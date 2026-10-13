// What to show as "the answer" once a student has tried an item enough times
// in practice mode. Derived from the key on the server and sent only then.

import type { ItemData, ItemKey, ItemType } from '@/content/items';

export type Solution = { lines: string[] } | { truth: boolean };

/** Practice mode shows the answer after this many wrong tries. */
export const REVEAL_AFTER_TRIES = 2;

type Input = { [T in ItemType]: { type: T; data: ItemData<T>; key: ItemKey<T> } }[ItemType];

export function solutionOf(input: Input): Solution | null {
  switch (input.type) {
    case 'multipleChoice': {
      const right = new Set(input.key.optionIds);
      return { lines: input.data.options.filter((o) => right.has(o.id)).map((o) => o.text) };
    }
    case 'trueFalse':
      return { truth: input.key.value };
    case 'fillBlank':
      return { lines: input.key.blanks.map((b) => b.accept[0] ?? '') };
    case 'matching': {
      const right = new Map(input.data.right.map((o) => [o.id, o.text]));
      return {
        lines: input.data.left.map(
          (l) => `${l.text} → ${right.get(input.key.pairs[l.id] ?? '') ?? ''}`,
        ),
      };
    }
    case 'reorderSentence':
      return { lines: [input.key.accept[0] ?? ''] };
    case 'shortAnswer':
    case 'reflection':
      return null;
  }
}
