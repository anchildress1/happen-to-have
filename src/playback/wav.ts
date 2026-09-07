/**
 * Turning what Gemini TTS returns into something a browser will play.
 *
 * The provider returns headerless signed 16-bit little-endian PCM with a mime type like
 * `audio/L16;codec=pcm;rate=24000`. No browser plays that from an `<audio>` element or an object
 * URL — it has no idea what rate, width, or channel count the bytes are. The 44-byte RIFF/WAVE
 * header supplies exactly that, and writing it here is less code than any package that would.
 */

/** Signed 16-bit PCM. The only format this module accepts, and the only one Gemini TTS returns. */
const BITS_PER_SAMPLE = 16;

/** Mono. Single-speaker TTS returns one channel; multi-speaker is not a feature this product has. */
const CHANNELS = 1;

const HEADER_BYTES = 44;

/** Every size field in the header — sample rate, byte rate, both lengths — is a `uint32`. */
const MAX_UINT32 = 0xffff_ffff;

/**
 * Largest payload whose RIFF size field (`36 + length`) still fits its `uint32`.
 *
 * Anything past it makes `writeUInt32LE` throw a `RangeError`, and WAV conversion happens outside
 * the caller's provider-call `try` — so the exception would escape instead of becoming the
 * retryable fault the contract documents.
 */
export const MAX_PCM_BYTES = MAX_UINT32 - (HEADER_BYTES - 8);

/** What a valid `audio/L16` mime type yielded. */
export interface ParsedAudioMime {
  sampleRate: number;
}

/**
 * Reads the sample rate out of a provider mime type, or returns null when it cannot.
 *
 * **The rate is parsed, never assumed, and that is the entire point of this function.** A
 * hardcoded 24000 would be right today and would fail silently the day it stopped being right:
 * audio at the wrong rate plays at the wrong speed and pitch, with nothing throwing and nothing
 * to notice in a test that only checks bytes came back. FR-023 requires the returned audio type
 * to be validated before use, and Principle V's TTS clause says the same in the constitution's
 * words.
 *
 * Returns null rather than throwing: the caller treats it as a fault, and faults are values here
 * the way they are in `src/review/retry.ts`.
 *
 * Accepts `audio/L16` and `audio/l16` with parameters in any order, since the provider is not
 * contractually bound to a particular spelling or ordering.
 */
export function parseAudioMimeType(mimeType: string | undefined): ParsedAudioMime | null {
  if (!mimeType) {
    return null;
  }

  const [type, ...params] = mimeType.split(';').map((part) => part.trim());

  // L16 is the only PCM flavour handled. Anything else — a container the header would misdescribe,
  // or a compressed format the header would corrupt — is a fault, not something to wrap anyway.
  if (type?.toLowerCase() !== 'audio/l16') {
    return null;
  }

  const rateParam = params.find((param) => param.toLowerCase().startsWith('rate='));
  if (!rateParam) {
    return null;
  }

  const rateValue = rateParam.slice('rate='.length);
  // Digits and nothing else. `Number.parseInt` reads `rate=24000Hz` as 24000 and `rate=0x5DC0` as
  // 0, so a partially-numeric value would sail through as a plausible-looking rate. Strictness
  // matters here specifically because the audio is cached permanently on the first Listen: a wrong
  // rate is not a transient error to be retried, it is stored, and every later playback is wrong.
  if (!/^\d+$/.test(rateValue)) {
    return null;
  }

  const sampleRate = Number.parseInt(rateValue, 10);
  // A rate of zero would produce a header claiming something impossible and divide-by-zero byte
  // rates downstream.
  if (sampleRate === 0) {
    return null;
  }

  // The header stores the sample rate and the derived byte rate in `uint32` fields.
  // `Buffer.writeUInt32LE` throws a `RangeError` for anything wider, and `pcmToWav` runs outside
  // the caller's provider-call `try` — so a malformed `rate=2147483648` (byte rate 4294967296)
  // would escape as an exception and bypass the fault contract entirely. Returning null makes it
  // the documented, retryable `bad-mime` fault instead.
  const byteRate = (sampleRate * CHANNELS * BITS_PER_SAMPLE) / 8;
  if (sampleRate > MAX_UINT32 || byteRate > MAX_UINT32) {
    return null;
  }

  return { sampleRate };
}

/**
 * Wraps raw PCM in a RIFF/WAVE container.
 *
 * Field layout is fixed by the format; the only two values that vary per call are the sample rate
 * and the two length fields derived from the payload.
 */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const byteRate = (sampleRate * CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;

  const header = Buffer.alloc(HEADER_BYTES);

  header.write('RIFF', 0, 'ascii');
  // Total file size minus the 8 bytes of "RIFF" plus this field itself.
  header.writeUInt32LE(HEADER_BYTES - 8 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');

  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk length, always 16 for PCM
  header.writeUInt16LE(1, 20); // audio format 1 = uncompressed PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);

  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/** What the route serves, and what the `bytea` column holds. */
export const PLAYBACK_CONTENT_TYPE = 'audio/wav';
