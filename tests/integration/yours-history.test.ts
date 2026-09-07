import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SqlClient } from '../../src/db/client.js';
import { listPublishedAnswers } from '../../src/db/queries/answers.js';
import {
  listPublishedQuestions,
  listResponsesForQuestions,
} from '../../src/db/queries/questions.js';
import { insertPublishedAnswer } from '../helpers/answers.js';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * 005's three read statements against real Postgres via PGlite.
 *
 * Every rule this file defends is a predicate — `a.participant_id = $1`, `q.participant_id = $1`,
 * `ORDER BY a.created_at ASC` — and a stub returning canned rows would replay the predicate the
 * test already assumed instead of executing it. The scoping rule in particular (FR-002) is only
 * meaningful when a second participant's rows are physically present in the same table and the
 * query declines to return them.
 *
 * The queries are called directly rather than through the page. FR-002 is a server-side property;
 * asserting it through a render would prove the page omitted a card, not that the row never left
 * the database.
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

async function createQuestion(participantId: string | null, displayText: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO questions (participant_id, display_text) VALUES ($1, $2) RETURNING id',
    [participantId, displayText],
  );
  return rows[0].id;
}

/**
 * An answer with its `created_at` chosen by the caller.
 *
 * `insertPublishedAnswer` covers every case that only needs a row to exist. Ordering does not:
 * `now()` on three inserts issued in one test can land inside the same microsecond, and even
 * when it does not, asserting that rows come back in the order they were written proves nothing
 * about the `ORDER BY` — an unordered query would pass it on most runs.
 */
