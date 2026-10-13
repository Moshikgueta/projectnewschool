// Paging (docs/PERFORMANCE.md §8). PostgREST returns at most `max_rows`
// (1,000) rows per request and says nothing when it stops there, so a read
// that can be longer either pages on screen (a page of a list, with the
// total) or reads every page in a loop. Pure helpers; the server wires them
// to Supabase in src/server/queries/paging.ts.

/** PostgREST's `max_rows` (supabase/config.toml [api]). */
export const MAX_ROWS = 1000;

/** Rows per page on screen, unless the page asks for another size. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/** A list never reads more than this many pages in a loop: it fails loudly instead. */
export const MAX_PAGES = 1000;

export type PageRequest = { page: number; size: number };

function positiveInt(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !/^\d{1,6}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 ? n : null;
}

/**
 * The page asked for in the URL (`?page=3&size=20`): page 1 and the default
 * size when missing or malformed; the size is kept between 1 and
 * MAX_PAGE_SIZE.
 */
export function parsePageRequest(
  params: { page?: unknown; size?: unknown },
  defaultSize = DEFAULT_PAGE_SIZE,
): PageRequest {
  const page = positiveInt(params.page) ?? 1;
  const size = Math.min(positiveInt(params.size) ?? defaultSize, MAX_PAGE_SIZE);
  return { page, size };
}

/** The inclusive row range of a page, as `.range(from, to)` takes it. */
export function pageRange({ page, size }: PageRequest): { from: number; to: number } {
  const from = (page - 1) * size;
  return { from, to: from + size - 1 };
}

export type PageInfo = {
  page: number;
  size: number;
  total: number;
  pages: number;
  /** 1-based position of the first and last row shown; 0 and 0 when nothing is shown. */
  first: number;
  last: number;
  prev: number | null;
  next: number | null;
};

/** What a page shows ("51–100 of 10,003") and where its neighbours are. */
export function pageInfo({ page, size }: PageRequest, total: number, shown: number): PageInfo {
  const pages = Math.max(1, Math.ceil(total / size));
  const first = shown > 0 ? (page - 1) * size + 1 : 0;
  return {
    page,
    size,
    total,
    pages,
    first,
    last: shown > 0 ? first + shown - 1 : 0,
    prev: page > 1 ? Math.min(page - 1, pages) : null,
    next: page < pages ? page + 1 : null,
  };
}

/** A page past the end (after rows were removed) shows the last page instead. */
export function clampPage(request: PageRequest, total: number): PageRequest {
  const pages = Math.max(1, Math.ceil(total / request.size));
  return request.page > pages ? { ...request, page: pages } : request;
}

/**
 * Text typed into a search box, made safe for a PostgREST `ilike` / `or`
 * filter: the characters that filter syntax gives a meaning to (`,` `(` `)`
 * `%` `_` `*` `\` `"` `:`) become spaces; at most 80 characters.
 */
export function searchTerm(raw: unknown): string {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== 'string') return '';
  return text
    .slice(0, 80)
    .replace(/[%_,()*\\":]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Query string for a link to another page of the same list (other params kept). */
export function pageHref(
  path: string,
  params: Record<string, string | number | undefined>,
  page: number,
): string {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && k !== 'page') query.set(k, String(v));
  }
  if (page > 1) query.set('page', String(page));
  const s = query.toString();
  return s ? `${path}?${s}` : path;
}

export type FetchedPage<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Every row of a read, one page at a time: asks for rows `from`–`to` until a
 * page comes back short. The read must be ordered by something unique (an id
 * last), or rows can repeat or go missing between pages. `pageSize` must not
 * exceed the server's cap, or a full page would look short.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<FetchedPage<T>>,
  pageSize: number = MAX_ROWS,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_ROWS) {
    throw new Error(`Page size must be between 1 and ${MAX_ROWS}: ${pageSize}`);
  }
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  throw new Error(`More than ${MAX_PAGES} pages of ${pageSize} rows: refusing to read further`);
}

/** Splits a list of ids for `.in()` filters, which go into the URL. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('Chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
