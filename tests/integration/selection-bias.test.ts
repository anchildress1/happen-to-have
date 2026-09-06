import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listEligibleQuestions } from '../../src/db/queries/questions.js';
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
    `INSERT INTO questions (participant_id, display_text, status)
     VALUES (NULL, $1, 'open')
     RETURNING id`,
    [`selection-bias.test.ts fixture ${randomUUID()}`],
  );
  return rows[0].id;
}

/** Explicit id and created_at, so tie order is a property of the fixture, not of clock skew. */
async function createQuestionAt(id: string, createdAt: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO questions (id, participant_id, display_text, status, created_at)
     VALUES ($1, NULL, $2, 'open', $3)
     RETURNING id`,
    [id, `selection-bias.test.ts tie fixture ${id}`, createdAt],
  );
  return rows[0].id;
}

async function publishAnswers(questionId: string, forParticipantIds: string[]): Promise<void> {
  await db.query(
    `INSERT INTO answers (question_id, participant_id, display_text)
     SELECT $1, unnest($2::uuid[]), $3`,
    [questionId, forParticipantIds, 'One thing at a time.'],
  );
}

const SELECTIONS = 100;
// Comfortably larger than SELECTIONS: even if every one of the 100 loop selections below
// picks the low-count question, its count can never climb high enough to catch the
// high-count question's starting total. That keeps which question "wins" determined
// entirely by the count comparison for the whole loop — never by a created_at/id
// tie-break — which is what makes the assertion below immune to flaking.
const HIGH_COUNT_HEADSTART = SELECTIONS + 50;

describe('question selection bias toward fewer published answers (real Postgres SQL via PGlite)', () => {
  it(`prefers the lower-answer-count question in a large majority of ${SELECTIONS} selections`, async () => {
    // The high-count question is created FIRST on purpose. It therefore also wins the
    // created_at/id tie-break, so only `published_answers ASC` can put the low-count one
    // ahead — delete that clause and this test goes red instead of staying green.
    const highCountQuestionId = await createSeededQuestion();
    const lowCountQuestionId = await createSeededQuestion();

    const headstartParticipants = await createParticipants(HIGH_COUNT_HEADSTART);
    await publishAnswers(highCountQuestionId, headstartParticipants);

    const loopParticipants = await createParticipants(SELECTIONS);

    let lowCountWins = 0;
    let highCountWins = 0;

    for (const participantId of loopParticipants) {
      const eligible = await listEligibleQuestions(participantId, db);
      const contenders = eligible.filter(
        (question) => question.id === lowCountQuestionId || question.id === highCountQuestionId,
      );
      // Both fixtures are unauthored and unanswered by this fresh participant, so both
      // must always be present — a missing one means an exclusion rule regressed (see
      // exclusions.test.ts), not that the bias assertion below is meaningless.
      expect(contenders).toHaveLength(2);

      const winnerId = contenders[0].id;
      if (winnerId === lowCountQuestionId) {
        lowCountWins++;
      } else {
        highCountWins++;
      }
      await publishAnswers(winnerId, [participantId]);
    }

    expect(lowCountWins + highCountWins).toBe(SELECTIONS);
    // Generous margin, not an exact count: the low-count question must win a clear,
    // large majority of a 100-selection sample rather than matching one specific number.
    expect(lowCountWins).toBeGreaterThan(highCountWins);
    expect(lowCountWins).toBeGreaterThanOrEqual(SELECTIONS * 0.9);
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
