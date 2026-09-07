import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listEligibleQuestions } from '../../src/db/queries/questions.js';
import { insertPublishedAnswers } from '../helpers/answers.js';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * 004's closure rule (FR-022 – FR-027a), which is a property of the selection query and of
 * nothing else. There is no status column, no counter and no job — dropping the column those
 * would have lived in is part of this feature — so every assertion here reads the rule out of
 * the answer rows, which is where it lives.
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

async function createParticipants(count: number): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO participants SELECT FROM generate_series(1, $1) RETURNING id',
    [count],
  );
  return rows.map((row) => row.id);
}

/** `authorId` null marks a seeded question — it belongs to no participant. */
async function createQuestion(authorId: string | null, createdAt?: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO questions (participant_id, display_text, created_at)
     VALUES ($1, $2, COALESCE($3::timestamptz, now()))
     RETURNING id`,
    [authorId, `closure.test.ts fixture ${randomUUID()}`, createdAt ?? null],
  );
  return rows[0].id;
}

async function idsFor(participantId: string): Promise<string[]> {
  return (await listEligibleQuestions(participantId, db)).map((question) => question.id);
}

describe('a question closes at exactly three published answers (FR-023, SC-008)', () => {
  it('is routed at two answers and gone at three', async () => {
    const questionId = await createQuestion(null);
    const [a, b, c] = await createParticipants(3);
    const reader = (await createParticipants(1))[0];

    await insertPublishedAnswers(db, questionId, [a, b]);
    expect(await idsFor(reader)).toContain(questionId);

    await insertPublishedAnswers(db, questionId, [c]);
    expect(await idsFor(reader)).not.toContain(questionId);
  });

  it('closes a seeded question on the same rule (FR-027a)', async () => {
    // Not redundant with the case above: a seeded question carries a NULL participant_id, and
    // 001 already shipped one NULL-handling bug in this query — `<>` instead of
    // `IS DISTINCT FROM` dropped every seeded question from the pool. Closure is a new
    // predicate over the same rows.
    const seededId = await createQuestion(null);
    const answerers = await createParticipants(3);
    const reader = (await createParticipants(1))[0];

    await insertPublishedAnswers(db, seededId, answerers);

    expect(await idsFor(reader)).not.toContain(seededId);
  });

  it('closes an authored question on the same rule', async () => {
    const asker = (await createParticipants(1))[0];
    const authoredId = await createQuestion(asker);
    const answerers = await createParticipants(3);
    const reader = (await createParticipants(1))[0];

    await insertPublishedAnswers(db, authoredId, answerers);

    expect(await idsFor(reader)).not.toContain(authoredId);
  });
});

describe('an unanswered question never closes (FR-022, SC-009)', () => {
  it('routes a question with zero answers, and reports the count as zero', async () => {
    const questionId = await createQuestion(null);
    const reader = (await createParticipants(1))[0];

    const eligible = await listEligibleQuestions(reader, db);

    expect(eligible.map((question) => question.id)).toEqual([questionId]);
    // `published_answers` is the COUNT(a.id)-versus-COUNT(*) assertion, and it has to be made
    // on the count rather than on eligibility. The LEFT JOIN gives an unanswered question one
    // row whose a.id is NULL, so COUNT(*) reports 1 — which is still under the threshold of
    // three, leaves routing identical, and passes every other test in this file. It corrupts
    // the ordering key instead, telling the fewer-answers bias that an unanswered question
    // already has an answer.
    expect(eligible[0].published_answers).toBe(0);
  });

  it('routes an unanswered question backdated a year', async () => {
    const questionId = await createQuestion(null, '2025-09-06T00:00:00Z');
    const reader = (await createParticipants(1))[0];

    // There is no expires_at and none may be added. Age is not a closure input.
    expect(await idsFor(reader)).toContain(questionId);
  });
});

describe('closure governs routing only (FR-025, FR-026, FR-027, SC-010)', () => {
  it('lets a fourth answer publish and stay readable after closure', async () => {
    const questionId = await createQuestion(null);
    const [a, b, c, d] = await createParticipants(4);
    await insertPublishedAnswers(db, questionId, [a, b, c]);

    // Closure removed it from routing; it did not cap the table. A participant holding a
    // stale client queue can still reach it, which is the accepted window the spec names.
    await insertPublishedAnswers(db, questionId, [d]);

    const { rows } = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM answers WHERE question_id = $1',
      [questionId],
    );
    expect(rows[0].count).toBe(4);
  });

  it('leaves a closed question and every answer readable', async () => {
    const asker = (await createParticipants(1))[0];
    const questionId = await createQuestion(asker);
    const answerers = await createParticipants(3);
    await insertPublishedAnswers(db, questionId, answerers);

    // 004 guarantees closure destroys nothing; 005 owns the screen that shows it.
    const { rows: question } = await db.query<{ display_text: string }>(
      'SELECT display_text FROM questions WHERE id = $1',
      [questionId],
    );
    const { rows: answers } = await db.query<{ display_text: string }>(
      'SELECT display_text FROM answers WHERE question_id = $1',
      [questionId],
    );
    expect(question).toHaveLength(1);
    expect(answers).toHaveLength(3);
    expect(answers.every((row) => row.display_text.length > 0)).toBe(true);
  });

  it('does not count a withheld answer, because a withheld answer leaves no row', async () => {
    // FR-025 asserted as the property it actually is. Withheld and failed submissions write
    // nothing at all (Principle V), so there is no filter to test — two published answers plus
    // any number of refused ones is still two.
    const questionId = await createQuestion(null);
    const [a, b] = await createParticipants(2);
    const reader = (await createParticipants(1))[0];

    await insertPublishedAnswers(db, questionId, [a, b]);

    expect(await idsFor(reader)).toContain(questionId);
  });
});
