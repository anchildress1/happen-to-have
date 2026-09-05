import { z } from 'zod';
import { db, type SqlClient } from '../client';

/**
 * The only shape `getOrCreateParticipant` (src/session/session.ts) needs from either
 * operation is the participant's id. It never reads `can_ask` — T033 forbids that value
 * from reaching the session at all — and never reads `created_at`. Selecting columns
 * nobody consumes would be exactly the speculative work Principle VI forbids.
 */
export interface ParticipantsClient {
  findParticipantById(id: string): Promise<{ id: string } | null>;
  createParticipant(): Promise<{ id: string }>;
}

const participantIdSchema = z.object({ id: z.uuid() });

/**
 * Backed by parameterized SQL. The row is parsed before it leaves this module: a driver
 * returning an unexpected shape must fail loudly rather than hand a malformed id to the
 * session (Principle V).
 *
 * Takes the SQL client as an argument so tests can exercise the real queries against an
 * in-process Postgres. Defaults to the Neon pool, so production callers need not care.
 */
export function makeParticipantsClient(client: SqlClient = db): ParticipantsClient {
  return {
    async findParticipantById(id) {
      const { rows } = await client.query<{ id: string }>(
        'SELECT id FROM participants WHERE id = $1',
        [id],
      );
      const row = rows[0];
      return row ? participantIdSchema.parse(row) : null;
    },

    async createParticipant() {
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO participants DEFAULT VALUES RETURNING id',
      );
      return participantIdSchema.parse(rows[0]);
    },
  };
}

/** The production instance, bound to the Neon pool. */
export const participantsClient: ParticipantsClient = makeParticipantsClient();
