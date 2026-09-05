import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listEligibleQuestions } from '../../src/db/queries/questions.js';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * Exercises the exclusion rules of the real selection query (data-model.md "Selection
 * query", src/db/queries/questions.ts) against PGlite — real Postgres compiled to WASM,
 * in-process, no network, no shared state with anything else. The client is injected
 * directly into `listEligibleQuestions` rather than mocking `../client`, so the selection
 * SQL runs unmodified against real Postgres semantics.
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
    [options.authorId, `exclusions.test.ts fixture ${randomUUID()}`, options.status ?? 'open'],
  );
  return rows[0].id;
}

async function publishAnswer(questionId: string, participantId: string): Promise<void> {
  await db.query('INSERT INTO answers (question_id, participant_id) VALUES ($1, $2)', [
    questionId,
    participantId,
  ]);
}

function idsOf(eligible: { id: string }[]): string[] {
  return eligible.map((question) => question.id);
}

describe('question selection exclusions (real Postgres SQL via PGlite)', () => {
  it('never selects a question authored by the requesting participant', async () => {
    const participantId = await createParticipant();
    const ownQuestionId = await createQuestion({ authorId: participantId });
    const othersQuestionId = await createQuestion({ authorId: null });

    const eligible = await listEligibleQuestions(participantId, db);

    expect(idsOf(eligible)).not.toContain(ownQuestionId);
    expect(idsOf(eligible)).toContain(othersQuestionId);
  });

  it('never selects a question the participant already has a published answer to', async () => {
    const participantId = await createParticipant();
    const answeredQuestionId = await createQuestion({ authorId: null });
    await publishAnswer(answeredQuestionId, participantId);
    const unansweredQuestionId = await createQuestion({ authorId: null });

    const eligible = await listEligibleQuestions(participantId, db);

    expect(idsOf(eligible)).not.toContain(answeredQuestionId);
    expect(idsOf(eligible)).toContain(unansweredQuestionId);
  });

  it('keeps a question eligible when the participant only has a withheld/failed attempt on it', async () => {
    // Regression guard, not a real "attempt": per Principle V (data-model.md
    // "Publication"), a withheld or failed attempt creates NO row in `answers` or
    // anywhere else — a row's existence IS publication. There is nothing to insert here
    // to represent the withheld attempt; that absence is the point. The guard is the
    // COUNT(*) assertion below: if a future change (e.g. spec 003) ever starts persisting
    // non-published attempts as answer rows, it fails loudly right here — on the raw table
    // state — instead of surfacing later as a confusing eligibility regression.
    const participantId = await createParticipant();
    const questionId = await createQuestion({ authorId: null });

    const { rows } = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM answers WHERE participant_id = $1 AND question_id = $2',
      [participantId, questionId],
    );
    expect(rows[0].count).toBe(0);

    const eligible = await listEligibleQuestions(participantId, db);

    expect(idsOf(eligible)).toContain(questionId);
  });

  it('never selects a question with status closed', async () => {
    const participantId = await createParticipant();
    const closedQuestionId = await createQuestion({ authorId: null, status: 'closed' });
    const openQuestionId = await createQuestion({ authorId: null, status: 'open' });

    const eligible = await listEligibleQuestions(participantId, db);

    expect(idsOf(eligible)).not.toContain(closedQuestionId);
    expect(idsOf(eligible)).toContain(openQuestionId);
  });

  it('selects seeded questions whose participant_id is NULL (IS DISTINCT FROM regression guard)', async () => {
    // Plain `<>` never matches NULL in SQL (`NULL <> NULL` evaluates to NULL, not true),
    // so a naive `q.participant_id <> $1` predicate would silently exclude every seeded
    // row for every participant. `IS DISTINCT FROM` is the only null-safe form here — this
    // is the single easiest bug to reintroduce in this query.
    const participantId = await createParticipant();
    const seededQuestionId = await createQuestion({ authorId: null });

    const eligible = await listEligibleQuestions(participantId, db);

    expect(idsOf(eligible)).toContain(seededQuestionId);
  });

  it('returns the same list for a participant id with no row as for a real one', async () => {
    // The read path in app/api/questions/next/route.ts trusts the signed cookie and does
    // not confirm the participant row still exists. That is only safe while this holds:
    // selection filters on `participant_id IS DISTINCT FROM $1` and `NOT EXISTS (their
    // answers)`, which an id with no rows satisfies exactly as a new participant does.
    // Add an INNER JOIN on participants and the route starts returning an empty pool
    // after a database reset instead of a full one.
    const real = await createParticipant();
    const ghost = randomUUID();
    await createQuestion({ authorId: null });
    await createQuestion({ authorId: null });

    const forReal = await listEligibleQuestions(real, db);
    const forGhost = await listEligibleQuestions(ghost, db);

    expect(idsOf(forGhost)).toEqual(idsOf(forReal));
    expect(forGhost).toHaveLength(2);
  });
});
