'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { signInWithCode, type FormState } from '@/server/actions/auth';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';

const initial: FormState = { status: 'idle' };

export function CodeForm() {
  const t = useTranslations('auth.code');
  const [state, action, pending] = useActionState(signInWithCode, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      <TextField
        id="code"
        name="code"
        dir="ltr"
        label={t('label')}
        hint={t('hint')}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={20}
        required
      />
      <Button type="submit" loading={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
