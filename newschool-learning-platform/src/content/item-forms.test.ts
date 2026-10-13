import { describe, expect, it } from 'vitest';
import { authoredItemSchema } from './activities-file';
import { checkActivityDoc } from './activity-editor';
import type { FieldSpec } from './block-forms';
import { ITEM_TYPES, itemFields, itemSummary, newItem } from './item-forms';

/** What an author would type into every empty required field. */
function fill(value: unknown, field: FieldSpec): unknown {
  if (field.kind === 'rows') return (value as string[][]).map((row) => row.map((c) => c || 'x'));
  if (field.kind === 'list')
    return (value as Record<string, unknown>[]).map((rec, i) => {
      const out = { ...rec };
      for (const f of field.fields) if (f.key in out) out[f.key] = fill(out[f.key], f);
      if ('text' in out) out.text = `${out.text as string}${i}`;
      return out;
    });
  if (typeof value === 'string') return value || 'x';
  return value;
}

describe('question form descriptions', () => {
  it('cover every question type in the schema', () => {
    const schemaTypes = authoredItemSchema.options.map((o) => o.shape.type.value).sort();
    expect([...ITEM_TYPES].sort()).toEqual(schemaTypes);
  });

  it('name only fields the schema has', () => {
    for (const option of authoredItemSchema.options) {
      const type = option.shape.type.value;
      const keys = Object.keys(option.shape);
      for (const field of itemFields(type))
        expect(keys, `${type}.${field.key}`).toContain(field.key);
    }
  });

  it('give every type a new question that is valid once written', () => {
    for (const type of ITEM_TYPES) {
      const item = newItem(type, new Set());
      for (const field of itemFields(type))
        if (field.key in item) item[field.key] = fill(item[field.key], field);
      if (type === 'fillBlank') item.text = 'Me ___ Ana.';
      if (type === 'reorderSentence') item.sentence = 'Me llamo Ana';
      const result = checkActivityDoc({ items: [item] }, 'ex');
      expect(result.ok, `${type}: ${JSON.stringify(!result.ok && result.problems)}`).toBe(true);
    }
  });

  it('starts a multiple-choice question with two options, the first one right', () => {
    const item = newItem('multipleChoice', new Set(['question-1']));
    expect(item.id).toBe('question-2');
    expect(item.options).toEqual([
      { text: '', correct: true },
      { text: '', correct: false },
    ]);
  });

  it('summarises a question by its prompt', () => {
    expect(itemSummary({ prompt: '¿Cómo te   **llamas**?' })).toBe('¿Cómo te llamas?');
    expect(itemSummary({ prompt: [{ id: 'p', type: 'text', text: 'Read this.' }] })).toBe(
      'Read this.',
    );
    expect(itemSummary({ prompt: '' })).toBe('');
  });
});
