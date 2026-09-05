import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';
import type { GenAiClient } from '../../src/review/client.js';
import { BACKOFF_MS, MAX_ATTEMPTS, runCheck } from '../../src/review/retry.js';
import { judgmentResultSchema } from '../../src/review/schemas.js';

/**
 * T012-T015, FR-038 and FR-039. The retry budget, and the classification that decides
 * whether a failure retries at all.
 *
 * Every case here is a fault the provider actually produced during the 002 spike, or a
 * bound the spec fixes numerically. Nothing in this file may resolve to a rejection: a
 * provider outage that reads as "your recording was refused" is the failure FR-038 exists
 * to prevent.
 *
 * Sleep and the clock are injected, so proving a three-second backoff takes no seconds.
 */

const VALID_JUDGMENT = {
  crisisCanPublish: true,
  illegalCanPublish: true,
  relevanceCanPublish: true,
  audioQuality: 'clear',
  primaryReason: 'none',
  reasonDetail: '',
};

const PARAMS: GenerateContentParameters = {
  model: 'gemini-3.5-flash-lite',
  contents: 'judge this',
};

/** A response the SDK could really return. `text` is a getter on the real class. */
function response(overrides: Partial<Record<string, unknown>> = {}): GenerateContentResponse {
  return {
    candidates: [{ finishReason: 'STOP', index: 0 }],
    text: JSON.stringify(VALID_JUDGMENT),
    ...overrides,
  } as unknown as GenerateContentResponse;
}

/** Replays the given results in order; a call past the end fails loudly rather than hanging. */
function scriptedClient(results: Array<GenerateContentResponse | Error>): {
  client: GenAiClient;
  calls: () => number;
} {
  let index = 0;
  return {
    calls: () => index,
    client: {
      async generateContent() {
        const next = results[index++];
        if (next === undefined) {
          throw new Error(`scriptedClient: no result scripted for call ${index}`);
        }
        if (next instanceof Error) {
          throw next;
        }
        return next;
      },
    },
  };
}

/** Records what it was asked to wait for without waiting. */
function recordingSleep() {
  const waited: number[] = [];
  return {
    waited,
    sleep: async (ms: number) => {
      waited.push(ms);
    },
  };
}

const FAR_FUTURE = () => 0;
const DEADLINE = 90_000;

function run(client: GenAiClient, deps: Parameters<typeof runCheck>[1] = {}) {
  return runCheck(
    {
      client,
      params: PARAMS,
      schema: judgmentResultSchema,
      signal: new AbortController().signal,
      deadline: DEADLINE,
    },
    { now: FAR_FUTURE, ...deps },
  );
}

describe('runCheck — the retry budget (FR-039)', () => {
  it('succeeds on the first attempt without sleeping', async () => {
    const { client, calls } = scriptedClient([response()]);
    const { waited, sleep } = recordingSleep();

    const outcome = await run(client, { sleep });

    expect(outcome.ok).toBe(true);
    expect(outcome.attempts).toBe(1);
    expect(calls()).toBe(1);
    expect(waited).toEqual([]);
  });

  it('makes at most three invocations including the first', async () => {
    const { client, calls } = scriptedClient([
      new Error('boom'),
      new Error('boom'),
      new Error('boom'),
    ]);
    const { sleep } = recordingSleep();

    const outcome = await run(client, { sleep });

    expect(outcome.ok).toBe(false);
    expect(outcome.attempts).toBe(MAX_ATTEMPTS);
    expect(calls()).toBe(3);
  });

  it('waits 1s then 2s, and never after the last attempt', async () => {
    const { client } = scriptedClient([new Error('a'), new Error('b'), new Error('c')]);
    const { waited, sleep } = recordingSleep();

    await run(client, { sleep });

    // A wait after the final attempt is a second of latency bought for nothing.
    expect(waited).toEqual([...BACKOFF_MS]);
  });

  it('stops retrying the moment one attempt succeeds', async () => {
    const { client, calls } = scriptedClient([new Error('transient'), response()]);
    const { waited, sleep } = recordingSleep();

    const outcome = await run(client, { sleep });

    expect(outcome.ok).toBe(true);
    expect(outcome.attempts).toBe(2);
    expect(calls()).toBe(2);
    expect(waited).toEqual([BACKOFF_MS[0]]);
  });
});

