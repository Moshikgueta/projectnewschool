import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/session';
import { Logo } from '@/ui/Logo';
import { SetPasswordForm } from './SetPasswordForm';

export const metadata: Metadata = { title: 'Choose a password' };

// Reached from an invite or password-reset email (via /auth/confirm, which
// signs the person in with the one-time link).
export default async function SetPasswordPage() {
  const user = await requireUser();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <Logo />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a password</h1>
        {user.email ? <p className="text-fg-secondary">For {user.email}</p> : null}
      </div>
      <SetPasswordForm />
    </main>
  );
}
