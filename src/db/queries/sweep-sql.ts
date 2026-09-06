/**
 * FR-005a. Kept in a module with no imports of its own so the CLI in `scripts/` can load it
 * under plain Node, where `src/`'s extensionless imports (research D16) do not resolve.
 * One copy of the statement, reachable from both the tested query and the script.
 */
export const SWEEP_CONTRIBUTIONLESS_PARTICIPANTS_SQL = `DELETE FROM participants p
 WHERE p.created_at < now() - make_interval(days => $1)
   AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.participant_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM answers a WHERE a.participant_id = p.id)
 RETURNING p.id`;

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
 */
export const SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL = `
  DELETE FROM submission_rate_limits
  WHERE window_started_at + ($2 || ' seconds')::interval < now() - ($1 || ' days')::interval
  RETURNING participant_id
`;
