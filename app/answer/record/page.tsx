import { Suspense } from 'react';
import { getQuestionText } from '@/db/queries/questions';
import { RecordAnswer } from './RecordAnswer';

/**
 * Reads the question's text on the server, from its id (FR-002).
 *
 * It arrived through the URL before, which meant it never arrived at all: `QuestionCard`
 * links with `questionId` alone, so the recorder fell back to a placeholder heading reading
 * "Recording isn't built yet" for every real participant. Eleven e2e tests were green because
 * they built their own URL with a `text` parameter nothing in the app emits.
 *
 * The server was always the right source. `contracts/answer-api.md` already forbids the
 * client supplying question text on submit, for the same reason it should not supply it for
 * display: the question is the server's fact, not the caller's claim.
 */
export default async function RecordAnswerPage({
  searchParams,
}: {
  searchParams: Promise<{ questionId?: string }>;
}) {
  const { questionId = '' } = await searchParams;
  const questionText = questionId ? await getQuestionText(questionId) : null;

  return (
    // `useSearchParams` in the client half still suspends, so the boundary stays. The
    // fallback is empty on purpose: the heading is real content now, and a placeholder would
    // flash a question the participant is not answering.
    <Suspense fallback={null}>
      <RecordAnswer questionId={questionId} questionText={questionText} />
    </Suspense>
  );
}
