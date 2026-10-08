'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './icons';

export type NavItem = { href: Route; label: string; icon: IconName };

function isCurrent(pathname: string, href: string, isRoot: boolean) {
  return isRoot ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Area navigation. "rail" is the desktop side rail; "bar" is the mobile
 * bottom tab bar (thumb-reachable, ≥ 44 px targets, safe-area aware).
 */
export function NavLinks({
  items,
  variant,
  label,
}: {
  items: NavItem[];
  variant: 'rail' | 'bar';
  label: string;
}) {
  const pathname = usePathname();
  const root = items[0]?.href;

  if (variant === 'rail') {
    return (
      <nav aria-label={label}>
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const current = isCurrent(pathname, item.href, item.href === root);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                  className="flex min-h-11 items-center gap-3 rounded-md px-3 text-[0.9375rem] font-medium text-fg-secondary hover:bg-surface-secondary hover:text-fg aria-[current=page]:bg-primary-light aria-[current=page]:text-primary"
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const current = isCurrent(pathname, item.href, item.href === root);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[0.75rem] font-medium text-muted aria-[current=page]:text-primary"
              >
                <Icon name={item.icon} className="size-6" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
