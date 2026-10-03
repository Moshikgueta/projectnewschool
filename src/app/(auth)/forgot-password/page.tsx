import Link from 'next/link';
import type { Metadata } from 'next';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata: Metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-fg-secondary">We will email you a link to choose a new password.</p>
      </div>
      <ForgotPasswordForm />
      <Link href="/login" className="text-[0.9375rem] font-medium text-primary hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
