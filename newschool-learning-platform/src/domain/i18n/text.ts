// Mixing languages in one line of text.

/**
 * Wrap a value in Unicode "first strong isolate" marks so it keeps its own
 * direction inside a sentence of the other direction ("הושלם: ¡Hola!" stays
 * readable). Use for plain-text interpolation; in markup prefer <bdi> or dir.
 */
export function isolate(text: string): string {
  return `⁨${text}⁩`;
}

/**
 * A language's name in the interface language ("es" → "ספרדית" / "Spanish"),
 * from the browser/runtime's own data, so names never need translating by hand.
 */
export function languageName(code: string, uiLocale: string, fallback: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? fallback;
  } catch {
    return fallback;
  }
}
