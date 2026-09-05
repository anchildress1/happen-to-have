import { db } from '../src/db/client.ts';
import { SWEEP_CONTRIBUTIONLESS_PARTICIPANTS_SQL } from '../src/db/queries/sweep-sql.ts';

// DAYS=0 sweeps everything eligible, which is how test debris predating the isolated
// e2e branch was cleared. Default 30 matches the session cookie's lifetime.
const parsed = Number.parseInt(process.argv[2] ?? '', 10);
const days = Number.isNaN(parsed) ? 30 : parsed;

const { rows } = await db.query<{ id: string }>(SWEEP_CONTRIBUTIONLESS_PARTICIPANTS_SQL, [days]);
console.log(`Swept ${rows.length} contribution-less participant(s) older than ${days} day(s).`);
