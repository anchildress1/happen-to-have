import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SqlClient } from '../../src/db/client';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * FR-001: identity is minted on interaction, never on render. A crawler or link preview
 * hitting `/` runs the Server Component body, and must not become a participant.
 *
 * The components are called, not rendered: their own body is the only place a render-time
 * write could live, and calling does not evaluate JSX children.
 */

// Hoisted: the mock factory is lifted above the imports, before PGlite exists.
const testDb = vi.hoisted(() => ({ current: null as SqlClient | null }));

vi.mock('../../src/db/client', () => ({
  db: {
    query(sql: string, params?: readonly unknown[]) {
      if (!testDb.current) throw new Error('identity-on-interaction: test db not initialized');
      return testDb.current.query(sql, params);
    },
  } satisfies SqlClient,
}));

process.env.SESSION_SECRET = 'i'.repeat(32);

let db: TestDb;
let ArrivalPage: () => unknown;
let AnswerPage: () => unknown;
let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  db = await createTestDb();
  testDb.current = db;

  // After the mock and secret, so these bind to PGlite rather than a Neon pool.
  ({ default: ArrivalPage } = await import('../../app/page'));
  ({ default: AnswerPage } = await import('../../app/answer/page'));
  ({ POST } = await import('../../app/api/question/route'));
});

afterEach(async () => {
  await db.truncate();
});

afterAll(async () => {
  await db.close();
});

async function countParticipants(): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM participants',
  );
  return rows[0].count;
}

describe('identity is created on interaction, never on render (FR-001, T094)', () => {
  it('creates no participant row when the Arrival page renders', async () => {
    expect(await countParticipants()).toBe(0);

    // `await` covers both shapes: sync today, a promise if someone adds an await.
    await ArrivalPage();

    expect(await countParticipants()).toBe(0);
  });

  it('creates no participant row when the selection page shell renders', async () => {
    expect(await countParticipants()).toBe(0);

    // `/answer` renders the shell only; QuestionCard's POST mints identity.
    await AnswerPage();

    expect(await countParticipants()).toBe(0);
  });

  it('creates exactly one participant row when POST /api/question is called', async () => {
    expect(await countParticipants()).toBe(0);

    const response = await POST(
      new Request('https://example.test/api/question', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    expect(await countParticipants()).toBe(1);
    // Without the cookie coming back, the next request mints another participant.
    expect(response.headers.get('set-cookie')).toContain('hth_session=');
  });

  it('reuses the participant when the cookie from that first POST is sent back', async () => {
    const first = await POST(new Request('https://example.test/api/question', { method: 'POST' }));
    const cookie = first.headers.get('set-cookie');
    expect(cookie).toBeTruthy();
    expect(await countParticipants()).toBe(1);

    const second = await POST(
      new Request('https://example.test/api/question', {
        method: 'POST',
        // Strip the attributes — a browser sends back only `name=value`.
        headers: { cookie: (cookie as string).split(';')[0] },
      }),
    );

    expect(second.status).toBe(200);
    // FR-004: the returning request is the same participant, not a second row.
    expect(await countParticipants()).toBe(1);
  });
});
