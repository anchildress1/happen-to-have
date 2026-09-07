import { type GenerateContentParameters, Modality } from '@google/genai';
import { describe, expect, it } from 'vitest';
import {
  PLAYBACK_MODEL,
  PlaybackUnavailableError,
  producePlayback,
  VOICE_ID,
} from '../../src/playback/index.js';
import type { GenAiClient } from '../../src/review/client.js';

/**
 * T037 – T040, FR-023 – FR-028 and SC-005. The request that goes out, the faults that come
 * back, and the in-flight map that keeps two taps on `Listen` from being two billed calls.
 *
 * The provider is faked at the `GenAiClient` seam, the same boundary
 * `tests/integration/review-fanout.test.ts` fakes. Nothing here mocks the module under test.
 */

/** Non-silent 16-bit PCM, and an odd byte count so a length bug cannot cancel out. */
const PCM = Buffer.from([0, 1, 2, 3, 250, 5, 6, 7, 9]);

const AUDIO_MIME = 'audio/L16;codec=pcm;rate=24000';

/** The parts array of a response that carried real audio. */
const audioPart = (data: string, mimeType: string = AUDIO_MIME) => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }],
});

/**
 * Records every call and replies with whatever `respond` yields — a response object to
 * resolve, or a thrown error to reject.
 *
 * The `setTimeout(0)` is load-bearing for T039. A synchronously resolving fake lets the first
 * production settle and clear the map before the second call is even made, so the coalescing
 * assertion would pass against an implementation that coalesces nothing.
 */
function fakeProvider(respond: () => unknown = () => audioPart(PCM.toString('base64'))): {
  client: GenAiClient;
  seen: GenerateContentParameters[];
} {
  const seen: GenerateContentParameters[] = [];
  return {
    seen,
    client: {
      async generateContent(params) {
        seen.push(params);
        await new Promise((resolve) => setTimeout(resolve, 0));
        return respond() as never;
      },
    },
  };
}

/** The provider's speech config, which the SDK types as a union too wide to index directly. */
function voiceOf(params: GenerateContentParameters): string | undefined {
  const speech = params.config?.speechConfig as
    | { voiceConfig?: { prebuiltVoiceConfig?: { voiceName?: string } } }
    | string
    | undefined;
  return typeof speech === 'string' ? speech : speech?.voiceConfig?.prebuiltVoiceConfig?.voiceName;
}

describe('producePlayback — the request (T037)', () => {
  it('sends one call on the pinned TTS model, in the product voice, and returns a WAV', async () => {
    const { client, seen } = fakeProvider();

    const outcome = await producePlayback(
      { answerId: 'request-shape', text: 'Feed it at the same time daily.' },
      { genai: client },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].model).toBe(PLAYBACK_MODEL);
    expect(voiceOf(seen[0])).toBe(VOICE_ID);
    expect(seen[0].config?.responseModalities).toContain(Modality.AUDIO);
    expect(JSON.stringify(seen[0].contents)).toContain('Feed it at the same time daily.');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.voiceId).toBe(VOICE_ID);
    expect(outcome.wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(outcome.wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
  });

  it('requests no responseSchema at all', async () => {
    // Asserted rather than left to review. The constitution exempts TTS from structured output
    // and requires that it NOT be requested — a schema on an audio-modality call is a
    // contradiction the provider is under no obligation to reject loudly.
    const { client, seen } = fakeProvider();

    await producePlayback({ answerId: 'no-schema', text: 'anything' }, { genai: client });

    expect(seen[0].config?.responseSchema).toBeUndefined();
  });
});

