import { describe, expect, it } from 'vitest';
import { SLUG_PATTERN, slugBase, staffExerciseSlug } from './exercise-slug';

describe('staff exercise slugs', () => {
  it('keeps the Latin letters of the title and adds the random ending', () => {
    expect(staffExerciseSlug('Repaso: los números', 'a1b2c3')).toBe('repaso-los-numeros-a1b2c3');
    expect(staffExerciseSlug('Révision — Café!', 'ZZ9')).toBe('revision-cafe-zz9');
  });

  it('names Hebrew and empty titles "exercise"', () => {
    expect(staffExerciseSlug('חזרה על המספרים', 'f00d')).toBe('exercise-f00d');
    expect(staffExerciseSlug('   ', 'f00d')).toBe('exercise-f00d');
    expect(slugBase('חזרה 2')).toBe('2');
  });

  it('always gives a valid slug of bounded length', () => {
    const titles = ['a'.repeat(300), '--x--', 'Ünïcödé ✓ 123', '', '日本語', 'a - b - c'];
    const suffixes = ['', '---', 'ABCDEF-123456-789', 'e5f6a7b8'];
    for (const title of titles) {
      for (const suffix of suffixes) {
        const slug = staffExerciseSlug(title, suffix);
        expect(slug).toMatch(SLUG_PATTERN);
        expect(slug.length).toBeLessThanOrEqual(80);
      }
    }
  });
});
