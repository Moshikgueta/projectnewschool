// Content block schemas (docs/CONTENT-MODEL.md §3, catalogue v1.1 from the
// content audit). One schema per block type. Content files are validated
// against these at import, and documents from the database are validated
// again before rendering: invalid blocks render a safe placeholder.

import { z } from 'zod';
import { isAllowedLink } from './links';

const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Inline text in the restricted format of inline.ts (no HTML). */
const inline = z.string().min(1).max(4000);
const shortText = z.string().min(1).max(300);
const link = z.string().refine(isAllowedLink, 'Link host is not on the allow-list');

const base = {
  id: z.string().regex(BLOCK_ID),
  /** Language of the block's text (BCP 47, e.g. "es", "he", "ar-Hebr"). Sets direction too. */
  lang: z.string().regex(LANG).optional(),
};

export const blockSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('heading'),
    level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    text: shortText,
  }),
  z.object({ ...base, type: z.literal('text'), text: inline }),
  z.object({
    ...base,
    type: z.literal('callout'),
    tone: z.enum(['tip', 'culture', 'info', 'warning']),
    title: shortText.optional(),
    text: inline,
  }),
  z.object({
    ...base,
    type: z.literal('examples'),
    items: z
      .array(z.object({ text: inline, gloss: inline.optional() }))
      .min(1)
      .max(50),
  }),
  z.object({
    ...base,
    type: z.literal('dialogue'),
    lines: z
      .array(z.object({ speaker: shortText, text: inline }))
      .min(1)
      .max(80),
    audioId: z.uuid().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('table'),
    caption: shortText.optional(),
    header: z.array(z.string().max(300)).max(8).optional(),
    rows: z
      .array(z.array(z.string().max(600)).min(1).max(8))
      .min(1)
      .max(200),
  }),
  z.object({
    ...base,
    type: z.literal('vocabulary'),
    title: shortText.optional(),
    /** Language of the glosses (usually the course's instruction language). */
    glossLang: z.string().regex(LANG).optional(),
    items: z
      .array(z.object({ term: shortText, gloss: shortText }))
      .min(1)
      .max(200),
    link: link.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('cycleOverview'),
    skills: z
      .array(z.object({ name: shortText, description: inline.optional() }))
      .min(1)
      .max(6),
  }),
  z.object({
    ...base,
    type: z.literal('sentenceFrame'),
    prompt: inline.optional(),
    frame: inline,
    example: inline.optional(),
    /** Whether students may type an answer (decision C2: optional, ungraded). */
    answerable: z.boolean().default(true),
  }),
  z.object({
    ...base,
    type: z.literal('discussionQuestions'),
    title: shortText.optional(),
    items: z
      .array(z.object({ question: inline, frame: inline.optional() }))
      .min(1)
      .max(20),
    answerable: z.boolean().default(true),
  }),
  z.object({
    ...base,
    type: z.literal('classActivity'),
    title: shortText,
    skills: z.array(shortText).max(6).default([]),
    minutes: z.number().int().min(1).max(120).optional(),
    steps: z.array(inline).min(1).max(12),
    example: inline.optional(),
    wordBank: z.array(shortText).max(60).optional(),
    resource: z.object({ label: shortText, url: link }).optional(),
  }),
  z.object({ ...base, type: z.literal('wordBank'), words: z.array(shortText).min(1).max(60) }),
  z.object({
    ...base,
    type: z.literal('ruleSummary'),
    skill: shortText,
    rules: z
      .array(z.object({ text: inline, examples: z.array(inline).max(20).optional() }))
      .min(1)
      .max(10),
  }),
  z.object({
    ...base,
    type: z.literal('aiTutorPrompt'),
    title: shortText.optional(),
    intro: inline.optional(),
    /** The message the student copies into the AI tutor (Mori). Plain text. */
    message: z.string().min(1).max(3000),
  }),
  z.object({
    ...base,
    type: z.literal('externalLink'),
    label: shortText,
    url: link,
    description: inline.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('speakingPrompt'),
    text: inline,
    minutes: z.number().int().min(1).max(60).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('reflection'),
    prompt: inline,
    answerable: z.boolean().default(true),
  }),
  /** An interactive exercise (Phase 4). */
  z.object({ ...base, type: z.literal('activity'), activityId: z.uuid() }),
]);

export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block['type'];

export const sectionDocumentSchema = z
  .array(blockSchema)
  .max(300)
  .superRefine((blocks, ctx) => {
    const seen = new Set<string>();
    blocks.forEach((b, i) => {
      if (seen.has(b.id))
        ctx.addIssue({ code: 'custom', message: `Duplicate block id "${b.id}"`, path: [i, 'id'] });
      seen.add(b.id);
    });
  });

/** Teacher-only notes, anchored to the student block they follow (ADR-022). */
export const teacherNoteSchema = z.object({
  id: z.string().regex(BLOCK_ID),
  /** Block id in the student view this note follows; null = top of the section. */
  anchor: z.string().regex(BLOCK_ID).nullable(),
  text: inline,
  minutes: z.number().int().min(1).max(120).optional(),
});
export const teacherNotesSchema = z.array(teacherNoteSchema).max(300);
export type TeacherNote = z.infer<typeof teacherNoteSchema>;

/** Block types where a student may type an answer, and how many inputs each has. */
export function answerSlots(block: Block): number {
  switch (block.type) {
    case 'sentenceFrame':
    case 'reflection':
      return block.answerable ? 1 : 0;
    case 'discussionQuestions':
      return block.answerable ? block.items.length : 0;
    default:
      return 0;
  }
}

/**
 * Parse a stored document leniently for rendering: valid blocks are kept,
 * invalid ones become `null` (rendered as a placeholder), so one bad block
 * never breaks a whole lesson.
 */
export function parseBlocksForRender(raw: unknown): (Block | null)[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const parsed = blockSchema.safeParse(item);
    return parsed.success ? parsed.data : null;
  });
}

export function parseTeacherNotes(raw: unknown): TeacherNote[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = teacherNoteSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
