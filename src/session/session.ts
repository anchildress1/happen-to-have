import { getIronSession, type SessionOptions, webCookies } from 'iron-session';
import { z } from 'zod';
import { type ParticipantsClient, participantsClient } from '../db/queries/participants.js';

const SESSION_SECRET = process.env.SESSION_SECRET;

// Constitution Principle II / contracts/session.md: a default secret is a
// forgeable session for every deployment that forgot to set one. Fail boot,
// don't fall back.
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error(
    'SESSION_SECRET must be set to a string of at least 32 characters. Refusing to boot with a missing or weak session secret.',
  );
}

const SESSION_COOKIE_NAME = 'hth_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * The ONLY data the cookie carries: `participantId`. No ask-eligibility flag,
 * no counts, no contribution history. Every eligibility decision re-reads the
 * database (contracts/session.md, constitution Principle II).
 */
export interface SessionData {
  participantId: string;
}

const sessionDataSchema = z.object({
  participantId: z.uuid(),
});

export const sessionOptions: SessionOptions = {
  cookieName: SESSION_COOKIE_NAME,
  password: SESSION_SECRET,
  ttl: SESSION_MAX_AGE_SECONDS,
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Set explicitly: iron-session otherwise derives max-age as `ttl - 60s`.
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
};

export interface GetOrCreateParticipantResult {
  participantId: string;
  isNew: boolean;
  /** Any Set-Cookie written by this call. Empty when the existing session was reused as-is. */
  headers: Headers;
}

/**
 * Resolves the participant behind a request, per contracts/session.md.
 *
 * Only a Route Handler or a client-invoked Server Action may call this — it
 * mutates state (may insert a participant row and write a session cookie).
 * Server Components must not call it during rendering.
 *
 * Branches:
 * 1. No cookie, or an undecryptable/tampered one → new participant, new session.
 * 2. Cookie holds a `participantId` whose row exists → reuse it, no writes.
 * 3. Cookie holds a `participantId` whose row is missing (e.g. after a database
 *    reset) → must NOT 500 and must NOT be trusted. New participant, new session.
 *
 * A database that cannot be reached is a 500 (thrown here, handled by the
 * caller) in every branch — never silently treated as "new participant."
 */
export async function getOrCreateParticipant(
  request: Request,
  client: ParticipantsClient = participantsClient,
): Promise<GetOrCreateParticipantResult> {
  const headers = new Headers();
  const session = await getIronSession<SessionData>(webCookies(request, headers), sessionOptions);

  const existing = sessionDataSchema.safeParse(session);
  if (existing.success) {
    const row = await client.findParticipantById(existing.data.participantId);
    if (row) {
      return { participantId: row.id, isNew: false, headers };
    }
    // Row missing: the cookie references a deleted or foreign participant.
    // Fall through and treat this exactly like "no cookie" — never trust it.
  }

  const created = await client.createParticipant();
  session.participantId = created.id;
  await session.save();
  return { participantId: created.id, isNew: true, headers };
}
