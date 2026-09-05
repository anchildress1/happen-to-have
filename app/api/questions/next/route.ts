import { participantsClient } from '@/db/queries/participants';
import { listEligibleQuestions, toSelectionPayload } from '@/db/queries/questions';
import { getOrCreateParticipant, readParticipantId } from '@/session/session';

/**
 * Selects one question for the current participant, creating their anonymous identity on
 * the way if this is their first interaction.
 *
 * This handler — not a Server Component render — is where identity is created (T054,
 * contracts/session.md). Loading `/` must mint no participant row, so a crawler or a link
 * preview never becomes one.
 *
 * Never cached. A cached selection would serve one participant's question to another,
 * breaking FR-015 and FR-016 in the most visible way available.
 */
export const dynamic = 'force-dynamic';

function json(payload: unknown, headers: Headers): Response {
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

export async function POST(request: Request): Promise<Response> {
  try {
    // Returning participant — the overwhelmingly common case. The cookie already carries
    // the id, so confirming the row still exists and selecting their question are
    // independent queries: issue both at once and pay one round-trip of latency instead
    // of two. Sequential, these were the entire cost of loading a question.
    //
    // The existence check is not skipped, only overlapped. An id that decrypts is still
    // not an id that exists (contracts/session.md, branch 3), so a missing row falls
    // through to the same create path as a request with no cookie at all.
    const claimed = await readParticipantId(request);
    if (claimed) {
      const [row, eligible] = await Promise.all([
        participantsClient.findParticipantById(claimed),
        listEligibleQuestions(claimed),
      ]);
      // The session is unchanged, so this response carries no Set-Cookie.
      if (row) return json(toSelectionPayload(eligible), new Headers());
    }

    // No cookie, or one naming a participant that no longer exists.
    const { participantId, headers } = await getOrCreateParticipant(request);
    const eligible = await listEligibleQuestions(participantId);
    return json(toSelectionPayload(eligible), headers);
  } catch {
    // Never a stack trace, never a database message.
    return Response.json({ error: 'selection_failed' }, { status: 500 });
  }
}
