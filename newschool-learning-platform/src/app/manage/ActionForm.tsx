'use client';

import { useActionState, type ReactNode } from 'react';
import type { ManageState } from '@/server/actions/manage';
import { Alert } from '@/ui/Alert';

const initial: ManageState = { status: 'idle' };

/**
 * A form bound to one management action. Shows the action's success or error
 * message next to the form; the fields and submit button are the children.
 */
export function ActionForm({
  action,
  hidden,
  className = 'flex flex-col gap-4',
  children,
}: {
  action: (prev: ManageState, formData: FormData) => Promise<ManageState>;
  hidden?: Record<string, string>;
  className?: string;
  children: (pending: boolean) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className={className} noValidate>
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children(pending)}
      {state.status === 'error' ? <Alert tone="error">{state.message}</Alert> : null}
      {state.status === 'ok' ? <Alert tone="success">{state.message}</Alert> : null}
    </form>
  );
}
