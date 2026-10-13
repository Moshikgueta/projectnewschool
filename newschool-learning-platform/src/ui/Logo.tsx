/**
 * The one place the New School logo is rendered (DESIGN-SYSTEM.md §5).
 *
 * PLACEHOLDER: no official logo file exists yet (brand/README.md). Until it does,
 * this renders the school's name as plain text in the UI font — it is NOT a
 * redraw or imitation of the logo. Replace the body with the official SVG
 * (horizontal / mark variants) when the files arrive; callers don't change.
 */
export function Logo({ variant = 'horizontal' }: { variant?: 'horizontal' | 'mark' }) {
  return (
    <span
      className="inline-flex items-center font-semibold tracking-tight text-fg"
      data-logo-placeholder
    >
      {variant === 'mark' ? 'NS' : 'New School'}
    </span>
  );
}
