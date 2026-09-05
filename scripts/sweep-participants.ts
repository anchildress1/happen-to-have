import { db } from '../src/db/client.ts';
import { SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL } from '../src/db/queries/rateLimits.ts';
import { SWEEP_CONTRIBUTIONLESS_PARTICIPANTS_SQL } from '../src/db/queries/sweep-sql.ts';

// DAYS=0 sweeps everything eligible, which is how test debris predating the isolated
// e2e branch was cleared. Default 30 matches the session cookie's lifetime.
const parsed = Number.parseInt(process.argv[2] ?? '', 10);
const days = Number.isNaN(parsed) ? 30 : parsed;

// Rate-limit rows go first. A closed window carries no meaning, and sweeping them here
// rather than on their own schedule keeps 002 from adding a second cron for one integer.
// Participants are swept second because the foreign key cascades — running it the other way
// round would delete rows this statement then reports as zero.
const { rows: windows } = await db.query<{ participant_id: string }>(
  SWEEP_CLOSED_RATE_LIMIT_WINDOWS_SQL,
  [days],
);

const { rows } = await db.query<{ id: string }>(SWEEP_CONTRIBUTIONLESS_PARTICIPANTS_SQL, [days]);

console.log(
  `Swept ${rows.length} contribution-less participant(s) and ${windows.length} closed ` +
    `rate-limit window(s) older than ${days} day(s).`,
);
