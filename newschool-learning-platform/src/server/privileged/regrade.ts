import 'server-only';
import {
  regradeAttempt,
  regradeResponses,
  type GradableItem,
  type ResponseGrade,
  type StoredResponse,
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
//
// Batched (docs/PERFORMANCE.md): answers that get the same new grade are
// updated together, by id, CHUNK at a time; attempts are read CHUNK at a time
// (the attempts first, then their tries, as one attempt at a time did) and
// only those that change are written, each compare-and-set; an attempt that
// changed meanwhile is rebuilt again on its own, as before.

const CHUNK = 100; // ids per request (keeps the request line well under 8 kB)
const PARALLEL = 20;

type Client = ReturnType<typeof createPrivilegedClient>;

async function inBatches<T>(list: T[], size: number, run: (x: T) => Promise<void>) {
  for (let i = 0; i < list.length; i += size) await Promise.all(list.slice(i, i + size).map(run));
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export type RegradeResult = { responsesUpdated: number; attemptsUpdated: number };

type AttemptRow = {
  id: string;
  status: 'in_progress' | 'submitted';
  score: number | null;
  max_score: number | null;
  state: Json;
  updated_at: string;
};

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

  // 1. Responses: is_correct, score and feedback code from the current key,
  //    one update per (new grade, chunk of ids).
  const responses = await loadItemResponses(db, itemId);
  const changed = regradeResponses(gradable, responses).filter((r) => r.changed);
  const byGrade = new Map<string, { grade: ResponseGrade; ids: string[] }>();
  for (const r of changed) {
    const k = JSON.stringify([r.next.isCorrect, r.next.score, r.next.feedbackCode]);
    const group = byGrade.get(k) ?? { grade: r.next, ids: [] };
    group.ids.push(r.id);
    byGrade.set(k, group);
  }
  const updates = [...byGrade.values()].flatMap(({ grade, ids }) =>
    chunks(ids, CHUNK).map((part) => ({ grade, part })),
  );
  await inBatches(updates, PARALLEL, async ({ grade, part }) => {
    const { error } = await db
      .from('responses')
      .update({
        is_correct: grade.isCorrect,
        score: grade.score,
        feedback_code: grade.feedbackCode,
      })
      .in('id', part);
    if (error) throw new Error(`Could not update answers: ${error.message}`);
  });

  // 2. Attempts: the item's progress and the finished attempt's score.
  const attemptIds = [...new Set(responses.map((r) => r.attemptId))];
  let attemptsUpdated = 0;
  for (const part of chunks(attemptIds, CHUNK)) {
    const { data: attempts, error } = await db
      .from('attempts')
      .select('id, status, score, max_score, state, updated_at')
      .in('id', part);
    if (error) throw new Error(`Could not load attempts: ${error.message}`);
    const tries = new Map<string, StoredResponse[]>();
    for (const r of await loadItemResponses(db, itemId, part)) {
      tries.set(r.attemptId, [...(tries.get(r.attemptId) ?? []), r]);
    }
    await inBatches(attempts as AttemptRow[], PARALLEL, async (attempt) => {
      const write = await writeAttempt(db, gradable, itemId, attempt, tries.get(attempt.id) ?? []);
      if (write === 'written') attemptsUpdated += 1;
      // Changed since it was read (a student answering now): rebuild it on its own.
      else if (write === 'stale' && (await rebuildAttempt(db, gradable, itemId, attempt.id))) {
        attemptsUpdated += 1;
      }
    });
  }
  return { responsesUpdated: changed.length, attemptsUpdated };
}

/** Write one attempt rebuilt from its tries, compare-and-set on the `updated_at` it was read with. */
async function writeAttempt(
  db: Client,
  item: GradableItem,
  itemId: string,
  attempt: AttemptRow,
  stored: StoredResponse[],
): Promise<'unchanged' | 'written' | 'stale'> {
  const tries = regradeResponses(item, stored).map((r) => ({
    response: r,
    grade: r.next satisfies ResponseGrade,
  }));
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
  if (!next.changed) return 'unchanged';
  const { data: written, error } = await db
    .from('attempts')
    .update({ state: next.state as unknown as NonNullable<Json>, score: next.score })
    .eq('id', attempt.id)
    .eq('updated_at', attempt.updated_at)
    .select('id');
  if (error) throw new Error(`Could not update an attempt: ${error.message}`);
  return written?.length ? 'written' : 'stale';
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
    const stored = await loadItemResponses(db, itemId, attemptId);
    const write = await writeAttempt(db, item, itemId, attempt as AttemptRow, stored);
    if (write !== 'stale') return write === 'written';
  }
  throw new Error('An attempt kept changing while it was re-checked; try again.');
}
