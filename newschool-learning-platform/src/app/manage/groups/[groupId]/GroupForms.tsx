'use client';

import { useTranslations } from 'next-intl';
import {
  addTeacher,
  enrollStudent,
  removeTeacher,
  setCycleState,
  setEnrollmentStatus,
  updateGroup,
} from '@/server/actions/manage';
import { Button } from '@/ui/Button';
import { Badge } from '@/ui/Card';
import { SelectField } from '@/ui/SelectField';
import { TextField } from '@/ui/TextField';
import { ActionForm } from '../../ActionForm';

const GROUP_STATUSES = ['planned', 'active', 'finished', 'archived'] as const;
const ENROLLMENT_STATUSES = ['active', 'paused', 'completed', 'withdrawn'] as const;
const CYCLE_STATES = ['upcoming', 'active', 'completed'] as const;

type Person = { id: string; name: string };

export function DetailsForm({
  group,
}: {
  group: {
    id: string;
    name: string;
    status: (typeof GROUP_STATUSES)[number];
    scheduleNote: string;
  };
}) {
  const t = useTranslations('manage');
  return (
    <ActionForm action={updateGroup} hidden={{ groupId: group.id }}>
      {(pending) => (
        <>
          <TextField
            id="group-name"
            name="name"
            label={t('groups.name')}
            defaultValue={group.name}
            required
          />
          <SelectField
            id="group-status"
            name="status"
            label={t('group.status')}
            defaultValue={group.status}
            options={GROUP_STATUSES.map((s) => ({ value: s, label: t(`groups.status.${s}`) }))}
          />
          <TextField
            id="group-schedule"
            name="scheduleNote"
            label={t('groups.schedule')}
            hint={t('groups.scheduleHint')}
            defaultValue={group.scheduleNote}
          />
          <Button type="submit" loading={pending} className="self-start">
            {t('group.save')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function TeacherForms({
  groupId,
  assigned,
  candidates,
}: {
  groupId: string;
  assigned: Person[];
  candidates: Person[];
}) {
  const t = useTranslations('manage.group');
  return (
    <div className="flex flex-col gap-5">
      {assigned.length === 0 ? (
        <p className="text-fg-secondary">{t('noTeachers')}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t('teachers')}>
          {assigned.map((teacher) => (
            <li key={teacher.id}>
              <ActionForm
                action={removeTeacher}
                hidden={{ groupId, teacherId: teacher.id }}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                {(pending) => (
                  <>
                    <span>{teacher.name}</span>
                    <Button
                      type="submit"
                      variant="tertiary"
                      loading={pending}
                      aria-label={t('removeLabel', { name: teacher.name })}
                    >
                      {t('remove')}
                    </Button>
                  </>
                )}
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 ? (
        <ActionForm
          action={addTeacher}
          hidden={{ groupId }}
          className="flex flex-wrap items-end gap-3"
        >
          {(pending) => (
            <>
              <SelectField
                id="teacher-select"
                name="teacherId"
                label={t('teacher')}
                options={candidates.map((p) => ({ value: p.id, label: p.name }))}
                className="min-w-48 flex-1"
              />
              <Button type="submit" variant="secondary" loading={pending}>
                {t('addTeacher')}
              </Button>
            </>
          )}
        </ActionForm>
      ) : null}
    </div>
  );
}

export function EnrollForm({ groupId, candidates }: { groupId: string; candidates: Person[] }) {
  const t = useTranslations('manage.group');
  if (candidates.length === 0) return <p className="text-sm text-muted">{t('noCandidates')}</p>;
  return (
    <ActionForm
      action={enrollStudent}
      hidden={{ groupId }}
      className="flex flex-wrap items-end gap-3"
    >
      {(pending) => (
        <>
          <SelectField
            id="student-select"
            name="studentId"
            label={t('student')}
            options={candidates.map((p) => ({ value: p.id, label: p.name }))}
            className="min-w-48 flex-1"
          />
          <Button type="submit" loading={pending}>
            {t('enroll')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function EnrollmentRow({
  groupId,
  enrollment,
}: {
  groupId: string;
  enrollment: { id: string; name: string; status: (typeof ENROLLMENT_STATUSES)[number] };
}) {
  const t = useTranslations('manage.group');
  return (
    <ActionForm
      action={setEnrollmentStatus}
      hidden={{ groupId, enrollmentId: enrollment.id }}
      className="flex flex-wrap items-end justify-between gap-3"
    >
      {(pending) => (
        <>
          <span className="flex items-center gap-3 self-center">
            <span>{enrollment.name}</span>
            <Badge tone={enrollment.status === 'active' ? 'success' : 'neutral'}>
              {t(`enrollment.${enrollment.status}`)}
            </Badge>
          </span>
          <span className="flex items-end gap-2">
            <SelectField
              id={`enrollment-${enrollment.id}`}
              name="status"
              label={t('enrollmentStatus', { name: enrollment.name })}
              hideLabel
              defaultValue={enrollment.status}
              options={ENROLLMENT_STATUSES.map((s) => ({ value: s, label: t(`enrollment.${s}`) }))}
            />
            <Button type="submit" variant="secondary" loading={pending}>
              {t('update')}
            </Button>
          </span>
        </>
      )}
    </ActionForm>
  );
}

export function CyclesForm({
  groupId,
  courseId,
  cycle,
}: {
  groupId: string;
  courseId: string;
  cycle: {
    id: string;
    title: string;
    position: number;
    published: boolean;
    state: (typeof CYCLE_STATES)[number] | null;
  };
}) {
  const t = useTranslations('manage.group');
  return (
    <ActionForm
      action={setCycleState}
      hidden={{ groupId, courseId, cycleId: cycle.id, position: String(cycle.position) }}
      className="flex flex-wrap items-end justify-between gap-3"
    >
      {(pending) => (
        <>
          <span className="flex flex-wrap items-center gap-3 self-center">
            <span className="font-medium">{cycle.title}</span>
            {cycle.published ? null : <Badge tone="warning">{t('unpublished')}</Badge>}
            {cycle.state === 'active' ? <Badge tone="brand">{t('state.active')}</Badge> : null}
          </span>
          <span className="flex items-end gap-2">
            <SelectField
              id={`cycle-${cycle.id}`}
              name="state"
              label={t('cycleState', { title: cycle.title })}
              hideLabel
              defaultValue={cycle.state ?? 'upcoming'}
              options={CYCLE_STATES.map((s) => ({ value: s, label: t(`state.${s}`) }))}
            />
            <Button type="submit" variant="secondary" loading={pending}>
              {t('update')}
            </Button>
          </span>
        </>
      )}
    </ActionForm>
  );
}
