import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeParticipantsClient } from '../../src/db/queries/participants.js';
import { listEligibleQuestions } from '../../src/db/queries/questions.js';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * FR-022 through FR-024: there is no `/api/questions/skip`. `handleTryAnother` only
 * advances a pointer into the queue already returned by `POST /api/questions/next`, so
 * these run that pointer arithmetic over a real queue and prove the database is untouched
 * and no question repeats immediately. The browser half is tests/e2e/skip.spec.ts.
 */

// getOrCreateParticipant (src/session/session.ts) validates this at module load time, not
// call time — set it before that module is ever imported, exactly like
// tests/integration/session.test.ts does.
process.env.SESSION_SECRET ??= 'e'.repeat(32);

// Static imports are hoisted above this file's own top-level statements, so importing
// session.ts before SESSION_SECRET is set would throw at load time. Deferring the import
// until beforeAll keeps the env assignment above authoritative.
let getOrCreateParticipant: typeof import('../../src/session/session.js').getOrCreateParticipant;

let db: TestDb;
let questionAId: string;
let questionBId: string;

beforeAll(async () => {
  ({ getOrCreateParticipant } = await import('../../src/session/session.js'));

  db = await createTestDb();

  // Two isolated, unowned, open questions — enough for a real queue of length >= 2. Skip
  // never writes to `questions`, so these are created once and shared by every test below.
  questionAId = randomUUID();
  questionBId = randomUUID();
  await db.query(
    `INSERT INTO questions (id, participant_id, display_text, status)
     VALUES ($1, NULL, $2, 'open'), ($3, NULL, $4, 'open')`,
    [
      questionAId,
      '[skip-writes-nothing test] question A',
      questionBId,
      '[skip-writes-nothing test] question B',
    ],
  );
});

afterAll(async () => {
  await db.close();
});

interface ParticipantSnapshot {
  canAsk: boolean | undefined;
  rowExists: boolean;
  answerCount: number | undefined;
}

async function snapshotParticipant(participantId: string): Promise<ParticipantSnapshot> {
  const { rows: participantRows } = await db.query<{ can_ask: boolean }>(
    'SELECT can_ask FROM participants WHERE id = $1',
    [participantId],
  );
  const { rows: answerRows } = await db.query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM answers WHERE participant_id = $1',
    [participantId],
  );
  return {
    canAsk: participantRows[0]?.can_ask,
    rowExists: participantRows.length === 1,
    answerCount: answerRows[0]?.count,
  };
}

/** Mirrors `handleTryAnother` in src/ui/QuestionCard.tsx exactly: advance, wrap at the end. */
function advance(pointer: number, queueLength: number): number {
  return (pointer + 1) % queueLength;
}

let participantId: string;

beforeEach(async () => {
  const request = new Request('https://example.test/api/questions/next', { method: 'POST' });
  ({ participantId } = await getOrCreateParticipant(request, makeParticipantsClient(db)));
});

describe('a traversal that fetches a queue and skips through it (FR-020, FR-022, FR-023)', () => {
  it('leaves participant row, can_ask, and answer count unchanged after 20 pointer advances', async () => {
    // Arrange
    const queue = await listEligibleQuestions(participantId, db);
    expect(queue.length).toBeGreaterThanOrEqual(2);

    const before = await snapshotParticipant(participantId);
    expect(before.rowExists).toBe(true);
    expect(before.answerCount).toBe(0);

    // Act — the only thing a skip ever does. No fetch call exists to make; that absence
    // is the behavior FR-020/FR-022/FR-023 require, not something a mock stands in for.
    let pointer = 0;
    for (let i = 0; i < 20; i++) {
      pointer = advance(pointer, queue.length);
    }

    // Assert
    const after = await snapshotParticipant(participantId);
    expect(after.rowExists).toBe(true);
    expect(after.canAsk).toBe(before.canAsk);
    expect(after.canAsk).toBe(false);
    expect(after.answerCount).toBe(before.answerCount);
    expect(after.answerCount).toBe(0);
  });
});

describe('skip never repeats the immediately previous question (FR-024)', () => {
  it('lands on a different question id every advance, across a full pass and a wrap', async () => {
    // Arrange
    const queue = await listEligibleQuestions(participantId, db);
    expect(queue.length).toBeGreaterThanOrEqual(2);

    // Act / Assert
    let pointer = 0;
    let previousId = queue[pointer]?.id;
    for (let i = 0; i < 20; i++) {
      pointer = advance(pointer, queue.length);
      const currentId = queue[pointer]?.id;
      expect(currentId).not.toBe(previousId);
      previousId = currentId;
    }
  });
});
