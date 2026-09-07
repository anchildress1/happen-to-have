import 'server-only';

import { Modality } from '@google/genai';
import type { GenAiClient } from '../review/client';
import { PLAYBACK_MODEL, playbackClient } from './client';
import { VOICE_ID } from './voice';
import { parseAudioMimeType, pcmToWav } from './wav';

/**
 * Producing generated playback from published text (FR-023 – FR-028).
 *
 * This module is a sibling of `src/review/`, not a member of it, and the distinction is real:
 * nothing here reviews anything. It requests no schema, dispatches no guardrail, and cannot
 * change a contribution's outcome. It reads text that already passed the gate and speaks it.
 *
 * It borrows one thing from `src/review/` deliberately — the `GenAiClient` seam — so that a test
 * fakes the provider the same way for both.
 */

/**
 * Why a production did not yield audio.
 *
 * Every one of these is a **fault**, never a rejection, exactly as in `src/review/retry.ts`. A
 * fault means "this attempt did not work"; the route answers 502 and offers a retry. Nothing here
 * can express "refuse", because there is nothing to refuse — the text was published days ago.
 *
 * `no-candidate` is its own kind for the same reason it is in the review path: the provider's
 * non-adjustable protections can return an empty response, and reading a decision out of silence
 * would be manufacturing one.
 */
export type PlaybackFault = 'no-candidate' | 'no-audio' | 'bad-mime' | 'empty-payload' | 'network';

export type PlaybackOutcome =
  | { ok: true; wav: Buffer; voiceId: string }
  | { ok: false; fault: PlaybackFault; cause?: unknown };

/** Injection seam for tests, matching `ReviewDeps` in `src/review/index.ts`. */
export interface PlaybackDeps {
  genai?: GenAiClient;
  voiceId?: string;
}

/**
 * In-flight productions, keyed by answer id.
 *
 * **FR-028 and SC-005: concurrent first requests must result in exactly one production.** Two
 * taps on one `Listen` arrive as two requests; without this, both call the provider and the
 * product pays twice for bytes only one of them will store.
 *
 * This is the only mutable module state in the codebase, and it is here because the two
 * deterministic alternatives are both worse (research D2). An advisory lock held across the TTS
 * call would pin connections from a pool capped at `max: 4` for the several seconds Gemini takes.
 * A pending row would be processing state in the database, which Principle V forbids in those
 * words, and a crashed producer would strand a claim nobody clears.
 *
 * **Scope, stated honestly**: this coalesces within one Cloud Run instance. Two instances can
 * both produce before either writes — a duplicate spend of a fraction of a cent, never a
 * duplicate artifact, because `claimPlayback`'s `generated_audio IS NULL` guard means exactly one
 * set of bytes is ever stored. It is also close to unreachable: `Yours` is scoped to one
 * participant's session, so concurrent first requests for one response are one person
 * double-tapping in one browser.
 */
const inFlight = new Map<string, Promise<PlaybackOutcome>>();

/**
 * Speaks a published contribution's processed text in the product's single voice.
 *
 * Never throws for a production outcome — a provider outage returns a fault. Only a missing
 * `GEMINI_API_KEY` escapes, as `PlaybackUnavailableError` from `./client`, because that is a
 * different question (does playback exist here at all) and the route answers it differently.
 */
export function producePlayback(
  input: { answerId: string; text: string },
  deps: PlaybackDeps = {},
): Promise<PlaybackOutcome> {
  const existing = inFlight.get(input.answerId);
  if (existing) {
    return existing;
  }

  const work = produce(input.text, deps).finally(() => {
    // Cleared on settle, success or fault. Leaving a rejected promise in the map would cache one
    // transient network blip as a permanent failure for that response — every later Listen would
    // replay it, and the retry FR-033 offers would be a retry of nothing.
    inFlight.delete(input.answerId);
  });

  inFlight.set(input.answerId, work);
  return work;
}

async function produce(text: string, deps: PlaybackDeps): Promise<PlaybackOutcome> {
  const genai = deps.genai ?? playbackClient;
  const voiceId = deps.voiceId ?? VOICE_ID;

  let response: Awaited<ReturnType<GenAiClient['generateContent']>>;
  try {
    response = await genai.generateContent({
      model: PLAYBACK_MODEL,
      contents: [{ role: 'user', parts: [{ text }] }],
      config: {
        // No `responseSchema`, and that is a rule rather than an omission: the constitution
        // exempts TTS from structured output and replaces it with the validation below.
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } },
        },
      },
    });
  } catch (cause) {
    // A missing key is not a production fault — it is the absence of the capability, and the
    // route renders it as a permanently degraded control rather than a retry. Rethrown so that
    // question reaches the code that answers it.
    if (cause instanceof Error && cause.name === 'PlaybackUnavailableError') {
      throw cause;
    }
    return { ok: false, fault: 'network', cause };
  }

  const part = response.candidates?.[0]?.content?.parts?.[0];
  if (!part) {
    return { ok: false, fault: 'no-candidate' };
  }

  const inline = part.inlineData;
  // `data === undefined` is "the part carried no audio at all"; `data === ''` is "it carried an
  // empty one". A truthiness check would collapse the second into the first, and the
  // `pcm.length === 0` guard below would then be unreachable for the commonest empty shape —
  // leaving a fault kind that can never fire and a log line naming the wrong cause. Both still
  // answer 502, so nothing participant-facing turns on it; a fault name that cannot be trusted is
  // its own cost.
  if (!inline || inline.data === undefined || inline.data === null) {
    return { ok: false, fault: 'no-audio' };
  }

  // FR-023: validate the returned audio type before use. A non-L16 payload wrapped in a WAV
  // header would be a file that claims to be PCM and is not — it plays as noise, or not at all,
  // and nothing upstream errors.
  const parsed = parseAudioMimeType(inline.mimeType);
  if (!parsed) {
    return { ok: false, fault: 'bad-mime', cause: inline.mimeType };
  }

  const pcm = Buffer.from(inline.data, 'base64');
  // FR-023: nonempty payload. A zero-length body would cache as a valid-looking 44-byte WAV that
  // plays silence — and because the cache is write-once, that silence would be permanent.
  if (pcm.length === 0) {
    return { ok: false, fault: 'empty-payload' };
  }

  return { ok: true, wav: pcmToWav(pcm, parsed.sampleRate), voiceId };
}

export { PLAYBACK_MODEL, PlaybackUnavailableError, isPlaybackConfigured } from './client';
export { PLAYBACK_CONTENT_TYPE } from './wav';
export { VOICE_ID } from './voice';
