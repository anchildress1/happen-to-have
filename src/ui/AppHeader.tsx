import Link from 'next/link';
import { copy } from '../copy';
import styles from './AppHeader.module.css';

type AppHeaderVariant = 'arrival-mobile' | 'default';

export interface AppHeaderProps {
  /** `arrival-mobile` drops the product name; that screen's H1 already carries it. */
  variant?: AppHeaderVariant;
  productName?: string;
}

/**
 * Shared product header.
 *
 * Both strings come from `copy` rather than from literals here. They were duplicated while
 * `/yours` was a placeholder and nothing depended on them agreeing; now that 005 renders
 * `copy.nav.yours` as the page's own H1, a second copy of that word is the one string
 * guaranteed to drift — and the product name has carried a question mark that is part of the
 * name since Principle VII, which is not a thing to keep two of.
 */
export function AppHeader({
  variant = 'default',
  productName = copy.product.name,
}: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <span className={styles.left}>{variant === 'default' ? productName : null}</span>
      <Link href="/yours" className={styles.right}>
        {copy.nav.yours}
      </Link>
    </header>
  );
}
