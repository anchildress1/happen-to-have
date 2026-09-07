import 'server-only';

import { z } from 'zod';
import { acquireConnection, db, type SqlClient } from './client';

/**
 * Cross-instance serialization for playback production (FR-028, SC-005).
 *
 * The in-process map in `src/playback/index.ts` coalesces two taps that land on the same Cloud
 * Run instance. It cannot see a second instance, and Cloud Run runs as many as it likes — so
 * without this, "exactly one production" was only ever true per instance, and the `IS NULL`
 * claim guaranteed one stored *artifact* while permitting two billed *productions*.
 *
 * A Postgres advisory lock is cluster-wide, which is exactly the scope that was missing. It is
 * also **not stored state**: it lives in the lock table for the life of a session and vanishes if
 * the connection drops. That matters, because the obvious alternative — a `playback_pending` row
 * — is processing state in the database, which Principle V forbids in those words, and it strands
 * a claim nobody clears when a producer crashes mid-call. A lock has no such failure mode: kill
 * the instance and Postgres releases it.
 *
 * `pg_try_advisory_lock`, never the blocking `pg_advisory_lock`. A loser must not sit on a
 * connection waiting — it returns immediately and reads the winner's result instead.
 */

/**
 * The lock key.
 *
 * `hashtextextended` gives a stable bigint for a uuid, which is what the advisory-lock functions
 * take. The second argument is the seed, fixed at 0 so the key is identical in every instance —
 * a per-process seed would give two instances two different keys for one answer and defeat the
 * whole mechanism.
 *
 * Advisory locks share one namespace database-wide, so the seed also acts as this feature's
 * corner of it. Nothing else in this codebase takes an advisory lock; `node-pg-migrate` takes its
 * own during migrations, on its own key.
 */
const TRY_LOCK_SQL = 'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired';
const UNLOCK_SQL = 'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released';

export { TRY_LOCK_SQL, UNLOCK_SQL };

/** Held by whoever won the right to produce. `release()` is mandatory and belongs in a `finally`. */
export interface PlaybackLock {
  release(): Promise<void>;
}

export interface PlaybackLockClient {
  /** Null when another session holds it — the caller must then wait for that session's result. */
  tryAcquire(answerId: string): Promise<PlaybackLock | null>;
}

/**
 * The real implementation, on a connection of its own.
 *
 * A session-level advisory lock belongs to the connection that took it, so this cannot go through
 * the shared `db` helper — a pooled query has no connection affinity, and the lock would be
 * released by whichever later request happened to be handed that connection, or never at all.
 *
 * One connection is held for the duration of the TTS call, which is the real cost of this design
 * and is bounded by how rare the path is: a response can be produced at most once ever, only its
 * asker can trigger it, and a question closes at three answers.
 */
export const playbackLockClient: PlaybackLockClient = {
  async tryAcquire(answerId: string): Promise<PlaybackLock | null> {
    const parsed = z.uuid().safeParse(answerId);
    if (!parsed.success) {
      return null;
    }

    const connection = await acquireConnection();
    try {
      const { rows } = await connection.query<{ acquired: boolean }>(TRY_LOCK_SQL, [parsed.data]);
      if (!rows[0]?.acquired) {
        connection.release();
        return null;
      }
    } catch (cause) {
      connection.release();
      throw cause;
    }

    return {
      async release() {
        try {
          await connection.query(UNLOCK_SQL, [parsed.data]);
        } finally {
          // Released even if the unlock statement fails. Returning the connection to the pool
          // without unlocking would leak the lock into the next request that borrows it; dropping
          // the connection instead is what makes that unreachable, since Postgres frees every
          // advisory lock a session held when the session ends.
          connection.release();
        }
      },
    };
  },
};

/** How long a loser waits for the winner's audio before giving up and answering retryably. */
export const WAIT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;

export interface WaitDeps {
  read: (answerId: string, client?: SqlClient) => Promise<Uint8Array | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  client?: SqlClient;
}

/**
 * Waits for whichever session holds the lock to finish and store its audio.
 *
 * Polling, not `LISTEN`/`NOTIFY`: a notification channel needs its own held connection per
 * waiter, which is the cost this design exists to avoid, and the wait is a couple of seconds in
 * the ordinary case.
 *
 * Returns null on timeout rather than producing anyway. The caller answers 502, which is
 * retryable — and by then the winner has almost certainly stored the audio, so the retry is a
 * cache hit. Producing here instead would reintroduce exactly the duplicate call this module
 * removes.
 */
export async function waitForPlayback(
  answerId: string,
  deps: WaitDeps,
): Promise<Uint8Array | null> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const client = deps.client ?? db;
  const deadline = now() + WAIT_TIMEOUT_MS;

  // Read once before sleeping: the winner may already have stored the audio between the failed
  // lock attempt and this call, in which case sleeping first would add a quarter second for
  // nothing.
  for (;;) {
    const audio = await deps.read(answerId, client);
    if (audio && audio.length > 0) {
      return audio;
    }
    if (now() >= deadline) {
      return null;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
