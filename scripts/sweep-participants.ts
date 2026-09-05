import { db } from '../src/db/client.ts';
import { SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL } from '../src/db/queries/rateLimits.ts';
import { SWEEP_CONTRIBUTIONLESS_PARTICIPANTS_SQL } from '../src/db/queries/sweep-sql.ts';

// DAYS=0 sweeps everything eligible, which is how test debris predating the isolated
// e2e branch was cleared. Default 30 matches the session cookie's lifetime.
const parsed = Number(process.argv[2] ?? '');
// Bounded at zero, not merely checked for NaN. Both statements interpolate this into
// `now() - ($1 || ' days')::interval`, so a negative argument becomes `now() + N days` and
// the WHERE clause matches every row — including every LIVE rate-limit window. That would
// reset every participant's counter and report it as a successful sweep.
const days = Number.isInteger(parsed) && parsed >= 0 ? parsed : 30;

// Both statements in one transaction. Separately, a failure in the second leaves the
// rate-limit rows already deleted and prints nothing — a partial destructive sweep reported
// as no sweep at all.
//
// Windows go first because the foreign key cascades: running it the other way round would
// delete rows the first statement then reports as zero.
await db.query('BEGIN');
let windows: Array<{ participant_id: string }>;
let rows: Array<{ id: string }>;
try {
  ({ rows: windows } = await db.query<{ participant_id: string }>(
    SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL,
    [days],
  ));
  ({ rows } = await db.query<{ id: string }>(SWEEP_CONTRIBUTIONLESS_PARTICIPANTS_SQL, [days]));
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
}

console.log(
  `Swept ${rows.length} contribution-less participant(s) and ${windows.length} closed ` +
    `rate-limit window(s) older than ${days} day(s).`,
);
