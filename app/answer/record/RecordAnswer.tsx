'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { copy } from '@/copy';
import { AppHeader } from '@/ui/AppHeader';
import { Button } from '@/ui/Button';
import { type ContributionOutcome, ContributionOutcomeView } from '@/ui/ContributionOutcome';
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
  const [outcome, setOutcome] = useState<ContributionOutcome | null>(null);

  /**
   * Capability is UNKNOWN until the browser tells us (FR-029).
   *
   * `canRecord()` reads `navigator`, which does not exist during the server render, so calling
   * it at render time made the server emit the unsupported page and the client emit the
   * controls — a deterministic hydration mismatch that flashes "This browser can't record
   * audio" at every supported browser on the way in.
   */
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(canRecord()), []);

  /**
   * One id per recording ATTEMPT, rotated when a new recording starts (FR-015, SC-007).
   *
   * It was minted once per page load. A participant who re-recorded after a Withheld — which
   * FR-027a exists to invite — reused the id, so the server replayed the first submission
   * instead of reviewing the new one. The retry was silently a no-op.
   */
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());

  async function startRecording() {
    setSubmissionId(crypto.randomUUID());
    await recorder.start();
  }

  async function submit(blob: Blob) {
    setChecking(true);
    const body = new FormData();
    body.set('audio', blob);
    body.set('questionId', questionId);
    // Stable across retries of THIS recording, fresh for the next one, so a dropped response
    // replays rather than re-reviews and a re-record is genuinely a new submission.
    body.set('submissionId', submissionId);
    body.set('durationSeconds', String(Math.max(1, recorder.seconds)));

    try {
      const response = await fetch('/api/answer', { method: 'POST', body });
      setOutcome((await response.json()) as ContributionOutcome);
    } catch {
      // A dropped connection is not proof that publication failed (FR-014), so this must not
      // say the recording was rejected — only that we could not confirm. `failed` renders
      // "Your recording was discarded", which is exactly the claim the requirement forbids;
      // the comment said so while the code did it anyway.
      setOutcome({ status: 'lost' });
    } finally {
      setChecking(false);
      // Principle IV: the browser releases its recording when the submission ends. Without
      // this the blob stayed in state while the outcome page was open — which is indefinitely,
      // if someone leaves the tab.
      recorder.discard();
    }
  }

  if (outcome) {
    return (
      <Screen header={<AppHeader />}>
        <Watermark />
        <ContributionOutcomeView
          outcome={outcome}
          kind="answer"
          questionId={questionId}
          onRetry={() => {
            setOutcome(null);
            recorder.discard();
          }}
        />
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

  if (questionText === null) {
    // No question, no recording. The heading was empty and the controls fully functional, so
    // someone could record a full minute against nothing and get `failed` on submit, with a
    // retry pointing back at the same missing question — a record-and-fail loop.
    return (
      <Screen header={<AppHeader />}>
        <Watermark />
        <h1>{copy.empty.heading}</h1>
        <p>{copy.empty.body}</p>
        <Link href="/answer">{copy.review.withheld.ghostAnswer}</Link>
      </Screen>
    );
  }

  // Unknown on the server and on the first client render; nothing is drawn until the browser
  // has answered, which is what keeps the markup identical on both sides.
  if (supported === null) {
    return (
      <Screen header={<AppHeader />}>
        <Watermark />
        {/* FR-002: the question is real content and renders on both sides, so the heading is
            identical server and client. Only the controls wait for the capability answer. */}
        <h1>{questionText}</h1>
      </Screen>
    );
  }

  if (!supported || recorder.state === 'unsupported') {
    // FR-029: rendered instead of the control, never after pressing it. `recorder.state` is
    // checked too — MediaRecorder can exist and still throw on construction, and that state
    // was produced and never consumed, leaving a dead Start button and no explanation.
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
        <p aria-live="polite">{copy.review.recording.timer(recorder.seconds, MAX_SECONDS)}</p>
      )}

      {/* FR-007: the limit stopping a recording is not a failure, and must not read as one. */}
      {recorder.reachedLimit && recorder.state === 'stopped' && (
        <p>{copy.review.recording.reachedLimit}</p>
      )}

      {/* The house Button, not a raw one. Hand-rolled <button> elements rendered at 21px —
          half the 44px touch target 001 holds every control to, on the screen a participant
          hits first and, on a phone, one-handed. `all: unset` in the reset is why: an
          unstyled button here has no padding at all. */}
      {recorder.state === 'recording' ? (
        <Button onClick={recorder.stop}>{copy.review.recording.stop}</Button>
      ) : (
        <Button onClick={startRecording} disabled={recorder.state === 'requesting'}>
          {recorder.blob ? copy.review.recording.again : copy.review.recording.start}
        </Button>
      )}

      {recorder.blob && recorder.state === 'stopped' && (
        <Button variant="ghost" onClick={() => recorder.blob && submit(recorder.blob)}>
          {copy.review.recording.submit}
        </Button>
      )}
    </Screen>
  );
}
