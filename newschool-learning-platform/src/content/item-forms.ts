// The exercise editor's form for each question type (Phase 8, ADR-037): the
// same field descriptions as the page editor's blocks (block-forms.ts), drawn
// by the same form component. The authored item schema (activities-file.ts)
// stays the rules; a unit test keeps these descriptions in step with it.

import type { AuthoredItem } from './activities-file';
import { record, type FieldSpec } from './block-forms';
import { inlineToPlainText } from './inline';

export type ItemType = AuthoredItem['type'];

const PROMPT: FieldSpec = { key: 'prompt', kind: 'text', label: 'question' };

/** After the type's own fields: points, feedback and the prompt's language. */
const COMMON_AFTER: FieldSpec[] = [
  { key: 'points', kind: 'number', min: 0, max: 100, optional: true },
  {
    key: 'feedback',
    kind: 'group',
    optional: true,
    fields: [
      { key: 'correct', kind: 'text', optional: true, label: 'feedbackCorrect' },
      { key: 'incorrect', kind: 'text', optional: true, label: 'feedbackIncorrect' },
    ],
  },
  { key: 'lang', kind: 'lang', optional: true, label: 'promptLang' },
];

const OWN: Record<ItemType, FieldSpec[]> = {
  multipleChoice: [
    {
      key: 'options',
      kind: 'list',
      fields: [
        { key: 'text', kind: 'line', label: 'optionText' },
        { key: 'correct', kind: 'boolean', initial: false, label: 'optionCorrect' },
        { key: 'feedback', kind: 'text', optional: true, label: 'optionFeedback' },
      ],
    },
  ],
  trueFalse: [{ key: 'answer', kind: 'boolean', label: 'statementTrue' }],
  fillBlank: [
    { key: 'text', kind: 'text', label: 'blankText' },
    { key: 'blanks', kind: 'rows', hint: 'blanksHint' },
    { key: 'wordBank', kind: 'lines', optional: true },
    { key: 'accents', kind: 'choice', options: ['lenient', 'strict'] },
  ],
  matching: [{ key: 'pairs', kind: 'rows', hint: 'pairsHint' }],
  reorderSentence: [
    { key: 'sentence', kind: 'line' },
    { key: 'alsoAccept', kind: 'lines', optional: true },
  ],
  shortAnswer: [{ key: 'maxLength', kind: 'number', min: 1, max: 2000, optional: true }],
  reflection: [{ key: 'maxLength', kind: 'number', min: 1, max: 2000, optional: true }],
};

export const ITEM_TYPES = Object.keys(OWN) as ItemType[];

/** The fields of an item type's form, in order. */
export function itemFields(type: ItemType): FieldSpec[] {
  return [PROMPT, ...OWN[type], ...COMMON_AFTER];
}

/** A new item of a type, with an id not used in the exercise. */
export function newItem(type: ItemType, usedIds: ReadonlySet<string>): Record<string, unknown> {
  let n = 1;
  while (usedIds.has(`question-${n}`)) n++;
  const item: Record<string, unknown> = { id: `question-${n}`, type, ...record(itemFields(type)) };
  // A question needs two options or pairs to be one; the first option is the right one.
  if (type === 'multipleChoice')
    item.options = [
      { text: '', correct: true },
      { text: '', correct: false },
    ];
  if (type === 'matching')
    item.pairs = [
      ['', ''],
      ['', ''],
    ];
  return item;
}

/** A few words to recognise an item by in the list. */
export function itemSummary(item: Record<string, unknown>): string {
  const prompt = item.prompt;
  const text =
    typeof prompt === 'string'
      ? prompt
      : Array.isArray(prompt)
        ? ((prompt as { text?: unknown }[]).find((b) => typeof b.text === 'string')?.text as
            string | undefined)
        : undefined;
  if (!text?.trim()) return '';
  const one = inlineToPlainText(text).replace(/\s+/g, ' ').trim();
  return one.length > 80 ? `${one.slice(0, 79)}…` : one;
}
