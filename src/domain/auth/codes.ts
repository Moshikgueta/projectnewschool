// Student entry codes (moved from the staff room). Pure helpers: the
// alphabet, generating, normalising and showing a code, and the wrong-code
// throttle decision. Hashing and storage live in src/server/privileged.

/**
 * No I, L, O, 0 or 1: the code is read off a printed slip and copied by hand,
 * so characters that get confused in handwriting are not in the alphabet.
 * 31 characters × 8 places ≈ 8.5 × 10^11 codes.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

/** Wrong codes allowed per caller, and overall, per window. */
export const CODE_WINDOW_MS = 15 * 60_000;
export const CODE_MAX_PER_CALLER = 10;
export const CODE_MAX_OVERALL = 100;

/**
 * A new code from a source of random bytes. Bytes at or above the largest
 * multiple of 31 that fits in a byte are discarded rather than folded in, so
 * every character is equally likely.
 */
export function generateCode(randomBytes: (n: number) => Uint8Array): string {
  const ceiling = 256 - (256 % CODE_ALPHABET.length);
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const b of randomBytes(CODE_LENGTH)) {
      if (b >= ceiling) continue;
      out += CODE_ALPHABET[b % CODE_ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/** What was typed, reduced to the code: case, spaces and dashes don't matter. */
export function normalizeCode(input: string): string {
  let out = '';
  for (const ch of input.toUpperCase()) if (CODE_ALPHABET.includes(ch)) out += ch;
  return out;
}

/** Shown grouped ("ABCD-EFGH"), stored ungrouped. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export type AttemptRow = { scope: string; windowStart: Date; n: number };

/** Whether this caller must wait: too many wrong codes from it, or from everyone. */
export function isThrottled(rows: readonly AttemptRow[], now: Date): boolean {
  return rows.some((row) => {
    if (now.getTime() - row.windowStart.getTime() >= CODE_WINDOW_MS) return false;
    return row.n >= (row.scope === 'all' ? CODE_MAX_OVERALL : CODE_MAX_PER_CALLER);
  });
}

/** The row after one more wrong code: a new window once the old one has passed. */
export function afterMiss(row: AttemptRow | null, scope: string, now: Date): AttemptRow {
  if (!row || now.getTime() - row.windowStart.getTime() >= CODE_WINDOW_MS) {
    return { scope, windowStart: now, n: 1 };
  }
  return { ...row, n: row.n + 1 };
}
