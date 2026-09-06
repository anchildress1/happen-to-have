import { db } from '../src/db/client.ts';
import {
  SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL,
  SWEEP_CONTRIBUTIONLESS_PARTICIPANTS_SQL,
} from '../src/db/queries/sweep-sql.ts';

// DAYS=0 sweeps everything eligible, which is how test debris predating the isolated
// e2e branch was cleared. Default 30 matches the session cookie's lifetime.
const raw = process.argv[2];
// `Number('')` is 0, so defaulting the missing argument to an empty string and then checking
// `>= 0` accepted it — every ordinary `make db-sweep` would have run with a cutoff of now()
// and deleted every eligible participant. The absent case is handled before parsing.
const parsed = raw === undefined || raw === '' ? Number.NaN : Number(raw);
// Bounded at zero as well as checked for NaN. Both statements interpolate this into
// `now() - ($1 || ' days')::interval`, so a negative argument becomes `now() + N days` and
// the WHERE clause matches every row — including every LIVE rate-limit window.
const days = Number.isInteger(parsed) && parsed >= 0 ? parsed : 30;

// The rate-limit sweep needs the configured window length to measure from the window's END.
// Kept in step with the limiter's own default so a deployment that sets neither still sweeps
// on the same basis the limiter counts on.
const windowSeconds = Number.parseInt(process.env.HTH_RATE_LIMIT_WINDOW_SECONDS ?? '', 10) || 3600;

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
    [days, windowSeconds],
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
