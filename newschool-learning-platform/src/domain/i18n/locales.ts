// Interface languages. The interface language is independent of the language
// a course teaches and of each content block's direction (ADR-009).

export const LOCALES = ['he', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'he';

const RTL: ReadonlySet<string> = new Set(['he', 'ar', 'fa', 'ur', 'yi']);

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Text direction of a language tag ("he", "ar-EG", "en-GB" …). */
export function directionOf(tag: string): 'ltr' | 'rtl' {
  return RTL.has(tag.toLowerCase().split('-')[0] ?? '') ? 'rtl' : 'ltr';
}

/**
 * Pick the interface language: an explicit choice (profile or cookie) wins;
 * otherwise the browser's preferred supported language; otherwise Hebrew.
 */
export function resolveLocale(options: {
  preferred?: string | null | undefined;
  acceptLanguage?: string | null | undefined;
}): Locale {
  if (isLocale(options.preferred)) return options.preferred;

  const ranked = (options.acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return {
        base: tag.toLowerCase().split('-')[0] ?? '',
        weight: Number.isFinite(weight) ? weight : 0,
        index,
      };
    })
    .filter((entry) => entry.base && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  return ranked.map((entry) => entry.base).find(isLocale) ?? DEFAULT_LOCALE;
}
