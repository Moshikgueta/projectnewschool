import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { withdrawFeedback } from '@/server/actions/staff';
import { requireArea } from '@/server/auth/session';
import { listFeedback, listMyStudents, listPlannerGroups } from '@/server/queries/staff';
import { ButtonLink } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { FeedbackBadges } from '@/app/_staff/FeedbackBadges';
import { FeedbackForm } from './FeedbackForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('staff.feedback'))('title') };
}

const QUIET_BUTTON =
  'min-h-11 px-2 text-sm font-medium text-muted underline-offset-4 hover:text-fg hover:underline';

export default async function TeacherFeedbackPage() {
  const user = await requireArea('teach');
  const [students, groups, all, t, tt, format] = await Promise.all([
    listMyStudents(user.id),
    listPlannerGroups(user.id),
    listFeedback(),
    getTranslations('staff.feedback'),
    getTranslations('staff.tools'),
    getFormatter(),
  ]);
  // A teacher who is also the manager reads everyone's here too; this page
  // lists only what they sent.
  const mine = all.filter((f) => f.authorId === user.id);
  const languages = [...new Set(groups.map((g) => g.languageCode.split('-')[0] ?? ''))].filter(
    (c) => /^[a-z]{2,3}$/.test(c),
  );
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', timeZone: user.timezone });

  return (
    <div className="flex flex-col gap-6">
      <ButtonLink href="/teach/tools" variant="tertiary" className="self-start">
        {tt('title')}
      </ButtonLink>
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <div className="grid gap-10 lg:grid-cols-2">
        <Card>
          <FeedbackForm students={students} languages={languages} />
        </Card>
        <Section id="my-feedback-heading" title={t('mine')}>
          {mine.length === 0 ? (
            <Card>
              <p className="text-fg-secondary">{t('empty')}</p>
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {mine.map((f) => (
                <li key={f.id}>
                  <Card className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <FeedbackBadges feedback={f} />
                      <form action={withdrawFeedback}>
                        <input type="hidden" name="id" value={f.id} />
                        <button
                          type="submit"
                          className={QUIET_BUTTON}
                          aria-label={t('withdrawLabel', { date: date(f.createdAt) })}
                        >
                          {t('withdraw')}
                        </button>
                      </form>
                    </div>
                    <p dir="auto" className="whitespace-pre-line">
                      {f.body}
                    </p>
                    <p className="text-sm text-muted">
                      {date(f.createdAt)} · {f.handledAt ? t('handled') : t('open')}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
