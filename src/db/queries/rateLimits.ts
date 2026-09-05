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
  const parsed = Number.parseInt(raw ?? '', 10);
  // A typo'd env var must not silently disable the limit. Anything unparseable or
  // non-positive falls back rather than becoming 0, which would refuse every submission, or
  // NaN, which would accept every one.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

export interface RateLimitDecision {
  allowed: boolean;
  /** When the current window closes. FR-049 requires telling the participant *when*. */
  retryAt: Date;
  /** Submissions counted inside the current window, including this one when allowed. */
  count: number;
}

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
      const { max, windowSeconds } = config();
      const { rows } = await client.query(RECORD_SUBMISSION_SQL, [participantId, windowSeconds]);
      const row = rateLimitRowSchema.parse(rows[0]);

      return {
        allowed: row.submission_count <= max,
        retryAt: new Date(row.window_started_at.getTime() + windowSeconds * 1_000),
        count: row.submission_count,
      };
    },
  };
}

/** The production instance, bound to the Neon pool. */
export const rateLimitClient: RateLimitClient = makeRateLimitClient();

/**
 * Deletes rows whose window closed long ago. Joined to the existing `db-sweep` job rather
 * than given a second scheduled task: a closed window carries no meaning, and the row is
 * abuse infrastructure rather than anything worth retaining.
 */
export const SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL = `
  DELETE FROM submission_rate_limits
  WHERE window_started_at < now() - ($1 || ' days')::interval
  RETURNING participant_id
`;
