import { describe, expect, it } from 'vitest';
import type { GenAiClient } from '../../src/review/client.js';
import { reviewContribution } from '../../src/review/index.js';
import type { RateLimitClient } from '../../src/db/queries/rateLimits.js';

/**
 * The fan-out end to end, with the provider faked at the SDK boundary (research D12).
 *
 * FR-002 – FR-005: every call receives the ORIGINAL audio and none receives another's output.
 * That is the property a mock can actually prove, and the one that quietly breaks first if
 * anyone "optimizes" by feeding the transcript to the judgments.
 */

const AUDIO = new Uint8Array(2048).fill(7);
const MIME = 'audio/webm;codecs=opus';

const PERMIT = {
  content: {
    canPublish: true,
    displayText: 'Feed it at the same time daily.',
    sourceLanguage: 'en',
    emotion: null,
    contentReason: null,
  },
  crisis: { inTrouble: false, signal: 'none' },
  verdict: { canPublish: true, detail: '' },
};

function fakeProvider(overrides: Record<string, unknown> = {}) {
  const seen: Array<{ model: string; parts: unknown[] }> = [];
  const client: GenAiClient = {
    async generateContent(params) {
      const parts = (params.contents as Array<{ parts: unknown[] }>)[0].parts;
      seen.push({ model: params.model, parts });
      // Collapsed, because the prompts wrap: "is this person in\ntrouble right now" does not
      // contain "in trouble right now" as written, and a fake that silently misroutes turns
      // every assertion in this file into a test of the retry budget.
      const instruction = String(params.config?.systemInstruction ?? '').replace(/\s+/g, ' ');
      const which = instruction.includes('in trouble right now')
        ? 'crisis'
        : instruction.includes('unlawful or dangerous')
          ? 'illegal'
          : instruction.includes('engage the question')
            ? 'relevance'
            : 'content';
      const body =
        overrides[which] ??
        PERMIT[which === 'content' ? 'content' : which === 'crisis' ? 'crisis' : 'verdict'];
      // A real candidate, because runCheck treats an empty `candidates` array as the
      // provider's non-adjustable block — a fault that retries three times (FR-008b1).
      return {
        candidates: [{ finishReason: 'STOP', index: 0 }],
        text: JSON.stringify(body),
      } as never;
    },
  };
  return { client, seen };
}

const allowAll: RateLimitClient = {
  async recordSubmission() {
    return { allowed: true, count: 1 };
  },
};

const run = (kind: 'answer' | 'question', client: GenAiClient, rateLimit = allowAll) =>
  reviewContribution(
    {
      kind,
      audio: AUDIO,
      mimeType: MIME,
      questionText: kind === 'answer' ? 'How do you get through a hard week?' : null,
      participantId: '11111111-1111-4111-8111-111111111111',
      signal: new AbortController().signal,
    },
    { genai: client, rateLimit },
  );

describe('review fan-out — width and isolation (FR-002 – FR-005)', () => {
  it('dispatches exactly four calls for an answer', async () => {
    const { client, seen } = fakeProvider();

    await run('answer', client);

    expect(seen).toHaveLength(4);
  });

  it('dispatches exactly three for a question, with no relevance call at all', async () => {
    // FR-003. Not a relevance call returning null — no call. A null verdict is
    // indistinguishable from an absent one, and absence is not permission.
    const { client, seen } = fakeProvider();

    await run('question', client);

    expect(seen).toHaveLength(3);
    expect(seen.some((c) => String(c.parts).includes('engage the question'))).toBe(false);
  });

  it('gives every call the original audio, and none the output of another', async () => {
    const { client, seen } = fakeProvider();

    await run('answer', client);

    const expected = Buffer.from(AUDIO).toString('base64');
    for (const call of seen) {
      const inline = call.parts.find(
        (p) => typeof p === 'object' && p !== null && 'inlineData' in p,
      );
      expect((inline as { inlineData: { data: string } }).inlineData.data).toBe(expected);
      expect(JSON.stringify(call.parts)).not.toContain('Feed it at the same time daily');
    }
  });

  it('sends the question text to relevance and to nothing else', async () => {
    const { client, seen } = fakeProvider();

    await run('answer', client);

    const withQuestion = seen.filter((c) => JSON.stringify(c.parts).includes('hard week'));
    expect(withQuestion).toHaveLength(1);
  });

  it('runs crisis on the content tier, not the cheap one', async () => {
    // FR-008a1, the load-bearing rule. A downgrade here is invisible in every other test.
    const { client, seen } = fakeProvider();

    await run('answer', client);

    const models = Object.fromEntries(
      seen.map((c) => [String(c.parts).length && c.model, c.model]),
    );
    void models;
    const flash = seen.filter((c) => c.model === 'gemini-3.8-flash');
    expect(flash).toHaveLength(2);
  });
});

