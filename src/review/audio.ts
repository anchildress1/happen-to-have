import type { ContentReason } from './types';

/**
 * FR-050. Cheap validation before any provider call, so abuse and accidents cost nothing.
 *
 * Bounds are on BYTES, which the server can verify. The 60-second ceiling belongs to the
 * recorder that produced the file: a recording slightly past 60s is not worth a rejection,
 * one that arrives at 4 MB is.
 */
const ALLOWED_BASE_TYPES = new Set([
  'audio/mp4',
  'audio/webm',
  'audio/m4a',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
]);

/** ~10x the worst measured 60s recording. An abuse bound, not the provider's 20 MB limit. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Smaller than any container's own headers, so it cannot contain speech. */
const MIN_BYTES = 1024;

/**
 * Everything before the first `;`, lowercased and trimmed.
 *
 * `MediaRecorder` reports the type it was constructed with, and picking a format with
 * `isTypeSupported('audio/webm;codecs=opus')` — the documented way — means it reports exactly
 * that. Exact-matching the allowlist would reject every Chrome recording before any call.
 */
export function baseMimeType(mimeType: string): string {
  return (mimeType.split(';')[0] ?? '').trim().toLowerCase();
}

/** Returns the reason to withhold, or null when the audio is worth spending a call on. */
export function rejectAudio(audio: Uint8Array, mimeType: string): ContentReason | null {
  if (!ALLOWED_BASE_TYPES.has(baseMimeType(mimeType))) {
    return 'unintelligible';
  }
  if (audio.byteLength < MIN_BYTES) {
    return 'silence';
  }
  if (audio.byteLength > MAX_BYTES) {
    return 'unpublishable';
  }
  return null;
}
