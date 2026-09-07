import { describe, expect, it } from 'vitest';
import type { SqlClient } from '../../src/db/client.js';
import {
  playbackLockClient,
  TRY_LOCK_SQL,
  UNLOCK_SQL,
  WAIT_TIMEOUT_MS,
  waitForPlayback,
} from '../../src/db/playbackLock.js';

/**
 * FR-028 and SC-005. The cross-instance half of "exactly one production" — the loser's wait,
 * and the two SQL statements that make the lock cluster-wide instead of per-process.
 *
 * The clock and the sleep are injected, so proving a fifteen-second timeout takes no seconds.
 * Nothing here touches Postgres: `tryAcquire` is exercised only up to the point where it would
 * reach for a connection, and everything past that belongs to the integration suite.
 */

/**
 * Replays reads in order and records the client each call was handed.
 *
 * A call past the end throws rather than returning `undefined`, so an implementation that polls
 * one time too many fails loudly instead of silently reading a falsy value and looping again.
 */
function scriptedRead(results: Array<Uint8Array | null>) {
  const clients: Array<SqlClient | undefined> = [];
  let index = 0;
  return {
    clients,
    calls: () => index,
    read: async (_answerId: string, client?: SqlClient): Promise<Uint8Array | null> => {
      clients.push(client);
      const next = results[index++];
      if (next === undefined) {
        throw new Error(`scriptedRead: no result scripted for call ${index}`);
      }
      return next;
    },
  };
}

/**
 * A clock that only moves when the code sleeps.
 *
 * Driving `now` off the recorded sleeps rather than a free-running counter is what makes the
 * timeout test measure the module's own polling schedule; a counter that advances on every `now`
 * call would time out on a schedule the fake invented.
 */
function fakeClock() {
  let ms = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => ms,
    sleep: async (waited: number) => {
      slept.push(waited);
      ms += waited;
    },
  };
}

/**
 * The loser's path. Every branch here runs while another instance holds the lock, which is the
 * only reason this function exists — a bug in it turns a coalesced production into a 502 or, worse,
 * into a second billed provider call.
 */
