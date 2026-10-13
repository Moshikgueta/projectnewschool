import { getRequestConfig } from 'next-intl/server';
import { getRequestLocale } from '@/server/i18n/locale';

// next-intl without locale-prefixed URLs: an authenticated app needs no
// /he/… or /en/… routes, so the locale comes from the user (see locale.ts).
export default getRequestConfig(async () => {
  const locale = await getRequestLocale();
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
    timeZone: 'Asia/Jerusalem',
  };
});