describe('producePlayback — faults (T038)', () => {
  it('returns no-candidate when the provider answers with nothing', async () => {
    const { client } = fakeProvider(() => ({ candidates: [] }));

    await expect(
      producePlayback({ answerId: 'fault-no-candidate', text: 'x' }, { genai: client }),
    ).resolves.toMatchObject({ ok: false, fault: 'no-candidate' });
  });

  it('returns no-audio when the candidate carries no inlineData', async () => {
    const { client } = fakeProvider(() => ({
      candidates: [{ content: { parts: [{ text: 'I cannot do that' }] } }],
    }));

    await expect(
      producePlayback({ answerId: 'fault-no-audio', text: 'x' }, { genai: client }),
    ).resolves.toMatchObject({ ok: false, fault: 'no-audio' });
  });

  it('returns bad-mime for audio that is not L16', async () => {
    const { client } = fakeProvider(() =>
      audioPart(PCM.toString('base64'), 'audio/mpeg;rate=24000'),
    );

    await expect(
      producePlayback({ answerId: 'fault-bad-mime', text: 'x' }, { genai: client }),
    ).resolves.toMatchObject({ ok: false, fault: 'bad-mime' });
  });

  it('returns bad-mime, and does not throw, for a rate too wide for the WAV header', async () => {
    // `rate=2147483648` derives a byte rate of 4294967296, which `Buffer.writeUInt32LE` refuses
    // with a RangeError. WAV conversion runs outside the provider-call `try`, so an unvalidated
    // rate would escape this function as an exception rather than the retryable fault the route
    // is written to answer.
    const { client } = fakeProvider(() =>
      audioPart(PCM.toString('base64'), 'audio/L16;codec=pcm;rate=2147483648'),
    );

    const outcome = await producePlayback(
      { answerId: 'fault-oversized-rate', text: 'x' },
      { genai: client },
    );

    expect(outcome).toMatchObject({ ok: false, fault: 'bad-mime' });
  });

  it('returns bad-mime for a rate carrying trailing non-digits', async () => {
    // `rate=24000Hz` parses as 24000 under `parseInt`. The bytes would be cached under a rate
    // nobody validated, permanently, because the audio column is write-once.
    const { client } = fakeProvider(() =>
      audioPart(PCM.toString('base64'), 'audio/L16;codec=pcm;rate=24000Hz'),
    );

    await expect(
      producePlayback({ answerId: 'fault-trailing-garbage', text: 'x' }, { genai: client }),
    ).resolves.toMatchObject({ ok: false, fault: 'bad-mime' });
  });

  it('returns empty-payload for a body that decodes to zero bytes', async () => {
    // A 44-byte header wrapping nothing is a valid WAV that plays silence, and the cache is
    // write-once — that silence would be this response's audio forever.
    //
    // Padding-only base64 — a body that is present and decodes to nothing.
    const { client } = fakeProvider(() => audioPart('===='));

    await expect(
      producePlayback({ answerId: 'fault-empty', text: 'x' }, { genai: client }),
    ).resolves.toMatchObject({ ok: false, fault: 'empty-payload' });
  });

  it('reports an empty-string body as empty-payload, not no-audio', async () => {
    // The commonest zero-byte shape a provider returns, and the one a truthiness guard silently
    // misfiles. `''` is falsy, so `!inline?.data` would classify "the audio part was empty" as
    // "there was no audio part" and leave the length check below it unreachable for this shape.
    // Both faults answer 502, so nothing participant-facing turns on it — but a fault name that
    // cannot be trusted is its own cost, and this test is what keeps the two distinguishable.
    const { client } = fakeProvider(() => audioPart(Buffer.alloc(0).toString('base64')));

    await expect(
      producePlayback({ answerId: 'fault-empty-string', text: 'x' }, { genai: client }),
    ).resolves.toMatchObject({ ok: false, fault: 'empty-payload' });
  });

  it('reports a part carrying no inlineData at all as no-audio', async () => {
    // The other side of the distinction above: `data` genuinely absent rather than empty. If this
    // and the previous test ever agree on a fault name, the guard has collapsed back into a
    // truthiness check.
    const { client } = fakeProvider(() => ({
      candidates: [{ content: { parts: [{ text: 'not audio' }] } }],
    }));

    await expect(
      producePlayback({ answerId: 'fault-no-inline', text: 'x' }, { genai: client }),
    ).resolves.toMatchObject({ ok: false, fault: 'no-audio' });
  });

  it('returns network rather than throwing when the provider is down', async () => {
    const { client } = fakeProvider(() => {
      throw new Error('ECONNRESET');
    });

    await expect(
      producePlayback({ answerId: 'fault-network', text: 'x' }, { genai: client }),
    ).resolves.toMatchObject({ ok: false, fault: 'network' });
  });

  it('rethrows PlaybackUnavailableError instead of folding it into a fault', async () => {
    // A missing key is the absence of the capability, not a failed attempt: the route answers
    // 503 and degrades the control permanently. Swallowed as a `network` fault it would become
    // a 502 offering a retry that fails identically every time, forever.
    const { client } = fakeProvider(() => {
      throw new PlaybackUnavailableError('GEMINI_API_KEY is not set.');
    });

    await expect(
      producePlayback({ answerId: 'fault-unconfigured', text: 'x' }, { genai: client }),
    ).rejects.toThrow(PlaybackUnavailableError);
  });
});

describe('producePlayback — concurrent first requests produce once (T039, SC-005)', () => {
  it('makes one provider call for two overlapping requests on the same answer', async () => {
    const { client, seen } = fakeProvider();

    const both = [
      producePlayback({ answerId: 'coalesced', text: 'same answer' }, { genai: client }),
      producePlayback({ answerId: 'coalesced', text: 'same answer' }, { genai: client }),
    ];
    const [first, second] = await Promise.all(both);

    expect(seen).toHaveLength(1);
    expect(first).toBe(second);
  });

  it('makes two provider calls for two overlapping requests on different answers', async () => {
    // Without this, the assertion above passes for an implementation that simply never calls
    // the provider twice for any reason.
    const { client, seen } = fakeProvider();

    await Promise.all([
      producePlayback({ answerId: 'distinct-a', text: 'a' }, { genai: client }),
      producePlayback({ answerId: 'distinct-b', text: 'b' }, { genai: client }),
    ]);

    expect(seen).toHaveLength(2);
  });
});

describe('producePlayback — the in-flight entry is evicted on settle (T040)', () => {
  it('produces again after a fault instead of replaying it', async () => {
    // A rejected or faulted promise left in the map turns one transient blip into a permanent
    // failure for that response: every later Listen replays it, and the retry FR-033 offers is
    // a retry of a cached memory rather than of the provider.
    let attempt = 0;
    const { client, seen } = fakeProvider(() => {
      attempt++;
      return attempt === 1 ? { candidates: [] } : audioPart(PCM.toString('base64'));
    });

    const failed = await producePlayback(
      { answerId: 'evicted-after-fault', text: 'x' },
      { genai: client },
    );
    expect(failed).toMatchObject({ ok: false, fault: 'no-candidate' });

    const retried = await producePlayback(
      { answerId: 'evicted-after-fault', text: 'x' },
      { genai: client },
    );

    expect(seen).toHaveLength(2);
    expect(retried.ok).toBe(true);
  });

  it('produces again after a success, because this map is not the cache', async () => {
    // The cache is the `generated_audio` column. This map only coalesces requests that overlap
    // in time; a sequential second call has nothing to join and must reach the provider.
    const { client, seen } = fakeProvider();

    await producePlayback({ answerId: 'evicted-after-ok', text: 'x' }, { genai: client });
    await producePlayback({ answerId: 'evicted-after-ok', text: 'x' }, { genai: client });

    expect(seen).toHaveLength(2);
  });
});
