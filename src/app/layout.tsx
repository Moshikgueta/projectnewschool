import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { directionOf } from '@/domain/i18n/locales';
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

// The interface language and direction follow the user (src/i18n/request.ts).
// Course content sets its own language and direction per block (ADR-009).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
