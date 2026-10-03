import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/server/auth/session';
import { Alert } from '@/ui/Alert';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  if (await getSessionUser()) redirect('/');
  const { next, error } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      {error === 'link' ? (
        <Alert tone="error">That link has expired or was already used. Ask for a new one.</Alert>
      ) : null}
      <LoginForm next={next ?? ''} />
      <Link
        href="/forgot-password"
        className="text-[0.9375rem] font-medium text-primary hover:underline"
      >
        Forgot your password?
      </Link>
    </div>
  );
}
