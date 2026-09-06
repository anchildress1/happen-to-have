import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  makeRateLimitClient,
  rateLimitConfig,
  SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL,
} from '../../src/db/queries/rateLimits.js';
import { createTestDb, type TestDb } from '../helpers/pglite.js';

/**
 * FR-048 – FR-052. The submission limiter, against real Postgres via PGlite.
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

  it('anchors retryAt to when the window opened, not to now', async () => {
    // FR-049 tells the participant a time, and the time has to be right. Computing it from
    // Date.now() instead of window_started_at passed the previous version of this test: under
    // a real one-hour window, someone limited 59 minutes in would be told to come back in an
    // hour rather than in a minute.
    const participantId = await createParticipant();
    const client = makeRateLimitClient(db, limitOf(1, 60));

    await client.recordSubmission(participantId);
    await ageWindow(participantId, 45);
    const refused = await client.recordSubmission(participantId);

    expect(refused.allowed).toBe(false);
    if (refused.allowed) {
      return;
    }

    // Compared against the stored anchor rather than the wall clock, so a slow runner cannot
    // make this flaky. 45s into a 60s window, retryAt must be exactly window start + 60s.
    const { rows } = await db.query<{ window_started_at: Date }>(
      'SELECT window_started_at FROM submission_rate_limits WHERE participant_id = $1',
      [participantId],
    );
    const expected = new Date(rows[0].window_started_at).getTime() + 60_000;

    expect(refused.retryAt.getTime()).toBe(expected);
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

describe('sweeping closed windows', () => {
  it('deletes windows past the cutoff and leaves live ones alone', async () => {
    // The statement takes DAYS while every other duration in the module is in seconds. A
    // unit slip here wipes live limiter rows on every cron tick, which silently removes the
    // limit for everyone — and nothing else in the suite would notice.
    const stale = await createParticipant();
    const live = await createParticipant();
    const client = makeRateLimitClient(db, limitOf(20));

    await client.recordSubmission(stale);
    await client.recordSubmission(live);
    await ageWindow(stale, 60 * 60 * 24 * 45);

    const { rows: swept } = await db.query<{ participant_id: string }>(
      SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL,
      [30, 3_600],
    );

    expect(swept.map((row) => row.participant_id)).toEqual([stale]);

    const { rows: left } = await db.query<{ participant_id: string }>(
      'SELECT participant_id FROM submission_rate_limits',
    );
    expect(left.map((row) => row.participant_id)).toEqual([live]);
  });

  it('leaves a live window alone even at DAYS=0', async () => {
    // DAYS=0 is a documented invocation. Measuring retention from window_started_at rather
    // than from the window's end deletes counters whose window is still open — silently
    // resetting active participants and removing the limit for everyone.
    const participantId = await createParticipant();
    await makeRateLimitClient(db, limitOf(20)).recordSubmission(participantId);

    const { rows } = await db.query(SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL, [0, 3_600]);

    expect(rows).toEqual([]);
  });

  it('sweeps a window that has closed, once its full length has elapsed', async () => {
    const participantId = await createParticipant();
    await makeRateLimitClient(db, limitOf(20)).recordSubmission(participantId);
    await ageWindow(participantId, 7_200);

    const { rows } = await db.query<{ participant_id: string }>(
      SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL,
      [0, 3_600],
    );

    expect(rows.map((row) => row.participant_id)).toEqual([participantId]);
  });

  it('sweeps nothing when every window is inside the cutoff', async () => {
    const participantId = await createParticipant();
    await makeRateLimitClient(db, limitOf(20)).recordSubmission(participantId);

    const { rows } = await db.query(SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL, [30, 3_600]);

    expect(rows).toEqual([]);
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

  it('falls back rather than letting a typo change the limit', () => {
    // Both '0' and NaN refuse EVERY submission — `1 <= NaN` is false, so NaN fails closed
    // rather than open. An earlier comment here claimed the opposite.
    expect(rateLimitConfig({ HTH_RATE_LIMIT_MAX: '0' }).max).toBe(20);
    expect(rateLimitConfig({ HTH_RATE_LIMIT_MAX: 'abc' }).max).toBe(20);
    expect(rateLimitConfig({ HTH_RATE_LIMIT_MAX: '-5' }).max).toBe(20);
  });

  it('does not accept a numeric prefix and silently discard the rest', () => {
    // parseInt('3_600') is 3 and parseInt('1e9') is 1. The first turns a one-hour window
    // into three seconds — effectively no limit — from an env var that reads as correct.
    expect(rateLimitConfig({ HTH_RATE_LIMIT_WINDOW_SECONDS: '3_600' }).windowSeconds).toBe(3_600);
    expect(rateLimitConfig({ HTH_RATE_LIMIT_MAX: '1e9' }).max).toBe(1_000_000_000);
    expect(rateLimitConfig({ HTH_RATE_LIMIT_MAX: '20abc' }).max).toBe(20);
    expect(rateLimitConfig({ HTH_RATE_LIMIT_MAX: '2.5' }).max).toBe(20);
  });

  it('rejects a malformed participant id rather than letting Postgres do it', async () => {
    // The column is a uuid PRIMARY KEY, so an unvalidated id surfaces as a driver error —
    // and reviewContribution is contracted never to throw for a review outcome.
    const client = makeRateLimitClient(db, limitOf(20));

    await expect(client.recordSubmission('not-a-uuid')).rejects.toThrow();
  });
});
