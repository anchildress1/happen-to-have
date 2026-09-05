import { sealData } from 'iron-session';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParticipantsClient } from '../../src/db/queries/participants.js';

/**
 * These exercise `getOrCreateParticipant`'s branching against an injected fake
 * `ParticipantsClient`, not a real Postgres/dataconnect instance — no database
 * is reachable from this test environment. They cover every branch
 * contracts/session.md requires; swap the fakes below for the real
 * `participantsClient` export from `src/db/queries/participants.ts` once a
 * Postgres/emulator connection is available to run against.
 */

const SESSION_SECRET = 'c'.repeat(32);
process.env.SESSION_SECRET = SESSION_SECRET;

let getOrCreateParticipant: typeof import('../../src/session/session.js').getOrCreateParticipant;
let sessionOptions: typeof import('../../src/session/session.js').sessionOptions;

beforeAll(async () => {
  ({ getOrCreateParticipant, sessionOptions } = await import('../../src/session/session.js'));
});

function fakeClient(overrides: Partial<ParticipantsClient>): ParticipantsClient {
  return {
    findParticipantById: async () => null,
    createParticipant: async () => {
      throw new Error('fakeClient: createParticipant not stubbed for this test');
    },
    ...overrides,
  };
}

function throwingClient(message: string): ParticipantsClient {
  return {
    findParticipantById: async () => {
      throw new Error(message);
    },
    createParticipant: async () => {
      throw new Error(message);
    },
  };
}

async function cookieHeaderFor(participantId: string): Promise<string> {
  const sealed = await sealData(
    { participantId },
    { password: sessionOptions.password, ttl: sessionOptions.ttl },
  );
  return `${sessionOptions.cookieName}=${sealed}`;
}

const PARTICIPANT_A = '11111111-1111-4111-8111-111111111111';
const PARTICIPANT_B = '22222222-2222-4222-8222-222222222222';

describe('getOrCreateParticipant — contracts/session.md branches', () => {
  it('no cookie: creates a new participant and writes a session cookie', async () => {
    const client = fakeClient({ createParticipant: async () => ({ id: PARTICIPANT_A }) });
    const request = new Request('https://example.test/api/question', { method: 'POST' });

    const result = await getOrCreateParticipant(request, client);

    expect(result.isNew).toBe(true);
    expect(result.participantId).toBe(PARTICIPANT_A);
    expect(result.headers.getSetCookie()).toHaveLength(1);
  });

  it('valid cookie referencing an existing row: reuses the participant, no new row', async () => {
    const client = fakeClient({
      findParticipantById: async (id) => (id === PARTICIPANT_A ? { id } : null),
    });
    const cookie = await cookieHeaderFor(PARTICIPANT_A);
    const request = new Request('https://example.test/api/question', {
      method: 'POST',
      headers: { cookie },
    });

    const result = await getOrCreateParticipant(request, client);

    expect(result.isNew).toBe(false);
    expect(result.participantId).toBe(PARTICIPANT_A);
  });

  it('cookie referencing a deleted/foreign row: creates a new participant, no 500', async () => {
    const client = fakeClient({
      findParticipantById: async () => null, // the cookie's participant no longer exists
      createParticipant: async () => ({ id: PARTICIPANT_B }),
    });
    const cookie = await cookieHeaderFor(PARTICIPANT_A); // references a row that no longer exists
    const request = new Request('https://example.test/api/question', {
      method: 'POST',
      headers: { cookie },
    });

    const result = await getOrCreateParticipant(request, client);

    expect(result.isNew).toBe(true);
    expect(result.participantId).toBe(PARTICIPANT_B);
    expect(result.headers.getSetCookie()).toHaveLength(1);
  });

  it('tampered/undecryptable cookie: creates a new participant, no 500', async () => {
    const client = fakeClient({ createParticipant: async () => ({ id: PARTICIPANT_B }) });
    const request = new Request('https://example.test/api/question', {
      method: 'POST',
      headers: { cookie: `${sessionOptions.cookieName}=not-a-real-seal` },
    });

    const result = await getOrCreateParticipant(request, client);

    expect(result.isNew).toBe(true);
    expect(result.participantId).toBe(PARTICIPANT_B);
  });

  it('database unreachable with no cookie: throws rather than fabricating a participant', async () => {
    const client = throwingClient('connection refused');
    const request = new Request('https://example.test/api/question', { method: 'POST' });

    await expect(getOrCreateParticipant(request, client)).rejects.toThrow('connection refused');
  });

  it('database unreachable with an existing cookie: throws rather than fabricating a participant', async () => {
    const client = throwingClient('connection refused');
    const cookie = await cookieHeaderFor(PARTICIPANT_A);
    const request = new Request('https://example.test/api/question', {
      method: 'POST',
      headers: { cookie },
    });

    await expect(getOrCreateParticipant(request, client)).rejects.toThrow('connection refused');
  });
});
