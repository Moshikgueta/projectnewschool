'use client';

import { useTranslations } from 'next-intl';
import { ActionForm } from '@/app/manage/ActionForm';
import { addResource } from '@/server/actions/staff';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';

export function ResourceForm() {
  const t = useTranslations('staff.resources');
  return (
    <ActionForm action={addResource} className="grid gap-4 sm:grid-cols-2">
      {(pending) => (
        <>
          <TextField id="res-title" name="title" label={t('titleField')} required maxLength={160} />
          <TextField
            id="res-url"
            name="url"
            type="url"
            dir="ltr"
            label={t('url')}
            required
            maxLength={2000}
            pattern="https://.+"
          />
          <TextField
            id="res-description"
            name="description"
            className="sm:col-span-2"
            label={t('description')}
            maxLength={500}
          />
          <Button type="submit" loading={pending} className="self-start">
            {t('addButton')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
