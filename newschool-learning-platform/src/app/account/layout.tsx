import type { ReactNode } from 'react';
import { setInterfaceLanguage } from '@/server/actions/preferences';
import { AuthFrame } from '@/ui/AuthFrame';

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AuthFrame languageAction={setInterfaceLanguage}>{children}</AuthFrame>;
}
