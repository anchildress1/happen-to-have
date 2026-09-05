import { AppHeader } from '@/ui/AppHeader';
import { QuestionCard } from '@/ui/QuestionCard';
import { Screen } from '@/ui/Screen';
import { Watermark } from '@/ui/Watermark';
import styles from './page.module.css';

// Never cached: a per-participant selection lives entirely behind
// QuestionCard's client POST, so there is nothing here for Next to cache.
export const dynamic = 'force-dynamic';

/**
 * Server Component shell for the question-selection screen. It renders no
 * question and creates no participant — QuestionCard's client-side POST to
 * `/api/questions/next` does both on mount (contracts/session.md, T054).
 */
export default function AnswerPage() {
  return (
    <Screen header={<AppHeader />} contentClassName={styles.content}>
      <Watermark />
      <QuestionCard />
    </Screen>
  );
}
