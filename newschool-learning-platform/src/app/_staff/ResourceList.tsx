import { getTranslations } from 'next-intl/server';
import { removeResource } from '@/server/actions/staff';
import { listResources } from '@/server/queries/staff';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/Page';

const LINK = 'font-medium text-primary underline-offset-4 hover:underline';
const QUIET_BUTTON =
  'min-h-11 px-2 text-sm font-medium text-muted underline-offset-4 hover:text-fg hover:underline';

/** Training links. Links are https only (checked in the database too) and open in a new tab. */
export async function ResourceList({ editable = false }: { editable?: boolean }) {
  const [resources, t] = await Promise.all([listResources(), getTranslations('staff.resources')]);
  if (!resources.length) return <EmptyState title={t('empty')} />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {resources.map((r) => (
        <li key={r.id}>
          <Card className="flex h-full flex-col gap-2">
            <h2 className="font-semibold">
              <bdi>{r.title}</bdi>
            </h2>
            {r.description ? <p className="text-sm text-fg-secondary">{r.description}</p> : null}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK}
                aria-label={t('openLabel', { title: r.title })}
              >
                {t('open')} ↗
              </a>
              {editable ? (
                <form action={removeResource}>
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    className={QUIET_BUTTON}
                    aria-label={t('removeLabel', { title: r.title })}
                  >
                    {t('remove')}
                  </button>
                </form>
              ) : null}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
