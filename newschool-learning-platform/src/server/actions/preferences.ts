'use server';

import type { Route } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/domain/auth/access';
import { isLocale } from '@/domain/i18n/locales';
import { getSessionUser } from '@/server/auth/session';
import { LOCALE_COOKIE } from '@/server/i18n/locale';
import { createSupabaseServerClient } from '@/server/supabase/server';

/**
 * Change the interface language. Signed-in users have it saved on their
 * profile (RLS allows updating only their own row and only these columns);
 * everyone also gets a cookie so the sign-in page follows the choice.
 */
export async function setInterfaceLanguage(formData: FormData): Promise<void> {
  const locale = formData.get('locale');
  const back = safeNextPath(String(formData.get('back') ?? '/'), '/');
  if (!isLocale(locale)) redirect(back as Route);

  const user = await getSessionUser();
  if (user) {
    const supabase = await createSupabaseServerClient();
    await supabase.from('profiles').update({ ui_locale: locale }).eq('id', user.id);
  }

  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect(back as Route); // safeNextPath: same-site paths only
}
