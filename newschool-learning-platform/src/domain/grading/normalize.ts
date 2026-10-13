// Answer normalisation (docs/CONTENT-MODEL.md §4). Compares what a student
// typed with an accepted answer the way a teacher would: spacing, capitals,
// Spanish opening marks and final punctuation don't matter; accents depend on
// the item's policy. Hebrew niqqud and Arabic harakat are always ignored.

export type NormalizeOptions = { caseSensitive?: boolean; stripAccents?: boolean };

const POINTING = /[֑-ׇֽֿׁׂًׅׄ-ٰٟ]/g;
const QUOTES: [RegExp, string][] = [
  [/[‘’ʼ`´]/g, "'"],
  [/[“”«»]/g, '"'],
  [/[‐-―−]/g, '-'],
];

export function normalizeAnswer(raw: string, options: NormalizeOptions = {}): string {
  let s = raw.normalize('NFC').replace(POINTING, '');
  for (const [pattern, replacement] of QUOTES) s = s.replace(pattern, replacement);
  s = s
    .replace(/\s+/g, ' ')
    .trim()
    // Opening ¿ ¡ anywhere, and punctuation at the very end.
    .replace(/[¿¡]/g, '')
    .replace(/[\s.!?…,;:]+$/u, '')
    .trim();
  // Space before punctuation ("Ana ." from joined tokens) is not a mistake.
  s = s.replace(/\s+([.,!?;:])/g, '$1');
  if (!options.caseSensitive) s = s.toLocaleLowerCase('und');
  if (options.stripAccents) s = stripAccents(s);
  return s;
}

/** Removes combining accents from Latin letters (é → e, ñ → n, ç → c). */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

export type TextMatch = 'exact' | 'accent' | 'wrong';

/**
 * Compare an answer with the accepted variants. "accent" means it matches
 * only when accents are ignored, which counts as correct under a lenient
 * policy (with a reminder) and wrong under a strict one.
 */
export function matchText(
  answer: string,
  accepted: readonly string[],
  options: { caseSensitive?: boolean } = {},
): TextMatch {
  const a = normalizeAnswer(answer, options);
  if (!a) return 'wrong';
  if (accepted.some((x) => normalizeAnswer(x, options) === a)) return 'exact';
  const loose = normalizeAnswer(answer, { ...options, stripAccents: true });
  if (accepted.some((x) => normalizeAnswer(x, { ...options, stripAccents: true }) === loose))
    return 'accent';
  return 'wrong';
}
