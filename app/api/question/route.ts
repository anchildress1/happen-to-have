import { listEligibleQuestions, toSelectionPayload } from '@/db/queries/questions';
import { getOrCreateParticipant } from '@/session/session';

// A cached selection would serve one participant's question to another (FR-015, FR-016).
export const dynamic = 'force-dynamic';

function json(payload: unknown, status: number, headers: Headers): Response {
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(payload), { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  // Declared out here so a failure after the participant was created still returns its
  // Set-Cookie; without it the retry mints another row.
  const headers = new Headers();

  try {
    // Unconditional, where an earlier revision called this only when the cookie was ABSENT.
    // That left the third case unhandled: a cookie that decrypts cleanly to a participant row
    // that no longer exists — swept, or belonging to a database branch this deployment no longer
    // points at. The id looked valid, identity creation was skipped, and the first foreign-key
    // write downstream failed as an unhandled rejection.
    //
    // `getOrCreateParticipant` already handles all three — absent, undecryptable, and naming a
    // missing row — and says so in its own doc comment. Calling it always costs one indexed
    // lookup on the common path and makes this route the thing that heals a stale cookie, which
    // matters because it is the first request every screen makes.
    const { participantId, headers: sessionHeaders } = await getOrCreateParticipant(request);
    for (const [key, value] of sessionHeaders) headers.append(key, value);

    return json(toSelectionPayload(await listEligibleQuestions(participantId)), 200, headers);
  } catch {
    return json({ error: 'selection_failed' }, 500, headers);
  }
}
