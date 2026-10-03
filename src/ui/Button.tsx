import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'tertiary';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-on-brand hover:bg-primary-hover active:bg-primary-active disabled:hover:bg-primary',
  secondary:
    'bg-primary-light text-primary border border-primary hover:bg-surface-secondary active:bg-border',
  tertiary: 'text-primary underline-offset-4 hover:underline px-0',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
};

/** The three New School button variants (DESIGN-SYSTEM.md §7). */
export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-5 text-[0.9375rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}
