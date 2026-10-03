import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import en from './messages/en.json';
import he from './messages/he.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? { ...acc, [path]: value }
      : { ...acc, ...flatten(value, path) };
  }, {});
}

const flatEn = flatten(en);
const flatHe = flatten(he);

describe('interface messages', () => {
  it('Hebrew and English have exactly the same keys', () => {
    expect(Object.keys(flatHe).sort()).toEqual(Object.keys(flatEn).sort());
  });

  it('every message is valid ICU syntax in its locale', () => {
    for (const [locale, flat] of [
      ['en', flatEn],
      ['he', flatHe],
    ] as const) {
      for (const [key, message] of Object.entries(flat)) {
        expect(() => new IntlMessageFormat(message, locale), `${locale}:${key}`).not.toThrow();
      }
    }
  });

  it('uses the same placeholders in both languages', () => {
    const placeholders = (m: string) => [...m.matchAll(/\{(\w+)[,}]/g)].map((x) => x[1]).sort();
    for (const key of Object.keys(flatEn)) {
      expect(placeholders(flatHe[key] ?? ''), key).toEqual(placeholders(flatEn[key] ?? ''));
    }
  });

  it('formats Hebrew plurals naturally', () => {
    const fmt = (n: number) =>
      new IntlMessageFormat(flatHe['learn.dashboard.counts.words'] ?? '', 'he').format({
        count: n,
      });
    expect(fmt(1)).toBe('מילה אחת');
    expect(fmt(12)).toBe('12 מילים');
  });
});
