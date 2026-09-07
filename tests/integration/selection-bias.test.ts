import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listEligibleQuestions } from '../../src/db/queries/questions.js';
import { insertPublishedAnswers } from '../helpers/answers.js';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * Validates FR-018 / SC-004 against PGlite — real Postgres compiled to WASM, in-process,
 * no network, no shared state. The selection query's strict ascending order (data-model.md
 * "Selection query", research D10) produces a fewer-published-answers BIAS in aggregate,
 * not a fixed single winner every pass. The assertion below reads relative frequency over
 * a large sample with a wide margin rather than an exact ordering of any single call, per
 * research D10 — so it cannot flake.
 *
 * The client is injected directly into `listEligibleQuestions` rather than mocking
 * `../client`, so the selection SQL itself still runs, unmodified, against real Postgres
 * semantics — and every one of the 100 round trips below stays in-process.
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
    'INSERT INTO participants (id) SELECT gen_random_uuid() FROM generate_series(1, $1) RETURNING id',
    [count],
  );
  return rows.map((row) => row.id);
}

async function createSeededQuestion(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO questions (participant_id, display_text)
     VALUES (NULL, $1)
     RETURNING id`,
    [`selection-bias.test.ts fixture ${randomUUID()}`],
  );
  return rows[0].id;
}

/** Explicit id and created_at, so tie order is a property of the fixture, not of clock skew. */
async function createQuestionAt(id: string, createdAt: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO questions (id, participant_id, display_text, created_at)
     VALUES ($1, NULL, $2, $3)
     RETURNING id`,
    [id, `selection-bias.test.ts tie fixture ${id}`, createdAt],
  );
  return rows[0].id;
}

/** Selection order is the assertion in every test here, so ids are compared as a list. */
function idsOf(questions: readonly { id: string }[]): string[] {
  return questions.map((question) => question.id);
}

async function publishAnswers(questionId: string, forParticipantIds: string[]): Promise<void> {
  await insertPublishedAnswers(db, questionId, forParticipantIds);
}

/**
 * 004's closure rule caps a question at three published answers (FR-023), so the whole domain
 * the fewer-answers bias can ever operate over is 0, 1 and 2. The earlier version of this
 * suite gave one fixture a 150-answer headstart and ran a 100-selection loop that published to
 * each winner — both of which closure now makes impossible, and the loop went red the moment
 * closure landed.
 *
 * A statistical loop was the wrong shape anyway: `ORDER BY published_answers ASC, created_at
 * ASC, id ASC` is deterministic, so a hundred samples of a deterministic ordering measure
 * nothing a single assertion does not. What follows walks every gap the rule permits instead.
 */
describe('question selection bias toward fewer published answers (real Postgres SQL via PGlite)', () => {
  it('prefers the lower-answer-count question at every gap closure permits', async () => {
    // Created FIRST on purpose, so it also wins the created_at/id tie-break. Only
    // `published_answers ASC` can put the low-count question ahead of it — delete that clause
    // and this test goes red instead of staying green.
    const highCountQuestionId = await createSeededQuestion();
    const lowCountQuestionId = await createSeededQuestion();

    const seeders = await createParticipants(4);
    await publishAnswers(highCountQuestionId, seeders.slice(0, 2));

    const reader = (await createParticipants(1))[0];

    // 2 versus 0.
    let eligible = await listEligibleQuestions(reader, db);
    expect(idsOf(eligible)).toEqual([lowCountQuestionId, highCountQuestionId]);

    // 2 versus 1 — still the lower count, and still against the tie-break.
    await publishAnswers(lowCountQuestionId, [seeders[2]]);
    eligible = await listEligibleQuestions(reader, db);
    expect(idsOf(eligible)).toEqual([lowCountQuestionId, highCountQuestionId]);

    // 2 versus 2 — the counts tie, so created_at decides and the older one leads. This is the
    // assertion that proves the ordering above came from the count and not from insertion
    // order.
    await publishAnswers(lowCountQuestionId, [seeders[3]]);
    eligible = await listEligibleQuestions(reader, db);
    expect(idsOf(eligible)).toEqual([highCountQuestionId, lowCountQuestionId]);
  });

  it('drops a question from selection once it reaches three published answers (004 FR-023)', async () => {
    const closingQuestionId = await createSeededQuestion();
    const openQuestionId = await createSeededQuestion();
    const answerers = await createParticipants(3);

    await publishAnswers(closingQuestionId, answerers.slice(0, 2));
    const reader = (await createParticipants(1))[0];
    expect(idsOf(await listEligibleQuestions(reader, db))).toContain(closingQuestionId);

    await publishAnswers(closingQuestionId, [answerers[2]]);
    const after = idsOf(await listEligibleQuestions(reader, db));
    expect(after).not.toContain(closingQuestionId);
    expect(after).toContain(openQuestionId);
  });
});

describe('stable ties: equal counts fall back to created_at then id (SC-004)', () => {
  it('orders equal-count questions by created_at ascending', async () => {
    const participantId = (await createParticipants(1))[0];
    const newest = await createQuestionAt(
      '33333333-3333-4333-8333-333333333333',
      '2026-03-03T00:00:00Z',
    );
    const oldest = await createQuestionAt(
      '11111111-1111-4111-8111-111111111111',
      '2026-01-01T00:00:00Z',
    );
    const middle = await createQuestionAt(
      '22222222-2222-4222-8222-222222222222',
      '2026-02-02T00:00:00Z',
    );

    const eligible = await listEligibleQuestions(participantId, db);

    // Inserted newest-first, so insertion order cannot be what produces this.
    expect(eligible.map((q) => q.id)).toEqual([oldest, middle, newest]);
  });

  it('orders questions sharing a created_at by id ascending', async () => {
    const participantId = (await createParticipants(1))[0];
    const sameInstant = '2026-04-04T00:00:00Z';
    const higherId = await createQuestionAt('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sameInstant);
    const lowerId = await createQuestionAt('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sameInstant);

    const eligible = await listEligibleQuestions(participantId, db);

    expect(eligible.map((q) => q.id)).toEqual([lowerId, higherId]);
  });
});
