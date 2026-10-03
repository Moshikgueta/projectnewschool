import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { homeAreaFor } from '@/domain/auth/access';
import { signOut } from '@/server/actions/auth';
import { setInterfaceLanguage } from '@/server/actions/preferences';
import { getSessionUser } from '@/server/auth/session';
import { AuthFrame } from '@/ui/AuthFrame';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const area = homeAreaFor(user.roles);
  if (area) redirect(`/${area}`);

  const t = await getTranslations();
  return (
    <AuthFrame languageAction={setInterfaceLanguage}>
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{t('auth.noAccess.title')}</h1>
        <p className="text-fg-secondary">{t('auth.noAccess.body')}</p>
        <form action={signOut}>
          <button type="submit" className="min-h-11 font-medium text-primary hover:underline">
            {t('common.signOut')}
          </button>
        </form>
      </div>
    </AuthFrame>
  );
}
