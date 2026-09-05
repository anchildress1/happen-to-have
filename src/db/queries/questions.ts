import { db, type SqlClient } from '../client';

export interface EligibleQuestion {
  id: string;
  display_text: string;
  published_answers: number;
}

/**
 * The native-SQL selection query from data-model.md ("Selection query"). Returns every
 * open question eligible for `participantId` — not their own, not already answered by
 * them, not closed — ordered least-published-answers first with a deterministic tiebreak.
 *
 * `IS DISTINCT FROM` is load-bearing: seeded questions carry `participant_id IS NULL`, and
 * plain `<>` never matches against NULL, silently excluding every seeded row.
 *
 * `COUNT` is computed relationally on every call. A denormalized counter is forbidden by
 * the constitution — it drifts, and a drifted count corrupts both the fewer-answers bias
 * (FR-018) and 004's three-answer closure rule.
 */
export async function listEligibleQuestions(
  participantId: string,
  client: SqlClient = db,
): Promise<EligibleQuestion[]> {
  const { rows } = await client.query<EligibleQuestion>(
    `SELECT q.id, q.display_text, COUNT(a.id) AS published_answers
     FROM questions q
     LEFT JOIN answers a ON a.question_id = q.id
     WHERE q.status = 'open'
       AND q.participant_id IS DISTINCT FROM $1
       AND NOT EXISTS (
         SELECT 1 FROM answers x
         WHERE x.question_id = q.id AND x.participant_id = $1
       )
     GROUP BY q.id
     ORDER BY published_answers ASC, q.created_at ASC, q.id ASC`,
    [participantId],
  );
  return rows;
}

/** The wire shape of one question, as `/api/questions/next` returns it. */
export interface SelectionPayload {
  question: { id: string; displayText: string; publishedAnswers: number } | null;
  queue: { id: string; displayText: string; publishedAnswers: number }[];
}

/**
 * Shape eligible rows into the response body.
 *
 * Extracted from the route handler so it can be tested directly. Left inline, a test could
 * only re-implement the transform and assert its own copy — which passes forever, including
 * after someone changes the real one.
 *
 * An empty list yields `question: null`, which is the FR-029 empty state and **not** an
 * error. The whole ordered list travels as `queue` so traversal stays tab-local: skipping
 * advances a pointer in page memory and never returns to the server (research D11).
 */
export function toSelectionPayload(eligible: EligibleQuestion[]): SelectionPayload {
  const queue = eligible.map((q) => ({
    id: q.id,
    displayText: q.display_text,
    publishedAnswers: q.published_answers,
  }));
  return { question: queue[0] ?? null, queue };
}
