import type { Route } from 'next';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { pageHref, type PageInfo } from '@/domain/paging';

const STEP =
  'inline-flex min-h-11 items-center gap-1 rounded-md border border-border-strong bg-surface px-4 font-medium text-primary hover:bg-surface-secondary';
const STEP_OFF =
  'inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-4 font-medium text-muted';

/**
 * "Showing 51–100 of 10,003" and links to the previous and next page. The
 * links are plain URLs (`?page=3`, other search params kept), so back and
 * forward and shared links work.
 */
export function Pager({
  info,
  path,
  params,
  label,
}: {
  info: PageInfo;
  path: string;
  /** The list's other search params (the search text, the page size). */
  params: Record<string, string | number | undefined>;
  /** What the list is, for screen readers ("Students pages"). */
  label: string;
}) {
  const t = useTranslations('paging');
  const format = useFormatter();
  const n = (v: number) => format.number(v);
  const href = (page: number) => pageHref(path, params, page) as Route;

  return (
    <nav
      aria-label={label}
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-[0.9375rem] text-fg-secondary tabular-nums">
        {info.total === 0
          ? t('none')
          : t('showing', { first: n(info.first), last: n(info.last), total: n(info.total) })}
      </p>
      {info.pages > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          {info.prev ? (
            <Link href={href(info.prev)} rel="prev" className={STEP}>
              {t('previous')}
            </Link>
          ) : (
            <span aria-disabled="true" className={STEP_OFF}>
              {t('previous')}
            </span>
          )}
          <span className="px-1 text-sm text-muted tabular-nums">
            {t('page', { page: n(info.page), pages: n(info.pages) })}
          </span>
          {info.next ? (
            <Link href={href(info.next)} rel="next" className={STEP}>
              {t('next')}
            </Link>
          ) : (
            <span aria-disabled="true" className={STEP_OFF}>
              {t('next')}
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}

/** For a list deliberately cut to its latest rows: says so, with the total. */
export function LatestOnly({ shown, total }: { shown: number; total: number }) {
  const t = useTranslations('paging');
  const format = useFormatter();
  if (total <= shown) return null;
  return (
    <p className="text-sm text-muted tabular-nums">
      {t('latest', { shown: format.number(shown), total: format.number(total) })}
    </p>
  );
}
