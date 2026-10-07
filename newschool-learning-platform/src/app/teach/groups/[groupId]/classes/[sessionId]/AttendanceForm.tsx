'use client';

import { useTranslations } from 'next-intl';
import { ActionForm } from '@/app/manage/ActionForm';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from '@/domain/teaching/attendance';
import { saveAttendance } from '@/server/actions/teach';
import { Button } from '@/ui/Button';
import { Badge } from '@/ui/Card';

type Student = {
  id: string;
  name: string;
  enrolment: 'active' | 'paused';
  status: AttendanceStatus | null;
  note: string;
};

/** One row per student: four choices as a radio group, and an optional note. */
export function AttendanceForm({
  groupId,
  sessionId,
  students,
}: {
  groupId: string;
  sessionId: string;
  students: Student[];
}) {
  const t = useTranslations('teach.attendance');
  return (
    <ActionForm action={saveAttendance} hidden={{ groupId, sessionId }}>
      {(pending) => (
        <>
          <p className="text-sm text-fg-secondary">{t('hint')}</p>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            {students.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 px-4 py-4">
                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-3 flex items-center gap-2 font-medium">
                    <bdi>{s.name}</bdi>
                    {s.enrolment === 'paused' ? <Badge>{t('paused')}</Badge> : null}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {ATTENDANCE_STATUSES.map((status) => (
                      <label
                        key={status}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 text-[0.9375rem] has-checked:border-primary has-checked:bg-primary-light has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary"
                      >
                        <input
                          type="radio"
                          name={`status-${s.id}`}
                          value={status}
                          defaultChecked={s.status === status}
                          className="size-4 accent-primary"
                        />
                        {t(`status.${status}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="flex flex-col gap-1 text-sm text-fg-secondary">
                  <span className="sr-only">{t('noteFor', { name: s.name })}</span>
                  <input
                    name={`note-${s.id}`}
                    defaultValue={s.note}
                    maxLength={300}
                    placeholder={t('note')}
                    className="min-h-11 rounded-md border border-border-strong bg-surface px-3 text-base text-fg"
                  />
                </label>
              </li>
            ))}
          </ul>
          <Button type="submit" loading={pending} className="self-start">
            {t('save')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
