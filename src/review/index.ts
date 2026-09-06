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
  let audio: Uint8Array | null = input.audio;

  try {
    const decision = await rateLimit.recordSubmission(participantId);
    if (!decision.allowed) {
      return { status: 'rate_limited', retryAt: decision.retryAt };
    }

    const rejected = rejectAudio(audio, mimeType);
    if (rejected) {
      return { status: 'withheld', reason: 'content', contentReason: rejected };
    }

    // Chained so a refusal aborts the siblings, and the caller's own abort still propagates.
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const shared = { client: genai, signal: controller.signal, deadline };
      const calls: Array<Promise<CheckResult>> = [
        runCheck({
          ...shared,
          params: contentCall(audio, mimeType),
          schema: contentResultSchema,
        }).then((o) => settle('content', o, (v) => v.canPublish)),
        runCheck({
          ...shared,
          params: crisisCall(audio, mimeType),
          schema: crisisResultSchema,
          // The one inverted signal: a permit is `inTrouble: false`.
        }).then((o) => settle('crisis', o, (v) => !v.inTrouble)),
        runCheck({
          ...shared,
          params: illegalCall(audio, mimeType),
          schema: verdictResultSchema,
        }).then((o) => settle('illegal', o, (v) => v.canPublish)),
      ];
      const dispatched: CheckResult['call'][] = ['content', 'crisis', 'illegal'];

      if (kind === 'answer') {
        calls.push(
          runCheck({
            ...shared,
            params: relevanceCall(audio, mimeType, questionText ?? undefined),
            schema: verdictResultSchema,
          }).then((o) => settle('relevance', o, (v) => v.canPublish)),
        );
        dispatched.push('relevance');
      }

      const results = await failFast(calls, controller);
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
  let refused = false;

  await Promise.all(
    calls.map(async (call) => {
      const result = await call;
      settled.push(result);
      if (result.outcome === 'refuse' && !refused) {
        refused = true;
        controller.abort();
      }
    }),
  );

  return settled;
}
