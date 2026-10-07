'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { parseActivityYaml, STARTER_ITEM } from '@/content/activity-editor';
import { parseSectionYaml, type EditorProblem } from '@/content/editor';
import { loadActivitySource, planActivityItems } from '@/server/content/activity-writer';
import type { ManageState } from '@/server/actions/manage';
import { requireArea } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/supabase/server';

// The content editor (Phase 8, ADR-034). Every write uses the pedagogical
// manager's own MFA-verified session, so RLS decides again; the database
// keeps the history (audit log) and refuses deletes.

const uuid = z.uuid();
const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(80);
const status = z.enum(['draft', 'in_review', 'published', 'archived']);
const phase = z.enum(['before_class', 'during_class', 'after_class', 'review', 'optional']);

type Key = 'saved' | 'invalid' | 'notAllowed' | 'failed' | 'slugTaken' | 'conflict' | 'problems';

async function say(key: Key): Promise<ManageState> {
  const t = await getTranslations('cms.messages');
  return key === 'saved' ? { status: 'ok', message: t(key) } : { status: 'error', message: t(key) };
}

async function fromError(error: { code?: string } | null): Promise<ManageState> {
  if (!error) return say('saved');
  if (error.code === '23505') return say('slugTaken');
  if (error.code === '42501') return say('notAllowed');
  return say('failed');
}

function refreshCourse(courseId: string) {
  revalidatePath('/manage');
  revalidatePath(`/manage/content/${courseId}` as Route);
}

export async function saveCourse(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({
      courseId: uuid,
      title: z.string().trim().min(1).max(160),
      description: z.string().trim().max(2000),
      status,
    })
    .safeParse({
      courseId: formData.get('courseId'),
      title: formData.get('title'),
      description: formData.get('description') ?? '',
      status: formData.get('status'),
    });
  if (!parsed.success) return say('invalid');
  const { courseId, ...course } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('courses')
    .update(course)
    .eq('id', courseId)
    .select('id')
    .maybeSingle();
  if (!error && !data) return say('notAllowed');
  refreshCourse(courseId);
  return fromError(error);
}

export async function createCycle(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({
      courseId: uuid,
      slug,
      title: z.string().trim().min(1).max(160),
      goal: z.string().trim().max(500),
    })
    .safeParse({
      courseId: formData.get('courseId'),
      slug: formData.get('slug'),
      title: formData.get('title'),
      goal: formData.get('goal') ?? '',
    });
  if (!parsed.success) return say('invalid');
  const supabase = await createSupabaseServerClient();
  const { data: last } = await supabase
    .from('cycles')
    .select('position')
    .eq('course_id', parsed.data.courseId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from('cycles')
    .insert({
      course_id: parsed.data.courseId,
      slug: parsed.data.slug,
      title: parsed.data.title,
      communicative_goal: parsed.data.goal,
      position: (last?.position ?? 0) + 1,
    })
    .select('id')
    .single();
  if (error) return fromError(error);
  refreshCourse(parsed.data.courseId);
  redirect(`/manage/content/cycles/${data.id}` as Route);
}

export async function saveCycle(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({
      cycleId: uuid,
      title: z.string().trim().min(1).max(160),
      goal: z.string().trim().max(500),
      status,
    })
    .safeParse({
      cycleId: formData.get('cycleId'),
      title: formData.get('title'),
      goal: formData.get('goal') ?? '',
      status: formData.get('status'),
    });
  if (!parsed.success) return say('invalid');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('cycles')
    .update({
      title: parsed.data.title,
      communicative_goal: parsed.data.goal,
      status: parsed.data.status,
    })
    .eq('id', parsed.data.cycleId)
    .select('course_id')
    .maybeSingle();
  if (!error && !data) return say('notAllowed');
  if (data) {
    refreshCourse(data.course_id);
    revalidatePath(`/manage/content/cycles/${parsed.data.cycleId}` as Route);
  }
  return fromError(error);
}

/** Swap a cycle (or section) with its neighbour above or below. */
async function move(
  table: 'cycles' | 'book_sections',
  id: string,
  direction: 'up' | 'down',
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  if (table === 'cycles') {
    const { data: row } = await supabase
      .from('cycles')
      .select('id, course_id, position')
      .eq('id', id)
      .maybeSingle();
    if (!row) return null;
    const { data: siblings } = await supabase
      .from('cycles')
      .select('id, position')
      .eq('course_id', row.course_id)
      .order('position');
    return swap('cycles', siblings ?? [], id, direction).then(() => row.course_id);
  }
  const { data: row } = await supabase
    .from('book_sections')
    .select('id, book_id, cycle_id, position')
    .eq('id', id)
    .maybeSingle();
  if (!row) return null;
  const { data: siblings } = await supabase
    .from('book_sections')
    .select('id, position')
    .eq('cycle_id', row.cycle_id)
    .eq('book_id', row.book_id)
    .order('position');
  return swap('book_sections', siblings ?? [], id, direction).then(() => row.cycle_id);
}

async function swap(
  table: 'cycles' | 'book_sections',
  siblings: { id: string; position: number }[],
  id: string,
  direction: 'up' | 'down',
) {
  // Renumber 1..n in the current order, then exchange the two neighbours.
  const order = siblings.map((s) => s.id);
  const i = order.indexOf(id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j]!, order[i]!];
  const supabase = await createSupabaseServerClient();
  for (const [index, rowId] of order.entries()) {
    const current = siblings.find((s) => s.id === rowId)!;
    if (current.position !== index + 1) {
      await supabase
        .from(table)
        .update({ position: index + 1 })
        .eq('id', rowId);
    }
  }
}

