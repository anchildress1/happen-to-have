import Link from 'next/link';
import styles from './AppHeader.module.css';

type AppHeaderVariant = 'arrival-mobile' | 'default';

export interface AppHeaderProps {
  /** `arrival-mobile` drops the product name; that screen's H1 already carries it. */
  variant?: AppHeaderVariant;
  productName?: string;
}

const PRODUCT_NAME = 'Happen to Have?';

/** Shared product header. `/yours` is a placeholder route until 005 delivers it. */
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
