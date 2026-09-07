import { z } from 'zod';
import { db, type SqlClient } from '../client';

export interface EligibleQuestion {
  id: string;
  display_text: string;
  published_answers: number;
}

/**
 * Every open question eligible for `participantId`, fewest published answers first.
 *
 * `IS DISTINCT FROM` is load-bearing: seeded questions carry a NULL `participant_id`, and
 * plain `<>` never matches NULL, silently excluding every seeded row.
 *
 * `HAVING COUNT(a.id) < 3` is 004's closure rule (FR-023, FR-023a), read rather than stored.
 * A question closes for routing once it holds three published answers, and because
 * `UNIQUE (participant_id, question_id)` makes a second published answer from one participant
 * unrepresentable, three answers ARE three distinct participants — so this counts rows rather
 * than re-deriving distinctness the schema already guarantees (FR-024).
 *
 * `COUNT(a.id)`, never `COUNT(*)`, and the reason is the reported count rather than the
 * routing decision. The LEFT JOIN gives a question with no answers one row whose `a.id` is
 * NULL: `COUNT(a.id)` sees 0, `COUNT(*)` sees 1. At a threshold of three that swap changes no
 * question's eligibility — both stay under it — so the closure tests alone cannot catch it.
 * What it corrupts is `published_answers`, which orders the queue for the fewer-answers bias
 * (FR-018), by reporting every unanswered question as having one answer. That is what the
 * count assertion in `closure.test.ts` exists to pin.
 *
 * The count stays relational because a denormalized counter drifts, corrupting both the
 * fewer-answers bias (FR-018) and closure at once.
 *
 * Closure is evaluated here, and the whole eligible queue then travels to the client with a
 * tab-local pointer (research D11). A queue fetched before a question's third answer landed
 * still holds it, so a participant can skip to it and answer it after it closed. That is an
 * accepted window, not an oversight: FR-027 already permits the fourth answer to publish, and
 * re-checking at publish time would put back the write FR-023a exists to avoid.
 */
export async function listEligibleQuestions(
  participantId: string,
  client: SqlClient = db,
): Promise<EligibleQuestion[]> {
  const { rows } = await client.query<EligibleQuestion>(
    `SELECT q.id, q.display_text, COUNT(a.id) AS published_answers
     FROM questions q
     LEFT JOIN answers a ON a.question_id = q.id
     WHERE q.participant_id IS DISTINCT FROM $1
       AND NOT EXISTS (
         SELECT 1 FROM answers x
         WHERE x.question_id = q.id AND x.participant_id = $1
       )
     GROUP BY q.id
     HAVING COUNT(a.id) < 3
     ORDER BY published_answers ASC, q.created_at ASC, q.id ASC`,
    [participantId],
  );
  return rows;
}

/**
 * The wire shape of one question, as `/api/question` returns it.
 *
 * Carries no answer data — not even a count. The count orders the queue here on the server
 * and stops; anything answer-derived reaching the browser is what would make "answer one to
 * ask one" inferable client-side instead of enforced.
 */
export interface SelectionPayload {
  question: { id: string; displayText: string } | null;
  queue: { id: string; displayText: string }[];
}

/**
 * Shape eligible rows into the response body. Extracted from the route handler so a test
 * exercises this transform rather than re-implementing its own copy of it.
 *
 * An empty list yields `question: null` — the FR-029 empty state, not an error. The whole
 * queue travels so skipping stays tab-local and never returns to the server (research D11).
 */
export function toSelectionPayload(eligible: EligibleQuestion[]): SelectionPayload {
  const queue = eligible.map((q) => ({
    id: q.id,
    displayText: q.display_text,
  }));
  return { question: queue[0] ?? null, queue };
}

/**
 * The question's text, or null when no such question exists.
 *
 * FR-018: eligibility is decided on the server regardless of what the interface allowed, so
 * the submit route reads the question itself rather than trusting a text field from the
 * client. A client-supplied question text would let anyone have any recording judged for
 * relevance against a question of their choosing.
 */
