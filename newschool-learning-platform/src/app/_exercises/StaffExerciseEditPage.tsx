import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ActivityEditor } from '@/app/manage/content/activities/[activityId]/ActivityEditor';
import type { EditorState } from '@/server/actions/cms';
import type { ManageState } from '@/server/actions/manage';
import type { SessionUser } from '@/server/auth/session';
import { getStaffExerciseForEdit, type StaffArea } from '@/server/queries/staff-exercises';
import { Button, ButtonLink } from '@/ui/Button';
import { Badge, Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { AssignExerciseForm, ExerciseDetailsForm } from './ExerciseForms';

export type StaffExerciseActions = {
  saveMeta: (prev: ManageState, formData: FormData) => Promise<ManageState>;
  saveContent: (prev: EditorState, formData: FormData) => Promise<EditorState>;
  setStatus: (formData: FormData) => Promise<void>;
  assign: (prev: ManageState, formData: FormData) => Promise<ManageState>;
  removeAssignment: (formData: FormData) => Promise<void>;
};

const QUIET_BUTTON =
  'min-h-11 px-2 text-sm font-medium text-muted underline-offset-4 hover:text-fg hover:underline';

/**
 * One exercise written by a teacher or the office: details, status, the
 * question editor (the manager's, with this area's save), and the groups it
 * is assigned to. Anything the caller may not edit here is "not found".
 */
export async function StaffExerciseEditPage({
  area,
  user,
  activityId,
  actions,
}: {
  area: StaffArea;
  user: SessionUser;
  activityId: string;
  actions: StaffExerciseActions;
}) {
  const exercise = await getStaffExerciseForEdit(area, user, activityId);
  if (!exercise) notFound();
  const [t, tl, ta, tc, format] = await Promise.all([
    getTranslations('exercises.edit'),
    getTranslations('exercises.list'),
    getTranslations('cms.activity'),
    getTranslations('cms'),
    getFormatter(),
  ]);
  const answeredItems = Object.values(exercise.answered).filter((n) => n > 0).length;
  const statusButtons: { status: 'draft' | 'published' | 'archived'; label: string }[] =
    exercise.status === 'published'
      ? [
          { status: 'draft', label: t('unpublish') },
          { status: 'archived', label: t('archive') },
        ]
      : exercise.status === 'archived'
        ? [{ status: 'draft', label: t('restore') }]
        : [
            { status: 'published', label: t('publish') },
            { status: 'archived', label: t('archive') },
          ];

  return (
    <div className="flex flex-col gap-8">
      <ButtonLink href={`/${area}/exercises` as Route} variant="tertiary" className="self-start">
        {t('back', { list: tl(area === 'teach' ? 'titleTeach' : 'titleOffice') })}
      </ButtonLink>
      <PageTitle subtitle={`${exercise.courseTitle} · ${exercise.cycleTitle}`}>
        <bdi dir="auto">{exercise.title}</bdi>
      </PageTitle>

      <Section
        id="exercise-status-heading"
        title={t('statusTitle')}
        action={
          <Badge tone={exercise.status === 'published' ? 'success' : 'neutral'}>
            {tc(`status.${exercise.status}`)}
          </Badge>
        }
      >
        <Card className="flex flex-col gap-3">
          <p className="text-fg-secondary">
            {t(
              exercise.status === 'published'
                ? 'statusPublished'
                : exercise.status === 'archived'
                  ? 'statusArchived'
                  : 'statusDraft',
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {statusButtons.map((b, i) => (
              <form key={b.status} action={actions.setStatus}>
                <input type="hidden" name="activityId" value={exercise.id} />
                <input type="hidden" name="status" value={b.status} />
                <Button type="submit" variant={i === 0 ? 'primary' : 'secondary'}>
                  {b.label}
                </Button>
              </form>
            ))}
          </div>
        </Card>
      </Section>

      <Section id="exercise-assign-heading" title={t('assignTitle')}>
        <Card className="flex flex-col gap-4">
          {exercise.assignments.length === 0 ? (
            <p className="text-fg-secondary">{t('noAssignments')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {exercise.assignments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">{a.groupName}</p>
                    <p className="text-sm text-muted">
                      {a.dueAt
                        ? t('due', {
                            date: format.dateTime(new Date(a.dueAt), {
                              day: 'numeric',
                              month: 'short',
                              timeZone: user.timezone,
                            }),
                          })
                        : t('noDue')}
                      {a.note ? ` · ${a.note}` : ''}
                    </p>
                    {a.recipients ? (
                      <p className="text-sm text-fg-secondary">
                        {a.recipients.length
                          ? t('forStudents', { names: a.recipients.join(', ') })
                          : t('forSelected')}
                      </p>
                    ) : null}
                  </div>
                  {a.canRemove ? (
                    <form action={actions.removeAssignment}>
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <input type="hidden" name="groupId" value={a.groupId} />
                      <input type="hidden" name="activityId" value={exercise.id} />
                      <button
                        type="submit"
                        className={QUIET_BUTTON}
                        aria-label={t('removeLabel', { group: a.groupName })}
                      >
                        {t('remove')}
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {exercise.status !== 'published' ? (
            <p className="rounded-md bg-info-light px-4 py-3 text-[0.9375rem] text-info-ink">
              {t('publishFirst')}
            </p>
          ) : exercise.groups.length === 0 ? (
            <p className="text-fg-secondary">{t('noGroups')}</p>
          ) : (
            <>
              <p className="text-sm text-muted">{t('assignHint')}</p>
              <AssignExerciseForm
                action={actions.assign}
                activityId={exercise.id}
                groups={exercise.groups}
              />
            </>
          )}
        </Card>
      </Section>

      <Section id="activity-details-heading" title={t('details')}>
        <Card>
          <ExerciseDetailsForm
            action={actions.saveMeta}
            activityId={exercise.id}
            title={exercise.title}
            phase={exercise.phase}
            scoring={exercise.scoring}
            minutes={exercise.minutes}
          />
        </Card>
      </Section>

      <Section id="activity-content-heading" title={ta('questions')}>
        {exercise.status === 'published' ? (
          <p className="rounded-md bg-warning-light px-4 py-3 text-[0.9375rem] text-warning-ink">
            {ta('publishedWarning')}
          </p>
        ) : null}
        {answeredItems ? (
          <p className="rounded-md bg-info-light px-4 py-3 text-[0.9375rem] text-info-ink">
            {ta('answeredNote', { count: answeredItems })}
          </p>
        ) : null}
        <ActivityEditor
          activityId={exercise.id}
          activitySlug={exercise.slug}
          updatedAt={exercise.updatedAt}
          yaml={exercise.yaml}
          courseLang={exercise.courseLang}
          answered={exercise.answered}
          saveAction={actions.saveContent}
        />
      </Section>
    </div>
  );
}
