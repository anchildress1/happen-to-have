import { listEligibleQuestions, toSelectionPayload } from '@/db/queries/questions';
import { getOrCreateParticipant, readParticipantId } from '@/session/session';

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
    let participantId = await readParticipantId(request);

    if (!participantId) {
      const created = await getOrCreateParticipant(request);
      participantId = created.participantId;
      for (const [key, value] of created.headers) headers.append(key, value);
    }

    return json(toSelectionPayload(await listEligibleQuestions(participantId)), 200, headers);
  } catch {
    return json({ error: 'selection_failed' }, 500, headers);
  }
}
