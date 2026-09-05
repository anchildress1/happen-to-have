import type { ReactNode } from 'react';
import styles from './Screen.module.css';

export interface ScreenProps {
  /** Typically an `AppHeader`. Always occupies the shell's header row, even when omitted. */
  header?: ReactNode;
  children: ReactNode;
  /**
   * Escape hatch for a screen with a bespoke desktop grid (design.md's
   * per-screen `Layout` table). Screens without one get the default
   * centered 560px column this component provides.
   */
  contentClassName?: string;
}

/**
 * Shared responsive screen shell. Mobile stacks header and content in a flex
 * column; desktop switches to `grid-template-rows: auto 1fr auto` at the
 * 768px breakpoint. `overflow: hidden` clips the decorative `Watermark`
 * without ever clipping content — content clips only if it overflows its
 * own box, which callers must avoid.
 */
export function Screen({ header, children, contentClassName }: ScreenProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>{header}</div>
      <div className={[styles.content, contentClassName].filter(Boolean).join(' ')}>{children}</div>
    </div>
  );
}
