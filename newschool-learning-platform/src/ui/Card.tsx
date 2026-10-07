import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

const BASE = 'rounded-lg border border-border bg-surface p-5';

/** A discrete item (course, activity, metric). Not for page layout. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`${BASE} ${className}`}>{children}</div>;
}

/** A card that is one link. Keeps a visible focus ring and a hover cue. */
export function CardLink({
  href,
  children,
  className = '',
}: {
  href: Route;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`${BASE} block transition-colors hover:border-primary hover:bg-primary-light ${className}`}
    >
      {children}
    </Link>
  );
}

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'error';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-secondary text-fg-secondary',
  brand: 'bg-primary-light text-primary',
  success: 'bg-success-light text-success-ink',
  warning: 'bg-warning-light text-warning-ink',
  error: 'bg-error-light text-error-ink',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.8125rem] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Identifies a course language without a per-language colour scheme
 * (DESIGN-SYSTEM.md §6): the code, in neutral brand styling.
 */
export function LanguageChip({ code, name }: { code: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.9375rem] text-fg-secondary">
      <span
        aria-hidden="true"
        className="rounded-sm border border-border-strong px-1.5 font-mono text-xs font-semibold tracking-wide text-fg uppercase"
      >
        {code}
      </span>
      <span lang={code}>{name}</span>
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter((part) => /^\p{L}/u.test(part))
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '·';
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-9 items-center justify-center rounded-full bg-primary-light text-sm font-semibold text-primary"
    >
      {initials}
    </span>
  );
}
