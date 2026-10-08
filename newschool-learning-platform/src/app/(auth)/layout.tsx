import type { ReactNode } from 'react';
import { setInterfaceLanguage } from '@/server/actions/preferences';
import { AuthFrame } from '@/ui/AuthFrame';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthFrame languageAction={setInterfaceLanguage}>{children}</AuthFrame>;
}
