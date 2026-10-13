'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { setPassword, type FormState } from '@/server/actions/auth';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';

const initial: FormState = { status: 'idle' };

export function SetPasswordForm() {
  const t = useTranslations('auth.setPassword');
  const [state, action, pending] = useActionState(setPassword, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      <TextField
        id="password"
        name="password"
        type="password"
        dir="ltr"
        label={t('password')}
        hint={t('hint')}
        autoComplete="new-password"
        minLength={10}
        required
      />
      <TextField
        id="confirm"
        name="confirm"
        type="password"
        dir="ltr"
        label={t('confirm')}
        autoComplete="new-password"
        required
      />
      <Button type="submit" loading={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
