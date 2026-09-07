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

export function ResponseList({ responses }: { responses: readonly ResponseRow[] }) {
  const [states, setStates] = useState<Record<string, PlaybackState>>({});

  // Object URLs are leaked memory until revoked, and a participant who plays every response in a
  // long history would accumulate one per play. Held in a ref rather than state because revoking
  // them is cleanup, never a render input.
  const objectUrls = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of objectUrls.current) {
        URL.revokeObjectURL(url);
      }
      objectUrls.current = [];
    },
    [],
  );

  const setState = (id: string, state: PlaybackState) =>
    setStates((current) => ({ ...current, [id]: state }));

  async function play(id: string) {
    setState(id, { kind: 'loading' });

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
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      objectUrls.current.push(url);

      const audio = new Audio(url);
      audio.addEventListener('ended', () => setState(id, { kind: 'idle' }), { once: true });
      audio.addEventListener('error', () => setState(id, { kind: 'failed' }), { once: true });
      await audio.play();
      setState(id, { kind: 'playing' });
    } catch {
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
              {state.kind === 'unavailable' ? (
                <p className={styles.playbackStatus}>{copy.yours.playback.unavailable}</p>
              ) : (
                <button
                  className={styles.listen}
                  disabled={state.kind === 'loading'}
                  onClick={() => void play(response.id)}
                  type="button"
                >
                  {state.kind === 'failed' ? copy.failure.action : copy.yours.playback.listen}
                </button>
              )}

              {/* One live region per response, never one for the page — following QuestionCard.
                  Always present so a status change is announced rather than the region appearing. */}
              <p aria-live="polite" className={styles.playbackStatus}>
                {state.kind === 'loading' ? copy.yours.playback.loading : ''}
                {state.kind === 'failed' ? copy.yours.playback.failed : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
