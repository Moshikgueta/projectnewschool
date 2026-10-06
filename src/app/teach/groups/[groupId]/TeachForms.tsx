'use client';

import { useTranslations } from 'next-intl';
import { ActionForm } from '@/app/manage/ActionForm';
import { assignActivity, scheduleClass, setActiveCycle } from '@/server/actions/teach';
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
