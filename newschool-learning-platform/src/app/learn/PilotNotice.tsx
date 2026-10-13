import { getTranslations } from 'next-intl/server';
import { Badge } from '@/ui/Card';

/**
 * Shown on a pilot course's pages (ADR-040): a "Pilot" badge and a line
 * saying the material is new and mistakes can be reported.
 */
export async function PilotNotice({ pilot }: { pilot: boolean }) {
  if (!pilot) return null;
  const t = await getTranslations('reports.pilot');
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
      <Badge tone="warning">{t('badge')}</Badge>
      <span>{t('note')}</span>
    </p>
  );
}
