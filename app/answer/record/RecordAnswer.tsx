'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { copy } from '@/copy';
import { AppHeader } from '@/ui/AppHeader';
import { type AnswerOutcome, AnswerOutcomeView } from '@/ui/AnswerOutcome';
import { Screen } from '@/ui/Screen';
import { MAX_SECONDS, useRecorder } from '@/ui/useRecorder';
import { Watermark } from '@/ui/Watermark';

/**
 * Record an answer, submit it, render the verdict (US1, US2, US3).
 *
 * Three states, and the middle one blocks: while the review runs there is nothing to decide
 * and nothing to undo, so offering an action would only invite abandoning a submission that
 * has already been paid for.
 */
export function RecordAnswer() {
  const params = useSearchParams();
  const questionId = params.get('q') ?? '';
  const questionText = params.get('text') ?? '';

  const recorder = useRecorder();
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<AnswerOutcome | null>(null);

  async function submit(blob: Blob) {
    setChecking(true);
    const body = new FormData();
    body.set('audio', blob);
    body.set('questionId', questionId);

    try {
      const response = await fetch('/api/answer', { method: 'POST', body });
      setOutcome((await response.json()) as AnswerOutcome);
    } catch {
      // A dropped connection is not proof that publication failed (FR-014), so this must not
      // say the recording was rejected — only that we could not confirm.
      setOutcome({ status: 'failed' });
    } finally {
      setChecking(false);
    }
  }

  if (outcome) {
    return (
      <Screen header={<AppHeader />}>
        <Watermark />
        <AnswerOutcomeView outcome={outcome} />
      </Screen>
    );
  }

  if (checking) {
    // FR-029: blocking, no actions, announced rather than merely shown.
    return (
      <Screen>
        <div aria-live="polite" role="status">
          <h1>{copy.review.checking.headingAnswer}</h1>
          <p>{copy.review.checking.helper}</p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen header={<AppHeader />}>
      <Watermark />
      {/* FR-002: the question stays visible for the whole recording. */}
      <h1>{questionText || copy.recordPlaceholder.heading}</h1>

      {recorder.state === 'denied' && <p>{copy.review.failed.helper}</p>}

      {recorder.state === 'recording' && (
        <p aria-live="polite">
          {recorder.seconds}s / {MAX_SECONDS}s
        </p>
      )}

      {/* FR-007: the limit stopping a recording is not a failure, and must not read as one. */}
      {recorder.reachedLimit && recorder.state === 'stopped' && <p>That&apos;s the minute.</p>}

      {recorder.state === 'recording' ? (
        <button type="button" onClick={recorder.stop}>
          Stop
        </button>
      ) : (
        <button type="button" onClick={recorder.start} disabled={recorder.state === 'requesting'}>
          {recorder.blob ? 'Record again' : 'Start recording'}
        </button>
      )}

      {recorder.blob && recorder.state === 'stopped' && (
        <button type="button" onClick={() => recorder.blob && submit(recorder.blob)}>
          Share this answer
        </button>
      )}
    </Screen>
  );
}
