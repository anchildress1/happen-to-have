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

/**
 * Closes a question the only way the product can: three published answers from three distinct
 * participants (004 FR-023).
 *
 * Before 004 these suites set `questions.status = 'closed'` directly, which asserted a
 * mechanism no production code ever used — the column was written by nothing and 004 dropped
 * it. Closure is now derived from the answer rows, so a test that wants a closed question has
 * to create the thing that closes it.
 *
 * Mints its own participants rather than taking them: `UNIQUE (participant_id, question_id)`
 * means three answers require three participants, and a caller passing the same id twice would
 * get a constraint violation instead of a closed question.
 */
export async function closeQuestion(db: TestDb, questionId: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO participants DEFAULT VALUES RETURNING id',
  );
  const first = rows[0].id;
  const { rows: second } = await db.query<{ id: string }>(
    'INSERT INTO participants DEFAULT VALUES RETURNING id',
  );
  const { rows: third } = await db.query<{ id: string }>(
    'INSERT INTO participants DEFAULT VALUES RETURNING id',
  );
  await insertPublishedAnswers(db, questionId, [first, second[0].id, third[0].id]);
}
