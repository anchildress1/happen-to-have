import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeRateLimitClient, rateLimitConfig } from '../../src/db/queries/rateLimits.js';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * T019, FR-048 – FR-052. The submission limiter, against real Postgres via PGlite.
 *
 * Real SQL rather than a fake, because the whole correctness argument lives in one
 * statement: `ON CONFLICT DO UPDATE` making the check and the increment atomic, and a `CASE`
 * resetting the window inside the same statement. A mock would assert the shape of a call
 * and prove nothing about the race the statement exists to close.
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

/** Drags the participant's window back in time, standing in for the clock moving forward. */
async function ageWindow(participantId: string, seconds: number): Promise<void> {
  await db.query(
    `UPDATE submission_rate_limits
     SET window_started_at = now() - ($2 || ' seconds')::interval
     WHERE participant_id = $1`,
    [participantId, seconds],
  );
}

const limitOf =
  (max: number, windowSeconds = 3_600) =>
  () => ({ max, windowSeconds });

describe('submission rate limit — the window (FR-048)', () => {
  it('opens a window on the first submission and allows it', async () => {
    const participantId = await createParticipant();
    const client = makeRateLimitClient(db, limitOf(20));

    const decision = await client.recordSubmission(participantId);

    expect(decision.allowed).toBe(true);
    expect(decision.count).toBe(1);
  });

  it('increments inside the live window rather than opening a second one', async () => {
    const participantId = await createParticipant();
    const client = makeRateLimitClient(db, limitOf(20));

    await client.recordSubmission(participantId);
    await client.recordSubmission(participantId);
    const third = await client.recordSubmission(participantId);

    expect(third.count).toBe(3);

    const { rows } = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM submission_rate_limits WHERE participant_id = $1',
      [participantId],
    );
    expect(rows[0].count).toBe(1);
  });

  it('refuses once the window count passes the configured max', async () => {
    const participantId = await createParticipant();
    const client = makeRateLimitClient(db, limitOf(2));

    expect((await client.recordSubmission(participantId)).allowed).toBe(true);
    expect((await client.recordSubmission(participantId)).allowed).toBe(true);
    expect((await client.recordSubmission(participantId)).allowed).toBe(false);
  });

  it('keeps counting refused submissions, so the boundary is not a free retry', async () => {
    // Not counting a refusal would let a caller sit exactly at the limit and resubmit
    // forever at no cost — which is the traffic the limiter exists to bound.
    const participantId = await createParticipant();
    const client = makeRateLimitClient(db, limitOf(1));

    await client.recordSubmission(participantId);
    await client.recordSubmission(participantId);
    const third = await client.recordSubmission(participantId);

    expect(third.allowed).toBe(false);
    expect(third.count).toBe(3);
  });

  it('opens a fresh window once the old one has expired', async () => {
    const participantId = await createParticipant();
    const client = makeRateLimitClient(db, limitOf(1, 60));

    await client.recordSubmission(participantId);
    expect((await client.recordSubmission(participantId)).allowed).toBe(false);

    await ageWindow(participantId, 120);

    const afterExpiry = await client.recordSubmission(participantId);
    expect(afterExpiry.allowed).toBe(true);
    expect(afterExpiry.count).toBe(1);
  });

  it('reports when the window closes, not merely that it is closed', async () => {
    // FR-049: the participant is told a time. A boolean alone leaves the interface with
    // nothing to interpolate into the heading.
    const participantId = await createParticipant();
    const client = makeRateLimitClient(db, limitOf(1, 60));

    const decision = await client.recordSubmission(participantId);

    expect(decision.retryAt.getTime()).toBeGreaterThan(Date.now());
    expect(decision.retryAt.getTime()).toBeLessThanOrEqual(Date.now() + 61_000);
  });
});

describe('submission rate limit — concurrency', () => {
  it('cannot create a second row for one participant under concurrent submissions', async () => {
    // Read-then-write would race two simultaneous submissions past the limit — exactly the
    // traffic a limiter is for. One statement with ON CONFLICT is what closes it.
    const participantId = await createParticipant();
    const client = makeRateLimitClient(db, limitOf(20));

    await Promise.all([
      client.recordSubmission(participantId),
      client.recordSubmission(participantId),
      client.recordSubmission(participantId),
      client.recordSubmission(participantId),
    ]);

    const { rows } = await db.query<{ count: number; total: number }>(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(submission_count), 0)::int AS total
       FROM submission_rate_limits WHERE participant_id = $1`,
      [participantId],
    );

    expect(rows[0].count).toBe(1);
    expect(rows[0].total).toBe(4);
  });

  it('keeps participants independent of one another', async () => {
    const a = await createParticipant();
    const b = await createParticipant();
    const client = makeRateLimitClient(db, limitOf(1));

    await client.recordSubmission(a);
    await client.recordSubmission(a);

    expect((await client.recordSubmission(b)).allowed).toBe(true);
  });
});

describe('submission rate limit — configuration (FR-048)', () => {
  it('falls back to the defaults when the env vars are absent', () => {
    expect(rateLimitConfig({})).toEqual({ max: 20, windowSeconds: 3_600 });
  });

  it('reads both values from the environment', () => {
    const config = rateLimitConfig({
      HTH_RATE_LIMIT_MAX: '5',
      HTH_RATE_LIMIT_WINDOW_SECONDS: '60',
    });

    expect(config).toEqual({ max: 5, windowSeconds: 60 });
  });

  it('falls back rather than letting a typo disable or invert the limit', () => {
    // '0' would refuse every submission; 'abc' parses to NaN, which compares false against
    // everything and would accept every submission. Both are worse than the default.
    expect(rateLimitConfig({ HTH_RATE_LIMIT_MAX: '0' }).max).toBe(20);
    expect(rateLimitConfig({ HTH_RATE_LIMIT_MAX: 'abc' }).max).toBe(20);
    expect(rateLimitConfig({ HTH_RATE_LIMIT_MAX: '-5' }).max).toBe(20);
  });
});
