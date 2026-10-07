// Writing an exercise's items, answer keys and source (Phase 8, ADR-036).
// Shared by the content editor (the manager's own session) and
// `pnpm content:import` (the secret key), so both follow the same rules:
//
//   - an item whose authored form did not change is not rewritten (so its
//     shuffled options keep their ids, and answers stay valid);
//   - an item students have answered keeps its options and answers, and is
//     not removed (the database refuses it too); its wording, feedback and
//     points may change;
//   - everything is checked before anything is written.
//
// No 'server-only' import: the import script uses this file as well.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  canonical,
  compileItem,
  decompileItem,
  feedbackForStored,
  sameAnswers,
  type AuthoredItem,
  type CompiledItem,
} from '@/content/activities-file';
import type { Block } from '@/content/schema';
import type { Database, Json } from '@/server/db.types';

type Client = SupabaseClient<Database>;

export type ActivitySource = { instructions: Block[]; items: AuthoredItem[] };

type StoredItem = {
  id: string;
  slug: string;
  type: string;
  prompt: unknown;
  data: unknown;
  points: number;
  position: number;
  key: unknown;
  feedback: unknown;
};

async function must<T>(
  what: string,
  q: PromiseLike<{ data: T; error: { message: string } | null }>,
) {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as NonNullable<T>;
}

/** The exercise's items as stored, with keys, and which have answers. */
export async function loadStoredItems(
  db: Client,
  activityId: string,
): Promise<{ items: StoredItem[]; answered: Map<string, number> }> {
  const items = await must(
    'items',
    db
      .from('activity_items')
      .select('id, slug, type, prompt, data, points, position')
      .eq('activity_id', activityId)
      .order('position'),
  );
  const ids = items.map((i) => i.id);
  const none = ['00000000-0000-0000-0000-000000000000'];
  const [keys, answers] = await Promise.all([
    must(
      'keys',
      db
        .from('activity_item_keys')
        .select('item_id, answer, feedback')
        .in('item_id', ids.length ? ids : none),
    ),
    must(
      'answers',
      db
        .from('responses')
        .select('item_id')
        .in('item_id', ids.length ? ids : none),
    ),
  ]);
  const keyOf = new Map(keys.map((k) => [k.item_id, k]));
  const answered = new Map<string, number>();
  for (const a of answers) answered.set(a.item_id, (answered.get(a.item_id) ?? 0) + 1);
  return {
    items: items.map((i) => ({
      ...i,
      slug: i.slug ?? i.id,
      key: keyOf.get(i.id)?.answer ?? null,
      feedback: keyOf.get(i.id)?.feedback ?? {},
    })),
    answered,
  };
}

/** The exercise as its author wrote it: the saved source, or rebuilt from what is stored. */
export async function loadActivitySource(
  db: Client,
  activityId: string,
): Promise<{
  source: ActivitySource;
  fromStored: boolean;
  answered: Map<string, number>;
  slugById: Map<string, string>;
}> {
  const [{ data: saved }, { data: activity }, stored] = await Promise.all([
    db.from('activity_sources').select('source').eq('activity_id', activityId).maybeSingle(),
    db.from('activities').select('instructions').eq('id', activityId).maybeSingle(),
    loadStoredItems(db, activityId),
  ]);
  const answeredBySlug = new Map(
    stored.items.map((i) => [i.slug, stored.answered.get(i.id) ?? 0] as const),
  );
  const slugById = new Map(stored.items.map((i) => [i.id, i.slug]));
  const src = saved?.source as ActivitySource | undefined;
  if (src && Array.isArray(src.items)) {
    return {
      source: { instructions: src.instructions ?? [], items: src.items },
      fromStored: false,
      answered: answeredBySlug,
      slugById,
    };
  }
  return {
    source: {
      instructions: (activity?.instructions as Block[] | null) ?? [],
      items: stored.items.flatMap((i) => {
        const item = decompileItem(i);
        return item ? [item] : [];
      }),
    },
    fromStored: true,
    answered: answeredBySlug,
    slugById,
  };
}

/** Why a version of an exercise cannot be saved as it is. */
export type PlanProblem = {
  code: 'answeredChanged' | 'answeredRemoved';
  item: string;
  count: number;
};

/** A plan problem in English, for the import script's log. */
export function describeProblem(p: PlanProblem): string {
  return p.code === 'answeredChanged'
    ? `Item "${p.item}" has ${p.count} answer(s) from students: its options and answers cannot change. Add a new item instead.`
    : `Item "${p.item}" has ${p.count} answer(s) from students and cannot be removed.`;
}

export type WritePlan = {
  problems: PlanProblem[];
  warnings: string[];
  write: () => Promise<void>;
};

