import { authorizePlayback, claimPlayback, readPlayback } from '@/db/queries/answers';
import {
  isPlaybackConfigured,
  PLAYBACK_CONTENT_TYPE,
  PlaybackUnavailableError,
  producePlayback,
} from '@/playback';
import { readParticipantId } from '@/session/session';

/**
 * 005's playback endpoint: an answer id in, audio out (FR-023 – FR-034).
 *
 * The order is the whole contract, and every step exists to make the next one unnecessary:
 * authorize, then read the cache, then produce, then claim. A cache hit never reaches the
 * provider, and a lost claim never overwrites the winner.
 *
 * **POST, not GET**, even though `<audio src>` would need no JavaScript at all. FR-032 requires a
 * loading state scoped to one response and FR-033 requires a retry offered for the audio alone;
 * both need the client to observe the request, which means `fetch`, which spends the saving GET
 * would have bought. Once the client is fetching, POST is the honest method for a call that can
 * produce something (research D5).
 */
export const dynamic = 'force-dynamic';

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The audio body. No `cache-control`: the durable cache is the `generated_audio` column, and a
 * browser or CDN copy would only duplicate it. The participant plays it in-session.
 */
/**
 * `Uint8Array`, not `Buffer`, and the distinction is a real portability bug rather than pedantry.
 * The Neon driver returns `bytea` as a `Buffer`; PGlite — which the integration suite runs —
 * returns a plain `Uint8Array`. `Buffer` is a subclass, so the wider type accepts both, while
 * declaring `Buffer` would type-check against production and be a lie under test.
 */
function audio(wav: Uint8Array): Response {
  return new Response(new Uint8Array(wav), {
    status: 200,
    headers: {
      'content-type': PLAYBACK_CONTENT_TYPE,
      'content-length': String(wav.length),
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const participantId = await readParticipantId(request);
  if (!participantId) {
    return json({ error: 'no-session' }, 401);
  }

  const { id } = await params;

  // FR-002. One predicate covers both ways an answer is the requester's: they wrote it, or they
  // asked the question it answers. A malformed id fails the same way an unknown one does.
  //
  // **404, never 403.** A distinct forbidden status confirms the row exists, which hands anyone
  // enumerating uuids an oracle over other people's answers. "Not yours" and "not there" are
  // deliberately indistinguishable from outside.
  const target = await authorizePlayback(id, participantId);
  if (!target) {
    return json({ error: 'not-found' }, 404);
  }

  // FR-027, SC-004. The cache hit, and the common path after the first Listen. No provider call,
  // no write, no coalescing — just the bytes that were stored the first time.
  if (target.cached) {
    const cached = await readPlayback(id);
    if (cached) {
      return audio(cached);
    }
    // Fell through: the row said cached and the bytes were not there. Nothing in this design
    // writes one without the other, so treat it as a miss and produce rather than serving a 200
    // with an empty body.
  }

  // FR-034 vs FR-033, and the reason this check is here rather than in a catch block. Playback
  // being absent from the deployment is a different question from a call that failed once, and it
  // is answerable before spending anything. Inferring it from a caught exception would read one
  // transient network error as "playback does not exist here" and permanently degrade the control
  // instead of offering the retry that would have worked.
  if (!isPlaybackConfigured()) {
    return json({ error: 'unavailable' }, 503);
  }

  let outcome: Awaited<ReturnType<typeof producePlayback>>;
  try {
    // FR-024. The text comes from the row, never from the request body — this endpoint reads no
    // body at all. A client-supplied text would let anyone have arbitrary words voiced in the
    // product's voice at the product's expense, and it would sever playback from the published
    // contribution it is supposed to be reading aloud.
    outcome = await producePlayback({ answerId: id, text: target.displayText });
  } catch (cause) {
    if (cause instanceof PlaybackUnavailableError) {
      return json({ error: 'unavailable' }, 503);
    }
    throw cause;
  }

  if (!outcome.ok) {
    // FR-033. A fault, not a rejection: the text stays readable and the client offers a retry for
    // the audio alone. Nothing is cached, so the retry actually re-attempts.
    return json({ error: 'production-failed' }, 502);
  }

  // FR-028, SC-005. The storage guarantee. A false return means another request stored audio
  // first; serve theirs rather than overwriting, so the bytes never change between one Listen and
  // the next.
  const claimed = await claimPlayback(id, outcome.wav, outcome.voiceId);
  if (!claimed) {
    const winner = await readPlayback(id);
    if (winner) {
      return audio(winner);
    }
  }

  return audio(outcome.wav);
}
