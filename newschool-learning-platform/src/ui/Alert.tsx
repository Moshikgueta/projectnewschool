import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<Tone, string> = {
  info: 'bg-info-light text-info-ink border-info-ink/20',
  success: 'bg-success-light text-success-ink border-success/30',
  warning: 'bg-warning-light text-warning-ink border-warning/30',
  error: 'bg-error-light text-error-ink border-error/30',
};

/** Inline message. Errors use role="alert"; others are polite status messages. */
export function Alert({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const t = useTranslations('common.alert');
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-[0.9375rem] ${TONES[tone]}`}
    >
      <span className="sr-only">{t(tone)}: </span>
      {children}
    </div>
  );
}
