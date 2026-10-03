import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Logo } from './Logo';

/** Centered frame for sign-in and account pages: logo, language switch, content. */
export function AuthFrame({
  languageAction,
  children,
}: {
  languageAction: (formData: FormData) => Promise<void>;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <Logo />
        <Suspense>
          <LanguageSwitcher action={languageAction} />
        </Suspense>
      </div>
      {children}
    </main>
  );
}
