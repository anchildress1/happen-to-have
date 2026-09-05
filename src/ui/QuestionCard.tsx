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
 * Client shell for `/answer`. Identity is created by this component's POST on mount, never
 * by the Server Component that renders it (contracts/session.md).
 *
 * Traversal is tab-local: skipping moves a pointer through the returned `queue` with no
 * cookie write and no microphone permission. Only a wrap re-fetches (FR-025).
 */
export function QuestionCard() {
  const [status, setStatus] = useState<Status>('loading');
  const [queue, setQueue] = useState<Question[]>([]);
  const [pointer, setPointer] = useState(0);
  const [isOnlyQuestion, setIsOnlyQuestion] = useState(false);
  // Guards against a slow first request resolving after a retry supersedes it.
  const requestId = useRef(0);
  // The queue as of now, readable from a response handler closed over an older render.
  const queueRef = useRef<Question[]>([]);

  // `keepVisible` swaps the queue underneath the rendered card: blanking mid-traversal
  // reads as the false empty state FR-029 forbids, and removes the button mid-press.
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
        // A refresh re-sorts, so the old index points at a different question. Re-find
        // the one on screen by id; carrying the index re-shows a question just left.
        setPointer((p) => {
          if (!options?.keepVisible) return 0;
          const currentId = queueRef.current[p]?.id;
          const found = data.queue.findIndex((q) => q.id === currentId);
          return found === -1 ? 0 : found;
        });
        setQueue(data.queue);
        setStatus(data.queue.length > 0 ? 'ready' : 'empty');
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

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

  // 'ready' is keyed off queue.length, so there is always an entry here. Modulo guards
  // a pointer left past the end by a refresh that returned fewer questions.
  const current = queue[pointer % queue.length];

  const handleTryAnother = () => {
    // FR-024: nowhere to advance to, so hold the question and say why.
    if (queue.length === 1) {
      setIsOnlyQuestion(true);
      return;
    }

    // Discrete click events flush synchronously, so `pointer` is this press's value.
    const next = pointer + 1;
    const wrapped = next >= queue.length;
    setPointer(wrapped ? 0 : next);

    // FR-025: a new pass re-fetches and re-sorts. The wrap above already moved the
    // screen, so the request only replaces the queue underneath it.
    if (wrapped) load({ keepVisible: true });
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
          {/* prefetch={false}: the href carries the question id, so every skip would
              otherwise fire a fresh RSC prefetch for a placeholder route. */}
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
