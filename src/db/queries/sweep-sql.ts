/**
 * FR-005a. Kept in a module with no imports of its own so the CLI in `scripts/` can load it
 * under plain Node, where `src/`'s extensionless imports (research D16) do not resolve.
 * One copy of the statement, reachable from both the tested query and the script.
 */
export const SWEEP_CONTRIBUTIONLESS_PARTICIPANTS_SQL = `DELETE FROM participants p
 WHERE p.created_at < now() - make_interval(days => $1)
   AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.participant_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM answers a WHERE a.participant_id = p.id)
   AND NOT EXISTS (
     SELECT 1 FROM submission_rate_limits s
      WHERE s.participant_id = p.id
        AND s.window_started_at + ($2 || ' seconds')::interval > now()
   )
 RETURNING p.id`;

/**
 * The limiter's own parser, shared so the sweep cannot disagree with it.
 *
 * `Number` rather than `parseInt`, which accepts a valid prefix and discards the rest:
 * `parseInt('3_600')` is 3 and `parseInt('1e9')` is 1. Both are silent, and the first turns a
 * one-hour window into three seconds. A sweep parsing that differently from the limiter deletes
 * counters the limiter still considers live, which is a rate limit that quietly stops existing.
 *
 * Lives here rather than beside the limiter for the same reason the statements do: `scripts/`
 * loads this module under plain Node.
 */
export function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const DEFAULT_WINDOW_SECONDS = 3600;

/**
 * FR-048. Deletes rate-limit counters whose window closed at least `$1` days ago.
 *
 * `$1` is in DAYS, unlike every other duration in the limiter, which is in seconds.
 *
 * The cutoff is measured from the window's END, not its start: `window_started_at` plus the
 * configured window length in `$2` seconds. Measuring from the start deletes counters whose
 * window is still open whenever retention is shorter than the window — and `DAYS=0` is a
 * documented invocation, which under a start-based predicate wipes every live counter and
 * silently removes the limit for everyone.
 *
 * Lives here rather than beside the limiter because `scripts/` loads this under plain Node,
 * where `src/`'s extensionless imports do not resolve.
 *
 * The participant sweep above takes `$2` for the same window length, and for a related reason:
 * deleting a contribution-less participant cascades through the foreign key onto their counter.
 * Without that guard, a `DAYS=0` sweep resets the live window of exactly the participant the
 * limiter exists to slow down — one who has published nothing.
 */
export const SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL = `
  DELETE FROM submission_rate_limits
  WHERE window_started_at + ($2 || ' seconds')::interval < now() - ($1 || ' days')::interval
  RETURNING participant_id
`;
