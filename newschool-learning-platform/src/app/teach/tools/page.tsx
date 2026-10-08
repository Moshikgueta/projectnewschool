import type { Metadata, Route } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { CardLink } from '@/ui/Card';
import { PageTitle } from '@/ui/Page';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('staff.tools'))('title') };
}

export default async function ToolsPage() {
  await requireArea('teach');
  const t = await getTranslations('staff.tools');
  const tools = [
    ['lesson-plan', 'lessonPlan', 'lessonPlanBody'],
    ['feedback', 'feedback', 'feedbackBody'],
    ['resources', 'resources', 'resourcesBody'],
    ['tasks', 'tasks', 'tasksBody'],
  ] as const;
  return (
    <>
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <ul className="grid gap-4 sm:grid-cols-2">
        {tools.map(([path, title, body]) => (
          <li key={path}>
            <CardLink href={`/teach/tools/${path}` as Route}>
              <h2 className="text-lg font-semibold">{t(title)}</h2>
              <p className="mt-1 text-[0.9375rem] text-fg-secondary">{t(body)}</p>
            </CardLink>
          </li>
        ))}
      </ul>
    </>
  );
}
