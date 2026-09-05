import type { Metadata } from 'next';
import Link from 'next/link';
import { copy } from '@/copy';
import { AppHeader } from '@/ui/AppHeader';
import { Screen } from '@/ui/Screen';
import { Watermark } from '@/ui/Watermark';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: copy.product.name,
  description: copy.product.description,
};

/**
 * Arrival (`/`). Server Component — it mints no participant. Identity is
 * created by `POST /api/question`, which the selection screen calls
 * once `Find me a question` is followed.
 */
export default function ArrivalPage() {
  return (
    <Screen
      header={
        <>
          {/* AppHeader has no responsive variant swap of its own — both
           * render and CSS shows the one that matches the breakpoint. */}
          <div className={styles.headerMobile}>
            <AppHeader variant="arrival-mobile" />
          </div>
          <div className={styles.headerDesktop}>
            <AppHeader />
          </div>
        </>
      }
      contentClassName={styles.content}
    >
      <Watermark />
      <div className={styles.hero}>
        <div className={styles.copy}>
          <span className={styles.statusDot} aria-hidden="true" />
          <h1 className={styles.heading}>{copy.product.name}</h1>
          <p className={styles.tagline}>{copy.product.tagline}</p>
        </div>
        <div className={styles.action}>
          <Link href="/answer" className={styles.primaryLink}>
            {copy.action.findQuestion}
          </Link>
          <p className={styles.helper}>{copy.arrival.helper}</p>
        </div>
      </div>
      <p className={styles.footer}>{copy.arrival.footer}</p>
    </Screen>
  );
}
