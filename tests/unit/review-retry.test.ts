import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';
import type { GenAiClient } from '../../src/review/client.js';
import {
  ATTEMPT_TIMEOUT_MS,
  BACKOFF_MS,
  defaultSleep,
  MAX_ATTEMPTS,
  type RunCheckDeps,
  runCheck,
} from '../../src/review/retry.js';
import { judgmentResultSchemaFor } from '../../src/review/schemas.js';

/**
 * FR-038 and FR-039. The retry budget, and the classification that decides
 * whether a failure retries at all.
 *
 * Every case here is a fault the provider actually produced during the 002 spike, or a
 * bound the spec fixes numerically. Nothing in this file may resolve to a rejection: a
 * provider outage that reads as "your recording was refused" is the failure FR-038 exists
 * to prevent.
 *
 * Sleep and the clock are injected, so proving a three-second backoff takes no seconds.
 */

const answerSchema = judgmentResultSchemaFor('answer');

const VALID_JUDGMENT = {
  crisisCanPublish: true,
  illegalCanPublish: true,
  relevanceCanPublish: true,
  audioQuality: 'clear',
  primaryReason: 'none',
  reasonDetail: '',
};

/**
 * The fresh-builder. `PARAMS` below is a shared instance most tests can read safely; any
 * test that asserts something about mutation must build its own, or it only means anything
 * when it happens to run after the tests that could have mutated the shared one.
 */
function makeParams(): GenerateContentParameters {
  return { model: 'gemini-3.5-flash-lite', contents: 'judge this' };
}

