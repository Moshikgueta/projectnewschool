// Server-side grading of one answer (ADR-006). Pure: the caller loads the
// item and its key with the privileged module and stores the result.

import type { Feedback, ItemAnswer, ItemData, ItemKey, ItemType } from '@/content/items';
import { matchText } from './normalize';

export type Grade = {
  /** null: not auto-graded (saved for the teacher). */
  correct: boolean | null;
  /** 0..points; partial credit for items with several parts. */
  score: number;
  /** Per part (blank, pair) for item types that have parts. */
  parts?: boolean[];
  /** Correct, but an accent is missing or wrong (lenient items). */
  accentReminder: boolean;
  /** Short code stored with the response for later analysis. */
  code: string;
  /** Feedback texts from the key that apply to this answer. */
  feedback: string[];
};

type Graded<T extends ItemType> = {
  type: T;
  data: ItemData<T>;
  key: ItemKey<T>;
  answer: ItemAnswer<T>;
  points: number;
  feedback: Feedback;
};

export type GradeInput = { [T in ItemType]: Graded<T> }[ItemType];

const round = (n: number) => Math.round(n * 100) / 100;

function result(
  input: { points: number; feedback: Feedback },
  correct: boolean,
  extra: {
    parts?: boolean[];
    fraction?: number;
    accent?: boolean;
    code?: string;
    keys?: string[];
  } = {},
): Grade {
  const fraction = extra.fraction ?? (correct ? 1 : 0);
  const keys = [...(extra.keys ?? []), correct ? 'correct' : 'incorrect'];
  return {
    correct,
    score: round(input.points * fraction),
    parts: extra.parts,
    accentReminder: extra.accent ?? false,
    code: extra.code ?? (correct ? 'correct' : 'incorrect'),
    feedback: keys.flatMap((k) => (input.feedback[k] ? [input.feedback[k]] : [])),
  };
}

export function grade(input: GradeInput): Grade {
  switch (input.type) {
    case 'multipleChoice': {
      const chosen = new Set(input.answer.optionIds);
      const right = new Set(input.key.optionIds);
      const correct = chosen.size === right.size && [...chosen].every((o) => right.has(o));
      const wrongChoices = [...chosen].filter((o) => !right.has(o));
      return result(input, correct, {
        keys: wrongChoices,
        code: correct ? 'correct' : `chose:${wrongChoices[0] ?? 'missing'}`,
      });
    }
    case 'trueFalse': {
      return result(input, input.answer.value === input.key.value);
    }
    case 'fillBlank': {
      const matches = input.key.blanks.map((blank, i) =>
        input.answer.blanks[i] === undefined
          ? 'wrong'
          : matchText(input.answer.blanks[i]!, blank.accept, {
              caseSensitive: input.key.caseSensitive,
            }),
      );
      const ok = matches.map(
        (m) => m === 'exact' || (m === 'accent' && input.key.accents === 'lenient'),
      );
      const correct = ok.every(Boolean);
      const accent = correct && matches.includes('accent');
      const strictAccentMiss =
        !correct && input.key.accents === 'strict' && matches.includes('accent');
      return result(input, correct, {
        parts: ok,
        fraction: ok.filter(Boolean).length / ok.length,
        accent: accent || strictAccentMiss,
        code: correct
          ? accent
            ? 'correct:accent'
            : 'correct'
          : strictAccentMiss
            ? 'accent'
            : 'incorrect',
      });
    }
    case 'matching': {
      const left = input.data.left.map((o) => o.id);
      const ok = left.map((l) => input.answer.pairs[l] === input.key.pairs[l]);
      const correct = ok.every(Boolean);
      return result(input, correct, { parts: ok, fraction: ok.filter(Boolean).length / ok.length });
    }
    case 'reorderSentence': {
      const tokens = new Map(input.data.tokens.map((t) => [t.id, t.text]));
      const used = new Set(input.answer.tokenIds);
      const complete = used.size === input.answer.tokenIds.length && used.size === tokens.size;
      const sentence = input.answer.tokenIds.map((id) => tokens.get(id) ?? '').join(' ');
      const correct =
        complete && matchText(sentence, input.key.accept, { caseSensitive: true }) === 'exact';
      return result(input, correct, {
        code: correct ? 'correct' : complete ? 'order' : 'incomplete',
      });
    }
    case 'shortAnswer':
    case 'reflection':
      return {
        correct: null,
        score: 0,
        accentReminder: false,
        code: 'saved',
        feedback: input.feedback.saved ? [input.feedback.saved] : [],
      };
  }
}
