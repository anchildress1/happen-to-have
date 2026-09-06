import { z } from 'zod';
import { rateLimitRowSchema } from '../../schema/rows';
import { type SqlClient, db } from '../client';

/**
 * Server-side submission rate limiting (FR-048 – FR-052).
 *
 * The one place 002 writes to the database. Justified in plan.md's Complexity Tracking
 * against Principle V: a limiter must count submissions that leave no row, because the
 * withheld and failed ones are exactly the abuse that costs money. Counting published rows
 * misses the attack; an in-memory counter resets per Cloud Run instance, so the limit stops
 * existing the moment traffic justifies it.
 */

/** FR-048: configurable without a code change. Defaults live here so a deployment that sets
 * neither still has a limit. */
const DEFAULT_MAX = 20;
const DEFAULT_WINDOW_SECONDS = 3_600;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  // `Number` rather than `parseInt`, which accepts a valid prefix and discards the rest:
  // `parseInt('3_600')` is 3, and `parseInt('1e9')` is 1. Both are silent, and the first
  // turns a one-hour window into three seconds — effectively no limit at all, from an env
  // var that reads as correct.
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Typed as a plain record rather than `NodeJS.ProcessEnv`: Next.js augments that interface
 * with a required `NODE_ENV`, which would force every caller — tests included — to supply a
 * value this function never reads.
 */
export function rateLimitConfig(env: Record<string, string | undefined> = process.env): {
  max: number;
  windowSeconds: number;
} {
  return {
    max: readPositiveInt(env.HTH_RATE_LIMIT_MAX, DEFAULT_MAX),
    windowSeconds: readPositiveInt(env.HTH_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS),
  };
}

/**
 * A union so `retryAt` exists only where it means something. On an allowed submission it
 * would be the current window's close time, which is not a retry time and not something a
 * caller should be able to read by accident.
 */
export type RateLimitDecision =
  | { allowed: true; count: number }
  | { allowed: false; retryAt: Date; count: number };

export interface RateLimitClient {
  /** Counts one submission against the participant's window and reports whether it may run. */
  recordSubmission(participantId: string): Promise<RateLimitDecision>;
}

/**
 * One statement does the whole thing: open a window, or increment inside the live one, and
 * return the resulting row.
 *
 * Read-then-write would race two concurrent submissions past the limit — the exact traffic
 * a limiter exists for. `ON CONFLICT DO UPDATE` makes the check and the increment a single
 * atomic operation, and the `CASE` resets the window in the same statement rather than in a
 * separate transaction that could interleave.
 *
 * The count is incremented even when it lands over the limit. A refused submission is still
 * a submission — not counting it would let a caller sit exactly at the boundary and retry
 * forever at no cost.
 */
const RECORD_SUBMISSION_SQL = `
  INSERT INTO submission_rate_limits (participant_id, window_started_at, submission_count)
  VALUES ($1, now(), 1)
  ON CONFLICT (participant_id) DO UPDATE
  SET
    window_started_at = CASE
      WHEN submission_rate_limits.window_started_at < now() - ($2 || ' seconds')::interval
        THEN now()
      ELSE submission_rate_limits.window_started_at
    END,
    submission_count = CASE
      WHEN submission_rate_limits.window_started_at < now() - ($2 || ' seconds')::interval
        THEN 1
      ELSE submission_rate_limits.submission_count + 1
    END
  RETURNING participant_id, window_started_at, submission_count
`;

export function makeRateLimitClient(
  client: SqlClient = db,
  config = rateLimitConfig,
): RateLimitClient {
  return {
    async recordSubmission(participantId) {
      // Validated here rather than trusted. The column is a uuid PRIMARY KEY, so a malformed
      // id reaches Postgres and comes back as `invalid input syntax for type uuid` — a
      // rejected promise, when the contract says reviewContribution never throws for a review
      // outcome. Failing here names the real problem instead.
      z.uuid().parse(participantId);
      const { max, windowSeconds } = config();
      const { rows } = await client.query(RECORD_SUBMISSION_SQL, [participantId, windowSeconds]);
      const row = rateLimitRowSchema.parse(rows[0]);

      // Inclusive on purpose: `max` is how many submissions a window permits, so the 20th is
      // allowed and the 21st is not. An exclusive comparison would silently make the
      // documented limit one lower than the number an operator configured.
      const allowed = row.submission_count <= max;

      return allowed
        ? { allowed: true, count: row.submission_count }
        : {
            allowed: false,
            // Anchored to when THIS window opened, not to now. A participant limited 59
            // minutes into an hour must be told a minute, not another hour (FR-049).
            retryAt: new Date(row.window_started_at.getTime() + windowSeconds * 1_000),
            count: row.submission_count,
          };
    },
  };
}

/** The production instance, bound to the Neon pool. */
export const rateLimitClient: RateLimitClient = makeRateLimitClient();

// Re-exported so the limiter's tests reach it through the module they exercise. The
// statement itself lives in `sweep-sql.ts`, which has no imports, because `scripts/` loads
// it under plain Node where `src/`'s extensionless imports do not resolve.
export { SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL } from './sweep-sql';