const PARAMS = makeParams();

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
  seen: GenerateContentParameters[];
} {
  let index = 0;
  const seen: GenerateContentParameters[] = [];
  return {
    calls: () => index,
    seen,
    client: {
      async generateContent(params) {
        seen.push(params);
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

function run(client: GenAiClient, deps: RunCheckDeps = {}) {
  return runCheck(
    {
      client,
      params: PARAMS,
      schema: answerSchema,
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

    // Asserted as literals rather than against BACKOFF_MS. Comparing the code to the constant
    // the code reads passes for any values — changing the schedule to [5, 7] left this green.
    // FR-039 fixes these numbers in the spec, so the suite fixes them here.
    // A wait after the final attempt is a second of latency bought for nothing.
    expect(waited).toEqual([1_000, 2_000]);
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

    expect(outcome.ok === false && outcome.fault).toBe('network');
    expect(outcome.attempts).toBe(3);
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

    expect(outcome.ok === false && outcome.fault).toBe('no-candidate');
    expect(outcome.attempts).toBe(3);
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
        schema: answerSchema,
        signal: controller.signal,
        deadline: DEADLINE,
      },
      { now: FAR_FUTURE, sleep: async () => {} },
    );

    // Fail-fast means a rejection elsewhere has already resolved the submission. Spending a
    // call here bills for a result that cannot change anything.
    expect(outcome.ok === false && outcome.fault).toBe('aborted');
    expect(outcome.attempts).toBe(0);
    expect(calls()).toBe(0);
  });

  it('stops without retrying when the submission deadline has passed', async () => {
    const { client, calls } = scriptedClient([response()]);

    const outcome = await runCheck(
      {
        client,
        params: PARAMS,
        schema: answerSchema,
        signal: new AbortController().signal,
        deadline: 1_000,
      },
      { now: () => 2_000, sleep: async () => {} },
    );

    expect(outcome.ok === false && outcome.fault).toBe('deadline');
    expect(outcome.attempts).toBe(0);
    expect(calls()).toBe(0);
  });

  it('stops mid-budget when the caller aborts between attempts', async () => {
    const controller = new AbortController();
    const { client, calls } = scriptedClient([new Error('transient'), response()]);

    const outcome = await runCheck(
      {
        client,
        params: PARAMS,
        schema: answerSchema,
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

    expect(outcome.ok === false && outcome.fault).toBe('aborted');
    expect(outcome.attempts).toBe(1);
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

describe('runCheck — the attempt timeout (FR-039)', () => {
  it('classifies a per-attempt timeout as a timeout fault', async () => {
    // Classification only: the injected error is already a TimeoutError, so this proves the
    // branch rather than that a real wait produces one.
    const timedOut = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    const { client } = scriptedClient([timedOut, timedOut, timedOut]);

    const outcome = await run(client, { sleep: async () => {} });

    expect(outcome.ok === false && outcome.fault).toBe('timeout');
  });

  it('reports a deadline rather than a timeout when the clamp is what fired', async () => {
    // With less than 20s of budget left, the attempt signal is clamped to the deadline.
    // Calling that a timeout would burn a full backoff before the loop head noticed, and
    // would blame the provider for our own budget running out.
    const timedOut = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    const { client } = scriptedClient([timedOut]);

    const outcome = await runCheck(
      {
        client,
        params: PARAMS,
        schema: answerSchema,
        signal: new AbortController().signal,
        deadline: 5_000,
      },
      { now: () => 0, sleep: async () => {} },
    );

    expect(outcome.ok === false && outcome.fault).toBe('deadline');
  });

  it("chains the CALLER's signal into the one the provider receives", async () => {
    // `toBeDefined()` was not enough: replacing AbortSignal.any([signal, timeout]) with the
    // timeout alone — severing the caller's abort from the in-flight call entirely — left
    // every test green. That link is what FR-045 relies on to release the recording when the
    // submission ends, so it is asserted by actually aborting.
    const controller = new AbortController();
    const { client, seen } = scriptedClient([response()]);

    await runCheck(
      {
        client,
        params: makeParams(),
        schema: answerSchema,
        signal: controller.signal,
        deadline: DEADLINE,
      },
      { now: FAR_FUTURE, sleep: async () => {} },
    );

    const passed = seen[0].config?.abortSignal;
    expect(passed?.aborted).toBe(false);
    controller.abort();
    expect(passed?.aborted).toBe(true);
  });

  it('bounds each attempt by the ceiling, not by the whole remaining budget', async () => {
    // Asserting ATTEMPT_TIMEOUT_MS proved nothing about wiring: multiplying it by 100 inside
    // the Math.min left every test green, and a hung call would then run to the 90s
    // submission deadline instead of timing out and retrying. The ceiling is injectable so
    // this can be exercised at a value a test can wait out; the real 20_000 is pinned by the
    // literal assertion in the constants block.
    const { client, seen } = scriptedClient([response()]);

    await runCheck(
      {
        client,
        params: makeParams(),
        schema: answerSchema,
        signal: new AbortController().signal,
        deadline: 90_000,
      },
      { now: () => 0, sleep: async () => {}, timeoutMs: 20 },
    );

    const passed = seen[0].config?.abortSignal;
    expect(passed?.aborted).toBe(false);

    // 90s of budget remained, so the ceiling is the only thing that can fire here.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(passed?.aborted).toBe(true);
  });

  it('keeps the caller params intact rather than mutating them', async () => {
    // Snapshots its OWN object. Asserting against the shared PARAMS only meant anything if
    // this ran after the tests that could have mutated it — under a shuffled order it might
    // run first and assert nothing.
    const { client } = scriptedClient([response()]);
    const mine = makeParams();

    await runCheck(
      {
        client,
        params: mine,
        schema: answerSchema,
        signal: new AbortController().signal,
        deadline: DEADLINE,
      },
      { now: FAR_FUTURE, sleep: async () => {} },
    );

    expect(mine).toEqual(makeParams());
  });
});

describe('defaultSleep — the abort guard', () => {
  it('rejects at once for an already-aborted signal, without waiting', async () => {
    // An 'abort' listener added to an already-aborted signal NEVER fires, so without the
    // guard this waits out the full backoff before anyone notices — delaying the audio
    // release FR-045 requires by up to two seconds per in-flight call.
    //
    // Tested directly rather than through runCheck: the reachable window is between an
    // attempt failing and the backoff starting, which a test cannot land in
    // deterministically. Going through runCheck would produce a test that passes with the
    // guard removed, which is worse than no test.
    const controller = new AbortController();
    controller.abort();

    const started = Date.now();
    await expect(defaultSleep(5_000, controller.signal)).rejects.toThrow('aborted');
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('rejects when a live signal aborts mid-wait', async () => {
    const controller = new AbortController();
    const waiting = defaultSleep(5_000, controller.signal);
    setTimeout(() => controller.abort(), 10);

    const started = Date.now();
    await expect(waiting).rejects.toThrow('aborted');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('resolves after the requested wait when never aborted', async () => {
    const started = Date.now();
    await defaultSleep(30, new AbortController().signal);

    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});

describe('runCheck — the real sleep (no injected clock)', () => {
  it('actually waits when the signal is live, using the real timer', async () => {
    // Exercises defaultSleep, which every other test injects around.
    const { client } = scriptedClient([new Error('transient'), response()]);

    const started = Date.now();
    const outcome = await runCheck(
      {
        client,
        params: PARAMS,
        schema: answerSchema,
        signal: new AbortController().signal,
        deadline: DEADLINE,
      },
      { now: FAR_FUTURE },
    );

    expect(outcome.ok).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(BACKOFF_MS[0] - 50);
  });
});

describe('retry constants (FR-039)', () => {
  it('fixes the numbers the spec fixes', () => {
    // MAX_ATTEMPTS is derived from the schedule, so asserting their relationship cannot fail.
    // Asserting the literal values can, and those are what FR-039 actually pins.
    expect(MAX_ATTEMPTS).toBe(3);
    expect(ATTEMPT_TIMEOUT_MS).toBe(20_000);
    expect([...BACKOFF_MS]).toEqual([1_000, 2_000]);
  });
});

describe('runCheck — a sleep failure is not a participant abort', () => {
  it('clamps the backoff to the remaining budget', async () => {
    // An unclamped backoff started near the boundary sleeps past the deadline, holding
    // request-scoped audio longer than FR-039 allows — and buys nothing, since the next
    // iteration only reports expiry.
    const { client } = scriptedClient([new Error('transient'), response()]);
    const waited: number[] = [];

    await runCheck(
      {
        client,
        params: makeParams(),
        schema: answerSchema,
        signal: new AbortController().signal,
        deadline: 300,
      },
      {
        now: () => 0,
        sleep: async (ms) => {
          waited.push(ms);
        },
      },
    );

    expect(waited).toEqual([300]);
  });

  it('reports a sleep failure as a fault rather than a participant abort', async () => {
    // A bare catch reported every sleep failure as 'aborted', which is terminal and means
    // "the participant left" — the gate would render nothing for someone still waiting.
    const { client, calls } = scriptedClient([new Error('transient'), response()]);
    let thrown = false;

    const outcome = await run(client, {
      sleep: async () => {
        if (!thrown) {
          thrown = true;
          throw new TypeError('a broken sleep, not an abort');
        }
      },
    });

    expect(outcome.ok === false && outcome.fault).toBe('network');
    expect(calls()).toBe(1);
  });
});
