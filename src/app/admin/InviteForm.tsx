'use client';

import { useActionState } from 'react';
import { inviteUser, type InviteState } from '@/server/actions/admin';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';

const initial: InviteState = { status: 'idle' };

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteUser, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      {state.status === 'invited' ? (
        <Alert tone="success">Invitation sent to {state.email}.</Alert>
      ) : null}
      <TextField id="displayName" name="displayName" label="Name" autoComplete="off" required />
      <TextField
        id="invite-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="off"
        required
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="role" className="text-[0.9375rem] font-medium">
          Role
        </label>
        <select
          id="role"
          name="role"
          defaultValue="student"
          className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
        >
          <option value="student">Student</option>
          <option value="teacher">Teacher</option>
          <option value="pedagogical_manager">Pedagogical manager</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <Button type="submit" loading={pending} className="self-start">
        Send invitation
      </Button>
    </form>
  );
}