describe('runCheck — fault classification (FR-038)', () => {
  it('classifies a thrown network error as a fault, never a rejection', async () => {
    const { client } = scriptedClient([
      new Error('fetch failed'),
      new Error('fetch failed'),
      new Error('fetch failed'),
    ]);

    const outcome = await run(client, { sleep: async () => {} });

    expect(outcome).toEqual({ ok: false, fault: 'network', attempts: 3 });
  });

  it('treats an empty candidate list as a fault and retries it', async () => {
    // The provider's non-adjustable core-harm protections stay active at every setting a
    // caller can send, and this was measured at a never-block threshold on two fixtures.
    // It carries no reason, so reading a decision out of it invents a verdict from silence.
    const { client, calls } = scriptedClient([
      response({ candidates: [] }),
      response({ candidates: [] }),
      response({ candidates: [] }),
    ]);

    const outcome = await run(client, { sleep: async () => {} });

    expect(outcome).toEqual({ ok: false, fault: 'no-candidate', attempts: 3 });
    expect(calls()).toBe(3);
  });

  it('treats a 200 with undefined text as a fault', async () => {
    // Observed twice in the spike: candidates present, `.text` undefined.
    const { client } = scriptedClient([
      response({ text: undefined }),
      response({ text: undefined }),
      response({ text: undefined }),
    ]);

    const outcome = await run(client, { sleep: async () => {} });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.fault).toBe('no-text');
  });

  it('treats unparseable text as a fault', async () => {
    const { client } = scriptedClient([
      response({ text: 'I cannot help with that.' }),
      response({ text: 'I cannot help with that.' }),
      response({ text: 'I cannot help with that.' }),
    ]);

    const outcome = await run(client, { sleep: async () => {} });

    expect(outcome.ok === false && outcome.fault).toBe('invalid');
  });

  it('treats schema-invalid JSON as a fault, so it can never publish', async () => {
    // Schema-valid generation and semantically valid output are different things. Absence
    // of a verdict is not permission (FR-019).
    const { client } = scriptedClient([
      response({ text: '{"crisisCanPublish":true}' }),
      response({ text: '{"crisisCanPublish":true}' }),
      response({ text: '{"crisisCanPublish":true}' }),
    ]);

    const outcome = await run(client, { sleep: async () => {} });

    expect(outcome.ok === false && outcome.fault).toBe('invalid');
  });

  it('recovers when a transient fault is followed by valid output', async () => {
    const { client } = scriptedClient([response({ candidates: [] }), response()]);

    const outcome = await run(client, { sleep: async () => {} });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok === true && outcome.value.primaryReason).toBe('none');
  });
});

describe('runCheck — abort and deadline are terminal', () => {
  it('does not call the provider at all when already aborted', async () => {
    const { client, calls } = scriptedClient([response()]);
    const controller = new AbortController();
    controller.abort();

    const outcome = await runCheck(
      {
        client,
        params: PARAMS,
        schema: judgmentResultSchema,
        signal: controller.signal,
        deadline: DEADLINE,
      },
      { now: FAR_FUTURE, sleep: async () => {} },
    );

    // Fail-fast means a rejection elsewhere has already resolved the submission. Spending a
    // call here bills for a result that cannot change anything.
    expect(outcome).toEqual({ ok: false, fault: 'aborted', attempts: 0 });
    expect(calls()).toBe(0);
  });

  it('stops without retrying when the submission deadline has passed', async () => {
    const { client, calls } = scriptedClient([response()]);

    const outcome = await runCheck(
      {
        client,
        params: PARAMS,
        schema: judgmentResultSchema,
        signal: new AbortController().signal,
        deadline: 1_000,
      },
      { now: () => 2_000, sleep: async () => {} },
    );

    expect(outcome).toEqual({ ok: false, fault: 'deadline', attempts: 0 });
    expect(calls()).toBe(0);
  });

  it('stops mid-budget when the caller aborts between attempts', async () => {
    const controller = new AbortController();
    const { client, calls } = scriptedClient([new Error('transient'), response()]);

    const outcome = await runCheck(
      {
        client,
        params: PARAMS,
        schema: judgmentResultSchema,
        signal: controller.signal,
        deadline: DEADLINE,
      },
      {
        now: FAR_FUTURE,
        // The browser closing, or another call refusing, lands here — during the backoff.
        sleep: async () => {
          controller.abort();
          throw new Error('aborted');
        },
      },
    );

    expect(outcome).toEqual({ ok: false, fault: 'aborted', attempts: 1 });
    expect(calls()).toBe(1);
  });
});

describe('runCheck — two calls in parallel do not interfere', () => {
  it('keeps each caller its own value when both resolve concurrently', async () => {
    // The review runs content processing and the judgment call at the same time. Any state
    // shared between invocations would let one overwrite the other's result — a race that
    // only appears under the exact concurrency production always uses.
    const slow: GenAiClient = {
      async generateContent() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return response({ text: JSON.stringify({ ...VALID_JUDGMENT, reasonDetail: 'slow' }) });
      },
    };
    const fast: GenAiClient = {
      async generateContent() {
        return response({ text: JSON.stringify({ ...VALID_JUDGMENT, reasonDetail: 'fast' }) });
      },
    };

    const [a, b] = await Promise.all([run(slow), run(fast)]);

    expect(a.ok === true && a.value.reasonDetail).toBe('slow');
    expect(b.ok === true && b.value.reasonDetail).toBe('fast');
  });
});
