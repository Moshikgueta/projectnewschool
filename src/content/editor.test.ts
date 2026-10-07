import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseSectionYaml, sectionToYaml } from './editor';
import { activityPlaceholder } from './activities-file';
import { validateContent } from './files';

const ACTIVITY_ID = '70000000-0000-4000-8000-000000000001';
const slugs = new Map([[ACTIVITY_ID, 'greetings']]);
const ids = new Map([['greetings', ACTIVITY_ID]]);

describe('section editor document', () => {
  it('turns a stored section into YAML and back without loss', () => {
    const section = {
      blocks: [
        { id: 'h1', type: 'heading', level: 2, text: '¡Hola!' },
        { id: 't1', type: 'text', text: 'Say **hello**.', lang: 'he' },
        { id: 'a1', type: 'activity', activityId: ACTIVITY_ID },
      ],
      teacherNotes: [{ id: 'n1', anchor: 'h1', text: 'Start with names.', minutes: 5 }],
    };
    const yaml = sectionToYaml(section, slugs);
    expect(yaml).toContain('activity: greetings');
    expect(yaml).not.toContain(ACTIVITY_ID);
    const back = parseSectionYaml(yaml, ids);
    expect(back).toEqual({ ok: true, ...section });
  });

  it('round-trips every section of the converted Family cycle', () => {
    const file = 'content/en-foundations-1/02-family.yaml';
    const data = parseDocument(readFileSync(file, 'utf8')).toJS() as {
      sections: { blocks: unknown[]; teacherNotes?: unknown[] }[];
      activities: { slug: string }[];
    };
    const { cycles, problems } = validateContent([
      {
        file: 'content/en-foundations-1/course.yaml',
        data: parseDocument(readFileSync('content/en-foundations-1/course.yaml', 'utf8')).toJS(),
      },
      { file, data },
    ]);
    expect(problems).toEqual([]);
    const cycle = cycles[0]!;
    const bySlug = new Map(cycle.activities.map((a) => [a.slug, activityPlaceholder(a.slug)]));
    const byId = new Map([...bySlug].map(([slug, id]) => [id, slug]));
    for (const section of cycle.sections) {
      const yaml = sectionToYaml(
        { blocks: section.blocks, teacherNotes: section.teacherNotes },
        byId,
      );
      const back = parseSectionYaml(yaml, bySlug);
      expect(back, section.slug).toEqual({
        ok: true,
        blocks: section.blocks,
        teacherNotes: section.teacherNotes,
      });
    }
  });

  it('reports every problem with where it is', () => {
    const result = parseSectionYaml(
      [
        'blocks:',
        '  - id: h1',
        '    type: heading',
        '    level: 9',
        '    text: Hi',
        '  - id: l1',
        '    type: externalLink',
        '    url: https://evil.example.com/x',
        '    label: Click',
        '  - id: a1',
        '    type: activity',
        '    activity: no-such-thing',
        'teacherNotes:',
        '  - id: n1',
        '    anchor: missing',
        '    text: Note',
      ].join('\n'),
      ids,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The unknown activity is reported first, on its own.
    expect(result.problems).toEqual([
      { path: 'blocks[2].activity', message: 'No activity "no-such-thing" in this course.' },
    ]);

    const second = parseSectionYaml(
      'blocks:\n  - id: h1\n    type: heading\n    level: 9\n    text: Hi\n  - id: l1\n    type: externalLink\n    url: https://evil.example.com/x\n    label: Click\nteacherNotes:\n  - id: n1\n    anchor: missing\n    text: Note\n',
      ids,
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    const paths = second.problems.map((p) => p.path);
    expect(paths).toContain('blocks[0].level');
    expect(paths.some((p) => p.startsWith('blocks[1]'))).toBe(true);

    const anchors = parseSectionYaml(
      'blocks:\n  - id: h1\n    type: heading\n    level: 2\n    text: Hi\nteacherNotes:\n  - id: h1\n    anchor: missing\n    text: Note\n',
      ids,
    );
    expect(anchors).toEqual({
      ok: false,
      problems: [
        {
          path: 'teacherNotes[0].anchor',
          message: '"missing" is not the id of a block in this section.',
        },
        { path: 'teacherNotes[0].id', message: 'Duplicate id "h1".' },
      ],
    });
  });

  it('refuses YAML that is broken, aliased, oddly shaped or too long', () => {
    expect(parseSectionYaml('blocks: [', ids).ok).toBe(false);
    expect(parseSectionYaml('blocks:\n  - &a {id: x}\n  - *a\n', ids)).toEqual({
      ok: false,
      problems: [{ path: '', message: 'YAML aliases (*name) are not allowed.' }],
    });
    expect(parseSectionYaml('- id: x', ids)).toEqual({
      ok: false,
      problems: [{ path: 'blocks', message: 'Start with `blocks:` and a list of blocks.' }],
    });
    expect(parseSectionYaml('blocks: []\nblocks: []\n', ids).ok).toBe(false); // duplicate key
    expect(parseSectionYaml('blocks: []\nextra: 1\n', ids).ok).toBe(false); // unknown key
    expect(parseSectionYaml('x'.repeat(300_001), ids).ok).toBe(false);
  });
});
