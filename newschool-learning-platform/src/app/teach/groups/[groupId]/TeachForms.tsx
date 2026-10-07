'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { ActionForm } from '@/app/manage/ActionForm';
import {
  assignActivity,
  issueStudentCode,
  scheduleClass,
  setActiveCycle,
  type CodeState,
} from '@/server/actions/teach';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { SelectField } from '@/ui/SelectField';
import { TextField } from '@/ui/TextField';

export function ActiveCycleForm({
  groupId,
  cycles,
  current,
}: {
  groupId: string;
  cycles: { id: string; title: string }[];
  current: string | null;
}) {
  const t = useTranslations('teach.group');
  return (
    <ActionForm action={setActiveCycle} hidden={{ groupId }} className="flex flex-col gap-3">
      {(pending) => (
        <>
          <SelectField
            id="active-cycle"
            name="cycleId"
            label={t('cycle')}
            defaultValue={current ?? cycles[0]?.id}
            options={cycles.map((c) => ({ value: c.id, label: c.title }))}
          />
          <p className="text-sm text-muted">{t('cycleHint')}</p>
          <Button type="submit" variant="secondary" loading={pending} className="self-start">
            {t('makeActive')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function ClassForm({ groupId }: { groupId: string }) {
  const t = useTranslations('teach.group');
  return (
    <ActionForm action={scheduleClass} hidden={{ groupId }} className="flex flex-col gap-3">
      {(pending) => (
        <>
          <TextField
            id="class-at"
            name="startsAt"
            type="datetime-local"
            label={t('classAt')}
            required
          />
          <Button type="submit" variant="secondary" loading={pending} className="self-start">
            {t('addClass')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function AssignForm({
  groupId,
  activities,
}: {
  groupId: string;
  activities: { id: string; label: string }[];
}) {
  const t = useTranslations('teach.group');
  return (
    <ActionForm action={assignActivity} hidden={{ groupId }} className="flex flex-col gap-3">
      {(pending) => (
        <>
          <SelectField
            id="assign-activity"
            name="activityId"
            label={t('activity')}
            options={activities.map((a) => ({ value: a.id, label: a.label }))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField id="assign-due" name="dueDate" type="date" label={t('dueDate')} />
            <TextField id="assign-note" name="note" label={t('note')} maxLength={1000} />
          </div>
          <Button type="submit" loading={pending} className="self-start">
            {t('assignButton')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

const noCode: CodeState = { status: 'idle' };

/**
 * "New code" for one student. The code appears here once, right after it is
 * made; it is never stored or shown anywhere else.
 */
export function StudentCodeForm({
  groupId,
  studentId,
  name,
}: {
  groupId: string;
  studentId: string;
  name: string;
}) {
  const t = useTranslations('teach.group');
  const [state, action, pending] = useActionState(issueStudentCode, noCode);
  return (
    <form action={action} className="flex flex-col items-start gap-2" noValidate>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="studentId" value={studentId} />
      <Button
        type="submit"
        variant="secondary"
        loading={pending}
        aria-label={t('newCodeLabel', { name })}
      >
        {t('newCode')}
      </Button>
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      {state.status === 'ok' ? (
        <Alert tone="success">
          <span className="block">{t('codeIssued', { name })}</span>
          <span dir="ltr" className="block font-mono text-lg font-semibold tracking-widest">
            {state.code}
          </span>
          <span className="block text-sm">{t('codeOnce')}</span>
        </Alert>
      ) : null}
    </form>
  );
}
