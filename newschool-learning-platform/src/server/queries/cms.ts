import 'server-only';
import { activityToYaml } from '@/content/activity-editor';
import { sectionToYaml } from '@/content/editor';
import {
  currentAnswer,
  isCorrectable,
  type CorrectableType,
  type Correction,
} from '@/content/item-correction';
import { loadActivitySource } from '@/server/content/activity-writer';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';

// The content editor (Phase 8, ADR-034). Read with the pedagogical manager's
// own session: RLS shows every status to them and nothing unpublished to
// anyone else, so these return null for other callers.

type Status = Database['public']['Enums']['content_status'];
type Phase = Database['public']['Enums']['learning_phase'];

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

export type ContentCourse = {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: Status;
  pilot: boolean;
  levelTitle: string;
  languageCode: string;
  cycles: {
    id: string;
    slug: string;
    title: string;
    goal: string;
    position: number;
    status: Status;
  }[];
};

export async function getContentCourse(courseId: string): Promise<ContentCourse | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('courses')
    .select(
      `id, slug, title, description, status, pilot,
       level:levels ( title, language:languages ( code ) ),
       cycles ( id, slug, title, communicative_goal, position, status )`,
    )
    .eq('id', courseId)
    .maybeSingle();
  if (error) fail('the course', error);
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    description: data.description,
    status: data.status,
    pilot: data.pilot,
    levelTitle: data.level?.title ?? '',
    languageCode: data.level?.language?.code ?? 'en',
    cycles: data.cycles
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        goal: c.communicative_goal,
        position: c.position,
        status: c.status,
      }))
      .sort((a, b) => a.position - b.position),
  };
}

export type ContentCycle = {
  id: string;
  slug: string;
  title: string;
  goal: string;
  status: Status;
  courseId: string;
  courseTitle: string;
  sections: {
    id: string;
    slug: string | null;
    title: string;
    phase: Phase | null;
    status: Status;
    position: number;
    book: Database['public']['Enums']['book_kind'];
  }[];
  activities: { id: string; slug: string; title: string; status: Status; phase: Phase }[];
};

export async function getContentCycle(cycleId: string): Promise<ContentCycle | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('cycles')
    .select(
      `id, slug, title, communicative_goal, status, course_id,
       course:courses ( title ),
       book_sections ( id, slug, title, phase, status, position, book:books ( kind ) ),
       activities ( id, slug, title, status, phase )`,
    )
    .eq('id', cycleId)
    .maybeSingle();
  if (error) fail('the cycle', error);
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    goal: data.communicative_goal,
    status: data.status,
    courseId: data.course_id,
    courseTitle: data.course?.title ?? '',
    sections: data.book_sections
      .map((s) => ({
        id: s.id,
        slug: s.slug,
        title: s.title,
        phase: s.phase,
        status: s.status,
        position: s.position,
        book: s.book?.kind ?? 'notebook',
      }))
      .sort((a, b) => a.book.localeCompare(b.book) || a.position - b.position),
    activities: data.activities
      .map((a) => ({ id: a.id, slug: a.slug, title: a.title, status: a.status, phase: a.phase }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export type SectionForEdit = {
  id: string;
  title: string;
  phase: Phase | null;
  status: Status;
  updatedAt: string;
  book: Database['public']['Enums']['book_kind'];
  cycleId: string;
  cycleTitle: string;
  courseId: string;
  courseTitle: string;
  courseLang: string;
  aiTutorUrl: string | null;
  yaml: string;
  activities: { id: string; slug: string; title: string; minutes: number | null }[];
};

export async function getSectionForEdit(sectionId: string): Promise<SectionForEdit | null> {
  const supabase = await createSupabaseServerClient();
  const { data: s, error } = await supabase
    .from('book_sections')
    .select(
      `id, title, phase, status, updated_at, blocks, course_id, cycle_id,
       book:books ( kind ),
       cycle:cycles ( title )`,
    )
    .eq('id', sectionId)
    .maybeSingle();
  if (error) fail('the section', error);
  if (!s) return null;
  const [course, notes, activities] = await Promise.all([
    supabase
      .from('courses')
      .select('title, ai_tutor_url, level:levels ( language:languages ( code ) )')
      .eq('id', s.course_id)
      .single(),
    supabase.from('section_teacher_notes').select('blocks').eq('section_id', s.id).maybeSingle(),
    supabase
      .from('activities')
      .select('id, slug, title, est_minutes')
      .eq('course_id', s.course_id)
      .order('title'),
  ]);
  if (activities.error) fail('activities', activities.error);
  const list = activities.data.map((a) => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    minutes: a.est_minutes,
  }));
  return {
    id: s.id,
    title: s.title,
    phase: s.phase,
    status: s.status,
    updatedAt: s.updated_at,
    book: s.book?.kind ?? 'notebook',
    cycleId: s.cycle_id,
    cycleTitle: s.cycle?.title ?? '',
    courseId: s.course_id,
    courseTitle: course.data?.title ?? '',
    courseLang: course.data?.level?.language?.code ?? 'en',
    aiTutorUrl: course.data?.ai_tutor_url ?? null,
    yaml: sectionToYaml(
      { blocks: s.blocks, teacherNotes: notes.data?.blocks ?? [] },
      new Map(list.map((a) => [a.id, a.slug])),
    ),
    activities: list,
  };
}

