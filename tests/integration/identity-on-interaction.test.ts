import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SqlClient } from '../../src/db/client';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * FR-001 and contracts/routes.md's test obligation "`/` creates no participant row"
 * (tasks.md T045/T094): identity is minted on *interaction*, never on render.
 *
 * The distinction is load-bearing. `app/page.tsx` is a Server Component, so a crawler, a
 * link preview, or an uptime probe hitting `/` runs its body. If identity moved into that
 * body, every one of them would become a participant, and `participants` would fill with
 * rows no person is behind — which quietly makes the reciprocity numbers a lie.
 *
 * The page components are called directly rather than rendered to HTML. Calling is what
 * proves the point: a Server Component's own body is the only place a render-time write
 * could live, and JSX children are not evaluated by the call, so nothing else can
 * contribute a query. The moment someone awaits `getOrCreateParticipant` in one of these,
 * the row count moves and this fails.
 */

// Hoisted so the `vi.mock` factory below can close over it — the factory is lifted above
// the imports, and the PGlite instance does not exist until `beforeAll`.
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

  // Imported after the mock is registered and the secret is set, so both modules bind to
  // the PGlite-backed client rather than reaching for a Neon pool that is not there.
  ({ default: ArrivalPage } = await import('../../app/page'));
  ({ default: AnswerPage } = await import('../../app/answer/page'));
  ({ POST } = await import('../../app/api/questions/next/route'));
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

    // `await` covers both shapes: today it is synchronous, and an added `await` inside it
    // would make it a promise this must still settle before counting.
    await ArrivalPage();

    expect(await countParticipants()).toBe(0);
  });

  it('creates no participant row when the selection page shell renders', async () => {
    expect(await countParticipants()).toBe(0);

    // T054: `/answer` renders the shell only. QuestionCard's client-side POST is what
    // mints identity, so the Server Component must stay as inert as Arrival.
    await AnswerPage();

    expect(await countParticipants()).toBe(0);
  });

  it('creates exactly one participant row when POST /api/questions/next is called', async () => {
    expect(await countParticipants()).toBe(0);

    const response = await POST(
      new Request('https://example.test/api/questions/next', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    expect(await countParticipants()).toBe(1);
    // The identity has to come back to the browser, or the next request mints another one.
    expect(response.headers.get('set-cookie')).toContain('hth_session=');
  });

  it('reuses the participant when the cookie from that first POST is sent back', async () => {
    const first = await POST(
      new Request('https://example.test/api/questions/next', { method: 'POST' }),
    );
    const cookie = first.headers.get('set-cookie');
    expect(cookie).toBeTruthy();
    expect(await countParticipants()).toBe(1);

    const second = await POST(
      new Request('https://example.test/api/questions/next', {
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
