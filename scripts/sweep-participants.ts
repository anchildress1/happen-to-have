import { db } from '../src/db/client.ts';
import {
  DEFAULT_WINDOW_SECONDS,
  readPositiveInt,
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

// Parsed with the limiter's own function, not a local `parseInt`. A malformed value with a
// numeric prefix — `3_600`, `1e9` — makes the limiter fall back to an hour while `parseInt`
// yields 3 or 1, and the two paths then disagree about which windows are still open. The sweep
// would delete counters the limiter is still enforcing, which removes the limit silently.
const windowSeconds = readPositiveInt(
  process.env.HTH_RATE_LIMIT_WINDOW_SECONDS,
  DEFAULT_WINDOW_SECONDS,
);

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
  // Takes the window length too: the participant delete cascades onto rate-limit counters, so
  // without it a DAYS=0 sweep wipes the live window of a participant who has published nothing
  // — precisely the one the limiter exists to slow down.
  ({ rows } = await db.query<{ id: string }>(SWEEP_CONTRIBUTIONLESS_PARTICIPANTS_SQL, [
    days,
    windowSeconds,
  ]));
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
}

console.log(
  `Swept ${rows.length} contribution-less participant(s) and ${windows.length} closed ` +
    `rate-limit window(s) older than ${days} day(s).`,
);
