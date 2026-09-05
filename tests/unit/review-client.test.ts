import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FR-008b. Three properties of the provider client that are easy to lose in a later refactor
 * and expensive to lose quietly.
 *
 * The module reads `GEMINI_API_KEY` lazily rather than at import.
 *
 * `vi.resetModules()` runs before every test, and it is load-bearing rather than hygiene.
 * A dynamic `import()` of the same specifier returns the cached namespace, so without the
 * reset the module body never re-executes — mutating `process.env` first would have no
 * effect, and the two tests below would pass whether or not the behaviour they name holds.
 * A test that cannot fail is worse than no test, because it reports coverage it does not
 * have.
 *
 * The same reset also isolates the memoized SDK singleton, so no test can pass merely
 * because an earlier one in this file happened not to construct it.
 */

const REAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  vi.resetModules();
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

  it('is frozen, so a call site cannot quietly reshape the shared settings', async () => {
    // The previous two attempts at this test could not fail — one compared a cached module
    // namespace to itself, the next used `isFrozen(x) || Array.isArray(x)`, where the second
    // operand is unconditionally true for a .map() result and short-circuits the first.
    //
    // Freezing gives the assertion a real failing input, and the property is worth having:
    // one shared array passed to both calls means a mutation at either call site would
    // silently change the other. That matters because the provider ships these filters off
    // by default, so a drifted setting fails no behavioural test.
    const { NEVER_BLOCK } = await import('../../src/review/client.js');

    expect(Object.isFrozen(NEVER_BLOCK)).toBe(true);
    expect(NEVER_BLOCK.every((setting) => Object.isFrozen(setting))).toBe(true);
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

  it('pins no review model whose id marks it preview or Live', async () => {
    const { REVIEW_MODELS } = await import('../../src/review/client.js');

    // Scoped to the review deliberately. Live API models are speech-to-speech over a
    // stateful socket and cannot return structured text, so reaching for one is a rewrite
    // rather than a config change. Preview is a narrower rule: the review runs GA only,
    // while playback has no choice — every provider TTS id is preview and 005 accepts that.
    for (const model of Object.values(REVIEW_MODELS)) {
      expect(model).not.toContain('live');
      expect(model).not.toContain('preview');
    }
  });
});

describe('review client — credential handling', () => {
  it('does not throw on import when GEMINI_API_KEY is absent', async () => {
    delete process.env.GEMINI_API_KEY;

    // Only meaningful because vi.resetModules() forces the module body to re-execute with
    // the key already gone. Importing must stay safe: a route that never reviews anything
    // should not fail to boot over a key it will not use. The failure belongs at first call.
    await expect(import('../../src/review/client.js')).resolves.toBeDefined();
  });

  it('memoizes the SDK rather than rebuilding it per call', async () => {
    // Constructed twice, so the guard has an observable effect. The earlier version of this
    // test warmed the singleton by actually CALLING generateContent — which issued a real
    // outbound HTTPS request with a fake key and passed only because the request failed.
    // `rejects.toThrow()` with no matcher accepted `fetch failed` on an offline runner just
    // as happily, making it the one test here whose result depended on the network.
    const { makeGenAiClient } = await import('../../src/review/client.js');

    expect(makeGenAiClient()).not.toBe(makeGenAiClient());
  });

  it('still names the variable when the key disappears after a module reset', async () => {
    const first = await import('../../src/review/client.js');
    expect(first.makeGenAiClient).toBeDefined();

    vi.resetModules();
    delete process.env.GEMINI_API_KEY;
    const { makeGenAiClient: freshFactory } = await import('../../src/review/client.js');

    await expect(
      freshFactory().generateContent({ model: 'gemini-3.5-flash-lite', contents: 'x' }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
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
