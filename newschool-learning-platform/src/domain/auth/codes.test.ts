import { describe, expect, it } from 'vitest';
import {
  afterMiss,
  CODE_ALPHABET,
  formatCode,
  generateCode,
  isThrottled,
  normalizeCode,
} from './codes';

describe('student entry codes', () => {
  it('generates 8 characters from the handwriting-safe alphabet, discarding biased bytes', () => {
    // 248 and above would favour the first characters, so they are skipped.
    const bytes = [255, 250, 248, 0, 30, 31, 61, 1, 2, 3, 4, 5];
    let i = 0;
    const code = generateCode((n) =>
      Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]!),
    );
    expect(code).toHaveLength(8);
    expect(code).toBe(['A', '9', 'A', '9', 'B', 'C', 'D', 'E'].join(''));
    expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    expect(CODE_ALPHABET).not.toMatch(/[ILO01]/);
  });

  it('accepts the code however it is typed', () => {
    expect(normalizeCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeCode(' AB CD EF GH ')).toBe('ABCDEFGH');
    expect(normalizeCode('0O1I')).toBe(''); // not in the alphabet
    expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });

  it('throttles 10 wrong codes per caller and 100 overall within 15 minutes', () => {
    const now = new Date('2026-10-06T10:00:00Z');
    const recent = new Date('2026-10-06T09:50:00Z');
    const old = new Date('2026-10-06T09:40:00Z');
    expect(isThrottled([{ scope: 'ip:1', windowStart: recent, n: 9 }], now)).toBe(false);
    expect(isThrottled([{ scope: 'ip:1', windowStart: recent, n: 10 }], now)).toBe(true);
    expect(isThrottled([{ scope: 'ip:1', windowStart: old, n: 50 }], now)).toBe(false);
    expect(isThrottled([{ scope: 'all', windowStart: recent, n: 99 }], now)).toBe(false);
    expect(isThrottled([{ scope: 'all', windowStart: recent, n: 100 }], now)).toBe(true);

    expect(afterMiss(null, 'ip:1', now)).toEqual({ scope: 'ip:1', windowStart: now, n: 1 });
    expect(afterMiss({ scope: 'ip:1', windowStart: recent, n: 4 }, 'ip:1', now).n).toBe(5);
    expect(afterMiss({ scope: 'ip:1', windowStart: old, n: 9 }, 'ip:1', now)).toEqual({
      scope: 'ip:1',
      windowStart: now,
      n: 1,
    });
  });
});
