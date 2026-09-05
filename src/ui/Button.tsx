import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is the one forward action; `ghost` is secondary and dismissive. */
  variant?: ButtonVariant;
}

/**
 * The product's only two button variants (design.md's third, `muted`, belongs
 * to a later spec and is not built here). Uses `all: unset` per the source
 * design, so it defines its own visible `:focus-visible` ring rather than
 * relying on the outline that reset strips.
 */
export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  const variantClass = variant === 'ghost' ? styles.ghost : styles.primary;

  return (
    <button
      {...props}
      className={[styles.button, variantClass, className].filter(Boolean).join(' ')}
    />
  );
}
