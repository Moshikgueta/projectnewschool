// The section editor's document (Phase 8, ADR-034): a notebook or workbook
// section as YAML, in the same block format as the content files, so what
// authors learned for files works here and the same schemas check it.
//
//   blocks:          the student view (block catalogue, CONTENT-MODEL.md §3)
//   teacherNotes:    teacher-only notes anchored to block ids
//
// An `activity` block names its exercise by slug (`activity: <slug>`) as in
// the files; stored documents hold the activity's id.

import { isMap, isSeq, parseDocument, stringify } from 'yaml';
import { z } from 'zod';
import { sectionDocumentSchema, teacherNotesSchema, type Block, type TeacherNote } from './schema';

/** Longest document the editor accepts (characters). */
export const MAX_SECTION_YAML = 300_000;

export type EditorProblem = { path: string; message: string };

export type ParsedSection =
  | { ok: true; blocks: Block[]; teacherNotes: TeacherNote[] }
  | { ok: false; problems: EditorProblem[] };

const editorSchema = z.strictObject({
  blocks: sectionDocumentSchema,
  teacherNotes: teacherNotesSchema.default([]),
});

/** A stored section as the editor shows it. */
export function sectionToYaml(
  section: { blocks: unknown; teacherNotes: unknown },
  activitySlugById: ReadonlyMap<string, string>,
): string {
  const blocks = (Array.isArray(section.blocks) ? section.blocks : []).map((b: unknown) => {
    if (b && typeof b === 'object' && 'type' in b && b.type === 'activity' && 'activityId' in b) {
      const { activityId, ...rest } = b as { activityId: string } & Record<string, unknown>;
      const slug = activitySlugById.get(activityId);
      return slug ? { ...rest, activity: slug } : b;
    }
    return b;
  });
  const notes = Array.isArray(section.teacherNotes) ? section.teacherNotes : [];
  return stringify(notes.length ? { blocks, teacherNotes: notes } : { blocks }, {
    lineWidth: 100,
    aliasDuplicateObjects: false,
  });
}

function pathOf(path: PropertyKey[]): string {
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : `${i ? '.' : ''}${String(p)}`))
    .join('');
}

/**
 * The editor's text back to a section: parsed (no aliases, no duplicate
 * keys), activity slugs resolved, every block and note checked, and note
 * anchors and ids cross-checked. All problems at once, each with its place.
 */
export function parseSectionYaml(
  text: string,
  activityIdBySlug: ReadonlyMap<string, string>,
): ParsedSection {
  if (text.length > MAX_SECTION_YAML) {
    return { ok: false, problems: [{ path: '', message: 'The document is too long.' }] };
  }
  const doc = parseDocument(text, { uniqueKeys: true, prettyErrors: true });
  if (doc.errors.length) {
    return {
      ok: false,
      problems: doc.errors.map((e) => ({
        path: e.linePos?.[0] ? `line ${e.linePos[0].line}` : '',
        message: e.message.split('\n')[0] ?? e.message,
      })),
    };
  }
  if (!isMap(doc.contents) || !isSeq(doc.contents.get('blocks', true))) {
    return {
      ok: false,
      problems: [{ path: 'blocks', message: 'Start with `blocks:` and a list of blocks.' }],
    };
  }

  let raw: Record<string, unknown>;
  try {
    // No aliases at all: they are never needed for content, and expanding
    // them is how a short document can be made enormous.
    raw = doc.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      problems: [{ path: '', message: 'YAML aliases (*name) are not allowed.' }],
    };
  }
  const problems: EditorProblem[] = [];
  const blocks = (raw.blocks as unknown[]).map((b, i) => {
    if (b && typeof b === 'object' && 'type' in b && b.type === 'activity' && 'activity' in b) {
      const { activity, ...rest } = b as { activity: unknown } & Record<string, unknown>;
      const id = typeof activity === 'string' ? activityIdBySlug.get(activity) : undefined;
      if (!id) {
        problems.push({
          path: `blocks[${i}].activity`,
          message: `No activity "${String(activity)}" in this course.`,
        });
        return b;
      }
      return { ...rest, activityId: id };
    }
    return b;
  });
  if (problems.length) return { ok: false, problems };

  const parsed = editorSchema.safeParse({ ...raw, blocks });
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({
        path: pathOf(issue.path),
        message: issue.message,
      })),
    };
  }

  const ids = new Set(parsed.data.blocks.map((b) => b.id));
  const noteIds = new Set<string>();
  parsed.data.teacherNotes.forEach((note, i) => {
    if (note.anchor !== null && !ids.has(note.anchor)) {
      problems.push({
        path: `teacherNotes[${i}].anchor`,
        message: `"${note.anchor}" is not the id of a block in this section.`,
      });
    }
    if (noteIds.has(note.id) || ids.has(note.id)) {
      problems.push({ path: `teacherNotes[${i}].id`, message: `Duplicate id "${note.id}".` });
    }
    noteIds.add(note.id);
  });
  if (problems.length) return { ok: false, problems };
  return { ok: true, blocks: parsed.data.blocks, teacherNotes: parsed.data.teacherNotes };
}
