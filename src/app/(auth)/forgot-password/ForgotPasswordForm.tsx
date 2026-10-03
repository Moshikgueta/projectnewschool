'use client';

import { useActionState } from 'react';
import { requestPasswordReset, type FormState } from '@/server/actions/auth';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';

const initial: FormState = { status: 'idle' };

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);
  if (state.status === 'sent') {
    return (
      <Alert tone="success">
        If an account exists for that address, a reset link is on its way. It works once and expires
        in one hour.
      </Alert>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      <TextField id="email" name="email" type="email" label="Email" autoComplete="email" required />
      <Button type="submit" loading={pending}>
        Send reset link
      </Button>
    </form>
  );
}
