import Link from 'next/link';
import styles from './AppHeader.module.css';

type AppHeaderVariant = 'arrival-mobile' | 'default';

export interface AppHeaderProps {
  /**
   * `arrival-mobile` renders the right slot only, per design.md — the H1
   * already carries the product name on that screen. `default` adds the
   * product name to the left slot (Arrival desktop and Selection).
   */
  variant?: AppHeaderVariant;
  productName?: string;
}

const PRODUCT_NAME = 'Happen to Have?';

/**
 * Shared product header. Left and right slots, `space-between`, 44px
 * min-height. The right slot is contextual — it offers wherever the viewer
 * is not — so both variants built here point it at `/yours`.
 *
 * `/yours` is delivered by 005; the link targets a placeholder route so it
 * never 404s from this feature.
 */
export function AppHeader({ variant = 'default', productName = PRODUCT_NAME }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <span className={styles.left}>{variant === 'default' ? productName : null}</span>
      <Link href="/yours" className={styles.right}>
        Yours
      </Link>
    </header>
  );
}
