/**
 * Server-side only. The API key is a credential: a module that constructs the provider
 * client must never reach a browser bundle, for the same reason `src/db/client.ts` refuses
 * to (constitution, Application Stack — "Gemini access MUST use the official `@google/genai`
 * SDK, server-side only").
 */
import 'server-only';

import {
  type GenerateContentParameters,
  type GenerateContentResponse,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  type SafetySetting,
} from '@google/genai';

/**
 * Model ids pinned per job. The constitution's Application Stack section is authoritative for
 * their status and verification date; this file does not restate it, because a model's tier is
 * exactly the kind of fact that drifts and a second uncited copy is the one nobody updates.
 *
 * Both are callable through `generateContent`; Live API models are forbidden outright because they
 * are speech-to-speech, cannot return structured text, and would derive playback from the
 * original recording rather than from processed text.
 *
 * Content processing stays on Flash and MUST NOT be downgraded to Flash-Lite without
 * evidence: it transcribes, translates and redacts, and **redaction is the only failure in
 * this product that cannot be retried** — a missed name is published.
 */
export const REVIEW_MODELS = {
  content: 'gemini-3.8-flash',
  judgment: 'gemini-3.5-flash-lite',
} as const;

/**
 * Intended for both calls, explicitly (FR-008b). Nothing consumes it yet — the gate that
 * issues the calls is not built — so this is the shape the wiring must use, not a description
 * of wiring that exists.
 *
 * The provider ships these four adjustable filters **off by default** for the models above,
 * so this changes nothing today. It is written rather than inherited because a documented
 * default can change, and this gate must not move when it does.
 *
 * It does NOT stop every block: the provider's non-adjustable protections against core harms
 * stay active at every setting a caller can send, and empty candidates were observed at this
 * threshold on two fixtures. Those are faults, handled in `retry.ts` (FR-008b1).
 *
 * No code may read `candidate.safetyRatings`. The field exists in the SDK's types and was not
 * populated in any configuration the 002 spike measured (research D3). Absence of evidence over
 * 16 fixtures is not a guarantee about every future response — the rule holds because a rating
 * this system did not compute is not a verdict it may act on, which is true regardless.
 */
export const NEVER_BLOCK: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));

/**
 * The only shape the review needs from the provider SDK. Declaring it lets tests supply a
 * fake without importing this module's real client, and without any caller knowing which one
 * it got — the seam `src/db/client.ts` established for `SqlClient`.
 *
 * Deliberately one method. Streaming, chats, files, caches and tuning are all on the real
 * client and none of them belong in this feature: the audio never leaves the request, and a
 * single decision is returned per call.
 */
export interface GenAiClient {
  generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
}

let sdk: GoogleGenAI | undefined;

function getSdk(): GoogleGenAI {
  if (sdk) {
    return sdk;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Naming the variable matters: the same failure otherwise surfaces as an opaque 401
    // from the provider, several seconds and one billed request later.
    throw new Error(
      'GEMINI_API_KEY is not set. Copy it into .env locally, or bind the ' +
        'HTH_GEMINI_API_KEY secret in production (deploy.sh).',
    );
  }

  sdk = new GoogleGenAI({ apiKey });
  return sdk;
}

/**
 * Builds a client over the real SDK. Constructed lazily so importing this module never
 * throws — a missing key must fail when a review is attempted, not when the process boots
 * a route that may never call one.
 */
export function makeGenAiClient(): GenAiClient {
  return {
    // `async` is load-bearing, not decoration. `getSdk()` throws when the key is missing,
    // and a synchronous throw out of a Promise-returning function escapes `.catch()` — it
    // would bypass the retry wrapper entirely and surface as an unhandled error rather than
    // the bounded fault the caller is written to expect (FR-038).
    async generateContent(params) {
      return getSdk().models.generateContent(params);
    },
  };
}

/** The production instance, bound to the real SDK. */
export const genAiClient: GenAiClient = makeGenAiClient();
