import { getTranslations } from 'next-intl/server';
import type { PackageAlerts } from '@/domain/office/packages';
import { Badge } from '@/ui/Card';

const ORDER = ['finished', 'expired', 'low', 'expiring', 'unpaid'] as const;

export async function PackageAlertBadges({ alerts }: { alerts: PackageAlerts }) {
  const t = await getTranslations('office.student.alert');
  const shown = ORDER.filter((k) => alerts[k]);
  if (!shown.length) return null;
  return (
    <p className="flex flex-wrap gap-2">
      {shown.map((k) => (
        <Badge key={k} tone={k === 'finished' || k === 'expired' ? 'neutral' : 'warning'}>
          {t(k)}
        </Badge>
      ))}
    </p>
  );
}
