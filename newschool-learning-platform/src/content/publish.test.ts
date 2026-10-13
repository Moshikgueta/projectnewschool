// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { validateContent } from './files';
import { publishCourseAsPilot, publishCycle } from './publish';

const COURSE = `# A course file, with a comment that must survive.
slug: en-1
title: English 1
language:
  code: en
  name: English
level:
  code: '1'
  title: Level 1
instructionLocale: he
status: draft
books:
  notebook: Notebook
`;

const CYCLE = `# Converted cycle. DRAFT for teacher review.
course: en-1
slug: family
title: Family
position: 1
status: in_review # set by the converter

review:
  - >-
    Is "status: in_review" the right register here?
sections:
  - slug: class
    title: Class
    phase: during_class
    status: in_review
    blocks:
      - id: intro
        type: text
        text: "status: draft is not a line to change"
  - slug: extra
    title: Extra
    phase: optional
    status: draft
    blocks:
      - id: more
        type: text
        text: More.
`;

describe('publishing content as a pilot', () => {
  it('publishes a course and marks it pilot, changing nothing else', () => {
    const { text, changed } = publishCourseAsPilot(COURSE);
    expect(changed).toBe(true);
    expect(text).toBe(COURSE.replace('status: draft\n', 'status: published\npilot: true\n'));
    expect(parse(text)).toEqual({ ...parse(COURSE), status: 'published', pilot: true });
  });

  it('is repeatable: a published pilot course is left as it is', () => {
    const once = publishCourseAsPilot(COURSE).text;
    expect(publishCourseAsPilot(once)).toEqual({ text: once, changed: false });
  });

  it('turns an existing `pilot: false` on, and adds a missing status', () => {
    const off = COURSE.replace('status: draft\n', 'status: in_review\npilot: false\n');
    expect(publishCourseAsPilot(off).text).toBe(
      COURSE.replace('status: draft\n', 'status: published\npilot: true\n'),
    );
    const bare = COURSE.replace('status: draft\n', '');
    expect(parse(publishCourseAsPilot(bare).text)).toEqual({
      ...parse(bare),
      status: 'published',
      pilot: true,
    });
  });

  it('publishes a cycle and its in-review sections; keeps review questions, drafts and text', () => {
    const { text, changed } = publishCycle(CYCLE);
    expect(changed).toBe(true);
    const before = parse(CYCLE);
    const after = parse(text);
    expect(after.status).toBe('published');
    expect(after.review).toEqual(before.review);
    expect(after.sections[0].status).toBe('published');
    expect(after.sections[1].status).toBe('draft');
    expect(after.sections[0].blocks).toEqual(before.sections[0].blocks);
    // Comments and layout survive: only two lines differ.
    const diff = text.split('\n').filter((line, i) => line !== CYCLE.split('\n')[i]);
    expect(diff).toEqual(['status: published # set by the converter', '    status: published']);
    expect(publishCycle(text)).toEqual({ text, changed: false });
  });

  it('leaves archived content archived', () => {
    const archived = CYCLE.replace('status: in_review # set', 'status: archived # set');
    expect(parse(publishCycle(archived).text).status).toBe('archived');
  });

  it('keeps Windows line endings', () => {
    const crlf = COURSE.replace(/\n/g, '\r\n');
    const { text } = publishCourseAsPilot(crlf);
    expect(text).toContain('status: published\r\npilot: true\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('refuses a file with two top-level status lines', () => {
    expect(() => publishCycle(`${CYCLE}status: draft\n`)).toThrow();
  });

  it('the result validates: a published pilot course may have open review questions', () => {
    const files = [
      { file: 'content/en-1/course.yaml', data: parse(publishCourseAsPilot(COURSE).text) },
      { file: 'content/en-1/01-family.yaml', data: parse(publishCycle(CYCLE).text) },
    ];
    expect(validateContent(files).problems).toEqual([]);
  });

  // Cheap on purpose (every file is fully validated in files.test.ts): the
  // top-level lines say the release was applied to every file.
  it('every course in content/ is a published pilot, and every cycle published', () => {
    const root = join(process.cwd(), 'content');
    const top = (text: string, key: string) =>
      text.split(/\r?\n/).filter((l) => l.startsWith(`${key}:`));
    for (const course of readdirSync(root, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    )) {
      const dir = join(root, course.name);
      const text = readFileSync(join(dir, 'course.yaml'), 'utf8');
      expect([course.name, top(text, 'status'), top(text, 'pilot')]).toEqual([
        course.name,
        ['status: published'],
        ['pilot: true'],
      ]);
      for (const file of readdirSync(dir).filter(
        (f) => f !== 'course.yaml' && f.endsWith('.yaml'),
      )) {
        const cycleText = readFileSync(join(dir, file), 'utf8');
        expect([file, top(cycleText, 'status')]).toEqual([file, ['status: published']]);
      }
    }
  });
});
