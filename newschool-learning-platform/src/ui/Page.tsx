import type { ReactNode } from 'react';

/** Page heading with an optional supporting line. One per page. */
export function PageTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight text-balance text-fg sm:text-3xl">
        {children}
      </h1>
      {subtitle ? <p className="text-fg-secondary">{subtitle}</p> : null}
    </div>
  );
}

/** A titled section of a page; the heading level is fixed so outlines stay correct. */
export function Section({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold text-fg">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
      <p className="font-medium text-fg">{title}</p>
      {children ? <div className="mt-1 text-[0.9375rem] text-muted">{children}</div> : null}
    </div>
  );
}

export function ErrorState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-error/30 bg-error-light px-6 py-8 text-center"
    >
      <p className="font-medium text-error-ink">{title}</p>
      {children ? <div className="mt-1 text-[0.9375rem] text-error-ink">{children}</div> : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-surface-secondary ${className}`}
    />
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