export async function getQuestionText(id: string, client: SqlClient = db): Promise<string | null> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) {
    return null;
  }

  const { rows } = await client.query<{ display_text: string }>(
    'SELECT display_text FROM questions WHERE id = $1',
    [parsed.data],
  );
  return rows[0]?.display_text ?? null;
}

/**
 * FR-014, FR-016, FR-019. Consuming the ask and creating the question are one statement.
 *
 * **The order is the concurrency control, and it is deliberately the reverse of 003's.**
 * `PUBLISH_ANSWER_SQL` inserts and then grants, which is safe only because granting is
 * idempotent: two answers both setting `can_ask = true` produce the state the product wants.
 * Consuming is not idempotent. Insert-first would let two concurrent requests each write a
 * question and then argue over one flag, and one ask would buy two questions.
 *
 * Here the `UPDATE … WHERE can_ask = true` runs first and takes a row lock. Two concurrent
 * statements serialize on it: the first flips the flag and returns a row, the second finds
 * `can_ask = false`, returns none, and its insert selects from an empty CTE and writes
 * nothing. No advisory lock, no serializable transaction, no read-then-write.
 */
export const PUBLISH_QUESTION_SQL = `
  WITH consumed AS (
    UPDATE participants
       SET can_ask = false
     WHERE id = $1
       -- FR-002 and FR-019 in one predicate. Also the whole of the race: a participant with
       -- no unspent ask matches nothing, so nothing below runs.
       AND can_ask = true
    RETURNING id
  ),
  published AS (
    INSERT INTO questions (participant_id, display_text, source_language,
                           duration_seconds, submission_id)
    SELECT c.id, $2, $3, $4, $5 FROM consumed c
    RETURNING id
  )
  SELECT (SELECT id FROM published) AS question_id
`;

/**
 * FR-014a. The question a submission id already produced, if any.
 *
 * The retried-upload case, and it matters more here than on the answer side. When a question
 * publishes and the response is lost, the ask is already spent — so without this the retry is
 * refused as ineligible and the participant is told they cannot ask, while their question sits
 * in the pool collecting answers they were never shown. They lost the ask and never saw what
 * it bought.
 *
 * Scoped to the participant as well as the id: a submission id identifies one recording
 * attempt, and answering another participant's id would be replaying their outcome.
 */
export const FIND_QUESTION_BY_SUBMISSION_SQL = `
  SELECT id FROM questions WHERE submission_id = $1 AND participant_id = $2
`;

export async function findQuestionBySubmission(
  submissionId: string,
  participantIdValue: string,
  client: SqlClient = db,
): Promise<{ questionId: string } | null> {
  const submission = z.uuid().safeParse(submissionId);
  const participant = z.uuid().safeParse(participantIdValue);
  if (!submission.success || !participant.success) {
    return null;
  }

  const { rows } = await client.query<{ id: string }>(FIND_QUESTION_BY_SUBMISSION_SQL, [
    submission.data,
    participant.data,
  ]);
  return rows[0] ? { questionId: rows[0].id } : null;
}

export type PublishQuestionResult =
  | { published: true; questionId: string }
  /** No unspent ask — held by nobody, or won by another request (research D6). */
  | { published: false; reason: 'spent' };

/**
 * Publishes the question and consumes the ask, atomically.
 *
 * Returns `spent` rather than throwing when the guard refuses: the caller renders a page
 * either way, and the review has already been paid for by this point.
 */
export async function publishQuestion(
  input: {
    participantId: string;
    displayText: string;
    sourceLanguage: string;
    durationSeconds: number;
    submissionId: string;
  },
  client: SqlClient = db,
): Promise<PublishQuestionResult> {
  // Validated here rather than trusted: both are uuid columns, so a malformed id would
  // surface as a driver error rather than a decision the caller can render.
  const participant = z.uuid().parse(input.participantId);
  const submission = z.uuid().parse(input.submissionId);

  const { rows } = await client.query<{ question_id: string | null }>(PUBLISH_QUESTION_SQL, [
    participant,
    input.displayText,
    input.sourceLanguage,
    input.durationSeconds,
    submission,
  ]);

  const questionId = rows[0]?.question_id;
  return questionId ? { published: true, questionId } : { published: false, reason: 'spent' };
}
