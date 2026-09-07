import { describe, expect, it } from 'vitest';
import { parseAudioMimeType, PLAYBACK_CONTENT_TYPE, pcmToWav } from '../../src/playback/wav.js';

/**
 * T035 and T036, FR-023. The container the browser is handed, and the one number that
 * container cannot be built without.
 *
 * Payload lengths here are deliberately odd (13, 37 bytes) and the sample rate is 22050
 * rather than 24000. Round numbers hide arithmetic: `36 + pcm.length` and
 * `sampleRate * channels * bits / 8` both survive an off-by-one when every operand is a
 * multiple of the mistake.
 */

/** 13 bytes — not a multiple of anything the header arithmetic uses. */
const PCM = Buffer.from([1, 2, 3, 250, 5, 6, 7, 8, 9, 10, 255, 12, 13]);

const SAMPLE_RATE = 22050;

const HEADER_BYTES = 44;

describe('pcmToWav — the RIFF/WAVE header (T035)', () => {
  const wav = pcmToWav(PCM, SAMPLE_RATE);

  it('writes the four ASCII markers a decoder looks for', () => {
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
  });

  it('declares an uncompressed 16-bit mono PCM stream', () => {
    expect(wav.readUInt32LE(16)).toBe(16); // fmt chunk length, fixed at 16 for PCM
    expect(wav.readUInt16LE(20)).toBe(1); // audio format 1 = uncompressed PCM
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt16LE(32)).toBe(2); // block align = channels * bits / 8
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
  });

  it('carries the sample rate it was given rather than a hardcoded one', () => {
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
  });

  it('derives the byte rate from that sample rate', () => {
    // 22050 * 1 * 16 / 8 = 44100. A rate the header understates plays slow and low; one it
    // overstates plays fast and high. Neither throws anywhere.
    expect(wav.readUInt32LE(28)).toBe((SAMPLE_RATE * 1 * 16) / 8);
  });

  it('sizes the RIFF and data chunks from the actual payload length', () => {
    expect(wav.readUInt32LE(4)).toBe(36 + PCM.length);
    expect(wav.readUInt32LE(40)).toBe(PCM.length);
  });

  it('appends the payload byte for byte behind the 44-byte header', () => {
    expect(wav.length).toBe(HEADER_BYTES + PCM.length);
    expect(wav.subarray(HEADER_BYTES).equals(PCM)).toBe(true);
  });

  it('re-derives both length fields for a different odd payload', () => {
    // A second length, because a header built once with a stale constant satisfies the
    // assertions above and fails the moment the payload changes size.
    const longer = Buffer.alloc(37, 0xab);
    const second = pcmToWav(longer, 8000);

    expect(second.readUInt32LE(4)).toBe(36 + 37);
    expect(second.readUInt32LE(40)).toBe(37);
    expect(second.readUInt32LE(28)).toBe((8000 * 1 * 16) / 8);
    expect(second.length).toBe(HEADER_BYTES + 37);
  });
});

/**
 * WHY null and not a 24000 default: a wrong sample rate is the one error in this path that
 * produces no error. The bytes decode, the `<audio>` element plays them, and the voice comes
 * out at the wrong speed and pitch — a chipmunk or a drunk, depending on which direction the
 * provider moved. Nothing throws, no status code changes, and the result is written once into
 * a write-once column. Returning null turns that silent corruption into a `bad-mime` fault the
 * caller can answer with a retry.
 */
describe('parseAudioMimeType — the rate is read, never assumed (T036)', () => {
  it('reads the rate out of the provider mime type', () => {
    expect(parseAudioMimeType('audio/L16;codec=pcm;rate=24000')).toEqual({ sampleRate: 24000 });
  });

  it('is case-insensitive on the type and on the parameter name', () => {
    expect(parseAudioMimeType('audio/l16;codec=pcm;RATE=24000')).toEqual({ sampleRate: 24000 });
    expect(parseAudioMimeType('AUDIO/L16;codec=pcm;Rate=16000')).toEqual({ sampleRate: 16000 });
  });

  it('tolerates whitespace and reordered parameters', () => {
    // The provider is not contractually bound to one spelling or ordering, so neither is this.
    expect(parseAudioMimeType('audio/L16; rate=16000; codec=pcm')).toEqual({ sampleRate: 16000 });
    expect(parseAudioMimeType('  audio/L16 ;  rate=44100  ')).toEqual({ sampleRate: 44100 });
  });

  it('returns null when there is no mime type at all', () => {
    expect(parseAudioMimeType(undefined)).toBeNull();
    expect(parseAudioMimeType('')).toBeNull();
  });

  it('returns null for anything that is not L16', () => {
    // A container or a compressed codec wrapped in a PCM header is a file that lies about
    // itself. It plays as noise, or not at all, and nothing upstream notices.
    expect(parseAudioMimeType('audio/mpeg;rate=24000')).toBeNull();
    expect(parseAudioMimeType('audio/wav;rate=24000')).toBeNull();
    expect(parseAudioMimeType('audio/L24;rate=24000')).toBeNull();
  });

  it('returns null when the rate is missing or unusable', () => {
    expect(parseAudioMimeType('audio/L16;codec=pcm')).toBeNull();
    expect(parseAudioMimeType('audio/L16;codec=pcm;rate=fast')).toBeNull();
    expect(parseAudioMimeType('audio/L16;codec=pcm;rate=')).toBeNull();
    // Zero would divide by nothing downstream; negative would write a header claiming an
    // impossibility. Both are faults rather than numbers to clamp.
    expect(parseAudioMimeType('audio/L16;codec=pcm;rate=0')).toBeNull();
    expect(parseAudioMimeType('audio/L16;codec=pcm;rate=-24000')).toBeNull();
  });
});

describe('PLAYBACK_CONTENT_TYPE', () => {
  it('is what the route serves and the column holds', () => {
    expect(PLAYBACK_CONTENT_TYPE).toBe('audio/wav');
  });
});
