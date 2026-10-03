'use client';

import { useActionState } from 'react';
import { setPassword, type FormState } from '@/server/actions/auth';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';

const initial: FormState = { status: 'idle' };

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPassword, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      <TextField
        id="password"
        name="password"
        type="password"
        label="New password"
        hint="At least 10 characters. A short sentence is easy to remember and hard to guess."
        autoComplete="new-password"
        minLength={10}
        required
      />
      <TextField
        id="confirm"
        name="confirm"
        type="password"
        label="Repeat the password"
        autoComplete="new-password"
        required
      />
      <Button type="submit" loading={pending}>
        Save password
      </Button>
    </form>
  );
}
