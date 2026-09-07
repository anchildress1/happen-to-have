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
 * Shared product header. The product name is the way back to the opening screen.
 *
 * The name is a link rather than inert text: it is the only element on every screen that reads
 * as "home", and a wordmark that looks like a title but does nothing is a dead end on a phone,
 * where there is no other route back. `arrival-mobile` still renders no name — that screen's own
 * H1 carries it, and linking a screen to itself is noise.
 *
 * Neither link prefetches. This header renders on every screen, so the default would pull the
 * route chunks for `/` and `/yours` on every page a participant lands on — bandwidth spent on a
 * phone, which is the target platform, for two destinations most visits never take. It also
 * restores a real invariant: skipping is tab-local (FR-020, FR-022, FR-023), and a prefetch
 * triggered by rendering the header made "skipping issues zero network requests" false.
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
      {variant === 'default' ? (
        <Link className={styles.left} href="/" prefetch={false}>
          {productName}
        </Link>
      ) : (
        <span className={styles.left} />
      )}
      <Link className={styles.right} href="/yours" prefetch={false}>
        {copy.nav.yours}
      </Link>
    </header>
  );
}