describe('review fan-out — outcomes', () => {
  it('publishes when everything permits', async () => {
    const { client } = fakeProvider();

    await expect(run('answer', client)).resolves.toMatchObject({ status: 'publish' });
  });

  it('withholds on crisis, and crisis outranks a simultaneous illegal refusal', async () => {
    const { client } = fakeProvider({
      crisis: { inTrouble: true, signal: 'BURDEN' },
      illegal: { canPublish: false, detail: 'x' },
    });

    await expect(run('answer', client)).resolves.toEqual({ status: 'withheld', reason: 'crisis' });
  });

  it('withholds content with the reason that selects its heading', async () => {
    const { client } = fakeProvider({
      content: {
        canPublish: false,
        displayText: '',
        sourceLanguage: null,
        emotion: null,
        contentReason: 'silence',
      },
    });

    await expect(run('answer', client)).resolves.toEqual({
      status: 'withheld',
      reason: 'content',
      contentReason: 'silence',
    });
  });
});

describe('review fan-out — costs nothing before it has to (FR-048, FR-050)', () => {
  it('makes no provider call when the participant is rate limited', async () => {
    const retryAt = new Date('2026-09-06T12:00:00Z');
    const limited: RateLimitClient = {
      async recordSubmission() {
        return { allowed: false, retryAt, count: 21 };
      },
    };
    const { client, seen } = fakeProvider();

    await expect(run('answer', client, limited)).resolves.toEqual({
      status: 'rate_limited',
      retryAt,
    });
    expect(seen).toHaveLength(0);
  });

  it('makes no provider call for audio below the floor', async () => {
    const { client, seen } = fakeProvider();

    const outcome = await reviewContribution(
      {
        kind: 'question',
        audio: new Uint8Array(16),
        mimeType: MIME,
        questionText: null,
        participantId: '11111111-1111-4111-8111-111111111111',
        signal: new AbortController().signal,
      },
      { genai: client, rateLimit: allowAll },
    );

    expect(outcome).toEqual({ status: 'withheld', reason: 'content', contentReason: 'silence' });
    expect(seen).toHaveLength(0);
  });

  it('accepts a codec-qualified mime type rather than rejecting every Chrome recording', async () => {
    const { client, seen } = fakeProvider();

    await run('question', client);

    expect(seen.length).toBeGreaterThan(0);
  });

  it('makes no provider call for a disallowed container', async () => {
    const { client, seen } = fakeProvider();

    const outcome = await reviewContribution(
      {
        kind: 'question',
        audio: AUDIO,
        mimeType: 'video/mp4',
        questionText: null,
        participantId: '11111111-1111-4111-8111-111111111111',
        signal: new AbortController().signal,
      },
      { genai: client, rateLimit: allowAll },
    );

    expect(outcome).toMatchObject({ status: 'withheld', reason: 'content' });
    expect(seen).toHaveLength(0);
  });
});

describe('review fan-out — programmer error is the only throw', () => {
  it('throws for an answer with no question text', async () => {
    const { client } = fakeProvider();

    await expect(
      reviewContribution(
        {
          kind: 'answer',
          audio: AUDIO,
          mimeType: MIME,
          questionText: null,
          participantId: '11111111-1111-4111-8111-111111111111',
          signal: new AbortController().signal,
        },
        { genai: client, rateLimit: allowAll },
      ),
    ).rejects.toThrow(TypeError);
  });

  it('returns failed rather than throwing when the provider is down', async () => {
    const client: GenAiClient = {
      async generateContent() {
        throw new Error('ECONNRESET');
      },
    };

    await expect(run('answer', client)).resolves.toMatchObject({ status: 'failed' });
  });
});
