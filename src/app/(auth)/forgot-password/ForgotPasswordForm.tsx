'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { requestPasswordReset, type FormState } from '@/server/actions/auth';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';

const initial: FormState = { status: 'idle' };

export function ForgotPasswordForm() {
  const t = useTranslations('auth.forgot');
  const [state, action, pending] = useActionState(requestPasswordReset, initial);
  if (state.status === 'sent') return <Alert tone="success">{t('sent')}</Alert>;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      <TextField
        id="email"
        name="email"
        type="email"
        dir="ltr"
        label={t('email')}
        autoComplete="email"
        required
      />
      <Button type="submit" loading={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
