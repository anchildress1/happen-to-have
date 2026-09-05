import { unsealData } from 'iron-session';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParticipantsClient } from '../../src/db/queries/participants.js';

const VALID_SECRET = 'a'.repeat(32);
const ORIGINAL_SECRET = process.env.SESSION_SECRET;

function fakeClient(overrides: Partial<ParticipantsClient> = {}): ParticipantsClient {
  return {
    findParticipantById: async () => null,
    createParticipant: async () => {
      throw new Error('fakeClient: createParticipant not stubbed for this test');
    },
    ...overrides,
  };
}

describe('session authority — the cookie carries identity only', () => {
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = ORIGINAL_SECRET;
    }
    vi.resetModules();
  });

  it('fails to load when SESSION_SECRET is absent', async () => {
    vi.resetModules();
    delete process.env.SESSION_SECRET;
    await expect(import('../../src/session/session.js')).rejects.toThrow(/SESSION_SECRET/);
  });

  it('fails to load when SESSION_SECRET is under 32 characters', async () => {
    vi.resetModules();
    process.env.SESSION_SECRET = 'too-short';
    await expect(import('../../src/session/session.js')).rejects.toThrow(/SESSION_SECRET/);
  });

  it('serializes ONLY participantId — no canAsk, no counts, no contribution history', async () => {
    vi.resetModules();
    process.env.SESSION_SECRET = VALID_SECRET;
    const { getOrCreateParticipant, sessionOptions } = await import('../../src/session/session.js');

    const participantId = '11111111-1111-4111-8111-111111111111';
    const client = fakeClient({ createParticipant: async () => ({ id: participantId }) });
    const request = new Request('https://example.test/api/question', { method: 'POST' });

    const result = await getOrCreateParticipant(request, client);
    const [setCookie] = result.headers.getSetCookie();
    expect(setCookie).toBeTruthy();

    const cookiePair = setCookie.split(';')[0];
    const sealed = cookiePair.slice(cookiePair.indexOf('=') + 1);
    const data = await unsealData<Record<string, unknown>>(sealed, {
      password: sessionOptions.password,
      ttl: sessionOptions.ttl,
    });

    // The exact key set — this is what a reviewer's `grep canAsk src/session/` check protects.
    expect(Object.keys(data)).toEqual(['participantId']);
    expect(data).not.toHaveProperty('canAsk');
    expect(data).not.toHaveProperty('can_ask');
  });
});
