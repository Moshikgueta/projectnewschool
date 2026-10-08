'use client';

import { useTranslations } from 'next-intl';
import { ActionForm } from '@/app/manage/ActionForm';
import { sendTask } from '@/server/actions/staff';
import { Button } from '@/ui/Button';
import { SelectField } from '@/ui/SelectField';
import { TextField } from '@/ui/TextField';

export function TaskForm({
  area,
  assignees,
  defaultAssignee,
}: {
  area: 'teach' | 'office' | 'manage';
  assignees: { id: string; name: string }[];
  defaultAssignee: string;
}) {
  const t = useTranslations('staff.tasks');
  return (
    <ActionForm action={sendTask} hidden={{ area }} className="flex flex-col gap-4">
      {(pending) => (
        <>
          <TextField
            id="task-title"
            name="title"
            label={t('titleField')}
            required
            maxLength={200}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="task-note" className="text-[0.9375rem] font-medium">
              {t('note')}
            </label>
            <textarea
              id="task-note"
              name="note"
              maxLength={1000}
              rows={3}
              className="rounded-md border border-border-strong bg-surface px-3 py-2 text-base"
            />
          </div>
          {assignees.length > 1 ? (
            <SelectField
              id="task-assignee"
              name="assigneeId"
              label={t('to')}
              defaultValue={defaultAssignee}
              options={assignees.map((a) => ({ value: a.id, label: a.name }))}
            />
          ) : (
            <input type="hidden" name="assigneeId" value={defaultAssignee} />
          )}
          <label className="flex min-h-11 items-center gap-2 text-[0.9375rem]">
            <input
              type="checkbox"
              name="priority"
              value="urgent"
              className="size-5 accent-primary"
            />
            {t('urgent')}
          </label>
          <Button type="submit" loading={pending} className="self-start">
            {t('send')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
