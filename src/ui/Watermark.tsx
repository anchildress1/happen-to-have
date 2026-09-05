import styles from './Watermark.module.css';

export interface WatermarkProps {
  /** The Checking screen drops opacity to .05 so nothing competes with the blocking state. */
  dim?: boolean;
}

/**
 * Decorative "?" behind screen content. Purely visual: `aria-hidden` and
 * `pointer-events: none` so it is never announced and never intercepts a
 * tap or click. Positioned absolutely within `Screen`'s clipping container.
 */
export function Watermark({ dim = false }: WatermarkProps) {
  return (
    <span
      aria-hidden="true"
      className={[styles.watermark, dim ? styles.dim : ''].filter(Boolean).join(' ')}
    >
      ?
    </span>
  );
}
