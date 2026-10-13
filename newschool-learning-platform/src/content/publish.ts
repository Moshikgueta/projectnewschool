// Publishing content files as a pilot (school owner, 2026-10-13; ADR-040),
// used by `pnpm content:publish-pilot` (scripts/publish-pilot.ts).
//
// The files are edited as text, line by line, so comments, quoting, folding
// and key order stay exactly as written: only the top-level `status:` line
// changes (and a `pilot: true` line is added to course.yaml). Every edit is
// then checked by parsing the file before and after: if anything but those
// fields differs, the edit is refused.

import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';

export type PublishResult = { text: string; changed: boolean };

/** Statuses a pilot release publishes. Archived content stays archived. */
const PUBLISHABLE = new Set(['draft', 'in_review']);

const TOP_STATUS = /^status:[ \t]*(['"]?)([a-z_]+)\1[ \t]*(#.*)?$/;
const TOP_PILOT = /^pilot:[ \t]*(\S+)?[ \t]*(#.*)?$/;
/** A section's own status (sections are list entries under `sections:`, indented by 4). */
const SECTION_STATUS = /^( {4})status:[ \t]*(['"]?)in_review\2[ \t]*(#.*)?$/;

function splitLines(text: string): { lines: string[]; eol: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return { lines: text.split(/\r?\n/), eol };
}

function comment(trailing: string | undefined): string {
  return trailing ? ` ${trailing}` : '';
}

/** Top-level `status:` of a file set to published (draft / in review only). */
function publishStatusLine(lines: string[]): { lines: string[]; index: number } {
  let index = -1;
  const out = lines.map((line, i) => {
    const m = TOP_STATUS.exec(line);
    if (!m) return line;
    if (index !== -1) throw new Error('More than one top-level `status:` line');
    index = i;
    return PUBLISHABLE.has(m[2] ?? '') ? `status: published${comment(m[3])}` : line;
  });
  return { lines: out, index };
}

/**
 * course.yaml: `status: published` and `pilot: true`. The pilot line goes
 * right after the status line (or replaces an existing `pilot:` line); a
 * file without a status line gets both at the end.
 */
export function publishCourseAsPilot(text: string): PublishResult {
  const { lines: input, eol } = splitLines(text);
  const pilotAt = input.findIndex((l) => TOP_PILOT.test(l));
  const published = publishStatusLine(input);
  const index = published.index;
  let lines = published.lines;
  if (pilotAt !== -1) {
    const m = TOP_PILOT.exec(lines[pilotAt]!)!;
    lines[pilotAt] = `pilot: true${comment(m[2])}`;
    if (index === -1)
      lines = [...lines.slice(0, pilotAt), 'status: published', ...lines.slice(pilotAt)];
  } else if (index !== -1) {
    lines = [...lines.slice(0, index + 1), 'pilot: true', ...lines.slice(index + 1)];
  } else {
    const end = lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    lines = [...lines.slice(0, end), 'status: published', 'pilot: true', ...lines.slice(end)];
  }
  const out = lines.join(eol);
  assertOnlyChanged(text, out, (data) => ({
    ...data,
    status:
      data.status === undefined || PUBLISHABLE.has(String(data.status)) ? 'published' : data.status,
    pilot: true,
  }));
  return { text: out, changed: out !== text };
}

/**
 * A cycle file: its top-level status, and any section's own `in_review`
 * status, set to published. Draft sections stay drafts (a section is marked
 * draft on purpose); everything else, `review:` included, is left as it is.
 */
export function publishCycle(text: string): PublishResult {
  const { lines: input, eol } = splitLines(text);
  const top = publishStatusLine(input);
  const lines = top.lines.map((line) => {
    const m = SECTION_STATUS.exec(line);
    return m ? `${m[1]}status: published${comment(m[3])}` : line;
  });
  const out = lines.join(eol);
  assertOnlyChanged(text, out, (data) => {
    const result: Record<string, unknown> = { ...data };
    if (top.index !== -1 && PUBLISHABLE.has(String(data.status))) result.status = 'published';
    if (Array.isArray(data.sections)) {
      result.sections = data.sections.map((s: unknown) =>
        s && typeof s === 'object' && (s as { status?: unknown }).status === 'in_review'
          ? { ...s, status: 'published' }
          : s,
      );
    }
    return result;
  });
  return { text: out, changed: out !== text };
}

/** Refuse an edit that changed anything but what `expected` says it should. */
function assertOnlyChanged(
  before: string,
  after: string,
  expected: (data: Record<string, unknown>) => Record<string, unknown>,
): void {
  const parsedBefore: unknown = parse(before);
  const parsedAfter: unknown = parse(after);
  if (!parsedBefore || typeof parsedBefore !== 'object' || Array.isArray(parsedBefore))
    throw new Error('Not a YAML mapping');
  if (!isDeepStrictEqual(parsedAfter, expected(parsedBefore as Record<string, unknown>)))
    throw new Error('The edit would change more than the status and pilot fields');
}