const moveSchema = z.object({ id: uuid, direction: z.enum(['up', 'down']) });

export async function moveCycle(formData: FormData): Promise<void> {
  await requireArea('manage');
  const parsed = moveSchema.safeParse({
    id: formData.get('id'),
    direction: formData.get('direction'),
  });
  if (!parsed.success) return;
  const courseId = await move('cycles', parsed.data.id, parsed.data.direction);
  if (courseId) refreshCourse(courseId);
}

export async function moveSection(formData: FormData): Promise<void> {
  await requireArea('manage');
  const parsed = moveSchema.safeParse({
    id: formData.get('id'),
    direction: formData.get('direction'),
  });
  if (!parsed.success) return;
  const cycleId = await move('book_sections', parsed.data.id, parsed.data.direction);
  if (cycleId) revalidatePath(`/manage/content/cycles/${cycleId}` as Route);
}

export async function createSection(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({
      cycleId: uuid,
      book: z.enum(['notebook', 'workbook']),
      slug,
      title: z.string().trim().min(1).max(200),
      phase,
    })
    .safeParse({
      cycleId: formData.get('cycleId'),
      book: formData.get('book'),
      slug: formData.get('slug'),
      title: formData.get('title'),
      phase: formData.get('phase'),
    });
  if (!parsed.success) return say('invalid');
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: cycle } = await supabase
    .from('cycles')
    .select('id, course_id')
    .eq('id', v.cycleId)
    .maybeSingle();
  if (!cycle) return say('notAllowed');

  // The course's notebook or workbook, created on first use.
  let { data: book } = await supabase
    .from('books')
    .select('id')
    .eq('course_id', cycle.course_id)
    .eq('kind', v.book)
    .maybeSingle();
  if (!book) {
    const t = await getTranslations('cms.books');
    const created = await supabase
      .from('books')
      .insert({ course_id: cycle.course_id, kind: v.book, title: t(v.book) })
      .select('id')
      .single();
    if (created.error) return fromError(created.error);
    book = created.data;
  }
  const { data: last } = await supabase
    .from('book_sections')
    .select('position')
    .eq('cycle_id', cycle.id)
    .eq('book_id', book.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from('book_sections')
    .insert({
      book_id: book.id,
      course_id: cycle.course_id,
      cycle_id: cycle.id,
      slug: v.slug,
      title: v.title,
      phase: v.phase,
      position: (last?.position ?? 0) + 1,
      blocks: [],
    })
    .select('id')
    .single();
  if (error) return fromError(error);
  revalidatePath(`/manage/content/cycles/${cycle.id}` as Route);
  redirect(`/manage/content/sections/${data.id}` as Route);
}

