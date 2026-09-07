'use client';

import Link from 'next/link';
import { useState } from 'react';
import { copy } from '@/copy';
import { AppHeader } from '@/ui/AppHeader';
import { Button } from '@/ui/Button';
import { type ContributionOutcome, ContributionOutcomeView } from '@/ui/ContributionOutcome';
import { Screen } from '@/ui/Screen';
import { RecorderPanel } from '@/ui/RecorderPanel';
import { useRecorder } from '@/ui/useRecorder';
import { Watermark } from '@/ui/Watermark';

/**
 * Spend the ask: the unlocked state, the recorder, the checking state, the verdict.
 *
 * One route with client state rather than `/ask` plus `/ask/record`, because the design's
 * route map gives both screens the same URL and the unlocked state has nothing to fetch.
 *
 * The recorder is 003's, reused unchanged (FR-010a). Every microphone-failure state, the
 * sixty-second ceiling and the timer come with it; forking it would be two implementations of
 * the one capability the product cannot get wrong twice.
 */
export function AskQuestion() {
  const recorder = useRecorder();
  const [started, setStarted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<ContributionOutcome | null>(null);

  /**
   * One id per recording ATTEMPT, rotated when a new recording starts.
   *
   * 003 shipped this minted once per page load, which made a re-record after a Withheld reuse
   * the id — so the server replayed the first submission instead of reviewing the new one and
   * the retry was silently a no-op. Rotating here is what keeps FR-021's retry real.
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
    body.set('submissionId', submissionId);
    body.set('durationSeconds', String(Math.max(1, recorder.seconds)));

    try {
      const response = await fetch('/api/ask', { method: 'POST', body });
      setOutcome((await response.json()) as ContributionOutcome);
    } catch {
      // A dropped connection is not proof that publication failed, and here the stakes are
      // higher than on the answer side: the ask may already be spent. `lost` sends them to
      // Yours to look rather than claiming the recording was discarded.
      setOutcome({ status: 'lost' });
    } finally {
      setChecking(false);
      // Principle IV: the browser releases its recording when the submission ends.
      recorder.discard();
    }
  }

  if (outcome) {
    return (
      <Screen header={<AppHeader />}>
        <Watermark />
        <ContributionOutcomeView
          outcome={outcome}
          kind="question"
          // The ask flow creates a question rather than answering one, so there is no id for
          // a retry to carry — every question retry is a fresh recording at this same route.
          questionId=""
          onRetry={() => {
            setOutcome(null);
            recorder.discard();
            // Back to the unlocked state, not straight into a live recorder: the retry link
            // points at the route the participant is already on, and a Next `<Link>` to the
            // current route does not remount. 003 shipped that bug and the Withheld page just
            // sat there; this handler is what makes the click do something.
            setStarted(false);
          }}
        />
      </Screen>
    );
  }

  if (checking) {
    // Blocking, no actions, announced rather than merely shown. There is nothing to decide
    // while the review runs and nothing to undo, so offering an action would only invite
    // abandoning a submission already paid for.
    return (
      <Screen>
        <div aria-live="polite" role="status">
          <h1>{copy.review.checking.headingQuestion}</h1>
          <p>{copy.review.checking.helper}</p>
        </div>
      </Screen>
    );
  }

  // FR-004a. The unlocked state: start, or decline without spending. The ghost has to lead
  // somewhere that does not consume the ask, which is what makes its copy true.
  if (!started) {
    return (
      <Screen header={<AppHeader />}>
        <Watermark />
        <h1>{copy.ask.unlocked.heading}</h1>
        <p>{copy.ask.unlocked.helper}</p>
        <Button onClick={() => setStarted(true)}>{copy.ask.unlocked.action}</Button>
        <Link href="/answer">{copy.ask.unlocked.ghost}</Link>
      </Screen>
    );
  }

  return (
    <Screen header={<AppHeader />}>
      <Watermark />
      <h1>{copy.ask.recording.heading}</h1>
      <p>{copy.ask.recording.helper}</p>

      <RecorderPanel
        recorder={recorder}
        submitLabel={copy.ask.recording.submit}
        onStart={startRecording}
        onSubmit={submit}
      />

      {/* FR-016 in the participant's language, and it is true: nothing is consumed until the
          insert. This is what makes abandoning the flow feel safe. */}
      <p>{copy.ask.recording.footnote}</p>
    </Screen>
  );
}
