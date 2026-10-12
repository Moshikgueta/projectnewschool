import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { homeAreaFor } from '@/domain/auth/access';
import { signOut } from '@/server/actions/auth';
import { setInterfaceLanguage } from '@/server/actions/preferences';
import { getSessionUser } from '@/server/auth/session';
import { AuthFrame } from '@/ui/AuthFrame';
import { ForwardArrow, Icon, type IconName } from '@/ui/icons';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.entry'))('metaTitle') };
}

const CHOICE =
  'flex min-h-24 items-center gap-4 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-primary hover:bg-primary-light';

function Choice({
  href,
  icon,
  title,
  hint,
}: {
  href: Route;
  icon: IconName;
  title: string;
  hint: string;
}) {
  return (
    <Link href={href} className={CHOICE}>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary">
        <Icon name={icon} className="size-7" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-lg font-semibold text-fg">{title}</span>
        <span className="text-[0.9375rem] text-fg-secondary">{hint}</span>
      </span>
      <ForwardArrow className="size-5 shrink-0 text-primary" />
    </Link>
  );
}

/**
 * One site for everyone. Signed out: the entry page, with the two ways in
 * (students with their entry code, staff with email and password). Signed
 * in: straight to the home area.
 */
export default async function Home() {
  const user = await getSessionUser();
  if (!user) {
    const t = await getTranslations('auth.entry');
    return (
      <AuthFrame languageAction={setInterfaceLanguage}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
            <p className="text-muted">{t('intro')}</p>
          </div>
          <ul className="flex flex-col gap-3">
            <li>
              <Choice
                href="/login/code"
                icon="student"
                title={t('student')}
                hint={t('studentHint')}
              />
            </li>
            <li>
              <Choice href="/login" icon="teach" title={t('staff')} hint={t('staffHint')} />
            </li>
          </ul>
          <p className="border-t border-border pt-6 text-[0.9375rem] text-muted">
            {t('studentEmail')}:{' '}
            <Link href="/login" className="font-medium text-primary hover:underline">
              {t('studentEmailLink')}
            </Link>
          </p>
        </div>
      </AuthFrame>
    );
  }

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
