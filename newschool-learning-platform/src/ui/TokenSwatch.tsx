'use client';

import { useSyncExternalStore } from 'react';

const noSubscription = () => () => {};

/** Shows a colour token and its current value, read from the live stylesheet. */
export function TokenSwatch({ token }: { token: string }) {
  const value = useSyncExternalStore(
    noSubscription,
    () => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    () => '',
  );
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="size-10 shrink-0 rounded-md border border-border"
        style={{ background: `var(${token})` }}
      />
      <span className="flex min-w-0 flex-col">
        <code className="truncate text-sm text-fg">{token}</code>
        <code className="text-xs text-muted">{value || '…'}</code>
      </span>
    </div>
  );
}
