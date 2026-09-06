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
       -- FR-016: never your own question. NULL participant_id is a seeded question, which
       -- IS NOT DISTINCT FROM handles correctly where <> would drop the row.
       AND (q.participant_id IS DISTINCT FROM $2)
       -- FR-017: one PUBLISHED answer per participant per question. Withheld and failed
       -- attempts left no row, so FR-017a's retry is allowed by the same predicate.
       AND NOT EXISTS (
         SELECT 1 FROM answers a
          WHERE a.question_id = q.id AND a.participant_id = $2
       )
  ),
  published AS (
    INSERT INTO answers (question_id, participant_id, display_text, source_language, emotion)
    SELECT e.id, $2, $3, $4, $5 FROM eligible e
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
       -- Already holding one? Answering again does not stack asks (FR-020).
       AND can_ask = false
    RETURNING id
  )
  SELECT
    (SELECT id FROM published)                    AS answer_id,
    (SELECT count(*) FROM granted)::int > 0       AS ask_granted
`;

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
  },
  client: SqlClient = db,
): Promise<PublishResult> {
  // Validated here rather than trusted: both columns are uuid, so a malformed id surfaces as
  // a driver error rather than a decision the caller can render.
  const question = questionId.parse(input.questionId);
  const participant = participantId.parse(input.participantId);

  const { rows } = await client.query<{ answer_id: string | null; ask_granted: boolean }>(
    PUBLISH_ANSWER_SQL,
    [question, participant, input.displayText, input.sourceLanguage, input.emotion],
  );

  const row = rows[0];
  if (!row?.answer_id) {
    return { published: false, reason: 'ineligible' };
  }
  return { published: true, answerId: row.answer_id, askGranted: row.ask_granted };
}
