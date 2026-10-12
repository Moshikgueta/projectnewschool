import type { Route } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ManageState } from '@/server/actions/manage';
import type { SessionUser } from '@/server/auth/session';
import {
  getAuthoringOptions,
  listStaffExercises,
  type StaffArea,
} from '@/server/queries/staff-exercises';
import { Badge, Card, CardLink } from '@/ui/Card';
import { EmptyState, PageTitle, Section } from '@/ui/Page';
import { NewExerciseForm } from './ExerciseForms';

const STATUS_TONE = {
  draft: 'neutral',
  in_review: 'warning',
  published: 'success',
  archived: 'neutral',
} as const;

/** "My exercises" (teachers) or "Exercises" (office): the list and a new-exercise form. */
export async function StaffExercisesPage({
  area,
  user,
  createAction,
}: {
  area: StaffArea;
  user: SessionUser;
  createAction: (prev: ManageState, formData: FormData) => Promise<ManageState>;
}) {
  const [exercises, options, t, tc, format] = await Promise.all([
    listStaffExercises(area, user),
    getAuthoringOptions(area, user),
    getTranslations('exercises.list'),
    getTranslations('cms'),
    getFormatter(),
  ]);

  return (
    <>
      <PageTitle subtitle={t(area === 'teach' ? 'subtitleTeach' : 'subtitleOffice')}>
        {t(area === 'teach' ? 'titleTeach' : 'titleOffice')}
      </PageTitle>
      <div className="flex flex-col gap-10">
        <Section id="new-exercise-heading" title={t('newTitle')}>
          <Card>
            {options.cycles.length ? (
              <NewExerciseForm
                action={createAction}
                cycles={options.cycles}
                defaultCycleId={options.defaultCycleId}
              />
            ) : (
              <p className="text-fg-secondary">{t('noCycles')}</p>
            )}
          </Card>
        </Section>

        <Section id="exercises-heading" title={t('listTitle')}>
          {exercises.length === 0 ? (
            <EmptyState title={t('empty')}>{t('emptyHint')}</EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {exercises.map((e) => (
                <li key={e.id}>
                  <CardLink
                    href={`/${area}/exercises/${e.id}` as Route}
                    className="flex h-full flex-col gap-2"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-fg" dir="auto">
                        {e.title}
                      </span>
                      <Badge tone={STATUS_TONE[e.status]}>{tc(`status.${e.status}`)}</Badge>
                    </span>
                    <span className="text-sm text-fg-secondary">
                      {e.courseTitle} · {e.cycleTitle}
                    </span>
                    <span className="text-sm text-muted">
                      {t('updated', {
                        date: format.dateTime(new Date(e.updatedAt), {
                          day: 'numeric',
                          month: 'short',
                          timeZone: user.timezone,
                        }),
                      })}
                    </span>
                  </CardLink>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
