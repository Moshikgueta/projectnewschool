import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { languageName } from '@/domain/i18n/text';
import { requireArea } from '@/server/auth/session';
import { listCoursesForManager } from '@/server/queries/manage';
import { Badge, LanguageChip } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('manage'))('title') };
}

export default async function ManageHome() {
  await requireArea('manage');
  const [courses, t, locale] = await Promise.all([
    listCoursesForManager(),
    getTranslations('manage'),
    getLocale(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <Section id="courses-heading" title={t('courses.title')}>
        <p className="text-[0.9375rem] text-muted">{t('courses.contentNote')}</p>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[0.9375rem]">
            <thead className="bg-surface-secondary text-sm text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  {t('courses.colCourse')}
                </th>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  {t('courses.colLevel')}
                </th>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  {t('courses.colStatus')}
                </th>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  {t('courses.colGroups')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {courses.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-medium" lang={c.languageCode}>
                    {c.title}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <LanguageChip
                        code={c.languageCode}
                        name={languageName(c.languageCode, locale, c.languageName)}
                      />
                      <span>{c.levelTitle}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={c.status === 'published' ? 'success' : 'neutral'}>
                      {t(`courses.status.${c.status}`)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{c.groupCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