/**
 * Check a new version of an exercise's items against what is stored, and
 * return what writing it would do. Nothing is written until `write()`.
 * `strict` (the editor) refuses any change to an answered item's options or
 * answers; otherwise (the import) such items are left as they are, with a
 * warning.
 */
export async function planActivityItems(
  db: Client,
  args: {
    activityId: string;
    courseId: string;
    activitySlug: string;
    items: AuthoredItem[];
    instructions: Block[];
    /** The previous authored form, if known: unchanged items are not rewritten. */
    previous: AuthoredItem[] | null;
  },
  strict: boolean,
): Promise<WritePlan> {
  const { items: stored, answered } = await loadStoredItems(db, args.activityId);
  const storedBySlug = new Map(stored.map((i) => [i.slug, i]));
  const previousBySlug = new Map((args.previous ?? []).map((i) => [i.id, i]));
  const problems: PlanProblem[] = [];
  const warnings: string[] = [];
  type Step =
    | { kind: 'position'; id: string; position: number }
    | { kind: 'item'; compiled: CompiledItem; position: number; textOnly: boolean };
  const steps: Step[] = [];

  args.items.forEach((item, index) => {
    const position = index + 1;
    const old = storedBySlug.get(item.id);
    const before = previousBySlug.get(item.id);
    if (old && before && canonical(before) === canonical(item)) {
      if (old.position !== position) steps.push({ kind: 'position', id: old.id, position });
      return;
    }
    const compiled = compileItem(args.activitySlug, item);
    const count = old ? (answered.get(old.id) ?? 0) : 0;
    if (old && count > 0) {
      // Compared by meaning, not by stored ids: options are shuffled when
      // compiled, so an exercise with no saved source would never match.
      const was = decompileItem(old);
      if (!was || !sameAnswers(was, item)) {
        const problem: PlanProblem = { code: 'answeredChanged', item: item.id, count };
        if (strict) problems.push(problem);
        else warnings.push(`${describeProblem(problem)} Left as it is.`);
        return;
      }
      // Same answers: keep the stored options, ids and key; change the wording.
      steps.push({
        kind: 'item',
        compiled: {
          ...compiled,
          type: old.type as CompiledItem['type'],
          data: old.data as Record<string, unknown>,
          key: (old.key as Record<string, unknown> | null) ?? null,
          feedback: feedbackForStored(item, old.data),
        },
        position,
        textOnly: true,
      });
      return;
    }
    steps.push({ kind: 'item', compiled, position, textOnly: false });
  });

  const keep = new Set(args.items.map((i) => i.id));
  const removed = stored.filter((i) => !keep.has(i.slug));
  for (const r of removed) {
    const count = answered.get(r.id) ?? 0;
    if (count > 0) {
      const problem: PlanProblem = { code: 'answeredRemoved', item: r.slug, count };
      if (strict) problems.push(problem);
      else warnings.push(`${describeProblem(problem)} Kept.`);
    }
  }

  async function write() {
    // Moving items first frees positions; positions are not unique, so order is safe.
    for (const step of steps) {
      if (step.kind === 'position') {
        await must(
          'position',
          db
            .from('activity_items')
            .update({ position: step.position })
            .eq('id', step.id)
            .select('id'),
        );
        continue;
      }
      const c = step.compiled;
      const row = await must(
        `item ${c.slug}`,
        db
          .from('activity_items')
          .upsert(
            {
              activity_id: args.activityId,
              course_id: args.courseId,
              slug: c.slug,
              position: step.position,
              type: c.type,
              prompt: c.prompt as unknown as NonNullable<Json>,
              data: c.data as NonNullable<Json>,
              points: c.points,
            },
            { onConflict: 'activity_id,slug' },
          )
          .select('id')
          .single(),
      );
      // The key lives in its own table, which students cannot read (ADR-006).
      if (c.key) {
        await must(
          `key ${c.slug}`,
          db
            .from('activity_item_keys')
            .upsert(
              {
                item_id: row.id,
                course_id: args.courseId,
                answer: c.key as NonNullable<Json>,
                feedback: c.feedback,
              },
              { onConflict: 'item_id' },
            )
            .select('item_id'),
        );
      } else if (!step.textOnly) {
        await db.from('activity_item_keys').delete().eq('item_id', row.id);
      }
    }
    for (const r of removed) {
      if ((answered.get(r.id) ?? 0) === 0) {
        await must(
          `remove ${r.slug}`,
          db.from('activity_items').delete().eq('id', r.id).select('id'),
        );
      }
    }
    await must(
      'source',
      db
        .from('activity_sources')
        .upsert(
          {
            activity_id: args.activityId,
            course_id: args.courseId,
            source: {
              instructions: args.instructions,
              items: args.items,
            } as unknown as NonNullable<Json>,
          },
          { onConflict: 'activity_id' },
        )
        .select('activity_id'),
    );
  }

  return { problems, warnings, write };
}
