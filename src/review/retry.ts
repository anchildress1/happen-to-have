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

/** FR-039. At most three invocations *including* the first. */
export const MAX_ATTEMPTS = 3;

/** FR-039. Per invocation, not per submission. */
export const ATTEMPT_TIMEOUT_MS = 20_000;

/** FR-039. Waits before the second and third invocations. */
export const BACKOFF_MS = [1_000, 2_000] as const;

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
  | { ok: false; fault: FaultKind; attempts: number };

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
}

type AttemptResult<T> = { ok: true; value: T } | { ok: false; fault: FaultKind };

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
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
    const result = await attemptOnce(client, params, schema, signal, remaining);

    if (result.ok) {
      return { ok: true, value: result.value, attempts };
    }

    // A caller-side abort or an expired deadline is terminal: nothing about waiting and
    // trying again improves either, and the audio is already being released.
    if (result.fault === 'aborted' || result.fault === 'deadline') {
      return { ok: false, fault: result.fault, attempts };
    }

    if (attempt === MAX_ATTEMPTS - 1) {
      return { ok: false, fault: result.fault, attempts };
    }

    try {
      await sleep(BACKOFF_MS[attempt], signal);
    } catch {
      return { ok: false, fault: 'aborted', attempts };
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
): Promise<AttemptResult<T>> {
  // Bounded by whichever comes first: this attempt's own 20s ceiling, the submission
  // deadline, or the caller aborting. Combining them here means a retry can never outlive
  // the budget it was granted.
  const attemptSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remainingMs)),
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
      return { ok: false, fault: 'aborted' };
    }
    return { ok: false, fault: isTimeout(error) ? 'timeout' : 'network' };
  }

  if (!response.candidates || response.candidates.length === 0) {
    return { ok: false, fault: 'no-candidate' };
  }

  // `.text` is a getter typed `string | undefined`, and the spike saw it yield undefined on
  // a 200 twice. Separated from `invalid` so the fault table stays honest about which one
  // actually happened.
  const text = response.text;
  if (!text) {
    return { ok: false, fault: 'no-text' };
  }

  const parsed = parseResult(schema, text);
  if (parsed === null) {
    return { ok: false, fault: 'invalid' };
  }

  return { ok: true, value: parsed };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
