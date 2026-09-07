/**
 * Server-side only. The API key is a credential: a module that constructs the provider client
 * must never reach a browser bundle, for the same reason `src/db/client.ts` and
 * `src/review/client.ts` refuse to.
 */
import 'server-only';

import { GoogleGenAI } from '@google/genai';
import type { GenAiClient } from '../review/client';

/**
 * The text-to-speech model, pinned here and nowhere else.
 *
 * **Deliberately not a member of `REVIEW_MODELS`.** This is not a review call: it requests no
 * `responseSchema`, dispatches no guardrail check, and cannot change a contribution's outcome.
 * `tests/unit/review-client.test.ts` asserts that object's exact key set, and adding a TTS id to
 * it would either break that assertion or quietly widen the meaning of "review model" to include
 * a call nothing reviews.
 *
 * This id is **preview**, and it is the only preview model the product uses. That is accepted
 * rather than overlooked: every Gemini TTS id is preview because no GA text-to-speech model
 * exists. Every call the reciprocity gate depends on still runs GA. The constitution requires
 * that this never be described to participants or in marketing as stable.
 *
 * Re-verified against https://ai.google.dev/gemini-api/docs/models on 2026-09-07.
 *
 * Live API models remain forbidden here specifically, not just generally: they are
 * speech-to-speech over a stateful socket, so a playback path built on one would derive audio
 * from the original recording rather than from processed text — a direct Principle IV violation.
 */
export const PLAYBACK_MODEL = 'gemini-3.1-flash-tts-preview';

let sdk: GoogleGenAI | undefined;

/**
 * Thrown when playback cannot work at all in this deployment, as opposed to failing this once.
 *
 * The distinction is the whole of how FR-033 and FR-034 differ, and it has to be detectable
 * *before* the call rather than inferred from a caught exception — an inference would read a
 * transient network error as "playback does not exist here" and permanently degrade the control
 * instead of offering a retry.
 */
export class PlaybackUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaybackUnavailableError';
  }
}

function getSdk(): GoogleGenAI {
  if (sdk) {
    return sdk;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Naming the variable matters: the same failure otherwise surfaces as an opaque 401 from the
    // provider, several seconds and one billed request later. Typed, because the route answers
    // 503 for this and 502 for everything else.
    throw new PlaybackUnavailableError(
      'GEMINI_API_KEY is not set. Copy it into .env locally, or bind the ' +
        'HTH_GEMINI_API_KEY secret in production (deploy.sh). Playback is unavailable; ' +
        'published text is unaffected.',
    );
  }

  sdk = new GoogleGenAI({ apiKey });
  return sdk;
}

/**
 * Whether playback can run at all here, without making a call or billing anything.
 *
 * Checked by the route before producing so a missing key becomes 503 (`Listen` degrades,
 * FR-034) rather than 502 (`Listen` offers a retry that would fail identically forever).
 */
export function isPlaybackConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Builds a client over the real SDK, reusing `src/review/client.ts`'s `GenAiClient` interface
 * rather than declaring a second one — two shapes for one seam is two places for a fake to drift.
 *
 * Constructed lazily so importing this module never throws. That is load-bearing for SC-011:
 * `app/yours/page.tsx` must render every word of a participant's history with no key present,
 * which it does by never importing this file at all — but a module-level construction would also
 * break any route that merely imports it.
 */
export function makePlaybackClient(): GenAiClient {
  return {
    // `async` is load-bearing, not decoration. `getSdk()` throws when the key is missing, and a
    // synchronous throw out of a Promise-returning function escapes `.catch()`, surfacing as an
    // unhandled error instead of the typed failure the caller is written to expect.
    async generateContent(params) {
      return getSdk().models.generateContent(params);
    },
  };
}

/** The production instance, bound to the real SDK. */
export const playbackClient: GenAiClient = makePlaybackClient();