describe('waitForPlayback — the loser polls for the winner (FR-028)', () => {
  it('returns audio already stored without sleeping first', async () => {
    // The module reads before it sleeps on purpose: the winner may have stored the audio between
    // the failed lock attempt and this call. A sleep-first implementation would buy a quarter
    // second of latency for nothing, and no other assertion in this file would notice.
    const audio = new Uint8Array([82, 73, 70, 70]);
    const { read, calls } = scriptedRead([audio]);
    const clock = fakeClock();

    const result = await waitForPlayback('already-there', {
      read,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(result).toBe(audio);
    expect(calls()).toBe(1);
    expect(clock.slept).toEqual([]);
  });

  it('keeps polling until the audio appears', async () => {
    const audio = new Uint8Array([1, 2, 3, 4, 5]);
    const { read, calls } = scriptedRead([null, null, audio]);
    const clock = fakeClock();

    const result = await waitForPlayback('arrives-late', {
      read,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(result).toBe(audio);
    expect(calls()).toBe(3);
    expect(clock.slept).toHaveLength(2);
  });

  it('treats a zero-length body as not ready yet and keeps waiting', async () => {
    // A zero-length Uint8Array is truthy. Accepting it would hand the route a body it happily
    // serves as `200 audio/wav`, and the asker gets a player that cannot play — the one failure
    // mode worse than the 502 a timeout produces, because nothing retries a 200.
    const audio = new Uint8Array([7, 7, 7]);
    const { read, calls } = scriptedRead([new Uint8Array(0), new Uint8Array(0), audio]);
    const clock = fakeClock();

    const result = await waitForPlayback('empty-then-real', {
      read,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(result).toBe(audio);
    expect(calls()).toBe(3);
    expect(clock.slept).toHaveLength(2);
  });

  it('gives up and returns null once the deadline passes', async () => {
    // The hard cap is the point: an unbounded loop would hang this test forever rather than fail
    // it, and a hung suite reads as an infrastructure flake instead of the bug it is.
    const HARD_CAP = 1_000;
    const clock = fakeClock();
    let reads = 0;
    const read = async (): Promise<Uint8Array | null> => {
      reads += 1;
      if (reads > HARD_CAP) {
        throw new Error(`waitForPlayback polled ${reads} times without honouring the deadline`);
      }
      return null;
    };

    const result = await waitForPlayback('never-arrives', {
      read,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(result).toBeNull();
    expect(reads).toBeGreaterThan(1);

    // The bound is derived from the module's own poll interval rather than hardcoded, so tuning
    // POLL_INTERVAL_MS cannot silently loosen it into a bound that proves nothing.
    const interval = clock.slept[0];
    expect(interval).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(WAIT_TIMEOUT_MS / interval + 1);
    expect(clock.slept.reduce((total, ms) => total + ms, 0)).toBeLessThanOrEqual(WAIT_TIMEOUT_MS);
  });

  it('reads through the injected client when it is given one', async () => {
    // Without this, the function silently falls back to the module-level pool and every test that
    // thinks it injected a database is really asserting against production wiring.
    const client: SqlClient = { query: async () => ({ rows: [] }) };
    const { read, clients } = scriptedRead([new Uint8Array([1])]);
    const clock = fakeClock();

    await waitForPlayback('injected-client', {
      read,
      client,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(clients).toHaveLength(1);
    expect(clients[0]).toBe(client);
  });
});

/**
 * The two statements are the whole mechanism, and both failure modes they guard against are
 * silent: a blocking lock still works in a one-instance test, and a mismatched key still returns
 * `released: false` without erroring. Only the text itself can be asserted here.
 */
describe('the advisory-lock SQL', () => {
  it('takes the non-blocking lock, never the blocking one', () => {
    // `pg_advisory_lock` would park every loser on a held pooled connection until the winner
    // finished — the exact resource exhaustion this whole module was written to avoid, and it
    // would pass any functional test that only ever runs one producer.
    expect(TRY_LOCK_SQL).toMatch(/\bpg_try_advisory_lock\s*\(/);
    expect(TRY_LOCK_SQL).not.toMatch(/\bpg_advisory_lock\b/);
  });

  it('keys the lock on hashtextextended with the fixed seed 0', () => {
    // The seed is the cross-instance contract. A per-process or randomised seed gives two Cloud
    // Run instances two different keys for one answer, and both of them win.
    expect(TRY_LOCK_SQL).toMatch(/hashtextextended\(\s*\$1\s*,\s*0\s*\)/);
  });

  it('passes the answer id as a bound parameter rather than interpolating it', () => {
    expect(TRY_LOCK_SQL).toContain('$1');
    expect(TRY_LOCK_SQL).not.toContain('${');
    expect(TRY_LOCK_SQL).not.toContain("'");
  });

  it('unlocks with pg_advisory_unlock on an identical key expression', () => {
    // If the two key expressions ever drift, the unlock frees nothing, reports success, and the
    // lock survives until the connection closes — after which every later asker times out.
    expect(UNLOCK_SQL).toMatch(/\bpg_advisory_unlock\s*\(/);
    expect(UNLOCK_SQL).toMatch(/hashtextextended\(\s*\$1\s*,\s*0\s*\)/);

    const keyOf = (sql: string) => sql.match(/hashtextextended\([^)]*\)/)?.[0];
    expect(keyOf(UNLOCK_SQL)).toBe(keyOf(TRY_LOCK_SQL));
    expect(keyOf(TRY_LOCK_SQL)).toBeDefined();
  });
});

/**
 * Only the guard that runs before the pool is reachable without a database. It is worth pinning
 * anyway: a route handler can be handed any string from a URL, and the difference between a clean
 * null and a thrown pool error is the difference between a 404 and a 500.
 */
describe('playbackLockClient.tryAcquire — the guard ahead of the pool', () => {
  it('returns null for a malformed answer id without reaching for a connection', async () => {
    // DATABASE_URL is removed so the assertion has teeth: if the uuid check were skipped or ran
    // after `acquireConnection()`, this rejects with the DATABASE_URL error instead of resolving.
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(playbackLockClient.tryAcquire('not-a-uuid')).resolves.toBeNull();
    } finally {
      if (saved === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = saved;
      }
    }
  });
});
