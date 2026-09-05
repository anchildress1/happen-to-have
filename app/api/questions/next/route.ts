import { listEligibleQuestions, toSelectionPayload } from '@/db/queries/questions';
import { getOrCreateParticipant } from '@/session/session';

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

export async function POST(request: Request): Promise<Response> {
  try {
    const { participantId, headers } = await getOrCreateParticipant(request);
    const eligible = await listEligibleQuestions(participantId);

    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(toSelectionPayload(eligible)), { status: 200, headers });
  } catch {
    // Never a stack trace, never a database message.
    return Response.json({ error: 'selection_failed' }, { status: 500 });
  }
}
