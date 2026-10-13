import 'server-only';
import {
  regradeAttempt,
  regradeResponses,
  type GradableItem,
  type ResponseGrade,
} from '@/domain/grading/regrade';
import { gradableItem, loadItemResponses } from '@/server/content/item-answers';
import type { Json } from '@/server/db.types';
import { createPrivilegedClient } from './admin-client';

// Re-checking past answers after an answer key was corrected (ADR-041).
// Learner records are written only by the server (ADR-006), so this uses the
// secret key. The CALLER must already have authorized the correction with
// the pedagogical manager's own MFA session (requireArea('manage') and the
// database's own check when the correction was inserted); this module takes
// only the id of the corrected item, never a user id.
//
// Idempotent and safe to retry: every response is graded again from its own
// answer and the item's CURRENT key (the same `grade` as live answers), and
// each attempt is rebuilt from its re-graded tries. Running it twice changes
// nothing the second time. Attempts are written compare-and-set on
// `updated_at`, so a student answering at the same moment is not overwritten.

const CHUNK = 100;
const PARALLEL = 20;

type Client = ReturnType<typeof createPrivilegedClient>;

async function inBatches<T>(list: T[], size: number, run: (x: T) => Promise<void>) {
  for (let i = 0; i < list.length; i += size) await Promise.all(list.slice(i, i + size).map(run));
}

export type RegradeResult = { responsesUpdated: number; attemptsUpdated: number };

/** Re-grade every past answer of one item with its current key and rebuild the attempts. */
export async function regradeItemAnswers(itemId: string): Promise<RegradeResult> {
  const db = createPrivilegedClient();
  const [{ data: item, error: itemError }, { data: key }] = await Promise.all([
    db.from('activity_items').select('id, type, data, points').eq('id', itemId).maybeSingle(),
    db.from('activity_item_keys').select('answer, feedback').eq('item_id', itemId).maybeSingle(),
  ]);
  if (itemError || !item) throw new Error('The question could not be loaded.');
  const gradable = gradableItem({
    type: item.type,
    data: item.data,
    key: key?.answer,
    points: Number(item.points),
    feedback: key?.feedback,
  });
  if (!gradable) throw new Error('The question has no readable answer key.');

  // 1. Responses: is_correct, score and feedback code from the current key.
  const responses = await loadItemResponses(db, itemId);
  const regraded = regradeResponses(gradable, responses);
  const changed = regraded.filter((r) => r.changed);
  await inBatches(changed, PARALLEL, async (r) => {
    const { error } = await db
      .from('responses')
      .update({
        is_correct: r.next.isCorrect,
        score: r.next.score,
        feedback_code: r.next.feedbackCode,
      })
      .eq('id', r.id);
    if (error) throw new Error(`Could not update an answer: ${error.message}`);
  });

  // 2. Attempts: the item's progress and the finished attempt's score.
  const attemptIds = [...new Set(responses.map((r) => r.attemptId))];
  let attemptsUpdated = 0;
  for (let i = 0; i < attemptIds.length; i += CHUNK) {
    const ids = attemptIds.slice(i, i + CHUNK);
    await inBatches(ids, PARALLEL, async (attemptId) => {
      if (await rebuildAttempt(db, gradable, itemId, attemptId)) attemptsUpdated += 1;
    });
  }
  return { responsesUpdated: changed.length, attemptsUpdated };
}

/** Rebuild one attempt's progress on the item; retried if the student answered meanwhile. */
async function rebuildAttempt(
  db: Client,
  item: GradableItem,
  itemId: string,
  attemptId: string,
): Promise<boolean> {
  for (let round = 0; round < 5; round++) {
    const { data: attempt, error } = await db
      .from('attempts')
      .select('id, status, score, max_score, state, updated_at')
      .eq('id', attemptId)
      .maybeSingle();
    if (error) throw new Error(`Could not load an attempt: ${error.message}`);
    if (!attempt) return false;
    const tries = regradeResponses(item, await loadItemResponses(db, itemId, attemptId)).map(
      (r) => ({ response: r, grade: r.next satisfies ResponseGrade }),
    );
    const next = regradeAttempt(
      {
        id: attempt.id,
        status: attempt.status,
        score: attempt.score === null ? null : Number(attempt.score),
        maxScore: attempt.max_score === null ? null : Number(attempt.max_score),
        state: attempt.state,
      },
      itemId,
      tries,
    );
    if (!next.changed) return false;
    const { data: written, error: writeError } = await db
      .from('attempts')
      .update({ state: next.state as unknown as NonNullable<Json>, score: next.score })
      .eq('id', attempt.id)
      .eq('updated_at', attempt.updated_at)
      .select('id');
    if (writeError) throw new Error(`Could not update an attempt: ${writeError.message}`);
    if (written?.length) return true;
  }
  throw new Error('An attempt kept changing while it was re-checked; try again.');
}