export async function saveSectionMeta(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({ sectionId: uuid, title: z.string().trim().min(1).max(200), phase, status })
    .safeParse({
      sectionId: formData.get('sectionId'),
      title: formData.get('title'),
      phase: formData.get('phase'),
      status: formData.get('status'),
    });
  if (!parsed.success) return say('invalid');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('book_sections')
    .update({
      title: parsed.data.title,
      phase: parsed.data.phase,
      status: parsed.data.status,
      edited_in_app_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.sectionId)
    .select('cycle_id')
    .maybeSingle();
  if (!error && !data) return say('notAllowed');
  revalidatePath(`/manage/content/sections/${parsed.data.sectionId}` as Route);
  if (data) revalidatePath(`/manage/content/cycles/${data.cycle_id}` as Route);
  return fromError(error);
}

export type EditorState =
  | { status: 'idle' }
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string; problems?: EditorProblem[] };

/**
 * Save a section's blocks and teacher notes from the editor's YAML. Checked
 * again here with the same rules as the browser; refused if someone else
 * saved the section since this editor opened it (no silent overwrite).
 */
export async function saveSectionContent(
  _prev: EditorState,
  formData: FormData,
): Promise<EditorState> {
  await requireArea('manage');
  const t = await getTranslations('cms.messages');
  const parsed = z
    .object({
      sectionId: uuid,
      updatedAt: z.string().min(1).max(64),
      yaml: z.string().max(300_000),
    })
    .safeParse({
      sectionId: formData.get('sectionId'),
      updatedAt: formData.get('updatedAt'),
      yaml: formData.get('yaml'),
    });
  if (!parsed.success) return { status: 'error', message: t('invalid') };

  const supabase = await createSupabaseServerClient();
  const { data: section } = await supabase
    .from('book_sections')
    .select('id, course_id, updated_at')
    .eq('id', parsed.data.sectionId)
    .maybeSingle();
  if (!section) return { status: 'error', message: t('notAllowed') };
  if (new Date(section.updated_at).getTime() !== new Date(parsed.data.updatedAt).getTime()) {
    return { status: 'error', message: t('conflict') };
  }

  const { data: activities } = await supabase
    .from('activities')
    .select('id, slug')
    .eq('course_id', section.course_id);
  const doc = parseSectionYaml(
    parsed.data.yaml,
    new Map((activities ?? []).map((a) => [a.slug, a.id])),
  );
  if (!doc.ok) return { status: 'error', message: t('problems'), problems: doc.problems };

  // Only if nobody saved in between (compare-and-set on updated_at).
  const { data: saved, error } = await supabase
    .from('book_sections')
    .update({ blocks: doc.blocks, edited_in_app_at: new Date().toISOString() })
    .eq('id', section.id)
    .eq('updated_at', section.updated_at)
    .select('id')
    .maybeSingle();
  if (error) return { status: 'error', message: t('failed') };
  if (!saved) return { status: 'error', message: t('conflict') };

  const notes = await supabase
    .from('section_teacher_notes')
    .upsert(
      { section_id: section.id, course_id: section.course_id, blocks: doc.teacherNotes },
      { onConflict: 'section_id' },
    );
  if (notes.error) return { status: 'error', message: t('failed') };

  revalidatePath(`/manage/content/sections/${section.id}` as Route);
  revalidatePath('/learn', 'layout');
  revalidatePath('/teach', 'layout');
  return { status: 'ok', message: t('saved') };
}

export async function setActivityStatus(formData: FormData): Promise<void> {
  await requireArea('manage');
  const parsed = z
    .object({ activityId: uuid, status })
    .safeParse({ activityId: formData.get('activityId'), status: formData.get('status') });
  if (!parsed.success) return;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('activities')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.activityId)
    .select('cycle_id')
    .maybeSingle();
  if (data) revalidatePath(`/manage/content/cycles/${data.cycle_id}` as Route);
}

const scoring = z.enum(['none', 'practice', 'scored']);

/** A new exercise in a cycle (a draft with one starter question), opened in the editor. */
export async function createActivity(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({ cycleId: uuid, slug, title: z.string().trim().min(1).max(200) })
    .safeParse({
      cycleId: formData.get('cycleId'),
      slug: formData.get('slug'),
      title: formData.get('title'),
    });
  if (!parsed.success) return say('invalid');
  const supabase = await createSupabaseServerClient();
  const { data: cycle } = await supabase
    .from('cycles')
    .select('id, course_id')
    .eq('id', parsed.data.cycleId)
    .maybeSingle();
  if (!cycle) return say('notAllowed');
  const { data: activity, error } = await supabase
    .from('activities')
    .insert({
      course_id: cycle.course_id,
      cycle_id: cycle.id,
      slug: parsed.data.slug,
      title: parsed.data.title,
    })
    .select('id')
    .single();
  if (error) return fromError(error);
  const plan = await planActivityItems(
    supabase,
    {
      activityId: activity.id,
      courseId: cycle.course_id,
      activitySlug: parsed.data.slug,
      items: [STARTER_ITEM],
      instructions: [],
      previous: null,
    },
    true,
  );
  await plan.write();
  revalidatePath(`/manage/content/cycles/${cycle.id}` as Route);
  redirect(`/manage/content/activities/${activity.id}` as Route);
}