export type ActivityForEdit = {
  id: string;
  slug: string;
  title: string;
  phase: Phase;
  scoring: Database['public']['Enums']['scoring_mode'];
  minutes: number | null;
  status: Status;
  updatedAt: string;
  cycleId: string;
  cycleTitle: string;
  courseTitle: string;
  courseLang: string;
  yaml: string;
  /** Rebuilt from the stored items (no saved source yet): options in stored order. */
  fromStored: boolean;
  /** Answers from students, by item slug. */
  answered: Record<string, number>;
};

export async function getActivityForEdit(activityId: string): Promise<ActivityForEdit | null> {
  const supabase = await createSupabaseServerClient();
  const { data: a, error } = await supabase
    .from('activities')
    .select(
      'id, slug, title, phase, scoring_mode, est_minutes, status, updated_at, course_id, cycle_id, cycle:cycles ( title )',
    )
    .eq('id', activityId)
    .maybeSingle();
  if (error) fail('the exercise', error);
  if (!a) return null;
  const [course, loaded] = await Promise.all([
    supabase
      .from('courses')
      .select('title, level:levels ( language:languages ( code ) )')
      .eq('id', a.course_id)
      .single(),
    loadActivitySource(supabase, a.id),
  ]);
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    phase: a.phase,
    scoring: a.scoring_mode,
    minutes: a.est_minutes,
    status: a.status,
    updatedAt: a.updated_at,
    cycleId: a.cycle_id,
    cycleTitle: a.cycle?.title ?? '',
    courseTitle: course.data?.title ?? '',
    courseLang: course.data?.level?.language?.code ?? 'en',
    yaml: activityToYaml(loaded.source),
    fromStored: loaded.fromStored,
    answered: Object.fromEntries(loaded.answered),
  };
}

/** An answered question whose answer key the manager may correct (ADR-041). */
export type CorrectableItem = {
  itemId: string;
  type: CorrectableType;
  /** The public data (options, words, pairs, the sentence): ids are what the key names. */
  data: Record<string, unknown>;
  /** The current answer key, in the correction form's terms. */
  answer: Correction;
  /** The latest correction, if any. */
  last: { id: string; at: string; reason: string; rechecked: boolean } | null;
};

/**
 * The answered questions of an exercise that can be corrected, by slug. Read
 * with the manager's own session: keys and corrections are the manager's
 * (RLS), so anyone else gets an empty map.
 */
export async function getCorrectableItems(
  activityId: string,
  answeredSlugs: string[],
): Promise<Record<string, CorrectableItem>> {
  if (!answeredSlugs.length) return {};
  const supabase = await createSupabaseServerClient();
  const { data: items, error } = await supabase
    .from('activity_items')
    .select('id, slug, type, data')
    .eq('activity_id', activityId)
    .in('slug', answeredSlugs);
  if (error) fail('the questions', error);
  const ids = items.map((i) => i.id);
  if (!ids.length) return {};
  const [keys, corrections] = await Promise.all([
    supabase.from('activity_item_keys').select('item_id, answer').in('item_id', ids),
    supabase
      .from('item_corrections')
      .select('id, item_id, corrected_at, reason, regraded_at')
      .eq('activity_id', activityId)
      .order('corrected_at', { ascending: false }),
  ]);
  if (keys.error) fail('the answer keys', keys.error);
  if (corrections.error) fail('the corrections', corrections.error);
  const keyOf = new Map(keys.data.map((k) => [k.item_id, k.answer]));
  const out: Record<string, CorrectableItem> = {};
  for (const item of items) {
    if (!isCorrectable(item.type)) continue;
    const answer = currentAnswer({ type: item.type, data: item.data, key: keyOf.get(item.id) });
    if (!answer) continue;
    const last = corrections.data.find((c) => c.item_id === item.id);
    out[item.slug] = {
      itemId: item.id,
      type: item.type,
      data: item.data as Record<string, unknown>,
      answer,
      last: last
        ? { id: last.id, at: last.corrected_at, reason: last.reason, rechecked: !!last.regraded_at }
        : null,
    };
  }
  return out;
}
