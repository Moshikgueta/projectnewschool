import type { ItemStatus } from '@/domain/grading/attempt';
import type { Solution } from '@/domain/grading/solution';

/** What the server tells the player after an answer is checked. */
export type CheckResult =
  | {
      ok: true;
      status: ItemStatus;
      /** Only in practice mode; scored activities reveal results at the end. */
      correct: boolean | null;
      parts?: boolean[];
      accentReminder: boolean;
      feedback: string[];
      tries: number;
      /** Shown after repeated wrong tries in practice mode. */
      solution: Solution | null;
    }
  | { ok: false; reason: 'invalid' | 'locked' | 'closed' | 'error' | 'tooFast' };

export type CheckAction = (
  attemptId: string,
  itemId: string,
  answer: unknown,
) => Promise<CheckResult>;
