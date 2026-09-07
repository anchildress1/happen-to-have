import { findBySubmission, publishAnswer } from '@/db/queries/answers';
import { getQuestionText } from '@/db/queries/questions';
import { MAX_BYTES } from '@/review/audio';
import { reviewContribution } from '@/review';
import { readExistingParticipantId } from '@/session/session';

/**
 * 003's submit endpoint: audio in, one rendered outcome out (FR-011 – FR-019).
 *
 * The order is not arbitrary. Review runs BEFORE any row is written, because a withheld or
 * failed attempt must leave nothing behind (Principle V, FR-019) — there is no status column
 * to clean up afterwards, by design.
 */
export const dynamic = 'force-dynamic';

// Imported, not restated. It was declared here as a second independent literal with a comment
// claiming it "matches the review's own ceiling" — a claim nothing enforced, so changing one
// would have desynced them silently.

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: Request): Promise<Response> {
  // No session, no submission. Never mints a participant here: doing so would let an
  // unauthenticated flood create rows, and 001 owns participant creation.
  const participantId = await readExistingParticipantId(request);
  if (!participantId) {
    // `no-session`, not `exhausted` — nothing was exhausted, and `cause` is the field that
    // exists to distinguish these.
    return json({ status: 'failed', cause: 'no-session' }, 401);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ status: 'withheld', reason: 'content', contentReason: 'unintelligible' }, 200);
  }

  const audio = form.get('audio');
  const questionId = form.get('questionId');
  const submissionId = form.get('submissionId');
  const declaredDuration = Number(form.get('durationSeconds'));
  if (
    !(audio instanceof Blob) ||
    typeof questionId !== 'string' ||
    typeof submissionId !== 'string'
  ) {
    return json({ status: 'withheld', reason: 'content', contentReason: 'unintelligible' }, 200);
  }

  // FR-013. The recorder's ceiling is a product behaviour, not a security boundary — a
  // crafted request never runs it. Checked here, where it cannot be skipped.
  if (!Number.isInteger(declaredDuration) || declaredDuration < 1 || declaredDuration > 60) {
    return json({ status: 'withheld', reason: 'content', contentReason: 'unpublishable' }, 200);
  }

  // FR-015, SC-007. The retried-upload case: the insert landed, the response did not. Answered
  // from the existing row rather than re-reviewed, because the review was already paid for and
  // would be asked to judge the same audio a second time.
  const already = await findBySubmission(submissionId, participantId);
  if (already) {
    return json({ status: 'published', askGranted: already.askGranted }, 200);
  }
  if (audio.size > MAX_BYTES) {
    return json({ status: 'withheld', reason: 'content', contentReason: 'unpublishable' }, 200);
  }

  const questionText = await getQuestionText(questionId);
  if (questionText === null) {
    // FR-018: the server does not trust that the interface offered a real question.
    return json({ status: 'failed', cause: 'unknown-question' }, 200);
  }

  try {
    const outcome = await reviewContribution({
      kind: 'answer',
      audio: new Uint8Array(await audio.arrayBuffer()),
      mimeType: audio.type,
      questionText,
      participantId,
      // Aborting when the participant leaves stops us waiting; it does not stop the provider,
      // and usage is billed either way.
      signal: request.signal,
    });

    if (outcome.status !== 'publish') {
      // Withheld, failed and rate-limited all leave no row. The participant sees a page; the
      // database sees nothing, which is what makes FR-017a's retry work without bookkeeping.
      return json(outcome, 200);
    }

    const published = await publishAnswer({
      questionId,
      participantId,
      displayText: outcome.displayText,
      sourceLanguage: outcome.sourceLanguage,
      emotion: outcome.emotion,
      durationSeconds: declaredDuration,
      submissionId,
    });

    if (!published.published) {
      // Before calling it ineligible, check whether THIS submission won under another
      // request. Two requests carrying one submissionId can both clear the lookup above
      // before either insert commits; one publishes and the other's ON CONFLICT returns no
      // row. Reporting ineligible there tells the loser their answer was refused when it was
      // published and the ask granted.
      const raced = await findBySubmission(submissionId, participantId);
      if (raced) {
        return json({ status: 'published', askGranted: raced.askGranted }, 200);
      }

      // Genuinely refused by a rule — answering your own question, or a second answer to one
      // already answered. Not a content problem, and not the participant being told their
      // recording was bad.
      return json({ status: 'ineligible' }, 200);
    }

    return json({ status: 'published', askGranted: published.askGranted }, 200);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      // The participant is gone. Nothing to render, nothing written.
      return new Response(null, { status: 499 });
    }
    return json({ status: 'failed', cause: 'exhausted' }, 200);
  }
}
