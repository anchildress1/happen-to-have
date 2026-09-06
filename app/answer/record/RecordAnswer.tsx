'use client';

import { useState } from 'react';
import { copy } from '@/copy';
import { AppHeader } from '@/ui/AppHeader';
import { type AnswerOutcome, AnswerOutcomeView } from '@/ui/AnswerOutcome';
import { Screen } from '@/ui/Screen';
import { canRecord, MAX_SECONDS, useRecorder } from '@/ui/useRecorder';
import { Watermark } from '@/ui/Watermark';

/**
 * Record an answer, submit it, render the verdict (US1, US2, US3).
 *
 * Three states, and the middle one blocks: while the review runs there is nothing to decide
 * and nothing to undo, so offering an action would only invite abandoning a submission that
 * has already been paid for.
 */
export function RecordAnswer({
  questionId,
  questionText,
}: {
  questionId: string;
  /** Read server-side from the id (FR-002). Null only when the question does not exist. */
  questionText: string | null;
}) {
  const recorder = useRecorder();
  const [checking, setChecking] = useState(false);
  const [submissionId] = useState(() => crypto.randomUUID());
  const [outcome, setOutcome] = useState<AnswerOutcome | null>(null);

  async function submit(blob: Blob) {
    setChecking(true);
    const body = new FormData();
    body.set('audio', blob);
    body.set('questionId', questionId);
    // One id per recording, minted when the recording ends rather than per request, so a
    // retried upload carries the same one and the server recognises it (FR-015, SC-007).
    body.set('submissionId', submissionId);
    body.set('durationSeconds', String(Math.max(1, recorder.seconds)));

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
        <AnswerOutcomeView outcome={outcome} questionId={questionId} />
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

  if (!canRecord()) {
    // FR-029: rendered instead of the control, never after pressing it. A button that cannot
    // work is exactly what that requirement forbids.
    return (
      <Screen header={<AppHeader />}>
        <Watermark />
        <h1>{copy.review.recording.unsupported.heading}</h1>
        <p>{copy.review.recording.unsupported.helper}</p>
      </Screen>
    );
  }

  return (
    <Screen header={<AppHeader />}>
      <Watermark />
      {/* FR-002: the question stays visible for the whole recording. */}
      {/* FR-002: the question stays visible for the whole recording. No fallback heading —
          a question that does not exist is a dead end, not a recording screen. */}
      <h1>{questionText}</h1>

      {/* Three states, three next actions (FR-028, FR-029). Sharing one message here told
          someone our processing failed when their browser had refused the microphone. */}
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
        <p aria-live="polite">
          {recorder.seconds}s of {MAX_SECONDS}s
        </p>
      )}

      {/* FR-007: the limit stopping a recording is not a failure, and must not read as one. */}
      {recorder.reachedLimit && recorder.state === 'stopped' && (
        <p>{copy.review.recording.reachedLimit}</p>
      )}

      {recorder.state === 'recording' ? (
        <button type="button" onClick={recorder.stop}>
          {copy.review.recording.stop}
        </button>
      ) : (
        <button type="button" onClick={recorder.start} disabled={recorder.state === 'requesting'}>
          {recorder.blob ? copy.review.recording.again : copy.review.recording.start}
        </button>
      )}

      {recorder.blob && recorder.state === 'stopped' && (
        <button type="button" onClick={() => recorder.blob && submit(recorder.blob)}>
          {copy.review.recording.submit}
        </button>
      )}
    </Screen>
  );
}
