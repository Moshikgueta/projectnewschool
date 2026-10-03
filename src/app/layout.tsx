import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'New School', template: '%s · New School' },
  description: 'New School learning platform',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Every page is rendered per request so it carries that request's CSP nonce
// (src/proxy.ts). A statically prerendered page would have scripts without a
// nonce, which the policy blocks.
export const dynamic = 'force-dynamic';

// UI language and direction become per-user in Phase 2 (next-intl, he + en).
// Content direction is set per block, independently (ADR-009).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
