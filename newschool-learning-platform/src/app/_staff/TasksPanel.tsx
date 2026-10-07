import { getFormatter, getTranslations } from 'next-intl/server';
import { removeTask, setTaskStatus } from '@/server/actions/staff';
import type { SessionUser } from '@/server/auth/session';
import { listTasks, type Task } from '@/server/queries/staff';
import { Badge, Card } from '@/ui/Card';
import { Section } from '@/ui/Page';
import { TaskForm } from './TaskForm';

const QUIET_BUTTON =
  'min-h-11 px-2 text-sm font-medium text-primary underline-offset-4 hover:underline';

/**
 * Tasks for the pedagogical manager (from the staff room's "משימות למושיק"),
 * the same panel in the teacher, office and manager areas. The area is sent
 * with every action so that area's guard (and MFA) applies.
 */
export async function TasksPanel({
  user,
  area,
}: {
  user: SessionUser;
  area: 'teach' | 'office' | 'manage';
}) {
  const [{ tasks, assignees }, t, format] = await Promise.all([
    listTasks(user.id, user.displayName),
    getTranslations('staff.tasks'),
    getFormatter(),
  ]);
  const isManager = assignees.some((a) => a.id === user.id);
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', timeZone: user.timezone });
  const open = tasks.filter((x) => x.status === 'open');
  const done = tasks.filter((x) => x.status === 'done');

  const row = (task: Task) => {
    const mine = task.assigneeId === user.id;
    return (
      <li key={task.id} className="flex flex-col gap-1 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium">
              <bdi>{task.title}</bdi>{' '}
              {task.priority === 'urgent' ? <Badge tone="error">{t('urgent')}</Badge> : null}
            </p>
            {task.note ? <p className="text-sm text-fg-secondary">{task.note}</p> : null}
            <p className="text-sm text-muted">
              {t('fromTo', { from: task.senderName, to: task.assigneeName })} ·{' '}
              {when(task.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {mine ? (
              <form action={setTaskStatus}>
                <input type="hidden" name="area" value={area} />
                <input type="hidden" name="id" value={task.id} />
                <input
                  type="hidden"
                  name="status"
                  value={task.status === 'open' ? 'done' : 'open'}
                />
                <button
                  type="submit"
                  className={QUIET_BUTTON}
                  aria-label={
                    task.status === 'open'
                      ? t('markDoneLabel', { title: task.title })
                      : t('reopenLabel', { title: task.title })
                  }
                >
                  {task.status === 'open' ? t('markDone') : t('reopen')}
                </button>
              </form>
            ) : null}
            <form action={removeTask}>
              <input type="hidden" name="area" value={area} />
              <input type="hidden" name="id" value={task.id} />
              <button
                type="submit"
                className={QUIET_BUTTON}
                aria-label={t('removeLabel', { title: task.title })}
              >
                {t('remove')}
              </button>
            </form>
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-10">
        <Section id="open-tasks-heading" title={t('open', { count: open.length })}>
          <Card>
            {open.length ? (
              <ul className="flex flex-col divide-y divide-border">{open.map(row)}</ul>
            ) : (
              <p className="text-fg-secondary">{t('empty')}</p>
            )}
          </Card>
        </Section>
        <Section id="done-tasks-heading" title={t('done', { count: done.length })}>
          <Card>
            {done.length ? (
              <ul className="flex flex-col divide-y divide-border">{done.map(row)}</ul>
            ) : (
              <p className="text-fg-secondary">{t('empty')}</p>
            )}
          </Card>
        </Section>
      </div>
      <Section id="new-task-heading" title={t('new')}>
        <Card>
          {assignees.length ? (
            <TaskForm
              area={area}
              assignees={assignees.map((a) => (a.id === user.id ? { ...a, name: t('myself') } : a))}
              defaultAssignee={isManager ? user.id : (assignees[0]?.id ?? '')}
            />
          ) : (
            <p className="text-fg-secondary">{t('noManager')}</p>
          )}
        </Card>
      </Section>
    </div>
  );
}
