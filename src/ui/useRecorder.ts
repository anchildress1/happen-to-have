'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** FR-006. Hard stop; the recorder enforces it so the server never has to trust a duration. */
export const MAX_SECONDS = 60;

/**
 * The formats the two target browsers actually produce, in preference order. Chosen with
 * `isTypeSupported` rather than assumed: mobile Safari has no WebM and Chrome has no MP4, so
 * a hard-coded type silently records nothing on one of them.
 *
 * The codec-qualified strings are deliberate — that is what MediaRecorder reports back, and
 * the server matches its allowlist on the base type so they are accepted.
 */
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
];

export function pickMimeType(
  isSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
): string | null {
  return PREFERRED_TYPES.find(isSupported) ?? null;
}

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopped' | 'denied';

export interface Recorder {
  state: RecorderState;
  /** Whole seconds elapsed, for the FR-005 readout. */
  seconds: number;
  /** True when recording stopped because the limit was reached, not because of a fault (FR-007). */
  reachedLimit: boolean;
  blob: Blob | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useRecorder(): Recorder {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [reachedLimit, setReachedLimit] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);

  // Releases the microphone. Without this the browser keeps showing the recording indicator
  // after the participant has moved on, which reads as the app still listening.
  const release = useCallback(() => {
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
  }, []);

  useEffect(() => release, [release]);

  const stop = useCallback(() => {
    recorder.current?.state === 'recording' && recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    setState('requesting');
    setReachedLimit(false);
    setSeconds(0);
    chunks.current = [];

    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denial is a state, not an error to surface raw: FR-007's sibling case, where the
      // participant needs to know what to do rather than what failed.
      setState('denied');
      return;
    }

    stream.current = media;
    const mimeType = pickMimeType();
    const instance = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
    recorder.current = instance;

    instance.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    instance.onstop = () => {
      setBlob(new Blob(chunks.current, { type: instance.mimeType }));
      setState('stopped');
      release();
    };

    instance.start();
    setState('recording');
  }, [release]);

  // One interval, owned by the recording state rather than by start(), so a stop from any
  // source clears it. The limit is enforced here and not by a setTimeout, because a timeout
  // that fires while the tab is backgrounded would cut a recording the participant is still
  // making.
  useEffect(() => {
    if (state !== 'recording') return;

    const started = Date.now();
    const tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) {
        setReachedLimit(true);
        stop();
      }
    }, 250);

    return () => clearInterval(tick);
  }, [state, stop]);

  return { state, seconds, reachedLimit, blob, start, stop };
}
