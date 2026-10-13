'use server';

import { randomUUID } from 'node:crypto';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { parseActivityYaml, STARTER_ITEM } from '@/content/activity-editor';
import { staffExerciseSlug } from '@/content/exercise-slug';
import { zonedTimeToUtc } from '@/domain/learning/time';
import type { EditorState } from '@/server/actions/cms';
import type { ManageState } from '@/server/actions/manage';
import { giveHomework, readAudience } from '@/server/assignments';
import type { SessionUser } from '@/server/auth/session';
import { requireArea } from '@/server/auth/session';
import { loadActivitySource, planActivityItems } from '@/server/content/activity-writer';
import { createSupabaseServerClient } from '@/server/supabase/server';

// Exercises written by teachers and the office (ADR-038). Each area has its
// own entry points with its own guard (requireArea('teach') or
// requireArea('office')); the manager's actions in cms.ts are unchanged.
// Every write uses the caller's OWN session, so the database policies
// (app.can_author_activity, app.can_edit_activity) decide again; the checks
// here give clear messages and keep a teacher in their own exercises.

type StaffArea = 'teach' | 'office';

const uuid = z.uuid();
const title = z.string().trim().min(1).max(200);
const phase = z.enum(['before_class', 'during_class', 'after_class', 'review', 'optional']);
const scoring = z.enum(['none', 'practice', 'scored']);
const staffStatus = z.enum(['draft', 'published', 'archived']);

type Key =
  | 'saved'
  | 'invalid'
  | 'notAllowed'
  | 'failed'
  | 'conflict'
  | 'problems'
  | 'past'
  | 'notPublished'
  | 'noStudents'
  | 'notInGroup';

async function say(key: Key): Promise<ManageState> {
  const t = await getTranslations('exercises.messages');
  return key === 'saved' ? { status: 'ok', message: t(key) } : { status: 'error', message: t(key) };
}

function exercisePath(area: StaffArea, id: string) {
  return `/${area}/exercises/${id}` as Route;
}

function refresh(area: StaffArea, id: string) {
  revalidatePath(`/${area}/exercises`);
  revalidatePath(exercisePath(area, id));
  revalidatePath('/learn', 'layout');
  revalidatePath('/teach', 'layout');
}

/**
 * The exercise, if the caller may edit it here: one the database lets them
 * edit (editable_activities), and in the teacher area one they wrote
 * themselves (a teacher who is also the manager edits others' work in
 * /manage, not here).
 */
async function editable(area: StaffArea, user: SessionUser, activityId: string) {
  const supabase = await createSupabaseServerClient();
  const [{ data: activity }, { data: allowed }] = await Promise.all([
    supabase
      .from('activities')
      .select('id, slug, course_id, cycle_id, updated_at, created_by, status')
      .eq('id', activityId)
      .maybeSingle(),
    supabase
      .from('editable_activities')
      .select('activity_id')
      .eq('activity_id', activityId)
      .maybeSingle(),
  ]);
  if (!activity || !allowed || !activity.created_by) return { supabase, activity: null };
  if (area === 'teach' && activity.created_by !== user.id) return { supabase, activity: null };
  return { supabase, activity };
}

async function create(area: StaffArea, formData: FormData): Promise<ManageState> {
  const user = await requireArea(area);
  const parsed = z
    .object({ cycleId: uuid, title })
    .safeParse({ cycleId: formData.get('cycleId'), title: formData.get('title') });
  if (!parsed.success) return say('invalid');

  const supabase = await createSupabaseServerClient();
  // The cycle must be one the caller can read (published, in a course they
  // teach — or any published course for the office).
  const { data: cycle } = await supabase
    .from('cycles')
    .select('id, course_id')
    .eq('id', parsed.data.cycleId)
    .maybeSingle();
  if (!cycle) return say('notAllowed');
  if (area === 'teach') {
    const { data: groups } = await supabase
      .from('groups')
      .select('id, group_teachers!inner ( teacher_id )')
      .eq('course_id', cycle.course_id)
      .eq('group_teachers.teacher_id', user.id)
      .limit(1);
    if (!groups?.length) return say('notAllowed');
  }

  // Slugs are unique per course and a teacher cannot see every exercise of
  // it, so a random ending is added; on the rare clash, try another.
  let created: { id: string; slug: string } | null = null;
  for (let i = 0; i < 3 && !created; i++) {
    const slug = staffExerciseSlug(parsed.data.title, randomUUID().slice(0, 8));
    const { data, error } = await supabase
      .from('activities')
      .insert({
        course_id: cycle.course_id,
        cycle_id: cycle.id,
        slug,
        title: parsed.data.title,
        created_by: user.id,
        status: 'draft',
      })
      .select('id, slug')
      .single();
    if (data) created = data;
    else if (error?.code !== '23505') return say(error?.code === '42501' ? 'notAllowed' : 'failed');
  }
  if (!created) return say('failed');

  const plan = await planActivityItems(
    supabase,
    {
      activityId: created.id,
      courseId: cycle.course_id,
      activitySlug: created.slug,
      items: [STARTER_ITEM],
      instructions: [],
      previous: null,
    },
    true,
  );
  try {
    await plan.write();
  } catch {
    return say('failed');
  }
  revalidatePath(`/${area}/exercises`);
  redirect(exercisePath(area, created.id));
}

