import { z } from 'zod';
import { findQuestionBySubmission, publishQuestion } from '@/db/queries/questions';
import { readAskEligibility } from '@/db/queries/answers';
import { MAX_BYTES } from '@/review/audio';
import { reviewContribution } from '@/review';
import { readExistingParticipantId } from '@/session/session';

/**
 * 004's submit endpoint: audio in, one rendered outcome out.
 *
 * **Not `/api/question`.** That path exists and does the opposite — it is 001's *selection*
 * endpoint, which hands the caller a question to answer. Two opposite operations behind one
 * name, distinguished by nothing a reader sees, is the overloading research D4 rejected.
 *
 * The order is the contract's and is not arbitrary. Review runs BEFORE anything is written and
 * before the ask is touched, because a withheld or failed attempt must leave nothing behind —
 * no row, and no spent ask. That absence is what makes FR-021's "record another question with
 * the ask intact" true with no bookkeeping.
 */
export const dynamic = 'force-dynamic';

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: Request): Promise<Response> {
  // FR-002a. No session, no submission — and never mint a participant here: one created now
  // would arrive with `can_ask = false` and be refused a line later, having written a row for
  // a flood. 001 owns identity.
  const participantId = await readExistingParticipantId(request);
  if (!participantId) {
    return json({ status: 'failed', cause: 'no-session' }, 401);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ status: 'withheld', reason: 'content', contentReason: 'unintelligible' }, 200);
  }

  const audio = form.get('audio');
  const submissionId = form.get('submissionId');
  const declaredDuration = Number(form.get('durationSeconds'));
  // Shape AND format. A non-uuid string used to pass here: the replay lookup returns null for
  // it, so the request went on to spend rate-limit capacity and three provider calls before
  // `publishQuestion` threw on parsing it — and that throw was caught as an infrastructure
  // failure, blaming this system for input the caller malformed.
  if (
    !(audio instanceof Blob) ||
    typeof submissionId !== 'string' ||
    !z.uuid().safeParse(submissionId).success
  ) {
    return json({ status: 'withheld', reason: 'content', contentReason: 'unintelligible' }, 200);
  }

  // FR-014a. The retried-upload case, answered from the existing row rather than re-reviewed.
  // It runs before the eligibility read on purpose: by this point the ask is already spent, so
  // an eligibility check would refuse the very submission that spent it.
  const already = await findQuestionBySubmission(submissionId, participantId);
  if (already) {
    return json({ status: 'published' }, 200);
  }

  // Contract step 4. A read, and deliberately NOT the enforcement — it exists so a submission
  // the publish statement will refuse anyway does not first pay for three provider calls.
  // Trusting it *instead* of the statement's `WHERE can_ask = true` is the FR-004 violation.
  if (!(await readAskEligibility(participantId))) {
    return json({ status: 'spent' }, 200);
  }

  // FR-006a. The recorder's ceiling is a product behaviour, not a security boundary — a
  // crafted request never runs it. Checked here, before any provider call is made.
  if (!Number.isInteger(declaredDuration) || declaredDuration < 1 || declaredDuration > 60) {
    return json({ status: 'withheld', reason: 'content', contentReason: 'unpublishable' }, 200);
  }
  if (audio.size > MAX_BYTES) {
    return json({ status: 'withheld', reason: 'content', contentReason: 'unpublishable' }, 200);
  }

  try {
    const outcome = await reviewContribution({
      kind: 'question',
      audio: new Uint8Array(await audio.arrayBuffer()),
      mimeType: audio.type,
      // FR-003: relevance is not dispatched for a question, so there is nothing to judge it
      // against. Three calls, not four.
      questionText: null,
      participantId,
      signal: request.signal,
    });

    if (outcome.status !== 'publish') {
      // Withheld, failed and rate-limited all leave no row and no consumed ask.
      return json(outcome, 200);
    }

    const published = await publishQuestion({
      participantId,
      displayText: outcome.displayText,
      sourceLanguage: outcome.sourceLanguage,
      durationSeconds: declaredDuration,
      submissionId,
    });

    if (!published.published) {
      // Before calling it spent, check whether THIS submission won under another request.
      // Two requests carrying one submissionId can both clear the lookup above before either
      // commits; one publishes and the other's guard finds `can_ask` already false. Reporting
      // `spent` there tells the loser their question was refused when it was published.
      const raced = await findQuestionBySubmission(submissionId, participantId);
      if (raced) {
        return json({ status: 'published' }, 200);
      }
      return json({ status: 'spent' }, 200);
    }

    return json({ status: 'published' }, 200);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      // The participant is gone. Nothing written, nothing consumed, nobody to render for.
      return new Response(null, { status: 499 });
    }
    return json({ status: 'failed', cause: 'exhausted' }, 200);
  }
}
