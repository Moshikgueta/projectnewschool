import { describe, expect, it } from 'vitest';
import { isolate, languageName } from './text';

describe('languageName', () => {
  it('names the course language in the interface language', () => {
    expect(languageName('es', 'he', 'Spanish')).toBe('ספרדית');
    expect(languageName('es', 'en', 'Spanish')).toBe('Spanish');
    expect(languageName('ar', 'he', 'Arabic')).toBe('ערבית');
  });

  it('falls back to the stored name for an invalid code', () => {
    expect(languageName('not a code!', 'he', 'Stored')).toBe('Stored');
  });
});

describe('isolate', () => {
  it('wraps text in first-strong-isolate marks', () => {
    expect(isolate('¡Hola!')).toBe('⁨¡Hola!⁩');
  });
});
