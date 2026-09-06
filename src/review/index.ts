import 'server-only';

import { makeRateLimitClient, type RateLimitClient } from '../db/queries/rateLimits';
import { rejectAudio } from './audio';
import { type GenAiClient, genAiClient } from './client';
import { resolve } from './gate';
import { contentCall } from './prompts/content';
import { crisisCall } from './prompts/crisis';
import { illegalCall, relevanceCall } from './prompts/illegal';
import { runCheck } from './retry';
import { contentResultSchema, crisisResultSchema, verdictResultSchema } from './schemas';
import type { CheckResult, ReviewInput, ReviewOutcome } from './types';

export type { ReviewInput, ReviewOutcome } from './types';

/** FR-039. The whole submission stops here, however many attempts remain. */
const DEADLINE_MS = 90_000;

/** Sentinel so the caller can tell a blown deadline from any other rejection. */
const DEADLINE = Symbol('deadline');

/**
 * Rejects with DEADLINE if the promise has not settled by the submission's deadline.
 *
 * The provider calls already respect it through `runCheck`; this is for the preflight work
 * that does not, where an unbounded await holds the participant's audio for as long as the
 * query stalls.
 */
function withDeadline<T>(work: Promise<T>, deadline: number, now: () => number): Promise<T> {
  const remaining = deadline - now();
  if (remaining <= 0) {
    return Promise.reject(DEADLINE);
  }
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(DEADLINE), remaining);
      void work.finally(() => clearTimeout(timer));
    }),
  ]);
}

/** Injection seam for tests (research D12). Production callers pass nothing. */
export interface ReviewDeps {
  genai?: GenAiClient;
  rateLimit?: RateLimitClient;
  now?: () => number;
}

/**
 * Audio in, one decision out (FR-001 – FR-052).
 *
 * Order of operations, and each step exists to make the next one cheaper:
 *
 * 1. Rate limit, before any provider call — a limited submission must cost nothing.
 * 2. Cheap audio validation — empty, oversized and wrong-type recordings never reach a call.
 * 3. Fan out one call per signal on the ORIGINAL audio. Four for an answer, three for a
 *    question: relevance is not dispatched at all rather than returning null (FR-003).
 * 4. Aggregate as each result lands, aborting the rest on the first refusal.
 * 5. Release the audio on every exit path.
 *
 * Never throws for a review outcome. A provider outage returns `{ status: 'failed' }`; only
 * programmer error and caller abort reject.
 */
