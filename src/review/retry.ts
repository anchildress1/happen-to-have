import type { GenerateContentParameters } from '@google/genai';
import type { z } from 'zod';
import type { GenAiClient } from './client';
import { parseResult } from './schemas';

/**
 * Bounded, independent retry for one provider call (FR-038, FR-039).
 *
 * Every failure mode below is a **fault**, never a rejection. A fault retries; a rejection
 * ends the submission. Conflating them turns a provider outage into a participant
 * rejection, which FR-038 forbids in those words — so this module deliberately cannot
 * express "refuse". It returns a validated payload or a fault, and the gate decides what
 * the payload means.
 */

/** FR-039. Waits before the second and third invocations. */
const BACKOFF_SCHEDULE = [1_000, 2_000] as const;

/**
 * FR-039. At most three invocations *including* the first.
 *
 * Derived from the backoff schedule rather than declared beside it. Declared independently,
 * raising this to 4 would index past the schedule, hand `setTimeout` an undefined delay, and
 * silently drop the backoff — with no test failing, because both constants are asserted
 * separately.
 */
export const MAX_ATTEMPTS = BACKOFF_SCHEDULE.length + 1;

/** FR-039. Per invocation, not per submission. */
export const ATTEMPT_TIMEOUT_MS = 20_000;

export const BACKOFF_MS = BACKOFF_SCHEDULE;

/**
 * Why a call did not produce a usable result.
 *
 * `no-candidate` is its own kind because it is the one the provider produces on purpose:
 * its non-adjustable protections against core harms stay active at every setting a caller
 * can send, and empty candidates were measured at a never-block threshold. It carries no
 * reason, so reading a decision out of it would manufacture a verdict from silence
 * (FR-008b1).
 */
export type FaultKind =
  | 'network'
  | 'timeout'
  | 'no-candidate'
  | 'no-text'
  | 'invalid'
  | 'aborted'
  | 'deadline';

export type CallOutcome<T> =
  | { ok: true; value: T; attempts: number }
  | {
      ok: false;
      fault: FaultKind;
      attempts: number;
      /**
       * What actually went wrong, for logs. `FaultKind` is the decision surface and stays
       * closed; discarding the evidence behind it is a separate mistake. Without this a
       * missing API key, a 429, and a real outage are one indistinguishable `network`, and
       * the carefully-named credential error from `client.ts` reaches nobody.
       */
      cause?: unknown;
    };

export interface RunCheckOptions<T> {
  client: GenAiClient;
  params: GenerateContentParameters;
  schema: z.ZodType<T>;
  /** Aborting this stops retrying immediately — a rejection elsewhere, or a lost browser. */
  signal: AbortSignal;
  /** Epoch ms. The whole submission stops here regardless of attempts left (FR-039). */
  deadline: number;
}

/** Injected so tests do not spend three real seconds proving the backoff is three seconds. */
export interface RunCheckDeps {
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  /**
   * The per-attempt ceiling, injectable purely so a test can prove it is wired in.
   *
   * Asserting the constant alone did not: multiplying it by 100 inside the Math.min left the
   * whole suite green, and a hung call would then run to the 90-second submission deadline
   * instead of timing out at 20 seconds and retrying — turning a publishable contribution
   * into a processing failure. Waiting 20 real seconds in a unit test is not an option, so
   * the value is asserted separately and the wiring is exercised at a value a test can wait
   * out.
   */
  timeoutMs?: number;
}

type AttemptResult<T> = { ok: true; value: T } | { ok: false; fault: FaultKind; cause?: unknown };

/**
 * Exported for its own test. The abort path below is reachable only in the window between
 * an attempt failing and the backoff starting, which is not a window a test can land in
 * deterministically through `runCheck` — so it is verified directly instead of through a
 * test that would claim to cover it and quietly not.
 */
