'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { signIn, type FormState } from '@/server/actions/auth';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';

const initial: FormState = { status: 'idle' };

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations('auth.signIn');
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      <input type="hidden" name="next" value={next} />
      <TextField
        id="email"
        name="email"
        type="email"
        dir="ltr"
        label={t('email')}
        autoComplete="username"
        required
      />
      <TextField
        id="password"
        name="password"
        type="password"
        dir="ltr"
        label={t('password')}
        autoComplete="current-password"
        required
      />
      <Button type="submit" loading={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
