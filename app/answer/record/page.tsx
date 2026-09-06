import { Suspense } from 'react';
import { RecordAnswer } from './RecordAnswer';

/**
 * `useSearchParams` suspends, so it needs a boundary above it and that boundary has to be a
 * server component. The fallback is empty on purpose: the question text arrives with the
 * params, and a placeholder heading would flash something the participant is not answering.
 */
export default function RecordAnswerPage() {
  return (
    <Suspense fallback={null}>
      <RecordAnswer />
    </Suspense>
  );
}
