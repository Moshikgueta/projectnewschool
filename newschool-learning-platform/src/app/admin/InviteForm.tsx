'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { ROLES } from '@/domain/auth/access';
import { inviteUser, type InviteState } from '@/server/actions/admin';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';

const initial: InviteState = { status: 'idle' };

export function InviteForm() {
  const t = useTranslations('admin');
  const [state, action, pending] = useActionState(inviteUser, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      {state.status === 'invited' ? (
        <Alert tone="success">{t('sent', { email: state.email })}</Alert>
      ) : null}
      <TextField
        id="displayName"
        name="displayName"
        label={t('name')}
        autoComplete="off"
        required
      />
      <TextField
        id="invite-email"
        name="email"
        type="email"
        label={t('email')}
        autoComplete="off"
        required
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="role" className="text-[0.9375rem] font-medium">
          {t('role')}
        </label>
        <select
          id="role"
          name="role"
          defaultValue="student"
          className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`roles.${role}`)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" loading={pending} className="self-start">
        {t('send')}
      </Button>
    </form>
  );
}
