import { describe, expect, it } from 'vitest';
import { directionOf, isLocale, resolveLocale } from './locales';

describe('directionOf', () => {
  it('knows the right-to-left languages the school teaches or may teach', () => {
    expect(directionOf('he')).toBe('rtl');
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('ar-EG')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('es')).toBe('ltr');
    expect(directionOf('el')).toBe('ltr');
  });
});

describe('resolveLocale', () => {
  it('uses an explicit preference first', () => {
    expect(resolveLocale({ preferred: 'en', acceptLanguage: 'he' })).toBe('en');
    expect(resolveLocale({ preferred: 'he', acceptLanguage: 'en-US' })).toBe('he');
  });

  it('ignores an unsupported preference', () => {
    expect(resolveLocale({ preferred: 'fr', acceptLanguage: 'en-US,en;q=0.9' })).toBe('en');
  });

  it('follows the browser’s ranking among supported languages', () => {
    expect(resolveLocale({ acceptLanguage: 'en-US,en;q=0.9,he;q=0.8' })).toBe('en');
    expect(resolveLocale({ acceptLanguage: 'he-IL,he;q=0.9,en;q=0.5' })).toBe('he');
    expect(resolveLocale({ acceptLanguage: 'pt-BR,pt;q=0.9,en;q=0.7' })).toBe('en');
    expect(resolveLocale({ acceptLanguage: 'en;q=0.2,he;q=0.8' })).toBe('he');
  });

  it('falls back to Hebrew', () => {
    expect(resolveLocale({})).toBe('he');
    expect(resolveLocale({ acceptLanguage: 'fr-FR' })).toBe('he');
    expect(resolveLocale({ acceptLanguage: 'garbage;;;' })).toBe('he');
  });

  it('only accepts known locales', () => {
    expect(isLocale('he')).toBe(true);
    expect(isLocale('xx')).toBe(false);
  });
});
