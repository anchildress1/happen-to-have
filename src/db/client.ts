/**
 * Server-side only. Importing this module from a Client Component ships a live Postgres
 * connection string into the browser bundle — a Principle II violation, since ask
 * eligibility must be computed and enforced on the server. A client that can read this
 * module's internals can forge its own authority.
 */
import 'server-only';

import { Pool, types } from '@neondatabase/serverless';

// node-postgres-compatible: bigint (OID 20 — every COUNT in this feature) arrives as a
// string by default, because the driver cannot safely widen every int8 into a JS number.
// Our counts stay far inside Number.MAX_SAFE_INTEGER, so parse eagerly and let callers
// read a plain number instead of casting ::int at every call site.
types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Run `neon checkout <branch>` to pull the branch env, ' +
        'or set it from Secret Manager in production.',
    );
  }

  // Cloud Run scales instances independently and each holds its own pool, so keep the
  // per-instance ceiling low: max × Cloud Run max-instances must stay under the project's
  // connection limit. Neon's pooled endpoint (-pooler host, the default DATABASE_URL)
  // absorbs the rest.
  pool = new Pool({ connectionString, max: 4 });
  return pool;
}

/**
 * A connection held for the caller's exclusive use, and released by them.
 *
 * Needed for exactly one thing: a session-level advisory lock, which Postgres ties to the
 * connection that took it. Every other caller in this codebase uses `db` and must keep doing so —
 * a pooled query has no connection affinity, so a lock taken through it could be released by a
 * different request or never released at all.
 */
export interface PooledConnection extends SqlClient {
  release(): void;
}

/** See `PooledConnection`. Callers MUST `release()` in a `finally`. */
export async function acquireConnection(): Promise<PooledConnection> {
  const client = await getPool().connect();
  return {
    query: ((sql, params) =>
      client.query(sql, params as unknown[] | undefined)) as SqlClient['query'],
    release: () => client.release(),
  };
}

/**
 * The only database surface the query modules depend on. Declaring it lets tests inject an
 * in-process Postgres (PGlite) without importing this module's Neon pool, and without any
 * query module knowing which one it got.
 */
export interface SqlClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

/**
 * Parameterized SQL against the branch named in `.neon`. Every caller must use `$1`-style
 * placeholders — never interpolate a value into `sql`.
 */
export const db: SqlClient = {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }> {
    return getPool().query(sql, params as unknown[] | undefined) as unknown as Promise<{
      rows: T[];
    }>;
  },
};
