// The exercise editor's document (Phase 8, ADR-036): an exercise's
// instructions and items in the content files' authored form, as YAML. The
// same schemas and checks as `content:import` apply (answers marked, no
// answer given away by order or ids).

import { isMap, parseDocument, stringify } from 'yaml';
import { z } from 'zod';
import { authoredItemSchema, checkActivity, type AuthoredItem } from './activities-file';
import type { EditorProblem } from './editor';
import { blockSchema, type Block } from './schema';

const MAX = 300_000;

const documentSchema = z.strictObject({
  instructions: z.array(blockSchema).max(20).default([]),
  items: z.array(authoredItemSchema).min(1).max(60),
});

export type ActivityDocument = { instructions: Block[]; items: AuthoredItem[] };

export function activityToYaml(doc: ActivityDocument): string {
  return stringify(doc.instructions.length ? doc : { items: doc.items }, {
    lineWidth: 100,
    aliasDuplicateObjects: false,
  });
}

function pathOf(path: PropertyKey[]): string {
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : `${i ? '.' : ''}${String(p)}`))
    .join('');
}

export function parseActivityYaml(
  text: string,
  activitySlug: string,
): { ok: true; doc: ActivityDocument } | { ok: false; problems: EditorProblem[] } {
  if (text.length > MAX)
    return { ok: false, problems: [{ path: '', message: 'The document is too long.' }] };
  const parsed = parseDocument(text, { uniqueKeys: true, prettyErrors: true });
  if (parsed.errors.length) {
    return {
      ok: false,
      problems: parsed.errors.map((e) => ({
        path: e.linePos?.[0] ? `line ${e.linePos[0].line}` : '',
        message: e.message.split('\n')[0] ?? e.message,
      })),
    };
  }
  if (!isMap(parsed.contents)) {
    return {
      ok: false,
      problems: [{ path: 'items', message: 'Start with `items:` and a list of items.' }],
    };
  }
  let raw: unknown;
  try {
    raw = parsed.toJS({ maxAliasCount: 0 });
  } catch {
    return {
      ok: false,
      problems: [{ path: '', message: 'YAML aliases (*name) are not allowed.' }],
    };
  }
  return checkActivityDoc(raw, activitySlug);
}

/**
 * Check an exercise document as the form editor holds it (plain values, as
 * parsed from YAML): the same schemas and checks as the YAML.
 */
export function checkActivityDoc(
  raw: unknown,
  activitySlug: string,
): { ok: true; doc: ActivityDocument } | { ok: false; problems: EditorProblem[] } {
  const result = documentSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      problems: result.error.issues.map((i) => ({ path: pathOf(i.path), message: i.message })),
    };
  }
  const problems = checkActivity({
    slug: activitySlug,
    title: 'x',
    phase: 'after_class',
    scoring: 'practice',
    instructions: result.data.instructions,
    items: result.data.items,
  }).map((p) => {
    const [where, ...message] = p.split(': ');
    const path = (where ?? '').replace(/^items\.(\d+)/, 'items[$1]');
    return { path, message: message.join(': ') };
  });
  if (problems.length) return { ok: false, problems };
  return { ok: true, doc: result.data };
}

/** The form editor's document: what the YAML holds, before any checks. */
export type ActivityFormDoc = { instructions: unknown[]; items: Record<string, unknown>[] };

/** YAML to the form editor's document, or null when the YAML is not readable as one. */
export function yamlToActivityDoc(text: string): ActivityFormDoc | null {
  if (text.length > MAX) return null;
  const parsed = parseDocument(text, { uniqueKeys: true });
  if (parsed.errors.length || !isMap(parsed.contents)) return null;
  try {
    const raw = parsed.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
    const items = Array.isArray(raw.items) ? raw.items : [];
    if (!items.every((i) => i && typeof i === 'object' && !Array.isArray(i))) return null;
    return {
      instructions: Array.isArray(raw.instructions) ? raw.instructions : [],
      items: items as Record<string, unknown>[],
    };
  } catch {
    return null;
  }
}

/** The form editor's document as YAML (what is saved). */
export function activityDocToYaml(doc: ActivityFormDoc): string {
  return stringify(doc.instructions.length ? doc : { items: doc.items }, {
    lineWidth: 100,
    aliasDuplicateObjects: false,
  });
}

/** A first item for a new exercise, to be rewritten by its author. */
export const STARTER_ITEM: AuthoredItem = {
  id: 'question-1',
  type: 'multipleChoice',
  prompt: 'Write the question here.',
  points: 1,
  feedback: {},
  options: [
    { text: 'The right answer', correct: true },
    { text: 'A wrong answer', correct: false },
  ],
};
