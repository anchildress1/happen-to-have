import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  findQuestionBySubmission,
  listEligibleQuestions,
  PUBLISH_QUESTION_SQL,
  publishQuestion,
} from '../../src/db/queries/questions.js';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * 004's publish statement against real Postgres via PGlite. The rules under test are all
 * races — two tabs, a double-tap, a retried upload — so they run as real SQL rather than
 * against a stub that would only replay what the test already assumed.
 *
 * The statement is called directly, never through the route. FR-002 requires the server to
 * refuse regardless of what the interface allowed, and only a direct call asks that question;
 * going through the route would prove the route hides a button.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.truncate();
});

afterAll(async () => {
  await db.close();
});

async function createParticipant(canAsk: boolean): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO participants (can_ask) VALUES ($1) RETURNING id',
    [canAsk],
  );
  return rows[0].id;
}

async function canAsk(participantId: string): Promise<boolean> {
  const { rows } = await db.query<{ can_ask: boolean }>(
    'SELECT can_ask FROM participants WHERE id = $1',
    [participantId],
  );
  return rows[0].can_ask;
}

async function questionCount(): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM questions',
  );
  return rows[0].count;
}

function submission(participantId: string, submissionId = randomUUID()) {
  return {
    participantId,
    displayText: 'How do you know when a repair is worth attempting yourself?',
    sourceLanguage: 'en',
    durationSeconds: 12,
    submissionId,
  };
}

describe('publishQuestion — consumption and creation are one statement (FR-014, FR-016)', () => {
  it('inserts the question and consumes the ask together', async () => {
    const participantId = await createParticipant(true);

    const result = await publishQuestion(submission(participantId), db);

    expect(result.published).toBe(true);
    expect(await questionCount()).toBe(1);
    expect(await canAsk(participantId)).toBe(false);
  });

  it('stores the duration and submission id the caller supplied', async () => {
    const participantId = await createParticipant(true);
    const submissionId = randomUUID();

    await publishQuestion({ ...submission(participantId, submissionId), durationSeconds: 47 }, db);

    const { rows } = await db.query<{ duration_seconds: number; submission_id: string }>(
      'SELECT duration_seconds, submission_id FROM questions',
    );
    expect(rows[0].duration_seconds).toBe(47);
    expect(rows[0].submission_id).toBe(submissionId);
  });
});

describe('publishQuestion — the ask gate (FR-002, SC-002)', () => {
  it('refuses a participant holding no ask, and writes nothing', async () => {
    const participantId = await createParticipant(false);

    const result = await publishQuestion(submission(participantId), db);

    expect(result).toEqual({ published: false, reason: 'spent' });
    expect(await questionCount()).toBe(0);
  });

  it('refuses a second question after the first spent the ask (FR-020)', async () => {
    const participantId = await createParticipant(true);
    await publishQuestion(submission(participantId), db);

    const second = await publishQuestion(submission(participantId), db);

    expect(second).toEqual({ published: false, reason: 'spent' });
    expect(await questionCount()).toBe(1);
  });

  it('refuses an unknown participant rather than throwing', async () => {
    const result = await publishQuestion(submission(randomUUID()), db);

    expect(result).toEqual({ published: false, reason: 'spent' });
    expect(await questionCount()).toBe(0);
  });
});

describe('publishQuestion — one ask buys one question (FR-019, SC-003, SC-005)', () => {
  it('publishes exactly one question when two submissions are issued together', async () => {
    const participantId = await createParticipant(true);

    const [first, second] = await Promise.all([
      publishQuestion(submission(participantId), db),
      publishQuestion(submission(participantId), db),
    ]);

    const published = [first, second].filter((result) => result.published);
    expect(published).toHaveLength(1);
    expect(await questionCount()).toBe(1);
    expect(await canAsk(participantId)).toBe(false);
  });

  /**
   * ⚠️ **The test above does not prove the race, and neither does any test in this file.**
   *
   * PGlite runs one in-process connection and serializes statements, so `Promise.all` here
   * executes them one after the other — measured: two concurrent `UPDATE`s both applied and
   * settled in issue order. The second call therefore only ever sees the committed
   * `can_ask = false`, which is the sequential case. The interleaving FR-019 defends against
   * cannot be constructed in this harness at all.
   *
   * Verified by mutation: rewriting the statement into 003's insert-then-consume order — the
   * shape that genuinely allows two questions on one ask — leaves every behavioural test in
   * this file green.
   *
   * So the statement's shape is asserted directly, which is the same conclusion 003 reached
   * for its own eligibility rules (research D2). 003 also records that its first attempt at
   * this was vacuous because it matched a string that appeared in a comment two lines below,
   * so the comments are stripped before anything is matched.
   */
  it('consumes the ask before inserting, which is what makes one ask buy one question', () => {
    const sql = PUBLISH_QUESTION_SQL.split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    const consume = sql.indexOf('UPDATE participants');
    const insert = sql.indexOf('INSERT INTO questions');

    expect(consume).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    // Order is the whole mechanism. Consuming first takes the row lock that serializes two
    // requests; inserting first would let both write a question and then argue over one flag.
    expect(consume).toBeLessThan(insert);
    // And the guard that makes the second attempt a no-op rather than a second consume.
    expect(sql).toContain('can_ask = true');
    // The insert must select FROM the consume, so no ask means no row.
    expect(sql).toMatch(/FROM\s+consumed/);
  });
});

describe('findQuestionBySubmission — replay after a lost response (FR-014a)', () => {
  it('returns the question a submission id already produced', async () => {
    const participantId = await createParticipant(true);
    const submissionId = randomUUID();
    const result = await publishQuestion(submission(participantId, submissionId), db);

    const replay = await findQuestionBySubmission(submissionId, participantId, db);

    expect(result.published).toBe(true);
    expect(replay).toEqual({ questionId: result.published ? result.questionId : '' });
  });

  it('returns null for a submission id that never published', async () => {
    const participantId = await createParticipant(true);

    expect(await findQuestionBySubmission(randomUUID(), participantId, db)).toBeNull();
  });

  it('does not replay another participant submission', async () => {
    const author = await createParticipant(true);
    const stranger = await createParticipant(true);
    const submissionId = randomUUID();
    await publishQuestion(submission(author, submissionId), db);

    // The id names one recording attempt. Answering it for anyone else would replay their
    // outcome to a participant who never made that submission.
    expect(await findQuestionBySubmission(submissionId, stranger, db)).toBeNull();
  });

  it('returns null for a malformed id rather than throwing', async () => {
    const participantId = await createParticipant(true);

    expect(await findQuestionBySubmission('not-a-uuid', participantId, db)).toBeNull();
  });
});

describe('a published question reaches the pool (FR-015, SC-006)', () => {
  it('becomes selectable by a different participant', async () => {
    const asker = await createParticipant(true);
    const reader = await createParticipant(false);
    const result = await publishQuestion(submission(asker), db);

    const eligible = await listEligibleQuestions(reader, db);

    expect(result.published).toBe(true);
    expect(eligible.map((q) => q.id)).toEqual([result.published ? result.questionId : '']);
  });

  it('is never offered back to its own asker (001 FR-016)', async () => {
    const asker = await createParticipant(true);
    await publishQuestion(submission(asker), db);

    expect(await listEligibleQuestions(asker, db)).toEqual([]);
  });
});
