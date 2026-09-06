import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listEligibleQuestions, toSelectionPayload } from '../../src/db/queries/questions';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * FR-029 (contracts/routes.md, tasks.md T073): a participant whose pool has run dry gets
 * the same 200 response shape as anyone else — `{ question: null, queue: [] }` — never a
 * 500. `app/api/question/route.ts` computes `question = eligible[0] ? {...} : null`
 * with no separate "empty" branch, so an empty array out of `listEligibleQuestions` is
 * exactly, and only, what makes that contract hold; this exercises the three ways the real
 * exclusion rules (exclusions.test.ts) can jointly empty the pool for one participant.
 *
 * Real Postgres via PGlite, per exclusions.test.ts — no DATABASE_URL, no live Neon, client
 * injected directly into `listEligibleQuestions`.
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

async function createParticipant(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO participants DEFAULT VALUES RETURNING id',
  );
  return rows[0].id;
}

async function createQuestion(options: {
  authorId: string | null;
  status?: 'open' | 'closed';
}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO questions (participant_id, display_text, status)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [options.authorId, `empty-pool.test.ts fixture ${randomUUID()}`, options.status ?? 'open'],
  );
  return rows[0].id;
}

async function publishAnswer(questionId: string, participantId: string): Promise<void> {
  // display_text is NOT NULL since 003: a published answer carries the text a reader sees.
  // These suites only care that the row exists, so any valid text does.
  // duration_seconds and submission_id are NOT NULL since 003. These suites only care that
  // the row exists, so any valid values do — but the id must be fresh per row, because it is
  // unique across the table.
  await db.query(
    `INSERT INTO answers (question_id, participant_id, display_text, duration_seconds, submission_id)
     VALUES ($1, $2, $3, 9, gen_random_uuid())`,
    [questionId, participantId, 'One thing at a time.'],
  );
}

/**
 * The real transform the route handler uses — imported, not re-implemented. A local copy
 * would keep passing after someone changed the actual one, which is the failure mode this
 * test exists to prevent.
 */

describe('empty pool (FR-029, T073): zero eligible questions is not an error', () => {
  it('empties the pool when every open question belongs to the participant', async () => {
    const participantId = await createParticipant();
    const ownQuestionAId = await createQuestion({ authorId: participantId });
    const ownQuestionBId = await createQuestion({ authorId: participantId });

    const eligible = await listEligibleQuestions(participantId, db);

    expect(eligible).toEqual([]);
    expect(toSelectionPayload(eligible).question).toBeNull();
    const eligibleIds = eligible.map((q) => q.id);
    expect(eligibleIds).not.toContain(ownQuestionAId);
    expect(eligibleIds).not.toContain(ownQuestionBId);
  });

  it('empties the pool when the participant already has a published answer to every question', async () => {
    const participantId = await createParticipant();
    const answeredQuestionAId = await createQuestion({ authorId: null });
    const answeredQuestionBId = await createQuestion({ authorId: null });
    await publishAnswer(answeredQuestionAId, participantId);
    await publishAnswer(answeredQuestionBId, participantId);

    const eligible = await listEligibleQuestions(participantId, db);

    expect(eligible).toEqual([]);
    expect(toSelectionPayload(eligible).question).toBeNull();
    const eligibleIds = eligible.map((q) => q.id);
    expect(eligibleIds).not.toContain(answeredQuestionAId);
    expect(eligibleIds).not.toContain(answeredQuestionBId);
  });

  it('empties the pool when every question is closed', async () => {
    const participantId = await createParticipant();
    const closedQuestionAId = await createQuestion({ authorId: null, status: 'closed' });
    const closedQuestionBId = await createQuestion({ authorId: null, status: 'closed' });

    const eligible = await listEligibleQuestions(participantId, db);

    expect(eligible).toEqual([]);
    expect(toSelectionPayload(eligible).question).toBeNull();
    const eligibleIds = eligible.map((q) => q.id);
    expect(eligibleIds).not.toContain(closedQuestionAId);
    expect(eligibleIds).not.toContain(closedQuestionBId);
  });

  it('never hands back an ineligible question to fill the gap when all three exclusion rules empty the pool together', async () => {
    const participantId = await createParticipant();
    const ownQuestionId = await createQuestion({ authorId: participantId });
    const answeredQuestionId = await createQuestion({ authorId: null });
    await publishAnswer(answeredQuestionId, participantId);
    const closedQuestionId = await createQuestion({ authorId: null, status: 'closed' });

    const eligible = await listEligibleQuestions(participantId, db);

    expect(eligible).toEqual([]);
    expect(toSelectionPayload(eligible).question).toBeNull();
    const eligibleIds = eligible.map((q) => q.id);
    expect(eligibleIds).not.toContain(ownQuestionId);
    expect(eligibleIds).not.toContain(answeredQuestionId);
    expect(eligibleIds).not.toContain(closedQuestionId);
  });
});
