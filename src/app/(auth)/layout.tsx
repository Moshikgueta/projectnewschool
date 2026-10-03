import type { ReactNode } from 'react';
import { Logo } from '@/ui/Logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <Logo />
      {children}
    </main>
  );
}
