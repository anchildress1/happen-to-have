import { getIronSession, type SessionOptions, webCookies } from 'iron-session';
import { z } from 'zod';
import { type ParticipantsClient, participantsClient } from '../db/queries/participants';

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
 * The only data the cookie carries. No ask-eligibility flag, no counts, no history:
 * every eligibility decision re-reads the database (constitution Principle II).
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
 * Resolves the participant behind a request, creating one when the cookie is absent,
 * undecryptable, or names a row that no longer exists (contracts/session.md).
 *
 * May write, so only a Route Handler or client-invoked Server Action may call it — never
 * a Server Component during render. An unreachable database throws rather than quietly
 * minting a new identity, which would discard someone's history.
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

/**
 * The participant id the cookie claims, decrypted locally with no database round-trip.
 * Null when the cookie is absent, tampered, or malformed.
 *
 * An id that decrypts is not an id that exists, so any path that writes must still go
 * through `getOrCreateParticipant`.
 */
export async function readParticipantId(request: Request): Promise<string | null> {
  const session = await getIronSession<SessionData>(
    webCookies(request, new Headers()),
    sessionOptions,
  );
  const parsed = sessionDataSchema.safeParse(session);
  return parsed.success ? parsed.data.participantId : null;
}
