import { z } from 'zod';
import { db, type SqlClient } from '../client';

/**
 * Publishing an answer, and the eligibility rules that gate it (FR-015 – FR-019).
 *
 * Every rule here is enforced in SQL rather than in a read-then-write, because all three are
 * races: two tabs, a double-tap, a retried request. A `SELECT` that says "not yet answered"
 * is true until the moment the second insert lands.
 */

/** FR-019. Publication and the ask grant are one statement, or neither happened. */
export const PUBLISH_ANSWER_SQL = `
  WITH eligible AS (
    SELECT q.id
      FROM questions q
     WHERE q.id = $1
       -- FR-016: never your own question. A seeded question has a NULL participant_id, and
       -- an inequality test against NULL yields NULL rather than true, dropping the row and
       -- refusing an answer to every seeded question in the pool. IS DISTINCT FROM keeps it.
       AND (q.participant_id IS DISTINCT FROM $2)
       -- FR-017: one PUBLISHED answer per participant per question. Withheld and failed
       -- attempts left no row, so FR-017a's retry is allowed by the same predicate.
       AND NOT EXISTS (
         SELECT 1 FROM answers a
          WHERE a.question_id = q.id AND a.participant_id = $2
       )
  ),
  published AS (
    INSERT INTO answers (question_id, participant_id, display_text, source_language, emotion,
                         duration_seconds, submission_id)
    SELECT e.id, $2, $3, $4, $5, $6, $7 FROM eligible e
    -- FR-015: exactly one answer per submission. The unique constraint is the backstop for
    -- the race the NOT EXISTS above cannot close on its own.
    ON CONFLICT (participant_id, question_id) DO NOTHING
    RETURNING id
  ),
  granted AS (
    UPDATE participants
       SET can_ask = true
     WHERE id = $2
       AND EXISTS (SELECT 1 FROM published)
       -- Already holding one? Answering again does not stack asks (FR-021). FR-020 is the copy.
       AND can_ask = false
    RETURNING id
  )
  SELECT
    (SELECT id FROM published)                    AS answer_id,
    (SELECT count(*) FROM granted)::int > 0       AS ask_granted
`;

/**
 * FR-015, SC-007. Returns the answer a submission id already produced, if any.
 *
 * This is the retried-upload case: the insert succeeded, the response never arrived, the
 * client sent the same recording again. Without this the retry is refused as "already
 * answered" and the participant is told they answered a question whose outcome they never
 * saw — which is indistinguishable, from their side, from having lost the answer.
 */
export const FIND_BY_SUBMISSION_SQL = `
  SELECT a.id, p.can_ask
    FROM answers a
    JOIN participants p ON p.id = a.participant_id
   WHERE a.submission_id = $1 AND a.participant_id = $2
`;

export async function findBySubmission(
  submissionId: string,
  participantIdValue: string,
  client: SqlClient = db,
): Promise<{ answerId: string; askGranted: boolean } | null> {
  const parsed = z.uuid().safeParse(submissionId);
  if (!parsed.success) {
    return null;
  }

  const { rows } = await client.query<{ id: string; can_ask: boolean }>(FIND_BY_SUBMISSION_SQL, [
    parsed.data,
    participantId.parse(participantIdValue),
  ]);
  // `can_ask` was already selected and thrown away, so a retry after a lost response always
  // reported askGranted:false and rendered "Your question is still waiting for you" — telling
  // someone who had just earned an ask that they had not. The contract says replay the
  // original outcome; this is the outcome.
  return rows[0] ? { answerId: rows[0].id, askGranted: rows[0].can_ask } : null;
}

export type PublishResult =
  | { published: true; answerId: string; askGranted: boolean }
  | { published: false; reason: 'ineligible' };

const participantId = z.uuid();
const questionId = z.uuid();

/**
 * Inserts the published answer and grants an ask, atomically.
 *
 * Returns `ineligible` rather than throwing when a rule refuses: the caller renders a page
 * either way, and the review has already been paid for by this point.
 */
export async function publishAnswer(
  input: {
    questionId: string;
    participantId: string;
    displayText: string;
    sourceLanguage: string;
    emotion: string | null;
    durationSeconds: number;
    submissionId: string;
  },
  client: SqlClient = db,
): Promise<PublishResult> {
  // Validated here rather than trusted: both columns are uuid, so a malformed id surfaces as
  // a driver error rather than a decision the caller can render.
  const question = questionId.parse(input.questionId);
  const participant = participantId.parse(input.participantId);

  const { rows } = await client.query<{ answer_id: string | null; ask_granted: boolean }>(
    PUBLISH_ANSWER_SQL,
    [
      question,
      participant,
      input.displayText,
      input.sourceLanguage,
      input.emotion,
      input.durationSeconds,
      z.uuid().parse(input.submissionId),
    ],
  );

  const row = rows[0];
  if (!row?.answer_id) {
    return { published: false, reason: 'ineligible' };
  }
  return { published: true, answerId: row.answer_id, askGranted: row.ask_granted };
}

/**
 * Whether this participant currently holds an unspent ask (FR-024, FR-025).
 *
 * The server's answer, and the only one that counts. 004 gates its route on this rather than
 * on anything the client sends: FR-024 makes client-supplied eligibility advisory, and FR-025
 * requires refusing a direct request that bypasses the interface entirely.
 *
 * Returns false for an unknown participant rather than throwing. A stale session cookie is a
 * caller with no ask, not an error to render.
 */
export async function readAskEligibility(
  participantIdValue: string,
  client: SqlClient = db,
): Promise<boolean> {
  const parsed = z.uuid().safeParse(participantIdValue);
  if (!parsed.success) {
    return false;
  }

  const { rows } = await client.query<{ can_ask: boolean }>(
    'SELECT can_ask FROM participants WHERE id = $1',
    [parsed.data],
  );
  return rows[0]?.can_ask ?? false;
}
