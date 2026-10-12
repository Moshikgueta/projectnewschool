// Short names (slugs) for exercises written by teachers and the office
// (ADR-038). Staff don't choose one: it is made from the title, with a random
// ending so two people writing "Revision" in the same course don't collide
// (slugs are unique per course, and a teacher cannot see every exercise of
// the course to check). Hebrew or other non-Latin titles give "exercise-…".

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const MAX_BASE = 40;

/** The Latin letters and digits of a title, as a slug part ('' if none). */
export function slugBase(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE)
    .replace(/-+$/, '');
}

/**
 * A slug for a staff exercise: the title's slug part and `suffix` (random,
 * from the caller; only its letters and digits are kept).
 */
export function staffExerciseSlug(title: string, suffix: string): string {
  const end =
    suffix
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 12) || '0';
  const base = slugBase(title) || 'exercise';
  return `${base}-${end}`;
}
