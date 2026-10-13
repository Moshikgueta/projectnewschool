import { describe, expect, it } from 'vitest';
import { activityToYaml, parseActivityYaml, STARTER_ITEM } from './activity-editor';

describe('exercise editor document', () => {
  it('round-trips an exercise through YAML', () => {
    const doc = { instructions: [], items: [STARTER_ITEM] };
    const yaml = activityToYaml(doc);
    expect(yaml.startsWith('items:')).toBe(true);
    expect(parseActivityYaml(yaml, 'ex')).toEqual({ ok: true, doc });
  });

  it('applies the import’s checks: a right answer must be marked, ids are unique', () => {
    const result = parseActivityYaml(
      [
        'items:',
        '  - id: q1',
        '    type: multipleChoice',
        '    prompt: Pick one',
        '    options:',
        '      - text: A',
        '      - text: B',
        '  - id: q1',
        '    type: trueFalse',
        '    prompt: True?',
        '    answer: true',
      ].join('\n'),
      'ex',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual(
      expect.arrayContaining([
        { path: 'items[0]', message: 'mark at least one option as correct' },
        { path: 'items[1].id', message: 'Duplicate item id "q1"' },
      ]),
    );
  });

  it('refuses broken YAML, aliases, unknown fields and empty exercises', () => {
    expect(parseActivityYaml('items: [', 'ex').ok).toBe(false);
    expect(parseActivityYaml('items:\n  - &a {id: q}\n  - *a\n', 'ex').ok).toBe(false);
    expect(parseActivityYaml('items: []\n', 'ex').ok).toBe(false);
    const extra = parseActivityYaml(
      'items:\n  - id: q\n    type: trueFalse\n    prompt: x\n    answer: true\n    secret: 1\n',
      'ex',
    );
    expect(extra.ok).toBe(false);
  });
});
