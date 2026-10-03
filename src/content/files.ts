// Content files (content/**/*.yaml): the format pedagogical staff and the
// migration produce before the CMS exists (docs/CONTENT-MODEL.md §6). Pure
// validation, shared by `pnpm content:validate`, `pnpm content:import` and
// unit tests. Everything is keyed by slugs so imports are idempotent.

import { z } from 'zod';
import { sectionDocumentSchema, teacherNotesSchema } from './schema';

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits and dashes');
const status = z.enum(['draft', 'in_review', 'published', 'archived']);

export const courseFileSchema = z.strictObject({
  slug,
  title: z.string().min(1).max(160),
  description: z.string().max(2000).default(''),
  /** Language the course teaches. Created if missing. */
  language: z.strictObject({
    code: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
    name: z.string().min(1).max(80),
    direction: z.enum(['ltr', 'rtl']).default('ltr'),
  }),
  level: z.strictObject({
    code: z.string().min(1).max(40),
    title: z.string().min(1).max(120),
    position: z.number().int().min(0).default(0),
    cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
  }),
  /** Language students are taught in (glosses, instructions). */
  instructionLocale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .default('he'),
  status: status.default('draft'),
  books: z.strictObject({
    notebook: z.string().min(1).max(160),
    workbook: z.string().min(1).max(160).optional(),
  }),
});
export type CourseFile = z.infer<typeof courseFileSchema>;

const sectionSchema = z.strictObject({
  slug,
  book: z.enum(['notebook', 'workbook']).default('notebook'),
  title: z.string().min(1).max(200),
  phase: z.enum(['before_class', 'during_class', 'after_class', 'review', 'optional']),
  /** Defaults to the cycle's status. */
  status: status.optional(),
  blocks: sectionDocumentSchema,
  teacherNotes: teacherNotesSchema.default([]),
});

const vocabularySetSchema = z.strictObject({
  slug,
  title: z.string().min(1).max(160),
  items: z
    .array(
      z.strictObject({
        term: z.string().trim().min(1).max(200),
        gloss: z.string().trim().max(400).default(''),
        example: z.string().max(600).default(''),
      }),
    )
    .min(1)
    .max(500),
});

export const cycleFileSchema = z
  .strictObject({
    /** Slug of the course this cycle belongs to (its course.yaml). */
    course: slug,
    slug,
    title: z.string().min(1).max(160),
    goal: z.string().max(500).default(''),
    position: z.number().int().min(0),
    status: status.default('draft'),
    /** Open questions for the reviewing teacher; never shown to students. */
    review: z.array(z.string().min(1).max(1000)).default([]),
    sections: z.array(sectionSchema).min(1).max(50),
    vocabulary: z.array(vocabularySetSchema).max(20).default([]),
  })
  .superRefine((cycle, ctx) => {
    const seen = new Set<string>();
    cycle.sections.forEach((section, i) => {
      const key = `${section.book}/${section.slug}`;
      if (seen.has(key))
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate section "${key}"`,
          path: ['sections', i, 'slug'],
        });
      seen.add(key);

      const ids = new Set(section.blocks.map((b) => b.id));
      const noteIds = new Set<string>();
      section.teacherNotes.forEach((note, j) => {
        const path = ['sections', i, 'teacherNotes', j];
        if (note.anchor !== null && !ids.has(note.anchor))
          ctx.addIssue({
            code: 'custom',
            message: `Note anchor "${note.anchor}" is not a block id`,
            path: [...path, 'anchor'],
          });
        if (noteIds.has(note.id) || ids.has(note.id))
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate id "${note.id}"`,
            path: [...path, 'id'],
          });
        noteIds.add(note.id);
      });
    });

    const sets = new Set<string>();
    cycle.vocabulary.forEach((set, i) => {
      if (sets.has(set.slug))
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate vocabulary set "${set.slug}"`,
          path: ['vocabulary', i, 'slug'],
        });
      sets.add(set.slug);
      const terms = new Set<string>();
      set.items.forEach((item, j) => {
        const key = item.term.toLowerCase();
        if (terms.has(key))
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate term "${item.term}"`,
            path: ['vocabulary', i, 'items', j, 'term'],
          });
        terms.add(key);
      });
    });
  });
export type CycleFile = z.infer<typeof cycleFileSchema>;

export type ContentProblem = { file: string; path: string; message: string };

/** Zod issues as readable "file › path: message" problems. */
export function problemsOf(file: string, error: z.ZodError): ContentProblem[] {
  return error.issues.map((issue) => ({
    file,
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Validate a set of parsed files: each against its schema, then across files
 * (every cycle names a known course; no two cycles share a slug or position).
 */
export function validateContent(files: { file: string; data: unknown }[]): {
  courses: (CourseFile & { file: string })[];
  cycles: (CycleFile & { file: string })[];
  problems: ContentProblem[];
} {
  const problems: ContentProblem[] = [];
  const courses: (CourseFile & { file: string })[] = [];
  const cycles: (CycleFile & { file: string })[] = [];

  for (const { file, data } of files) {
    const isCourse = /(^|\/)course\.ya?ml$/.test(file);
    const parsed = (isCourse ? courseFileSchema : cycleFileSchema).safeParse(data);
    if (!parsed.success) {
      problems.push(...problemsOf(file, parsed.error));
      continue;
    }
    if (isCourse) courses.push({ ...(parsed.data as CourseFile), file });
    else cycles.push({ ...(parsed.data as CycleFile), file });
  }

  const courseSlugs = new Map<string, string>();
  for (const c of courses) {
    const other = courseSlugs.get(c.slug);
    if (other)
      problems.push({
        file: c.file,
        path: 'slug',
        message: `Course "${c.slug}" is also defined in ${other}`,
      });
    courseSlugs.set(c.slug, c.file);
  }
  const cycleKeys = new Map<string, string>();
  for (const c of cycles) {
    if (!courseSlugs.has(c.course))
      problems.push({
        file: c.file,
        path: 'course',
        message: `No course.yaml defines course "${c.course}"`,
      });
    for (const [key, label] of [
      [`${c.course}/${c.slug}`, `Cycle "${c.slug}"`],
      [`${c.course}#${c.position}`, `Position ${c.position}`],
    ] as const) {
      const other = cycleKeys.get(key);
      if (other)
        problems.push({ file: c.file, path: 'slug', message: `${label} is also used in ${other}` });
      cycleKeys.set(key, c.file);
    }
  }
  return { courses, cycles, problems };
}
