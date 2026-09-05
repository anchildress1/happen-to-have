import { listEligibleQuestions, toSelectionPayload } from '@/db/queries/questions';
import { getOrCreateParticipant, readParticipantId } from '@/session/session';

/**
 * Selects one question, minting the participant on first visit.
 *
 * Identity is created here rather than in a Server Component render, so loading `/` never
 * turns a crawler or link preview into a participant (T054). Never cached: a cached
 * selection would serve one participant's question to another (FR-015, FR-016).
 */
export const dynamic = 'force-dynamic';

function json(payload: unknown, headers: Headers): Response {
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

export async function POST(request: Request): Promise<Response> {
  try {
    // Deliberately does not confirm the row still exists: an id with no rows returns the
    // same list as a new participant (exclusions.test.ts), so the check cost a round-trip
    // to prove what the result already implied. A missing row is a write concern, left to
    // 003 under the foreign key that enforces it.
    const claimed = await readParticipantId(request);
    if (claimed) {
      return json(toSelectionPayload(await listEligibleQuestions(claimed)), new Headers());
    }

    const { participantId, headers } = await getOrCreateParticipant(request);
    const eligible = await listEligibleQuestions(participantId);
    return json(toSelectionPayload(eligible), headers);
  } catch {
    // Never a stack trace, never a database message.
    return Response.json({ error: 'selection_failed' }, { status: 500 });
  }
}
