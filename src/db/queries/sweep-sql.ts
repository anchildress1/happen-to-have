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
