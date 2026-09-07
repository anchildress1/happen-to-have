import 'server-only';

import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { type SessionData, sessionDataSchema, sessionOptions } from './session';

/**
 * The participant id, read inside a Server Component.
 *
 * `readParticipantId` in `./session` takes a `Request`, which is what a route handler has and
 * what the integration tests can construct. A Server Component has neither — it reads the
 * cookie store from `next/headers` instead.
 *
 * This lives in its own module rather than beside its sibling so that importing the session
 * helpers does not drag `next/headers` into the unit and integration suites, which run under
 * plain Vitest with no Next request context to satisfy it.
 *
 * Read-only on purpose: it never mints a participant. 001 owns identity creation, and a page
 * that created one would hand an unauthenticated caller a row for the cost of a GET.
 */
export async function readParticipantIdFromCookies(): Promise<string | null> {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  const parsed = sessionDataSchema.safeParse(session);
  return parsed.success ? parsed.data.participantId : null;
}
