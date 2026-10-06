import type { Metadata } from 'next';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { FeedbackBadges } from '@/app/_staff/FeedbackBadges';
import { markFeedbackHandled } from '@/server/actions/staff';
import { requireArea } from '@/server/auth/session';
import { listFeedback } from '@/server/queries/staff';
import { Badge, Card } from '@/ui/Card';
import { EmptyState, PageTitle, Section } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('staff.feedback'))('manageTitle') };
}

const QUIET_BUTTON =
  'min-h-11 px-2 text-sm font-medium text-primary underline-offset-4 hover:underline';

export default async function ManagerFeedbackPage() {
  const user = await requireArea('manage');
  const [feedback, t, format, locale] = await Promise.all([
    listFeedback(),
    getTranslations('staff.feedback'),
    getFormatter(),
    getLocale(),
  ]);
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', timeZone: user.timezone });
  const names = new Intl.DisplayNames([locale], { type: 'language' });

  // "Missing material in group classes": requests grouped by what, language and level.
  const missing = new Map<
    string,
    { gap: string; language: string | null; level: number | null; count: number }
  >();
  for (const f of feedback) {
    if (f.kind !== 'missing_material' || f.handledAt) continue;
    const key = `${f.subject}|${f.languageCode ?? ''}|${f.level ?? ''}`;
    const row = missing.get(key) ?? {
      gap: f.subject,
      language: f.languageCode,
      level: f.level,
      count: 0,
    };
    row.count++;
    missing.set(key, row);
  }
  const ordered = [...feedback].sort(
    (a, b) =>
      Number(!!a.handledAt) - Number(!!b.handledAt) || b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageTitle subtitle={t('manageSubtitle')}>{t('manageTitle')}</PageTitle>
      <Section id="missing-heading" title={t('missing')}>
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t('missingHint')}</p>
          {missing.size === 0 ? (
            <p className="text-fg-secondary">{t('missingEmpty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {[...missing.values()]
                .sort((a, b) => b.count - a.count)
                .map((m) => (
                  <li
                    key={`${m.gap}${m.language}${m.level}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t(`gaps.${m.gap as 'listening'}`)}</span>
                      {m.language ? <Badge>{names.of(m.language) ?? m.language}</Badge> : null}
                      {m.level ? <Badge>{t('levelOption', { n: m.level })}</Badge> : null}
                    </span>
                    <span className="text-sm text-fg-secondary">
                      {t('count', { count: m.count })}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section id="all-feedback-heading" title={t('all')}>
        {ordered.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {ordered.map((f) => (
              <li key={f.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <FeedbackBadges feedback={f} />
                    {f.handledAt ? (
                      <Badge tone="success">{t('handled')}</Badge>
                    ) : (
                      <form action={markFeedbackHandled}>
                        <input type="hidden" name="id" value={f.id} />
                        <button
                          type="submit"
                          className={QUIET_BUTTON}
                          aria-label={t('markHandledLabel', {
                            name: f.authorName,
                            date: date(f.createdAt),
                          })}
                        >
                          {t('markHandled')}
                        </button>
                      </form>
                    )}
                  </div>
                  <p dir="auto" className="whitespace-pre-line">
                    {f.body}
                  </p>
                  <p className="text-sm text-muted">
                    {t('from', { name: f.authorName })} · {date(f.createdAt)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
