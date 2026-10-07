'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** Copies a message (e.g. a prompt for the AI tutor) to the clipboard. */
export function CopyButton({ text }: { text: string }) {
  const t = useTranslations('notebook');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        onClick={() =>
          navigator.clipboard
            .writeText(text)
            .then(() => setState('copied'))
            .catch(() => setState('failed'))
        }
        className="min-h-11 rounded-md border border-primary bg-primary-light px-4 text-[0.9375rem] font-medium text-primary hover:bg-surface-secondary"
      >
        {t('copy')}
      </button>
      <span role="status" className="text-sm text-muted">
        {state === 'copied' ? t('copied') : state === 'failed' ? t('copyFailed') : ''}
      </span>
    </span>
  );
}
