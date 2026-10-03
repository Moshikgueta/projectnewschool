import 'server-only';
import { cookies, headers } from 'next/headers';
import { resolveLocale, type Locale } from '@/domain/i18n/locales';
import { getSessionUser } from '@/server/auth/session';

export const LOCALE_COOKIE = 'ns-locale';

/**
 * Interface language for this request: the signed-in user's profile setting,
 * else the language cookie (chosen on the sign-in page), else the browser's
 * preference, else Hebrew.
 */
export async function getRequestLocale(): Promise<Locale> {
  const [user, cookieStore, headerList] = await Promise.all([
    getSessionUser(),
    cookies(),
    headers(),
  ]);
  return resolveLocale({
    preferred: user?.uiLocale ?? cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerList.get('accept-language'),
  });
}
