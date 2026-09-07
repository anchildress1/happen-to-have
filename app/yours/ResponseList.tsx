'use client';

import { useEffect, useRef, useState } from 'react';
import { copy } from '@/copy';
import type { ResponseRow } from '@/schema/rows';
import styles from './page.module.css';

/**
 * The responses to one of the participant's questions, each with a `Listen` action.
 *
 * The only interactive part of `/yours`, which is why it is the only part that is a client
 * component. It receives its responses as props and never fetches history — the server already
 * knew all of it at request time.
 *
 * **Playback state is per response, keyed by answer id (FR-032).** There is no global spinner and
 * no shared error banner: pressing `Listen` on one response must not change the control, the
 * status, or the text of any other, and two responses may sit in different states at once.
 */

type PlaybackState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'playing' }
  /** 502. The attempt failed; a retry can work (FR-033). */
  | { kind: 'failed' }
  /** 503. Playback does not exist in this deployment; a retry never can (FR-034). */
  | { kind: 'unavailable' };

/** One response's live audio, held so a second press can stop the first rather than talk over it. */
interface ActivePlayback {
  audio: HTMLAudioElement;
  url: string;
}

export function ResponseList({ responses }: { responses: readonly ResponseRow[] }) {
  const [states, setStates] = useState<Record<string, PlaybackState>>({});

  // Keyed by answer id, so stopping one response's audio cannot touch another's (FR-032).
  //
  // A ref rather than state: this is resource ownership, never a render input. Object URLs are
  // pinned memory until revoked, and at 3-4 MB per response a participant who plays a
  // ten-response question twice would hold ~80 MB — which is what SC-010's "current iPhone
  // browser" does not survive. So each is revoked the moment its audio settles, and the unmount
  // sweep below is only the backstop for the one still playing when they navigate away.
  const active = useRef<Map<string, ActivePlayback>>(new Map());

  useEffect(() => {
    const playing = active.current;
    return () => {
      for (const { audio, url } of playing.values()) {
        audio.pause();
        URL.revokeObjectURL(url);
      }
      playing.clear();
    };
  }, []);

  const setState = (id: string, state: PlaybackState) =>
    setStates((current) => ({ ...current, [id]: state }));

  /** Stops and releases whatever this response was playing. Safe to call when nothing is. */
  function release(id: string) {
    const current = active.current.get(id);
    if (!current) {
      return;
    }
    current.audio.pause();
    URL.revokeObjectURL(current.url);
    active.current.delete(id);
  }

  async function play(id: string, state: PlaybackState) {
    // A press while the request is already in flight is a double-tap, not a new intent. Without
    // this the control would issue a second fetch — and the button stays enabled during loading
    // deliberately, because disabling the element the keyboard is focused on drops focus to
    // <body> and loses the participant's place in a list that can be dozens of stops long.
    if (state.kind === 'loading' || state.kind === 'unavailable') {
      return;
    }

    // Pressing Listen again mid-playback restarts this response rather than layering a second
    // copy over the first. Sixty seconds of speech is long enough that the second press is
    // ordinary, and two overlapping voices is the one outcome nobody wants.
    release(id);
    setState(id, { kind: 'loading' });

    // Created and primed HERE — synchronously, inside the click handler — and not after the
    // fetch. This is the whole fix for a bug that only appears on a real phone.
    //
    // Mobile Safari grants a *transient* activation window when the participant taps, and only
    // media elements touched inside that window may play programmatically later. An uncached
    // response spends several seconds in the TTS round trip below, by which point the window has
    // expired: constructing the element then and calling `play()` gets `NotAllowedError`, so the
    // very first Listen caches the audio successfully and plays nothing.
    //
    // `load()` on an element created during the gesture consumes the activation and unlocks this
    // element for the later `play()`. Desktop Chromium never needed it, which is exactly why the
    // Playwright suite could not have caught this — SC-010 names a current iPhone browser and the
    // suite runs five Chromium viewports.
    const audio = new Audio();
    audio.load();

    let response: Response;
    try {
      response = await fetch(`/api/playback/answer/${id}`, { method: 'POST' });
    } catch {
      setState(id, { kind: 'failed' });
      return;
    }

    // FR-034 and FR-033 differ exactly here. 503 means playback is absent from this deployment, so
    // the control degrades and no retry is offered — a retry that can never succeed is worse than
    // none. Every other failure is this attempt failing, and a retry may well work.
    if (response.status === 503) {
      setState(id, { kind: 'unavailable' });
      return;
    }
    if (!response.ok) {
      setState(id, { kind: 'failed' });
      return;
    }

    try {
      const url = URL.createObjectURL(await response.blob());
      // The element primed during the gesture, now given its source. Reusing it is the point —
      // a fresh `new Audio(url)` here would be an element the activation never touched.
      audio.src = url;
      active.current.set(id, { audio, url });

      // `playing` is set from the element's own event rather than after `play()` resolves. The
      // promise resolves when playback *begins*, so a very short clip can end first — and the
      // late `setState('playing')` would then overwrite the `ended` handler's `idle` and strand
      // the control claiming to play silence.
      audio.addEventListener('playing', () => setState(id, { kind: 'playing' }), { once: true });
      audio.addEventListener(
        'ended',
        () => {
          release(id);
          setState(id, { kind: 'idle' });
        },
        { once: true },
      );
      audio.addEventListener(
        'error',
        () => {
          release(id);
          setState(id, { kind: 'failed' });
        },
        { once: true },
      );

      await audio.play();
    } catch {
      // Belt and braces for the activation case above. If `play()` is still refused — a browser
      // stricter than the priming trick handles, or an activation that expired anyway — this
      // lands on `failed`, which offers `Try again`.
      //
      // That retry genuinely works rather than merely looking like it might: the audio was cached
      // server-side by the request that just completed, so the second press returns from the
      // `bytea` column in milliseconds and plays well inside a fresh activation window. The
      // expensive half never repeats.
      release(id);
      setState(id, { kind: 'failed' });
    }
  }

  return (
    // FR-017. A flat list. No nesting, no reply tree, and nothing to nest under.
    <ul className={styles.responses}>
      {responses.map((response) => {
        const state = states[response.id] ?? { kind: 'idle' };
        return (
          <li className={styles.response} key={response.id}>
            {/* FR-013, FR-030. Rendered in every state, including both failure states — the text
                never depends on the audio. */}
            <p className={styles.body}>{response.display_text}</p>

            <div className={styles.playback}>
              {/*
                Always mounted, never swapped out for a message. Unmounting the control a
                participant just activated drops keyboard focus to <body>; `unavailable` and
                `loading` are conveyed by `disabled`/`aria-busy` and by the live region instead.
              */}
              <button
                aria-busy={state.kind === 'loading'}
                className={styles.listen}
                disabled={state.kind === 'unavailable'}
                onClick={() => void play(response.id, state)}
                type="button"
              >
                {state.kind === 'failed' ? copy.failure.action : copy.yours.playback.listen}
              </button>

              {/*
                One live region per response, never one for the page — following QuestionCard.
                Always mounted with a single expression inside it, so every state change is one
                text swap the announcer will read. Rendering a state's message in a sibling
                element instead would leave this region unchanged and announce nothing.
              */}
              <p aria-live="polite" className={styles.playbackStatus}>
                {playbackStatus(state)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function playbackStatus(state: PlaybackState): string {
  switch (state.kind) {
    case 'loading':
      return copy.yours.playback.loading;
    case 'playing':
      return copy.yours.playback.playing;
    case 'failed':
      return copy.yours.playback.failed;
    case 'unavailable':
      return copy.yours.playback.unavailable;
    default:
      return '';
  }
}
