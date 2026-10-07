import type { ReactNode } from 'react';

/**
 * Accessible progress bar. The fill grows from the start edge, so it runs
 * right-to-left in Hebrew and Arabic automatically.
 */
export function ProgressBar({
  value,
  label,
  valueText,
}: {
  value: number;
  label: string;
  valueText?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-secondary"
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** One calm metric: a label, a value, and optionally a bar. */
export function Stat({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="flex flex-col gap-2">
        <span className="text-2xl font-semibold text-fg tabular-nums">{value}</span>
        {children}
      </dd>
    </div>
  );
}
