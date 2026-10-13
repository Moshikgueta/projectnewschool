import { describe, expect, it } from 'vitest';
import {
  chunk,
  clampPage,
  DEFAULT_PAGE_SIZE,
  fetchAllPages,
  MAX_PAGE_SIZE,
  MAX_ROWS,
  pageHref,
  pageInfo,
  pageRange,
  parsePageRequest,
  searchTerm,
} from './paging';

describe('parsePageRequest', () => {
  it('defaults to the first page and the default size', () => {
    expect(parsePageRequest({})).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE });
    expect(parsePageRequest({}, 20)).toEqual({ page: 1, size: 20 });
  });

  it('reads page and size from the URL', () => {
    expect(parsePageRequest({ page: '3', size: '20' })).toEqual({ page: 3, size: 20 });
    expect(parsePageRequest({ page: ['2', '9'] })).toEqual({ page: 2, size: DEFAULT_PAGE_SIZE });
  });

  it('ignores malformed values and caps the size', () => {
    for (const page of ['0', '-1', '1.5', 'abc', '', '9999999', undefined, 7]) {
      expect(parsePageRequest({ page }).page).toBe(1);
    }
    expect(parsePageRequest({ size: '0' }).size).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageRequest({ size: '5000' }).size).toBe(MAX_PAGE_SIZE);
  });
});

describe('pageRange and pageInfo', () => {
  it('turns a page into an inclusive row range', () => {
    expect(pageRange({ page: 1, size: 50 })).toEqual({ from: 0, to: 49 });
    expect(pageRange({ page: 2, size: 50 })).toEqual({ from: 50, to: 99 });
  });

  it('describes "51–100 of 10,003"', () => {
    expect(pageInfo({ page: 2, size: 50 }, 10_003, 50)).toEqual({
      page: 2,
      size: 50,
      total: 10_003,
      pages: 201,
      first: 51,
      last: 100,
      prev: 1,
      next: 3,
    });
  });

  it('handles the last, short page and an empty list', () => {
    expect(pageInfo({ page: 201, size: 50 }, 10_003, 3)).toMatchObject({
      first: 10_001,
      last: 10_003,
      prev: 200,
      next: null,
    });
    expect(pageInfo({ page: 1, size: 50 }, 0, 0)).toMatchObject({
      pages: 1,
      first: 0,
      last: 0,
      prev: null,
      next: null,
    });
  });

  it('sends a page past the end back to the last page', () => {
    expect(clampPage({ page: 9, size: 50 }, 120)).toEqual({ page: 3, size: 50 });
    expect(clampPage({ page: 2, size: 50 }, 0)).toEqual({ page: 1, size: 50 });
    expect(clampPage({ page: 2, size: 50 }, 120)).toEqual({ page: 2, size: 50 });
  });
});

describe('searchTerm', () => {
  it('keeps letters, digits and spaces in any script', () => {
    expect(searchTerm('  דנה  כהן ')).toBe('דנה כהן');
    expect(searchTerm('050-123')).toBe('050-123');
    expect(searchTerm('a@b.co')).toBe('a@b.co');
  });

  it('removes what PostgREST filter syntax would read', () => {
    expect(searchTerm('a,b(c)d%e_f*g\\h"i:j')).toBe('a b c d e f g h i j');
    expect(searchTerm('x'.repeat(200))).toHaveLength(80);
    expect(searchTerm(undefined)).toBe('');
    expect(searchTerm(['q', 'r'])).toBe('q');
  });
});

describe('pageHref', () => {
  it('keeps the search and drops page 1', () => {
    expect(pageHref('/office/students', { q: 'dana', page: 4 }, 1)).toBe('/office/students?q=dana');
    expect(pageHref('/office/students', { q: 'dana', size: 20 }, 3)).toBe(
      '/office/students?q=dana&size=20&page=3',
    );
    expect(pageHref('/admin', { q: '' }, 1)).toBe('/admin');
  });
});

/** A fake ordered table behind a server that caps every response at `cap` rows. */
function table(rows: number, cap = MAX_ROWS) {
  const data = Array.from({ length: rows }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: data.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { data, calls, fetchPage };
}

describe('fetchAllPages', () => {
  it('reads every row past the server cap, in order', async () => {
    const t = table(2_345);
    const rows = await fetchAllPages(t.fetchPage);
    expect(rows).toEqual(t.data);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('asks once more after an exactly full last page', async () => {
    const t = table(10);
    expect(await fetchAllPages(t.fetchPage, 5)).toHaveLength(10);
    expect(t.calls).toEqual([
      [0, 4],
      [5, 9],
      [10, 14],
    ]);
  });

  it('reads an empty table in one request', async () => {
    const t = table(0);
    expect(await fetchAllPages(t.fetchPage, 3)).toEqual([]);
    expect(t.calls).toHaveLength(1);
  });

  it('fails on an error instead of returning part of the rows', async () => {
    let n = 0;
    await expect(
      fetchAllPages(
        async () =>
          n++ === 0
            ? { data: [1, 2], error: null }
            : { data: null, error: { message: 'connection lost' } },
        2,
      ),
    ).rejects.toThrow('connection lost');
  });

  it('refuses a page size above the server cap (a full page would look short)', async () => {
    const t = table(5);
    await expect(fetchAllPages(t.fetchPage, MAX_ROWS + 1)).rejects.toThrow(/Page size/);
    await expect(fetchAllPages(t.fetchPage, 0)).rejects.toThrow(/Page size/);
  });

  it('stops with an error rather than loop forever', async () => {
    await expect(fetchAllPages(async () => ({ data: [1], error: null }), 1)).rejects.toThrow(
      /refusing/,
    );
  });
});

describe('chunk', () => {
  it('splits a list for .in() filters', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });
});
