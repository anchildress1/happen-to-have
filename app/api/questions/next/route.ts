import { listEligibleQuestions } from '@/db/queries/questions';
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

    // Zero eligible questions is the FR-029 empty state, not an error. Every question is
    // either theirs or one they already answered.
    const question = eligible[0]
      ? {
          id: eligible[0].id,
          displayText: eligible[0].display_text,
          publishedAnswers: eligible[0].published_answers,
        }
      : null;

    // The full ordered list travels with the response so traversal stays tab-local
    // (research D11): skipping advances a pointer in page memory and never writes a cookie.
    const queue = eligible.map((q) => ({
      id: q.id,
      displayText: q.display_text,
      publishedAnswers: q.published_answers,
    }));

    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify({ question, queue }), { status: 200, headers });
  } catch {
    // Never a stack trace, never a database message.
    return Response.json({ error: 'selection_failed' }, { status: 500 });
  }
}
