import 'server-only';
import {
  chunk,
  clampPage,
  fetchAllPages,
  MAX_ROWS,
  pageInfo,
  pageRange,
  type FetchedPage,
  type PageInfo,
  type PageRequest,
} from '@/domain/paging';
import { isProductionLike } from '@/server/env';

// Reads that can be longer than PostgREST's max_rows (docs/PERFORMANCE.md §7.4).
// `readAll` reads every page; the query must end with an order on something
// unique (an id last). FETCH_PAGE_SIZE (local and preview only) makes every
// such read use small pages, so the end-to-end suite exercises the paging
// with the small seed (playwright.config.ts).

function pageSize(): number {
  const raw = process.env.FETCH_PAGE_SIZE;
  if (!raw || isProductionLike()) return MAX_ROWS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_ROWS ? n : MAX_ROWS;
}

/** Every row of an ordered read, one page at a time. Throws `Could not load <what>` on an error. */
export async function readAll<T>(
  what: string,
  build: (from: number, to: number) => PromiseLike<FetchedPage<T>>,
): Promise<T[]> {
  try {
    return await fetchAllPages(build, pageSize());
  } catch (e) {
    throw new Error(`Could not load ${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Ids per `.in()` filter: they go into the URL (≈37 characters each). */
export const IDS_PER_REQUEST = 100;

/**
 * Every row of an ordered read filtered by a long list of ids: the ids in
 * chunks, each chunk read in pages. Rows come back chunk by chunk.
 */
export async function readAllByIds<T>(
  what: string,
  ids: readonly string[],
  build: (ids: string[], from: number, to: number) => PromiseLike<FetchedPage<T>>,
): Promise<T[]> {
  const parts = await Promise.all(
    chunk([...new Set(ids)], IDS_PER_REQUEST).map((part) =>
      readAll(what, (from, to) => build(part, from, to)),
    ),
  );
  return parts.flat();
}

type CountedPage<T> = {
  data: T[] | null;
  error: { message: string; code?: string } | null;
  count: number | null;
};

/**
 * One page of a list and its total (`{ count: 'exact' }` in `build`). A page
 * past the end (rows removed, an old link) shows the last page: PostgREST
 * answers a range past the end with an error (PGRST103), so the total is
 * asked for and the last page read instead.
 */
export async function readCountedPage<T>(
  what: string,
  request: PageRequest,
  build: (from: number, to: number) => PromiseLike<CountedPage<T>>,
): Promise<{ rows: T[]; info: PageInfo }> {
  const read = async (r: PageRequest) => {
    const { from, to } = pageRange(r);
    return build(from, to);
  };
  let page = await read(request);
  let shown = request;
  if (page.error?.code === 'PGRST103') {
    const first = await build(0, 0);
    if (first.error) throw new Error(`Could not load ${what}: ${first.error.message}`);
    shown = clampPage(request, first.count ?? 0);
    page = await read(shown);
  }
  if (page.error) throw new Error(`Could not load ${what}: ${page.error.message}`);
  const rows = page.data ?? [];
  return { rows, info: pageInfo(shown, page.count ?? rows.length, rows.length) };
}