async function saveMeta(area: StaffArea, formData: FormData): Promise<ManageState> {
  const user = await requireArea(area);
  const parsed = z
    .object({
      activityId: uuid,
      title,
      phase,
      scoring,
      minutes: z.union([z.literal(''), z.coerce.number().int().min(1).max(240)]),
    })
    .safeParse({
      activityId: formData.get('activityId'),
      title: formData.get('title'),
      phase: formData.get('phase'),
      scoring: formData.get('scoring'),
      minutes: formData.get('minutes') ?? '',
    });
  if (!parsed.success) return say('invalid');
  const v = parsed.data;
  const { supabase, activity } = await editable(area, user, v.activityId);
  if (!activity) return say('notAllowed');
  const { data, error } = await supabase
    .from('activities')
    .update({
      title: v.title,
      phase: v.phase,
      scoring_mode: v.scoring,
      est_minutes: v.minutes === '' ? null : v.minutes,
    })
    .eq('id', activity.id)
    .select('id')
    .maybeSingle();
  if (error) return say('failed');
  if (!data) return say('notAllowed');
  refresh(area, activity.id);
  return say('saved');
}

async function setStatus(area: StaffArea, formData: FormData): Promise<void> {
  const user = await requireArea(area);
  const parsed = z
    .object({ activityId: uuid, status: staffStatus })
    .safeParse({ activityId: formData.get('activityId'), status: formData.get('status') });
  if (!parsed.success) return;
  const { supabase, activity } = await editable(area, user, parsed.data.activityId);
  if (!activity) return;
  await supabase
    .from('activities')
    .update({ status: parsed.data.status })
    .eq('id', activity.id)
    .select('id')
    .maybeSingle();
  refresh(area, activity.id);
}

/**
 * Save an exercise's questions from the editor, with the manager editor's
 * rules: refused if someone saved it meanwhile (compare-and-set on
 * updated_at), or if it would change the options or answers of a question
 * students have answered (nothing is written then).
 */
async function saveContent(area: StaffArea, formData: FormData): Promise<EditorState> {
  const user = await requireArea(area);
  const t = await getTranslations('exercises.messages');
  const tc = await getTranslations('cms.messages');
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

  const { supabase, activity } = await editable(area, user, parsed.data.activityId);
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
        message: tc(p.code, { count: p.count }),
      })),
    };
  }

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
  refresh(area, activity.id);
  return { status: 'ok', message: t('saved') };
}

// ── the teacher area ───────────────────────────────────────────────────────

export async function createTeacherExercise(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  return create('teach', formData);
}

export async function saveTeacherExerciseMeta(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  return saveMeta('teach', formData);
}

export async function saveTeacherExerciseContent(
  _prev: EditorState,
  formData: FormData,
): Promise<EditorState> {
  return saveContent('teach', formData);
}

export async function setTeacherExerciseStatus(formData: FormData): Promise<void> {
  return setStatus('teach', formData);
}

// ── the office ─────────────────────────────────────────────────────────────

export async function createOfficeExercise(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  return create('office', formData);
}

export async function saveOfficeExerciseMeta(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  return saveMeta('office', formData);
}

export async function saveOfficeExerciseContent(
  _prev: EditorState,
  formData: FormData,
): Promise<EditorState> {
  return saveContent('office', formData);
}

export async function setOfficeExerciseStatus(formData: FormData): Promise<void> {
  return setStatus('office', formData);
}

/**
 * The office gives a published exercise to any group of its course, or to
 * selected students of it (ADR-039), in its own name (assignments_insert_office,
 * assignment_recipients_insert_office). Teachers use assignActivity in teach.ts,
 * which keeps them to their own groups.
 */
export async function assignOfficeExercise(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const user = await requireArea('office');
  const parsed = z
    .object({
      groupId: uuid,
      activityId: uuid,
      dueDate: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
      note: z.string().trim().max(1000),
    })
    .safeParse({
      groupId: formData.get('groupId'),
      activityId: formData.get('activityId'),
      dueDate: formData.get('dueDate') ?? '',
      note: formData.get('note') ?? '',
    });
  const audience = readAudience(formData);
  if (!parsed.success || !audience) return say('invalid');
  const dueAt = parsed.data.dueDate
    ? zonedTimeToUtc(`${parsed.data.dueDate}T23:59`, user.timezone)
    : null;
  if (parsed.data.dueDate && !dueAt) return say('invalid');
  if (dueAt && dueAt.getTime() < Date.now()) return say('past');

  const supabase = await createSupabaseServerClient();
  const { data: group } = await supabase
    .from('groups')
    .select('id, course_id')
    .eq('id', parsed.data.groupId)
    .maybeSingle();
  if (!group) return say('notAllowed');
  const { data: activity } = await supabase
    .from('activities')
    .select('id, phase, status')
    .eq('id', parsed.data.activityId)
    .eq('course_id', group.course_id)
    .maybeSingle();
  if (!activity) return say('invalid');
  if (activity.status !== 'published') return say('notPublished');

  const result = await giveHomework(
    supabase,
    {
      group_id: group.id,
      course_id: group.course_id,
      activity_id: activity.id,
      phase: activity.phase,
      due_at: dueAt?.toISOString() ?? null,
      note: parsed.data.note,
      assigned_by: user.id,
    },
    audience,
  );
  if (result !== 'ok') return say(result);
  refresh('office', activity.id);
  return say('saved');
}

/** Remove homework the office gave (only its own: assignments_delete_office). */
export async function removeOfficeAssignment(formData: FormData): Promise<void> {
  const user = await requireArea('office');
  const assignmentId = uuid.safeParse(formData.get('assignmentId'));
  const activityId = uuid.safeParse(formData.get('activityId'));
  if (!assignmentId.success || !activityId.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from('assignments')
    .delete()
    .eq('id', assignmentId.data)
    .eq('assigned_by', user.id);
  refresh('office', activityId.data);
}
