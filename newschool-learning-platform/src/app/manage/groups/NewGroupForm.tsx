'use client';

import { useTranslations } from 'next-intl';
import { createGroup } from '@/server/actions/manage';
import { Button } from '@/ui/Button';
import { SelectField } from '@/ui/SelectField';
import { TextField } from '@/ui/TextField';
import { ActionForm } from '../ActionForm';

export function NewGroupForm({ courses }: { courses: { value: string; label: string }[] }) {
  const t = useTranslations('manage.groups');
  return (
    <ActionForm action={createGroup}>
      {(pending) => (
        <>
          <SelectField
            id="new-course"
            name="courseId"
            label={t('course')}
            options={courses}
            required
          />
          <TextField id="new-name" name="name" label={t('name')} maxLength={160} required />
          <TextField
            id="new-schedule"
            name="scheduleNote"
            label={t('schedule')}
            hint={t('scheduleHint')}
            maxLength={300}
          />
          <TextField id="new-starts" name="startsOn" type="date" label={t('startsOn')} />
          <Button type="submit" loading={pending} className="self-start">
            {t('create')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
