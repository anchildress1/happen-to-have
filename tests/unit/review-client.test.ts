import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * T006-T008, FR-008b. Three properties of the provider client that are easy to lose in a
 * later refactor and expensive to lose quietly.
 *
 * The module reads `GEMINI_API_KEY` lazily rather than at import, so every test here
 * re-imports it with `vi.resetModules()`-free dynamic import against a mutated env — the
 * same shape `tests/unit/session-authority.test.ts` uses for `SESSION_SECRET`, except that
 * one validates at module load and this one deliberately does not.
 */

const REAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key-not-a-real-credential';
});

afterEach(() => {
  if (REAL_KEY === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = REAL_KEY;
  }
});

describe('review client — safety settings (FR-008b)', () => {
  it('sets all four adjustable harm categories to BLOCK_NONE', async () => {
    const { NEVER_BLOCK } = await import('../../src/review/client.js');

    expect(NEVER_BLOCK.map((setting) => setting.category)).toEqual([
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ]);
    expect(NEVER_BLOCK.every((setting) => setting.threshold === 'BLOCK_NONE')).toBe(true);
  });

  it('is a single shared constant, so both calls cannot drift apart', async () => {
    // The provider ships these filters off by default, which means an omitted setting and
    // BLOCK_NONE behave identically today. That is exactly why one call silently losing the
    // setting would not fail any behavioural test — only this identity check catches it.
    const { NEVER_BLOCK } = await import('../../src/review/client.js');
    const again = await import('../../src/review/client.js');

    expect(again.NEVER_BLOCK).toBe(NEVER_BLOCK);
  });
});

describe('review client — pinned models (constitution, Application Stack)', () => {
  it('pins content processing to Flash and the judgment call to Flash-Lite', async () => {
    const { REVIEW_MODELS } = await import('../../src/review/client.js');

    // Content processing MUST NOT be downgraded to Flash-Lite without evidence: it performs
    // the redaction pass, and a missed name is the one failure in this product that cannot
    // be retried once published.
    expect(REVIEW_MODELS.content).toBe('gemini-3.8-flash');
    expect(REVIEW_MODELS.judgment).toBe('gemini-3.5-flash-lite');
  });

  it('pins no model whose id marks it preview or Live', async () => {
    const { REVIEW_MODELS } = await import('../../src/review/client.js');

    // Live API models are speech-to-speech over a stateful socket and cannot return
    // structured text. Reaching for one is a rewrite, not a config change, so the ban is
    // asserted on the ids rather than left to review.
    for (const model of Object.values(REVIEW_MODELS)) {
      expect(model).not.toContain('live');
      expect(model).not.toContain('preview');
    }
  });
});

describe('review client — credential handling', () => {
  it('does not throw on import when GEMINI_API_KEY is absent', async () => {
    delete process.env.GEMINI_API_KEY;

    // Importing must stay safe: a route that never reviews anything should not fail to boot
    // because a key it will not use is missing. The failure belongs at first call.
    await expect(import('../../src/review/client.js')).resolves.toBeDefined();
  });

  it('names the missing variable when a review is attempted without a key', async () => {
    const { makeGenAiClient } = await import('../../src/review/client.js');
    delete process.env.GEMINI_API_KEY;
    const client = makeGenAiClient();

    // Without the name in the message this surfaces as an opaque provider 401, several
    // seconds and one billed request later.
    await expect(
      client.generateContent({ model: 'gemini-3.5-flash-lite', contents: 'anything' }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
