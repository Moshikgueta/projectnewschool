import { describe, expect, it } from 'vitest';
import { BLOCK_FIELDS, BLOCK_TYPES, blockSummary, newBlock, type FieldSpec } from './block-forms';
import { blockSchema } from './schema';

/** What an author would type into every empty required field. */
function fill(value: unknown, field?: FieldSpec): unknown {
  if (field?.kind === 'activity') return 'saludos-practica';
  if (field?.kind === 'url') return 'https://docs.google.com/document/d/x';
  if (typeof value === 'string') return value || 'x';
  if (Array.isArray(value)) {
    if (field?.kind === 'lines') return value.length ? value : ['x'];
    if (field?.kind === 'rows') return [['x']];
    if (field?.kind === 'list')
      return value.map((v) => fillRecord(v as Record<string, unknown>, field.fields));
    return value;
  }
  return value;
}
function fillRecord(rec: Record<string, unknown>, fields: FieldSpec[]) {
  const out = { ...rec };
  for (const f of fields) if (f.key in out) out[f.key] = fill(out[f.key], f);
  return out;
}

describe('block form descriptions', () => {
  it('cover every block type in the schema', () => {
    const schemaTypes = blockSchema.options.map((o) => o.shape.type.value).sort();
    expect([...BLOCK_TYPES].sort()).toEqual(schemaTypes);
  });

  it('name only fields the schema has (activity blocks use the slug, as in files)', () => {
    for (const option of blockSchema.options) {
      const type = option.shape.type.value;
      const keys = Object.keys(option.shape).map((k) => (k === 'activityId' ? 'activity' : k));
      for (const field of BLOCK_FIELDS[type])
        expect(keys, `${type}.${field.key}`).toContain(field.key);
    }
  });

  it('give every type a template that is valid once the required fields are written', () => {
    for (const type of BLOCK_TYPES) {
      const block = fillRecord(newBlock(type, new Set()), BLOCK_FIELDS[type]);
      const { activity, ...rest } = block as { activity?: string } & Record<string, unknown>;
      const stored = activity
        ? { ...rest, activityId: '70000000-0000-4000-8000-000000000001' }
        : block;
      const result = blockSchema.safeParse(stored);
      expect(result.success, `${type}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('gives new blocks ids not used on the page', () => {
    expect(newBlock('discussionQuestions', new Set(['discussion-questions-1'])).id).toBe(
      'discussion-questions-2',
    );
  });

  it('summarises a block in a few words', () => {
    expect(blockSummary({ type: 'text', text: 'Say **hello** to   everyone.' })).toBe(
      'Say hello to everyone.',
    );
    expect(blockSummary({ type: 'dialogue', lines: [{ speaker: 'Ana', text: 'Hola' }] })).toBe(
      'Ana',
    );
    expect(blockSummary({ type: 'table', rows: [['a', 'b']] })).toBe('a · b');
    expect(blockSummary({ type: 'text', text: 'x'.repeat(200) })).toHaveLength(80);
  });
});
