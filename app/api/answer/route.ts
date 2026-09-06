import { findBySubmission, publishAnswer } from '@/db/queries/answers';
import { getQuestionText } from '@/db/queries/questions';
import { reviewContribution } from '@/review';
import { readParticipantId } from '@/session/session';

/**
 * 003's submit endpoint: audio in, one rendered outcome out (FR-011 – FR-019).
 *
 * The order is not arbitrary. Review runs BEFORE any row is written, because a withheld or
 * failed attempt must leave nothing behind (Principle V, FR-019) — there is no status column
 * to clean up afterwards, by design.
 */
export const dynamic = 'force-dynamic';

/** 5 MB matches the review's own ceiling. Rejected here too, so a flood costs no parsing. */
const MAX_BYTES = 5 * 1024 * 1024;

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: Request): Promise<Response> {
  // No session, no submission. Never mints a participant here: doing so would let an
  // unauthenticated flood create rows, and 001 owns participant creation.
  const participantId = await readParticipantId(request);
  if (!participantId) {
    return json({ status: 'failed', cause: 'exhausted' }, 401);
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
    return json({ status: 'published', askGranted: false }, 200);
  }
  if (audio.size > MAX_BYTES) {
    return json({ status: 'withheld', reason: 'content', contentReason: 'unpublishable' }, 200);
  }

  const questionText = await getQuestionText(questionId);
  if (questionText === null) {
    // FR-018: the server does not trust that the interface offered a real question.
    return json({ status: 'failed', cause: 'exhausted' }, 200);
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
      // Review passed but a rule refused — answering your own question, or a second answer
      // that arrived while this one was in review. Not a content problem, and not the
      // participant being told their recording was bad.
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
