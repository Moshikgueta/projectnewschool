// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { describe, expect, it } from 'vitest';
import { validateContent } from './files';

const course = {
  slug: 'en-1',
  title: 'English 1',
  language: { code: 'en', name: 'English' },
  level: { code: '1', title: 'Level 1' },
  books: { notebook: 'Notebook' },
};

function cycle(overrides: Record<string, unknown> = {}) {
  return {
    course: 'en-1',
    slug: 'family',
    title: 'Family',
    position: 1,
    sections: [
      {
        slug: 'class',
        title: 'Class',
        phase: 'during_class',
        blocks: [{ id: 'intro', type: 'sentenceFrame', frame: 'I am ___.' }],
        teacherNotes: [{ id: 'n1', anchor: 'intro', text: 'Go around the group.' }],
      },
    ],
    ...overrides,
  };
}

const run = (...cycles: unknown[]) =>
  validateContent([
    { file: 'content/en-1/course.yaml', data: course },
    ...cycles.map((data, i) => ({ file: `content/en-1/0${i}.yaml`, data })),
  ]);

describe('content files', () => {
  it('accept a valid course and cycle', () => {
    const result = run(cycle());
    expect(result.problems).toEqual([]);
    expect(result.cycles[0]?.sections[0]?.book).toBe('notebook');
  });

  it('reject teacher notes anchored to a block that does not exist', () => {
    const bad = cycle();
    bad.sections[0]!.teacherNotes[0]!.anchor = 'gone';
    expect(run(bad).problems).toEqual([
      expect.objectContaining({ path: 'sections.0.teacherNotes.0.anchor' }),
    ]);
  });

  it('reject cycles of unknown courses, duplicate slugs and duplicate positions', () => {
    const messages = run(
      cycle(),
      cycle({ course: 'nope' }),
      cycle({ slug: 'other' }),
      cycle({ position: 3 }),
    ).problems.map((p) => p.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'No course.yaml defines course "nope"',
        expect.stringMatching(/^Cycle "family" is also used/),
        expect.stringMatching(/^Position 1 is also used/),
      ]),
    );
  });

  it('reject duplicate vocabulary terms (any case)', () => {
    const items = [{ term: 'Mother' }, { term: 'mother' }];
    const problems = run(
      cycle({ vocabulary: [{ slug: 'family', title: 'Family', items }] }),
    ).problems;
    expect(problems.map((p) => p.message)).toEqual(['Duplicate term "mother"']);
  });

  it('reject unknown fields, so typos are not silently ignored', () => {
    const problems = run(cycle({ titel: 'Family' })).problems;
    expect(problems[0]?.message).toMatch(/Unrecognized key/);
  });

  it('reject links to hosts that are not allow-listed', () => {
    const bad = cycle();
    bad.sections[0]!.blocks.push({
      id: 'link',
      type: 'externalLink',
      label: 'Worksheet',
      url: 'https://example.com/sheet',
    } as never);
    expect(run(bad).problems[0]?.message).toBe('Link host is not on the allow-list');
  });

  // The repository's own content must always be valid (Phase 3 exit criterion:
  // invalid content fails CI).
  it('every file in content/ is valid', () => {
    const root = join(process.cwd(), 'content');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(dir, e.name))
          : /\.ya?ml$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const files = walk(root).map((path) => {
      const doc = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true });
      expect(doc.errors, path).toEqual([]);
      return { file: relative(process.cwd(), path), data: doc.toJS() as unknown };
    });
    expect(files.length).toBeGreaterThan(0);
    expect(validateContent(files).problems).toEqual([]);
  });
});
