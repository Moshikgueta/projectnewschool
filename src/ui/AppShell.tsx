import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { Logo } from './Logo';

type NavItem = { href: Route; label: string };

type Props = {
  areaLabel: string;
  userName: string;
  nav: NavItem[];
  signOutAction: () => Promise<void>;
  children: ReactNode;
};

/**
 * Phase 1 shell shared by every signed-in area. Phase 2 replaces it with the
 * full design-system shell (side rail on desktop, bottom tab bar on mobile).
 */
export function AppShell({ areaLabel, userName, nav, signOutAction, children }: Props) {
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Logo />
          <span className="text-sm text-muted">{areaLabel}</span>
          <nav aria-label="Main" className="flex flex-wrap gap-4">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[0.9375rem] text-fg-secondary hover:text-fg"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-4">
            <span className="text-sm text-fg-secondary">{userName}</span>
            <form action={signOutAction}>
              <button type="submit" className="text-sm font-medium text-primary hover:underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}

export function PageTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight text-fg text-balance">{children}</h1>
      {subtitle ? <p className="text-fg-secondary">{subtitle}</p> : null}
    </div>
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
