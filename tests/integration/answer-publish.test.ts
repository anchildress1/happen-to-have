import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISH_ANSWER_SQL, publishAnswer } from '../../src/db/queries/answers.js';
import { getQuestionText } from '../../src/db/queries/questions.js';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * FR-015 – FR-019, against real Postgres via PGlite.
 *
 * Real SQL rather than a fake, because every rule here is a race and the whole correctness
 * argument lives in one statement. A mock would assert the shape of a call and prove nothing
 * about two tabs submitting at once.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.query('DELETE FROM answers');
  await db.query('DELETE FROM questions');
  await db.query('DELETE FROM participants');
});

afterAll(async () => {
  await db.close();
});

async function participant(canAsk = false): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO participants (can_ask) VALUES ($1) RETURNING id',
    [canAsk],
  );
  return rows[0].id;
}

async function question(owner: string | null): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO questions (participant_id, display_text) VALUES ($1, $2) RETURNING id',
    [owner, 'How do you get through a hard week?'],
  );
  return rows[0].id;
}

const answer = { displayText: 'One thing at a time.', sourceLanguage: 'en', emotion: null };

const canAsk = async (id: string) => {
  const { rows } = await db.query<{ can_ask: boolean }>(
    'SELECT can_ask FROM participants WHERE id = $1',
    [id],
  );
  return rows[0].can_ask;
};

describe('publishing an answer grants an ask, atomically (FR-019)', () => {
  it('publishes and grants in one statement', async () => {
    const asker = await participant();
    const q = await question(await participant());

    const result = await publishAnswer({ ...answer, questionId: q, participantId: asker }, db);

    expect(result).toMatchObject({ published: true, askGranted: true });
    expect(await canAsk(asker)).toBe(true);
  });

  it('does not stack a second ask on someone already holding one', async () => {
    // FR-020. Answering twice does not bank two asks; the ask is a permission, not a currency.
    const asker = await participant(true);
    const q = await question(await participant());

    const result = await publishAnswer({ ...answer, questionId: q, participantId: asker }, db);

    expect(result).toMatchObject({ published: true, askGranted: false });
    expect(await canAsk(asker)).toBe(true);
  });

  it('stores the reviewed text, not the recording', async () => {
    const asker = await participant();
    const q = await question(await participant());

    await publishAnswer(
      {
        questionId: q,
        participantId: asker,
        displayText: 'Feed it daily.',
        sourceLanguage: 'es',
        emotion: 'warm',
      },
      db,
    );

    const { rows } = await db.query<{
      display_text: string;
      source_language: string;
      emotion: string | null;
    }>('SELECT display_text, source_language, emotion FROM answers');
    expect(rows[0]).toEqual({
      display_text: 'Feed it daily.',
      source_language: 'es',
      emotion: 'warm',
    });
  });
});

describe('eligibility is enforced in SQL, not by the interface (FR-016 – FR-018)', () => {
  it('refuses an answer to your own question', async () => {
    const author = await participant();
    const q = await question(author);

    const result = await publishAnswer({ ...answer, questionId: q, participantId: author }, db);

    expect(result).toEqual({ published: false, reason: 'ineligible' });
    expect(await canAsk(author)).toBe(false);
  });

  it('allows answering a seeded question, whose author is NULL', async () => {
    // `participant_id <> $2` drops this row; IS DISTINCT FROM keeps it. A seeded question
    // belongs to nobody, so nobody is disqualified from answering it.
    const asker = await participant();
    const q = await question(null);

    await expect(
      publishAnswer({ ...answer, questionId: q, participantId: asker }, db),
    ).resolves.toMatchObject({ published: true });
  });

  it('refuses a second published answer to the same question', async () => {
    const asker = await participant();
    const q = await question(await participant());
    await publishAnswer({ ...answer, questionId: q, participantId: asker }, db);

    const second = await publishAnswer({ ...answer, questionId: q, participantId: asker }, db);

    expect(second).toEqual({ published: false, reason: 'ineligible' });
  });

  it('keeps both duplicate guards, because either alone still returns the right answer', async () => {
    // Mutation testing found that removing EITHER the NOT EXISTS or the ON CONFLICT leaves
    // every other test in this file green: the survivor covers for the casualty. That makes
    // the pair untestable through behaviour alone, so the statement itself is asserted.
    //
    // They are not redundant. NOT EXISTS refuses cheaply and reports `ineligible`; ON CONFLICT
    // is what closes the window where two statements both read "no answer yet" before either
    // writes. Losing the second turns a double-tap into a driver error rather than a decision
    // the caller can render.
    // Matched on the predicate, not the phrase: "NOT EXISTS" also appears in a comment two
    // lines below, so asserting the phrase passed with the clause deleted. Caught by running
    // the mutation, not by reading the test.
    expect(PUBLISH_ANSWER_SQL).toMatch(
      /AND NOT EXISTS \(\s*SELECT 1 FROM answers a\s*WHERE a\.question_id = q\.id AND a\.participant_id = \$2\s*\)/,
    );
    expect(PUBLISH_ANSWER_SQL).toContain('ON CONFLICT (participant_id, question_id) DO NOTHING');
  });

  it('publishes exactly one answer under concurrent submissions (FR-015)', async () => {
    // Two tabs, one participant, one question. The NOT EXISTS cannot close this on its own —
    // both statements read "no answer yet" before either writes.
    const asker = await participant();
    const q = await question(await participant());

    const results = await Promise.all([
      publishAnswer({ ...answer, questionId: q, participantId: asker }, db),
      publishAnswer({ ...answer, questionId: q, participantId: asker }, db),
    ]);

    expect(results.filter((r) => r.published)).toHaveLength(1);
    const { rows } = await db.query('SELECT id FROM answers');
    expect(rows).toHaveLength(1);
  });

  it('lets a participant answer again after a withheld attempt left no row (FR-017a)', async () => {
    // Nothing to arrange: a withheld attempt writes nothing at all, so the second attempt
    // sees exactly the state the first one started from. That is the point of the rule.
    const asker = await participant();
    const q = await question(await participant());

    await expect(
      publishAnswer({ ...answer, questionId: q, participantId: asker }, db),
    ).resolves.toMatchObject({ published: true });
  });

  it('refuses an unknown question rather than inserting an orphan', async () => {
    const asker = await participant();

    const result = await publishAnswer(
      { ...answer, questionId: '11111111-1111-4111-8111-111111111111', participantId: asker },
      db,
    );

    expect(result).toEqual({ published: false, reason: 'ineligible' });
  });

  it('rejects a malformed id rather than letting Postgres do it', async () => {
    await expect(
      publishAnswer(
        { ...answer, questionId: 'not-a-uuid', participantId: await participant() },
        db,
      ),
    ).rejects.toThrow();
  });
});

describe('the server reads the question itself (FR-018)', () => {
  it('returns the text for a real question', async () => {
    const q = await question(await participant());

    await expect(getQuestionText(q, db)).resolves.toBe('How do you get through a hard week?');
  });

  it('returns null for an unknown question rather than throwing', async () => {
    await expect(getQuestionText('11111111-1111-4111-8111-111111111111', db)).resolves.toBeNull();
  });

  it('returns null for a malformed id rather than reaching Postgres', async () => {
    // The route turns null into a failure page. Letting a malformed id through would surface
    // as a driver error, which is a 500 rather than something a participant can act on.
    await expect(getQuestionText('../../etc/passwd', db)).resolves.toBeNull();
  });
});
