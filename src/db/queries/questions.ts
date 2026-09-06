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
 * plain `<>` never matches NULL, silently excluding every seeded row. `COUNT` stays
 * relational because a denormalized counter drifts, corrupting both the fewer-answers
 * bias (FR-018) and 004's closure rule.
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
