'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { copy } from '@/copy';
import { Button } from '@/ui/Button';
import styles from './QuestionCard.module.css';

interface Question {
  id: string;
  displayText: string;
  publishedAnswers: number;
}

interface NextResponse {
  question: Question | null;
  queue: Question[];
}

type Status = 'loading' | 'ready' | 'empty' | 'error';

/**
 * Client shell for `/answer` (T052-T055). Identity is created here, by this
 * component's `POST /api/questions/next` on mount — never by the Server
 * Component that renders it (contracts/session.md, T054).
 *
 * Traversal is tab-local (research D11): the returned `queue` and a pointer
 * live only in this component's state. `Try another question` moves the
 * pointer — no cookie write, no repeat request, no microphone permission —
 * and wraps to the start past the last entry instead of faking an empty pool.
 */
export function QuestionCard() {
  const [status, setStatus] = useState<Status>('loading');
  const [queue, setQueue] = useState<Question[]>([]);
  const [pointer, setPointer] = useState(0);
  const [isOnlyQuestion, setIsOnlyQuestion] = useState(false);
  // Guards against a slow first request resolving after a retry supersedes it.
  const requestId = useRef(0);

  /**
   * `keepVisible` suppresses the loading state so a wrap refresh swaps the queue underneath
   * the rendered card. Blanking mid-traversal would read as the false empty state FR-029
   * exists to prevent, and it would strip the `Try another question` button out from under
   * the press that triggered it.
   */
  const load = useCallback((options?: { keepVisible?: boolean }) => {
    const id = ++requestId.current;
    setIsOnlyQuestion(false);
    if (!options?.keepVisible) setStatus('loading');

    fetch('/api/questions/next', { method: 'POST' })
      .then((res) => {
        if (!res.ok) throw new Error('selection_failed');
        return res.json() as Promise<NextResponse>;
      })
      .then((data) => {
        if (id !== requestId.current) return;
        setQueue(data.queue);
        // A wrap refresh must not move the pointer. It already jumped to 0 optimistically,
        // and the participant may have skipped again while the request was in flight —
        // resetting here would yank them back and re-show a question they just left,
        // breaking FR-024. Modulo only guards a queue that came back shorter.
        setPointer((p) =>
          options?.keepVisible ? (data.queue.length ? p % data.queue.length : 0) : 0,
        );
        setStatus(data.question ? 'ready' : 'empty');
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (status === 'loading') {
    return (
      <p className={styles.statusBody} aria-live="polite">
        {copy.loading}
      </p>
    );
  }

  if (status === 'error') {
    return (
      <div className={styles.status}>
        <h1 className={styles.statusHeading}>{copy.failure.heading}</h1>
        <p className={styles.statusBody}>{copy.failure.body}</p>
        <Button type="button" onClick={() => load()}>
          {copy.failure.action}
        </Button>
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div className={styles.status}>
        <h1 className={styles.statusHeading}>{copy.empty.heading}</h1>
        <p className={styles.statusBody}>{copy.empty.body}</p>
      </div>
    );
  }

  // status === 'ready': route.ts only reports 'ready' when `question` (===
  // `queue[0]`) is non-null, so `queue` always has at least one entry here.
  const current = queue[pointer] as Question;

  const handleTryAnother = () => {
    // FR-024: with one eligible question there is nowhere to advance to. Keep it on screen
    // and say so, rather than re-rendering the same card as if the press did nothing.
    if (queue.length === 1) {
      setIsOnlyQuestion(true);
      return;
    }

    const next = pointer + 1;
    if (next < queue.length) {
      setPointer(next);
      return;
    }

    // FR-025: the end of a pass refreshes and re-sorts the eligible list rather than
    // replaying a stale one, so a question published mid-traversal can appear and counts
    // that moved are re-read. Wrap optimistically first — the press must change the screen
    // now, not a round trip later, and the refreshed queue lands underneath.
    setPointer(0);
    load({ keepVisible: true });
  };

  return (
    <div className={styles.card}>
      <h1 className={styles.question}>{current.displayText}</h1>
      <div className={styles.panel}>
        <p className={styles.helperMobile}>{copy.selection.helperMobile}</p>
        <p className={styles.helperDesktop}>{copy.selection.helperDesktop}</p>
        {isOnlyQuestion ? (
          <p className={styles.onlyQuestion} aria-live="polite">
            {copy.selection.onlyQuestion}
          </p>
        ) : null}
        <div className={styles.actions}>
          {/* Placeholder target: 003 delivers /answer/record. This feature's code
              never touches getUserMedia, on this path or any other.

              prefetch={false} is load-bearing. The href carries the current
              question id, so every skip changes it and Next fires a fresh RSC
              prefetch for a route that is a placeholder — wasted round trips
              proportional to how much someone skips. It also makes "a skip
              issues zero network requests" (FR-020, FR-022) literally true
              rather than nearly true, which is the difference between an
              assertion that holds and one that flakes by viewport. */}
          <Link
            href={`/answer/record?questionId=${encodeURIComponent(current.id)}`}
            className={styles.primaryLink}
            prefetch={false}
          >
            {copy.action.canAnswer}
          </Link>
          <Button type="button" variant="ghost" onClick={handleTryAnother}>
            {copy.action.tryAnother}
          </Button>
        </div>
      </div>
    </div>
  );
}
