import { redirect } from 'next/navigation';
import { readAskEligibility } from '@/db/queries/answers';
import { readParticipantIdFromCookies } from '@/session/server';
import { AskQuestion } from './AskQuestion';

/**
 * The gate on `/ask` (FR-001 – FR-004a).
 *
 * 003 shipped a `Link href="/ask"` on its published-answer screen and no route behind it, so
 * until now the one screen that states the product's rule led to a 404. Every state at this
 * URL belongs to 004.
 *
 * `force-dynamic`, matching 001's selection route: a cached gate would serve one participant's
 * eligibility to another, which is the whole of Principle II going wrong at the CDN.
 */
export const dynamic = 'force-dynamic';

export default async function AskPage() {
  const participantId = await readParticipantIdFromCookies();

  // FR-003. No ask, no ask flow — and a redirect rather than a page, because a screen whose
  // only action is "go answer something" is the redirect with extra steps. No session lands
  // here too: 001 owns identity and mints it at `/answer`.
  //
  // This is not the enforcement. FR-002 requires the server to refuse a submission that
  // bypasses the interface entirely, and such a request never loads this page — that refusal
  // lives in `/api/ask` and in the publish statement's own guard.
  if (!participantId || !(await readAskEligibility(participantId))) {
    redirect('/answer');
  }

  return <AskQuestion />;
}