export async function saveActivityMeta(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  await requireArea('manage');
  const parsed = z
    .object({
      activityId: uuid,
      title: z.string().trim().min(1).max(200),
      phase,
      scoring,
      minutes: z.union([z.literal(''), z.coerce.number().int().min(1).max(240)]),
      status,
    })
    .safeParse({
      activityId: formData.get('activityId'),
      title: formData.get('title'),
      phase: formData.get('phase'),
      scoring: formData.get('scoring'),
      minutes: formData.get('minutes') ?? '',
      status: formData.get('status'),
    });
  if (!parsed.success) return say('invalid');
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('activities')
    .update({
      title: v.title,
      phase: v.phase,
      scoring_mode: v.scoring,
      est_minutes: v.minutes === '' ? null : v.minutes,
      status: v.status,
    })
    .eq('id', v.activityId)
    .select('cycle_id')
    .maybeSingle();
  if (!error && !data) return say('notAllowed');
  revalidatePath(`/manage/content/activities/${v.activityId}` as Route);
  if (data) revalidatePath(`/manage/content/cycles/${data.cycle_id}` as Route);
  return fromError(error);
}

/**
 * Save an exercise's instructions and items from the editor's YAML. Checked
 * here with the import's rules; refused if someone saved it meanwhile, or if
 * it would change the options or answers of an item students have answered
 * (nothing is written then).
 */
export async function saveActivityContent(
  _prev: EditorState,
  formData: FormData,
): Promise<EditorState> {
  await requireArea('manage');
  const t = await getTranslations('cms.messages');
  const parsed = z
    .object({
      activityId: uuid,
      updatedAt: z.string().min(1).max(64),
      yaml: z.string().max(300_000),
    })
    .safeParse({
      activityId: formData.get('activityId'),
      updatedAt: formData.get('updatedAt'),
      yaml: formData.get('yaml'),
    });
  if (!parsed.success) return { status: 'error', message: t('invalid') };

  const supabase = await createSupabaseServerClient();
  const { data: activity } = await supabase
    .from('activities')
    .select('id, slug, course_id, updated_at')
    .eq('id', parsed.data.activityId)
    .maybeSingle();
  if (!activity) return { status: 'error', message: t('notAllowed') };
  if (new Date(activity.updated_at).getTime() !== new Date(parsed.data.updatedAt).getTime()) {
    return { status: 'error', message: t('conflict') };
  }

  const doc = parseActivityYaml(parsed.data.yaml, activity.slug);
  if (!doc.ok) return { status: 'error', message: t('problems'), problems: doc.problems };

  const previous = await loadActivitySource(supabase, activity.id);
  const plan = await planActivityItems(
    supabase,
    {
      activityId: activity.id,
      courseId: activity.course_id,
      activitySlug: activity.slug,
      items: doc.doc.items,
      instructions: doc.doc.instructions,
      previous: previous.source.items,
    },
    true,
  );
  if (plan.problems.length) {
    return {
      status: 'error',
      message: t('problems'),
      problems: plan.problems.map((p) => ({
        path: p.item,
        message: t(p.code, { count: p.count }),
      })),
    };
  }

  // Compare-and-set on updated_at, then the items.
  const { data: claimed, error } = await supabase
    .from('activities')
    .update({ instructions: doc.doc.instructions })
    .eq('id', activity.id)
    .eq('updated_at', activity.updated_at)
    .select('id')
    .maybeSingle();
  if (error) return { status: 'error', message: t('failed') };
  if (!claimed) return { status: 'error', message: t('conflict') };
  try {
    await plan.write();
  } catch {
    return { status: 'error', message: t('failed') };
  }
  revalidatePath(`/manage/content/activities/${activity.id}` as Route);
  revalidatePath('/learn', 'layout');
  revalidatePath('/teach', 'layout');
  return { status: 'ok', message: t('saved') };
}
