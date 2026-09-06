import type { TestDb } from './pglite';

/**
 * The one place a test inserts a published answer row.
 *
 * Two NOT NULL columns have been added to `answers` since 001 — `display_text`, then
 * `duration_seconds` and `submission_id` — and each broke the same three suites, which each
 * had their own insert with a different shape. A third would have done it again.
 *
 * Only the columns a caller actually cares about are parameters. Everything else takes a
 * value that is valid and uninteresting, because these suites assert on the row's existence
 * and its relationships, never on its text.
 */
export async function insertPublishedAnswer(
  db: TestDb,
  questionId: string,
  participantId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO answers (question_id, participant_id, display_text, duration_seconds, submission_id)
     VALUES ($1, $2, $3, 9, gen_random_uuid())`,
    [questionId, participantId, 'One thing at a time.'],
  );
}

/** The same, for several participants answering one question. */
export async function insertPublishedAnswers(
  db: TestDb,
  questionId: string,
  participantIds: readonly string[],
): Promise<void> {
  await db.query(
    `INSERT INTO answers (question_id, participant_id, display_text, duration_seconds, submission_id)
     SELECT $1, unnest($2::uuid[]), $3, 9, gen_random_uuid()`,
    [questionId, participantIds, 'One thing at a time.'],
  );
}