export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  // An 'abort' listener added to an ALREADY-aborted signal never fires. Without this guard a
  // caller that aborts between the attempt failing and the backoff starting would sit out the
  // full 1s or 2s before anyone noticed — delaying the audio release FR-045 requires.
  if (signal.aborted) {
    return Promise.reject(new Error('aborted'));
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs one call, retrying only itself.
 *
 * A call that already succeeded is never re-invoked from here — the gate keeps it. Retrying
 * a settled question spends money to re-ask a non-deterministic model, which can answer
 * differently the second time (FR-019).
 */
export async function runCheck<T>(
  options: RunCheckOptions<T>,
  deps: RunCheckDeps = {},
): Promise<CallOutcome<T>> {
  const { client, params, schema, signal, deadline } = options;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS;

  let attempts = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) {
      return { ok: false, fault: 'aborted', attempts };
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      return { ok: false, fault: 'deadline', attempts };
    }

    attempts++;
    const result = await attemptOnce(client, params, schema, signal, remaining, timeoutMs);

    if (result.ok) {
      return { ok: true, value: result.value, attempts };
    }

    // A caller-side abort or an expired deadline is terminal: nothing about waiting and
    // trying again improves either, and the audio is already being released.
    if (result.fault === 'aborted' || result.fault === 'deadline') {
      return { ok: false, fault: result.fault, attempts, cause: result.cause };
    }

    if (attempt === MAX_ATTEMPTS - 1) {
      return { ok: false, fault: result.fault, attempts, cause: result.cause };
    }

    try {
      await sleep(BACKOFF_MS[attempt], signal);
    } catch {
      // Only the caller's signal makes this terminal. A throw from an injected sleep, or a
      // RangeError out of setTimeout, is a fault we can still retry — reporting it as
      // 'aborted' would tell the gate the participant left, and it would render nothing for
      // someone still sitting there.
      return signal.aborted
        ? { ok: false, fault: 'aborted', attempts }
        : { ok: false, fault: 'network', attempts };
    }
  }

  // Unreachable: the loop returns on every path. Kept so the function has no implicit
  // undefined return rather than relying on the checker agreeing with that reasoning.
  return { ok: false, fault: 'network', attempts };
}

async function attemptOnce<T>(
  client: GenAiClient,
  params: GenerateContentParameters,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  remainingMs: number,
  timeoutMs: number,
): Promise<AttemptResult<T>> {
  // Whichever comes first: this attempt's own 20s ceiling, or what is left of the submission
  // deadline. Clamping here means a retry can never outlive the budget it was granted.
  const clampedToDeadline = remainingMs < timeoutMs;
  const attemptSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(Math.min(timeoutMs, remainingMs)),
  ]);

  let response: Awaited<ReturnType<GenAiClient['generateContent']>>;
  try {
    response = await client.generateContent({
      ...params,
      // NOTE: the SDK documents this as client-side only — aborting stops us waiting, it
      // does not stop the provider working, and usage is still billed. It bounds latency,
      // not cost.
      config: { ...params.config, abortSignal: attemptSignal },
    });
  } catch (error) {
    if (signal.aborted) {
      return { ok: false, fault: 'aborted', cause: error };
    }
    if (isTimeout(error)) {
      // A timeout caused by the deadline clamp is a deadline, not a slow provider. Reporting
      // it as 'timeout' would also burn a full backoff before the loop head noticed.
      return { ok: false, fault: clampedToDeadline ? 'deadline' : 'timeout', cause: error };
    }
    return { ok: false, fault: 'network', cause: error };
  }

  if (!response.candidates || response.candidates.length === 0) {
    // promptFeedback is the only field that distinguishes a core-harm block from a malformed
    // prompt. It is never a verdict (FR-008b1), but discarding it as evidence leaves the two
    // indistinguishable in logs.
    return { ok: false, fault: 'no-candidate', cause: response.promptFeedback };
  }

  // `.text` is a getter typed `string | undefined`, and the spike saw it yield undefined on
  // a 200 twice. Separated from `invalid` so the fault table stays honest about which one
  // actually happened.
  const text = response.text;
  if (!text) {
    return { ok: false, fault: 'no-text', cause: response.candidates[0]?.finishReason };
  }

  const parsed = parseResult(schema, text);
  if (parsed === null) {
    // finishReason separates a truncated response from a malformed one. A MAX_TOKENS cut-off
    // yields partial JSON that looks identical to a model ignoring the schema.
    return { ok: false, fault: 'invalid', cause: response.candidates[0]?.finishReason };
  }

  return { ok: true, value: parsed };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
