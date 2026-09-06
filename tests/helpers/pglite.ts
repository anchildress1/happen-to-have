import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { SqlClient } from '../../src/db/client';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

/**
 * Postgres compiled to WASM, in-process. Tests get real SQL — the correlated NOT EXISTS,
 * `IS DISTINCT FROM`, and the COUNT-driven ordering all actually execute — without touching
 * the live Neon branch, which is shared mutable state that would make runs order-dependent
 * and leave debris behind on a failed cleanup.
 *
 * A canned-rows stub would be faster still and would prove nothing: the selection query IS
 * the behaviour under test, and a stub only replays what the test already assumed.
 */
export interface TestDb extends SqlClient {
  /** Drop every row, keeping the schema. Cheaper than rebuilding between tests. */
  truncate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The schema comes from `migrations/*.sql`, executed in filename order — never transcribed
 * into the test. A hand-copied schema drifts silently the first time a migration changes,
 * and then the suite is green against a database that no longer exists.
 */
function migrationUpSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      // node-pg-migrate keeps both directions in one file; only apply the up half.
      const down = sql.indexOf('-- Down Migration');
      return down === -1 ? sql : sql.slice(0, down);
    })
    .join('\n');
}

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec(migrationUpSql());

  return {
    async query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const result = await pg.query<T>(sql, params ? [...params] : undefined);
      return { rows: result.rows };
    },
    async truncate() {
      await pg.exec('TRUNCATE answers, questions, submission_rate_limits, participants CASCADE;');
    },
    async close() {
      await pg.close();
    },
  };
}
