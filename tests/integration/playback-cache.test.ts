import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  authorizePlayback,
  CLAIM_PLAYBACK_SQL,
  claimPlayback,
  readPlayback,
} from '../../src/db/queries/answers.js';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * 005's playback cache against real Postgres via PGlite.
 *
 * The produce-once guarantee lives entirely in one `WHERE generated_audio IS NULL`, so it is
 * asserted against a real column with real NULL semantics rather than a stub. SC-003 in
 * particular is stated in the spec *as a query* — count the rows holding audio and compare it to
 * the number of `Listen` requests — and only a real table can answer it.
 *
 * Gemini is never involved. These functions are the storage half of playback; the production
 * half is somebody else's test.
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

/** Four bytes standing in for a WAV. The cache never inspects the payload, only its presence. */
const FIRST_AUDIO = Buffer.from([0x52, 0x49, 0x46, 0x46]);
const SECOND_AUDIO = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

async function createParticipant(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO participants DEFAULT VALUES RETURNING id',
  );
  return rows[0].id;
}

async function createQuestion(participantId: string, displayText: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO questions (participant_id, display_text) VALUES ($1, $2) RETURNING id',
    [participantId, displayText],
  );
  return rows[0].id;
}

async function publishAnswer(
  questionId: string,
  participantId: string,
  displayText = 'The dishwasher, and it still runs.',
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO answers (question_id, participant_id, display_text, duration_seconds, submission_id)
     VALUES ($1, $2, $3, 9, gen_random_uuid())
     RETURNING id`,
    [questionId, participantId, displayText],
  );
  return rows[0].id;
}

/** The SC-003 criterion, verbatim. */
async function answersHoldingAudio(): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM answers WHERE generated_audio IS NOT NULL',
  );
  return rows[0].count;
}

async function storedVoiceId(answerId: string): Promise<string | null> {
  const { rows } = await db.query<{ audio_voice_id: string | null }>(
    'SELECT audio_voice_id FROM answers WHERE id = $1',
    [answerId],
  );
  return rows[0].audio_voice_id;
}

/**
 * PGlite hands `bytea` back as a `Uint8Array`, not a `Buffer`, so the bytes are compared and the
 * wrapper is not. `toEqual` across the two constructors is not a comparison anyone should have to
 * reason about at a glance.
 */
function bytes(value: Uint8Array | null): number[] | null {
  return value === null ? null : Array.from(value);
}

/**
 * T022 — SC-003, which the spec states as a query rather than as a description:
 *
 *   SELECT count(*) FROM answers WHERE generated_audio IS NOT NULL;
 *
 * Publish answers, request playback on none, expect 0. The column is nullable with no default
 * and no backfill precisely so this number cannot be misread — a design that pre-created a marker
 * row or a zero-length blob at publication time would have to prove the same property by arguing
 * about what the marker meant.
 *
 * The count after a claim is asserted in the same test. A zero that stays zero forever would also
 * satisfy the first half, and would mean playback never stored anything.
 */
describe('T022 publication produces no audio (SC-003, FR-026, FR-029)', () => {
  it('leaves generated_audio NULL on every published answer until something claims one', async () => {
    const asker = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');
    const answerIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      answerIds.push(await publishAnswer(questionId, await createParticipant()));
    }

    const { rows } = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM answers',
    );
    expect(rows[0].count).toBe(3);
    expect(await answersHoldingAudio()).toBe(0);

    await claimPlayback(answerIds[0], FIRST_AUDIO, 'Sulafat', db);

    // One Listen, one production. The criterion is the comparison, not the zero.
    expect(await answersHoldingAudio()).toBe(1);
  });
});

/**
 * T023 — SC-004 and FR-027. The bytes a participant hears never change between one `Listen` and
 * the next.
 *
 * The second claim carries *different* audio and a *different* voice on purpose. A guard that was
 * dropped, or narrowed to `WHERE id = $1` alone, would return true and quietly re-voice a response
 * somebody had already heard — a failure invisible to any test that claims the same bytes twice.
 */
describe('T023 claimPlayback stores once and never overwrites (SC-004, FR-027, FR-028)', () => {
  it('accepts the first claim and refuses the second without disturbing the stored audio', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');
    const answerId = await publishAnswer(questionId, answerer);

    expect(await claimPlayback(answerId, FIRST_AUDIO, 'Sulafat', db)).toBe(true);
    expect(await claimPlayback(answerId, SECOND_AUDIO, 'Kore', db)).toBe(false);

    expect(bytes(await readPlayback(answerId, db))).toEqual([...FIRST_AUDIO]);
    expect(await storedVoiceId(answerId)).toBe('Sulafat');
    expect(await answersHoldingAudio()).toBe(1);
  });

  it('returns false for an answer that does not exist', async () => {
    expect(await claimPlayback(randomUUID(), FIRST_AUDIO, 'Sulafat', db)).toBe(false);
  });
});

/**
 * T024 — ⚠️ **the test above does not prove the race, and no test in this file can.**
 *
 * PGlite runs one in-process connection and serializes statements, so two claims issued together
 * execute one after the other and the second always sees the first already committed. That is the
 * sequential case, which is not the interleaving FR-028 defends against — two Cloud Run instances
 * both finishing a Gemini call before either writes.
 *
 * So the statement's shape is asserted directly, which is the technique `question-publish.test.ts`
 * established for its own consume-then-insert ordering. That file also records that its first
 * attempt matched a string appearing in a comment two lines below, so comments are stripped
 * before anything is matched here.
 */
describe('T024 the produce-once guarantee is a predicate in the statement (FR-028, SC-005)', () => {
  it('guards the update on generated_audio IS NULL', () => {
    const sql = CLAIM_PLAYBACK_SQL.split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    // The whole mechanism. Without it the last writer wins and the audio changes underneath
    // somebody who has already heard it.
    expect(sql).toContain('generated_audio IS NULL');
    // And the row count that tells the caller whether it won, rather than a silent no-op.
    expect(sql).toMatch(/RETURNING\s+id/);
  });
});

/**
 * T025 — FR-002 and FR-031, the authorization for hearing a response.
 *
 * **A refusal is `null`, and the caller MUST render it as 404 rather than 403.** A distinct
 * forbidden status confirms the row exists, which turns uuid enumeration into an oracle over
 * other people's answers. The unrelated participant and the non-existent answer therefore return
 * the *same* value here, and that sameness is the property under test.
 *
 * Two participants pass, and only two: the answer's author, and the participant who asked the
 * question it answers. Those are the only ways an answer appears in anyone's `Yours`.
 */
describe('T025 authorizePlayback admits exactly the answer author and the question owner (FR-002, FR-031)', () => {
  it('admits the author', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');
    const answerId = await publishAnswer(questionId, answerer);

    expect(await authorizePlayback(answerId, answerer, db)).toEqual({
      displayText: 'The dishwasher, and it still runs.',
      cached: false,
    });
  });

  it('admits the participant who asked the question', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');
    const answerId = await publishAnswer(questionId, answerer);

    expect(await authorizePlayback(answerId, asker, db)).toEqual({
      displayText: 'The dishwasher, and it still runs.',
      cached: false,
    });
  });

  it('gives an unrelated participant the same answer as a missing row', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const stranger = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');
    const answerId = await publishAnswer(questionId, answerer);

    expect(await authorizePlayback(answerId, stranger, db)).toBeNull();
    expect(await authorizePlayback(randomUUID(), answerer, db)).toBeNull();
  });

  it('refuses a malformed id rather than throwing', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');
    const answerId = await publishAnswer(questionId, answerer);

    // Both columns are uuid, so an unvalidated malformed id reaches the driver as a type error
    // and a stale cookie renders a 500 instead of a 404.
    expect(await authorizePlayback('not-a-uuid', answerer, db)).toBeNull();
    expect(await authorizePlayback(answerId, 'not-a-uuid', db)).toBeNull();
  });

  /**
   * The text to be voiced comes from this row, which is why the route never accepts text from the
   * request body: a client-supplied string would let anyone have arbitrary text spoken in the
   * product's voice at the product's expense.
   */
  it('returns the answer stored display_text, which is what gets voiced', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');
    const answerId = await publishAnswer(questionId, answerer, 'Whatever I would miss.');

    const target = await authorizePlayback(answerId, answerer, db);

    expect(target?.displayText).toBe('Whatever I would miss.');
  });

  it('reports cached once audio exists', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');
    const answerId = await publishAnswer(questionId, answerer);

    expect((await authorizePlayback(answerId, answerer, db))?.cached).toBe(false);
    await claimPlayback(answerId, FIRST_AUDIO, 'Sulafat', db);
    expect((await authorizePlayback(answerId, answerer, db))?.cached).toBe(true);
  });
});

/**
 * `readPlayback` is the serving half: no join, no ownership rule, because callers reach it only
 * after `authorizePlayback` has already returned a row. Duplicating the ownership predicate here
 * would mean two places to get it wrong.
 */
describe('readPlayback serves what was claimed, and nothing before that (FR-027)', () => {
  it('returns null before production and the stored bytes after', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');
    const answerId = await publishAnswer(questionId, answerer);

    expect(await readPlayback(answerId, db)).toBeNull();

    await claimPlayback(answerId, FIRST_AUDIO, 'Sulafat', db);

    expect(bytes(await readPlayback(answerId, db))).toEqual([...FIRST_AUDIO]);
  });

  it('returns null for an answer that has none and for a malformed id', async () => {
    const asker = await createParticipant();
    const answerer = await createParticipant();
    const questionId = await createQuestion(asker, 'What repair are you proudest of?');
    const withAudio = await publishAnswer(questionId, answerer);
    const withoutAudio = await publishAnswer(questionId, await createParticipant());
    await claimPlayback(withAudio, FIRST_AUDIO, 'Sulafat', db);

    expect(bytes(await readPlayback(withAudio, db))).toEqual([...FIRST_AUDIO]);
    expect(await readPlayback(withoutAudio, db)).toBeNull();
    expect(await readPlayback('not-a-uuid', db)).toBeNull();
    expect(await readPlayback(randomUUID(), db)).toBeNull();
  });
});
