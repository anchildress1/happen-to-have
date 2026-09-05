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
  // Guards against a slow first request resolving after a retry supersedes it.
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    setStatus('loading');

    fetch('/api/questions/next', { method: 'POST' })
      .then((res) => {
        if (!res.ok) throw new Error('selection_failed');
        return res.json() as Promise<NextResponse>;
      })
      .then((data) => {
        if (id !== requestId.current) return;
        setQueue(data.queue);
        setPointer(0);
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
        <Button type="button" onClick={load}>
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
    setPointer((p) => (p + 1) % queue.length);
  };

  return (
    <div className={styles.card}>
      <h1 className={styles.question}>{current.displayText}</h1>
      <div className={styles.panel}>
        <p className={styles.helperMobile}>{copy.selection.helperMobile}</p>
        <p className={styles.helperDesktop}>{copy.selection.helperDesktop}</p>
        <div className={styles.actions}>
          {/* Placeholder target: 003 delivers /answer/record. This feature's code
              never touches getUserMedia, on this path or any other. */}
          <Link
            href={`/answer/record?questionId=${encodeURIComponent(current.id)}`}
            className={styles.primaryLink}
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