async function insertAnswerAt(
  questionId: string,
  participantId: string,
  displayText: string,
  createdAt: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO answers (question_id, participant_id, display_text, duration_seconds,
                          submission_id, created_at)
     VALUES ($1, $2, $3, 9, gen_random_uuid(), $4)
     RETURNING id`,
    [questionId, participantId, displayText, createdAt],
  );
  return rows[0].id;
}

async function storePlayback(answerId: string): Promise<void> {
  await db.query('UPDATE answers SET generated_audio = $2, audio_voice_id = $3 WHERE id = $1', [
    answerId,
    Buffer.from([0x52, 0x49, 0x46, 0x46]),
    'Sulafat',
  ]);
}

/**
 * T017 — the two lists `Yours` is made of.
 *
 * `Your Answers` carries the question text (FR-005) because an answer read on its own is
 * unreadable: "About four hours, usually" is not a contribution without the question it
 * answered. That text comes from the join, never from anything stored on the answer row, so the
 * assertion has to see a question written separately from the answer.
 *
 * There is no status predicate in either query and no assertion here for one. Only published
 * rows exist at all (001's schema comment), which is what makes FR-004's "and no unpublished
 * attempts" unfalsifiable rather than untested — there is no way to create the row it forbids.
 */
describe('T017 Yours shows the participant their own contributions (FR-004, FR-005, FR-007, FR-010, FR-011)', () => {
  it('lists a published answer together with the question it addressed', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');
    const answerId = await insertAnswerAt(
      questionId,
      answerer,
      'The dishwasher, and it still runs.',
      '2026-03-01T10:00:00Z',
    );

    const answers = await listPublishedAnswers(answerer, db);

    expect(answers).toHaveLength(1);
    expect(answers[0].id).toBe(answerId);
    expect(answers[0].display_text).toBe('The dishwasher, and it still runs.');
    expect(answers[0].question_text).toBe('What repair are you proudest of?');
  });

  it('lists a published question with its processed text', async () => {
    const asker = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');

    const questions = await listPublishedQuestions(asker, db);

    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe(questionId);
    expect(questions[0].display_text).toBe('What repair are you proudest of?');
  });
});

/**
 * T018 — FR-002, the whole privacy boundary of the feature.
 *
 * Both participants hold a question and an answer, so every assertion below is two-sided: the
 * row the caller should see is present in the result and the row they should not see is present
 * in the *table*. Seeding only one participant would leave a query with no `WHERE` clause green.
 */
describe('T018 Yours is scoped to the requesting participant (FR-002)', () => {
  it('never returns another participant answers or questions', async () => {
    const alice = await createParticipant();
    const bob = await createParticipant();
    const aliceQuestion = await createQuestion(alice, 'How do you decide what to keep?');
    const bobQuestion = await createQuestion(bob, 'What did you learn too late?');
    // Crossed on purpose: each answers the other's question, so an answer and its question have
    // different owners and a query confusing the two columns cannot pass.
    const aliceAnswer = await insertAnswerAt(
      bobQuestion,
      alice,
      'That the manual was worth reading.',
      '2026-03-01T10:00:00Z',
    );
    const bobAnswer = await insertAnswerAt(
      aliceQuestion,
      bob,
      'Whatever I would miss.',
      '2026-03-01T11:00:00Z',
    );

    expect((await listPublishedAnswers(alice, db)).map((a) => a.id)).toEqual([aliceAnswer]);
    expect((await listPublishedAnswers(bob, db)).map((a) => a.id)).toEqual([bobAnswer]);
    expect((await listPublishedQuestions(alice, db)).map((q) => q.id)).toEqual([aliceQuestion]);
    expect((await listPublishedQuestions(bob, db)).map((q) => q.id)).toEqual([bobQuestion]);
  });
});

/**
 * T019 — the `= $1` that `listEligibleQuestions` cannot use.
 *
 * A seeded question carries `participant_id IS NULL`. The selection query needs
 * `IS DISTINCT FROM` precisely so those rows survive; this query needs plain equality so they do
 * not, and the two are not in conflict — no participant id is ever NULL.
 *
 * The failure this pins is not hypothetical: `IS DISTINCT FROM $1` pasted into `Your Questions`
 * would hand every participant every seeded question in the pool as their own, plus everyone
 * else's, and would still look right to a reader who had just written the selection query.
 */
describe('T019 a seeded question belongs to nobody (FR-002, FR-010)', () => {
  it('keeps a NULL participant_id question out of every participant Your Questions', async () => {
    const alice = await createParticipant();
    const bob = await createParticipant();
    const owned = await createQuestion(alice, 'How do you decide what to keep?');
    await createQuestion(null, 'What is a small thing that improved your day?');

    // The seeded row exists — otherwise both assertions below pass against an empty table.
    const { rows } = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM questions WHERE participant_id IS NULL',
    );
    expect(rows[0].count).toBe(1);

    expect((await listPublishedQuestions(alice, db)).map((q) => q.id)).toEqual([owned]);
    expect(await listPublishedQuestions(bob, db)).toEqual([]);
  });
});

/**
 * T020 — FR-018, ordering that asserts nothing about quality.
 *
 * Chronological is the only ordering that carries no ranking, so the test has to prove the rows
 * are actually sorted rather than merely emerging in a plausible order. The three answers are
 * inserted newest-first with explicit timestamps: insertion order is the reverse of the expected
 * order, so an unordered query, an `ASC`/`DESC` slip, or a sort on any other column all fail.
 *
 * Three answers need three participants — `UNIQUE (participant_id, question_id)` makes a second
 * answer from one person to one question unrepresentable.
 */
describe('T020 responses come back oldest-first (FR-018)', () => {
  it('orders three responses by created_at ascending regardless of insertion order', async () => {
    const asker = await createParticipant();
    const questionId = await createQuestion(asker, 'What did you learn too late?');
    const first = await createParticipant();
    const second = await createParticipant();
    const third = await createParticipant();

    await insertAnswerAt(questionId, third, 'third', '2026-03-03T09:00:00Z');
    await insertAnswerAt(questionId, first, 'first', '2026-03-01T09:00:00Z');
    await insertAnswerAt(questionId, second, 'second', '2026-03-02T09:00:00Z');

    const responses = await listResponsesForQuestions([questionId], db);

    expect(responses.map((r) => r.display_text)).toEqual(['first', 'second', 'third']);
  });
});

/**
 * T021 — the empty states, each paired with the populated case that makes it falsifiable.
 *
 * An empty array from a query nothing was seeded for is true whatever the query says, including
 * `WHERE false`. Every case below seeds content that must NOT come back alongside the participant
 * or question that must come back empty.
 */
describe('T021 the empty states (FR-009, FR-016, FR-017)', () => {
  it('returns no answers for a participant who has published none', async () => {
    const answerer = await createParticipant();
    const newcomer = await createParticipant();
    const asker = await createParticipant();
    const questionId = await createQuestion(asker, 'How do you decide what to keep?');
    await insertPublishedAnswer(db, questionId, answerer);

    expect(await listPublishedAnswers(answerer, db)).toHaveLength(1);
    expect(await listPublishedAnswers(newcomer, db)).toEqual([]);
  });

  it('returns no questions for a participant who has published none', async () => {
    const asker = await createParticipant();
    const newcomer = await createParticipant();
    await createQuestion(asker, 'How do you decide what to keep?');

    expect(await listPublishedQuestions(asker, db)).toHaveLength(1);
    expect(await listPublishedQuestions(newcomer, db)).toEqual([]);
  });

  it('returns no responses for a published question nobody has answered', async () => {
    const asker = await createParticipant();
    const stranger = await createParticipant();
    const answered = await createQuestion(asker, 'What did you learn too late?');
    const unanswered = await createQuestion(asker, 'What are you still putting off?');
    // A third question, owned by somebody else and answered, sits in the same table. Without it
    // an unfiltered `WHERE true` would return exactly the rows this test expects.
    const elsewhere = await createQuestion(stranger, 'What would you do again?');
    await insertPublishedAnswer(db, answered, await createParticipant());
    await insertPublishedAnswer(db, elsewhere, await createParticipant());

    // Both ids in one call: the answered question proves the query returns rows at all, and the
    // unanswered one proves none of them are attributed to it.
    const responses = await listResponsesForQuestions([answered, unanswered], db);

    expect(responses.map((r) => r.question_id)).toEqual([answered]);
  });
});

/**
 * An empty id list is answered without asking the database. `= ANY('{}')` is a round trip whose
 * result is knowable before it is issued, and `Yours` issues it on every render by a participant
 * who has never asked a question — which is most of them.
 *
 * Proved with a client that throws rather than by timing: any query at all fails the test.
 */
describe('listResponsesForQuestions — no questions, no round trip', () => {
  it('returns an empty list without issuing a query', async () => {
    const exploding: SqlClient = {
      query() {
        throw new Error('listResponsesForQuestions issued a query for an empty id list');
      },
    };

    await expect(listResponsesForQuestions([], exploding)).resolves.toEqual([]);
  });
});

/**
 * A stale or tampered `participant` cookie is a participant with no history, not a crash.
 *
 * Both queries validate before binding because the column is `uuid`: an unvalidated malformed id
 * reaches the driver as a type error, and `Yours` renders a 500 for what is really an expired
 * session. The populated participant in each test is what stops these from passing against a
 * function that returns `[]` unconditionally.
 */
describe('a malformed participant id has no history rather than an error', () => {
  it('returns an empty answer list without throwing', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'How do you decide what to keep?');
    await insertPublishedAnswer(db, questionId, answerer);

    expect(await listPublishedAnswers(answerer, db)).toHaveLength(1);
    expect(await listPublishedAnswers('not-a-uuid', db)).toEqual([]);
  });

  it('returns an empty question list without throwing', async () => {
    const asker = await createParticipant();
    await createQuestion(asker, 'How do you decide what to keep?');

    expect(await listPublishedQuestions(asker, db)).toHaveLength(1);
    expect(await listPublishedQuestions('not-a-uuid', db)).toEqual([]);
  });

  it('returns an empty answer list for a well-formed id belonging to nobody', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'How do you decide what to keep?');
    await insertPublishedAnswer(db, questionId, answerer);

    expect(await listPublishedAnswers(randomUUID(), db)).toEqual([]);
    expect(await listPublishedQuestions(randomUUID(), db)).toEqual([]);
  });
});

/**
 * `has_playback` is derived from `generated_audio IS NOT NULL` on every read, never stored as a
 * flag of its own. FR-030 requires the response to be readable before any audio exists, so the
 * false case is the one every freshly published answer is in — and the true case is what a
 * `Listen` produces.
 *
 * A stored boolean would drift from the column it describes; this asserts the derivation by
 * flipping the underlying bytes and reading the boolean back.
 */
describe('has_playback tracks the audio column (FR-026, FR-030)', () => {
  it('is false for a freshly published answer and true once audio exists', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'What did you learn too late?');
    const answerId = await insertAnswerAt(
      questionId,
      answerer,
      'That the manual was worth reading.',
      '2026-03-01T10:00:00Z',
    );

    const before = await listResponsesForQuestions([questionId], db);
    expect(before.map((r) => r.has_playback)).toEqual([false]);

    await storePlayback(answerId);

    const after = await listResponsesForQuestions([questionId], db);
    expect(after.map((r) => r.has_playback)).toEqual([true]);
  });
});
