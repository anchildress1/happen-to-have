'use client';

import { useEffect, useState } from 'react';
import { copy } from '@/copy';
import { Button } from '@/ui/Button';
import { canRecord, MAX_SECONDS, type useRecorder } from '@/ui/useRecorder';

/**
 * The recording controls, shared by the answer flow and the ask flow.
 *
 * Both flows record the same way — same ceiling, same timer, same three microphone-failure
 * states — and 004's FR-010a says so in requirement form: the question recorder reuses the
 * answer recorder rather than reimplementing it. `useRecorder` already shares the state
 * machine; this shares the markup that reads it, which is the half that had been copied.
 *
 * Only the submit label differs between the two callers, so that is the only prop that varies.
 * Everything else here is 003's, unchanged.
 */
export function RecorderPanel({
  recorder,
  submitLabel,
  onStart,
  onSubmit,
}: {
  recorder: ReturnType<typeof useRecorder>;
  submitLabel: string;
  /**
   * Starting is the caller's, not the recorder's: both flows rotate their submission id here,
   * and minting it once per page load instead is the bug 003 shipped — a re-record after a
   * Withheld reused the id, so the server replayed the first submission and the retry was
   * silently a no-op.
   */
  onStart: () => void;
  onSubmit: (blob: Blob) => void;
}) {
  /**
   * Capability is UNKNOWN until the browser answers. `canRecord()` reads `navigator`, which
   * does not exist during the server render, so calling it at render time makes the server
   * emit the unsupported message and the client emit the controls — a hydration mismatch that
   * flashes "This browser can't record audio" at every supported browser on the way in.
   *
   * Held here rather than in each caller because it is a fact about the recorder, and both
   * flows were carrying identical copies of the same three-state branch.
   */
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(canRecord()), []);

  // Nothing is drawn until the browser has answered, which keeps the markup identical on the
  // server and on the first client render.
  if (supported === null) {
    return null;
  }

  // Rendered INSTEAD of the control, never after pressing it (FR-029). `recorder.state` is
  // checked too: MediaRecorder can exist and still throw on construction, and that state was
  // once produced and never consumed, leaving a dead Start button and no explanation.
  if (!supported || recorder.state === 'unsupported') {
    return (
      <>
        <h2>{copy.review.recording.unsupported.heading}</h2>
        <p>{copy.review.recording.unsupported.helper}</p>
      </>
    );
  }

  return (
    <>
      {/* Three causes, three next actions. Sharing one message here told someone our
          processing failed when their browser had refused the microphone. */}
      {recorder.state === 'denied' && (
        <>
          <h2>{copy.review.recording.denied.heading}</h2>
          <p>{copy.review.recording.denied.helper}</p>
        </>
      )}
      {recorder.state === 'noDevice' && (
        <>
          <h2>{copy.review.recording.noDevice.heading}</h2>
          <p>{copy.review.recording.noDevice.helper}</p>
        </>
      )}

      {recorder.state === 'recording' && (
        <p aria-live="polite">{copy.review.recording.timer(recorder.seconds, MAX_SECONDS)}</p>
      )}

      {/* Reaching the ceiling is not a failure and must not read as one. */}
      {recorder.reachedLimit && recorder.state === 'stopped' && (
        <p>{copy.review.recording.reachedLimit}</p>
      )}

      {/* The house Button, not a raw one: `all: unset` in the reset leaves a bare <button>
          with no padding, rendering at half the 44px touch target 001 holds controls to. */}
      {recorder.state === 'recording' ? (
        <Button onClick={recorder.stop}>{copy.review.recording.stop}</Button>
      ) : (
        <Button onClick={onStart} disabled={recorder.state === 'requesting'}>
          {recorder.blob ? copy.review.recording.again : copy.review.recording.start}
        </Button>
      )}

      {recorder.blob && recorder.state === 'stopped' && (
        <Button variant="ghost" onClick={() => recorder.blob && onSubmit(recorder.blob)}>
          {submitLabel}
        </Button>
      )}
    </>
  );
}
