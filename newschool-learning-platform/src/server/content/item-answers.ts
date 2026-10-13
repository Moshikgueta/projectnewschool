// Reading an exercise question with its key and its past answers, for
// correcting the key and re-checking the answers (ADR-041). Used with the
// pedagogical manager's own session (preview, RLS decides what they read) and
// with the privileged client (the re-check). No 'server-only' import, like
// activity-writer.ts, so pure server helpers stay testable.

import type { SupabaseClient } from '@supabase/supabase-js';
import { feedbackSchema, itemSchemas, type ItemType } from '@/content/items';
import type { GradableItem, StoredResponse } from '@/domain/grading/regrade';
import type { Database, Json } from '@/server/db.types';

type Client = SupabaseClient<Database>;

const PAGE = 1000;

/** An item in the grader's terms, or null if its data or key is not readable. */
export function gradableItem(row: {
  type: string;
  data: unknown;
  key: unknown;
  points: number;
  feedback: unknown;
}): GradableItem | null {
  if (!(row.type in itemSchemas)) return null;
  const type = row.type as ItemType;
  const data = itemSchemas[type].data.safeParse(row.data);
  const key = itemSchemas[type].key.safeParse(row.key ?? undefined);
  if (!data.success || !key.success || key.data === undefined) return null;
  const feedback = feedbackSchema.safeParse(row.feedback ?? {});
  return {
    type,
    data: data.data,
    key: key.data,
    points: Number(row.points),
    feedback: feedback.success ? feedback.data : {},
  } as GradableItem;
}

type ResponseRow = {
  id: string;
  attempt_id: string;
  user_id: string;
  answer: Json;
  is_correct: boolean | null;
  score: number | null;
  feedback_code: string | null;
  try_no: number;
  created_at: string;
};

function toStoredResponse(r: ResponseRow): StoredResponse {
  return {
    id: r.id,
    attemptId: r.attempt_id,
    userId: r.user_id,
    answer: r.answer,
    isCorrect: r.is_correct,
    score: r.score === null ? null : Number(r.score),
    feedbackCode: r.feedback_code,
    tryNo: r.try_no,
    createdAt: r.created_at,
  };
}

const RESPONSE_COLUMNS =
  'id, attempt_id, user_id, answer, is_correct, score, feedback_code, try_no, created_at';

/**
 * Every response to an item that the client may read (all pages); optionally
 * only one attempt's, or only those of a list of attempts.
 */
export async function loadItemResponses(
  db: Client,
  itemId: string,
  attempts?: string | string[],
): Promise<StoredResponse[]> {
  const out: StoredResponse[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db.from('responses').select(RESPONSE_COLUMNS).eq('item_id', itemId);
    if (typeof attempts === 'string') query = query.eq('attempt_id', attempts);
    else if (attempts) query = query.in('attempt_id', attempts);
    const { data, error } = await query.order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load answers: ${error.message}`);
    out.push(...(data as ResponseRow[]).map(toStoredResponse));
    if (data.length < PAGE) return out;
  }
}

export type ItemForCorrection = {
  id: string;
  slug: string;
  type: string;
  activityId: string;
  courseId: string;
  prompt: unknown;
  data: unknown;
  points: number;
  key: unknown;
  feedback: unknown;
  /** The question as its author wrote it (activity_sources), if the exercise has a saved source. */
  source: unknown | null;
  hasSource: boolean;
};

/** A question with its key and authored source, as far as the client may read them. */
export async function loadItemForCorrection(
  db: Client,
  itemId: string,
): Promise<ItemForCorrection | null> {
  const { data: item } = await db
    .from('activity_items')
    .select('id, slug, type, activity_id, course_id, prompt, data, points')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return null;
  const [{ data: key }, { data: source }] = await Promise.all([
    db.from('activity_item_keys').select('answer, feedback').eq('item_id', itemId).maybeSingle(),
    db.from('activity_sources').select('source').eq('activity_id', item.activity_id).maybeSingle(),
  ]);
  if (!key) return null;
  const items = (source?.source as { items?: unknown } | null)?.items;
  const authored = Array.isArray(items)
    ? ((items as { id?: unknown }[]).find((i) => i && i.id === item.slug) ?? null)
    : null;
  return {
    id: item.id,
    slug: item.slug,
    type: item.type,
    activityId: item.activity_id,
    courseId: item.course_id,
    prompt: item.prompt,
    data: item.data,
    points: Number(item.points),
    key: key.answer,
    feedback: key.feedback,
    source: authored,
    hasSource: Array.isArray(items),
  };
}