export async function reviewContribution(
  input: ReviewInput,
  deps: ReviewDeps = {},
): Promise<ReviewOutcome> {
  const { kind, mimeType, questionText, participantId, signal } = input;

  if (kind === 'answer' && questionText === null) {
    // Programmer error, not a review outcome: 003 cannot ask for a relevance judgment against
    // no question. Throwing is correct here and nowhere else in this function.
    throw new TypeError('reviewContribution: kind "answer" requires questionText');
  }

  const genai = deps.genai ?? genAiClient;
  const rateLimit = deps.rateLimit ?? makeRateLimitClient();
  const now = deps.now ?? Date.now;
  const deadline = now() + DEADLINE_MS;

  // Held in a local so every exit path can drop the reference, including the throwing ones.
  // Typed nullable because `finally` clears it; narrowed once here so nothing downstream has
  // to re-check, and so a future refactor cannot quietly hand `null` to a provider call.
  let audio: Uint8Array | null = input.audio;
  const recording = audio;

  /**
   * Abandonment outranks every other outcome, so it is checked before each preflight return
   * rather than once after them.
   *
   * Checked below the limiter and the audio bounds, a caller who had already left got
   * `rate_limited` or `withheld` resolved at them — outcomes for a request that no longer
   * exists, when the contract says abort rejects.
   */
  const abortIfGone = () => {
    if (signal.aborted) {
      throw new DOMException('The review was aborted.', 'AbortError');
    }
  };

  try {
    abortIfGone();

    // The limiter talks to Postgres, and a transient outage there rejects. Left unhandled it
    // escapes as an arbitrary error, and the contract says only programmer error and caller
    // abort reject — a caller with neither has no ReviewOutcome to render.
    //
    // Raced against the submission deadline as well: an unbounded await here holds the audio
    // for as long as the query stalls, and a query that never settles means the submission
    // never stops at 90 s (FR-039).
    let decision: Awaited<ReturnType<RateLimitClient['recordSubmission']>>;
    try {
      decision = await withDeadline(rateLimit.recordSubmission(participantId), deadline, now);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      return { status: 'failed', cause: error === DEADLINE ? 'deadline' : 'exhausted' };
    }

    abortIfGone();

    if (!decision.allowed) {
      return { status: 'rate_limited', retryAt: decision.retryAt };
    }

    const rejected = rejectAudio(recording, mimeType);
    if (rejected) {
      abortIfGone();
      return { status: 'withheld', reason: 'content', contentReason: rejected };
    }

    // Chained so a refusal aborts the siblings, and the caller's own abort still propagates.
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    // Checked as well as listened for: `addEventListener` does not replay an event that has
    // already fired, so without this every call is dispatched for a participant who left
    // during the preflight — billed work for an outcome nobody will read.
    abortIfGone();
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const shared = { client: genai, signal: controller.signal, deadline };
      // The deadline above is computed in `deps.now`'s clock domain, so the retry layer has to
      // read the same clock. Passing only one of them makes `now: () => 0` produce a deadline
      // of 90000 that real epoch time treats as long expired, and no call is ever made.
      const clock = { now };
      const calls: Array<Promise<CheckResult>> = [
        runCheck(
          {
            ...shared,
            params: contentCall(recording, mimeType),
            schema: contentResultSchema,
          },
          clock,
        ).then((o) => settle('content', o, (v) => v.canPublish)),
        runCheck(
          {
            ...shared,
            params: crisisCall(recording, mimeType),
            schema: crisisResultSchema,
            // The one inverted signal: a permit is `inTrouble: false`.
          },
          clock,
        ).then((o) => settle('crisis', o, (v) => !v.inTrouble)),
        runCheck(
          {
            ...shared,
            params: illegalCall(recording, mimeType),
            schema: verdictResultSchema,
          },
          clock,
        ).then((o) => settle('illegal', o, (v) => v.canPublish)),
      ];
      const dispatched: CheckResult['call'][] = ['content', 'crisis', 'illegal'];

      if (kind === 'answer') {
        calls.push(
          runCheck(
            {
              ...shared,
              params: relevanceCall(recording, mimeType, questionText ?? undefined),
              schema: verdictResultSchema,
            },
            clock,
          ).then((o) => settle('relevance', o, (v) => v.canPublish)),
        );
        dispatched.push('relevance');
      }

      const results = await failFast(calls, controller);
      // Abandonment rejects rather than resolving. The chained controller turns a caller abort
      // into aborted faults, and resolving those as `failed` would hand a processing-failure
      // page to a request that no longer exists — the contract's one documented rejection.
      if (signal.aborted) {
        throw new DOMException('The review was aborted.', 'AbortError');
      }
      return resolve(results, dispatched, now() >= deadline ? 'deadline' : 'exhausted');
    } finally {
      signal.removeEventListener('abort', onAbort);
      // Abort bounds latency, not cost: the SDK's signal is client-side only and usage is
      // billed either way. This exists so nothing is left waiting, not to save money.
      controller.abort();
    }
  } finally {
    // FR-045. Every exit path — publish, withheld, failure, rate limit, abort, throw.
    audio = null;
    void audio;
  }
}

/** Maps one call's outcome onto the envelope the gate reads, applying that call's polarity. */
function settle<C extends CheckResult['call'], T>(
  call: C,
  outcome: { ok: true; value: T; attempts: number } | { ok: false; attempts: number },
  permits: (value: T) => boolean,
): CheckResult {
  if (!outcome.ok) {
    return { call, outcome: 'fault', payload: null, attempts: outcome.attempts } as CheckResult;
  }
  return {
    call,
    outcome: permits(outcome.value) ? 'permit' : 'refuse',
    payload: outcome.value,
    attempts: outcome.attempts,
  } as CheckResult;
}

/**
 * Resolves as soon as any check refuses, rather than waiting for the slowest.
 *
 * A refusal cannot be overturned by a later permit, so waiting only delays the page the
 * participant is owed. Results that arrive after the abort are ignored, not merged (FR-022).
 */
async function failFast(
  calls: readonly Promise<CheckResult>[],
  controller: AbortController,
): Promise<CheckResult[]> {
  const settled: CheckResult[] = [];

  // Resolves on the FIRST refusal, not after every call settles. The previous version awaited
  // Promise.all and merely aborted the controller, which made the name a lie twice over: it
  // waited for any provider that ignores cancellation, and — because `settled` kept growing —
  // a later refusal could still change the chosen reason. FR-022 forbids exactly that: only
  // rejections already known at resolution count, and late results must not change the outcome.
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };

    let outstanding = calls.length;
    for (const call of calls) {
      void call.then((result) => {
        // A result arriving after resolution is dropped rather than merged. Pushing it would
        // reintroduce the reason-changing race through the back door.
        if (done) {
          return;
        }
        settled.push(result);
        if (result.outcome === 'refuse') {
          controller.abort();
          finish();
          return;
        }
        outstanding -= 1;
        if (outstanding === 0) {
          finish();
        }
      });
    }
  });

  return settled;
}
