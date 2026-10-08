import 'server-only';
import {
  parseBlocksForRender,
  parseTeacherNotes,
  type Block,
  type TeacherNote,
} from '@/content/schema';
import type { SessionUser } from '@/server/auth/session';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { listMyCourses, type MyCourse } from './student';

type ProgressStatus = Database['public']['Enums']['progress_status'];
export type BookKind = Database['public']['Enums']['book_kind'];

export type NotebookCycle = {
  id: string;
  title: string;
  active: boolean;
  sections: { id: string; title: string; status: ProgressStatus }[];
};

/**
 * The student's notebook for one course: published cycles that have notebook
 * sections, with the group's active cycles first. RLS limits everything to
 * published content of a course the student is enrolled in.
 */
export async function getStudentNotebook(
  user: SessionUser,
  requestedCourseId: string | undefined,
  kind: BookKind = 'notebook',
): Promise<{ courses: MyCourse[]; course: MyCourse | null; cycles: NotebookCycle[] }> {
  const courses = await listMyCourses(user.id);
  const course = courses.find((c) => c.courseId === requestedCourseId) ?? courses[0] ?? null;
  if (!course) return { courses, course, cycles: [] };

  const supabase = await createSupabaseServerClient();
  const [cycles, sections, groupCycles, progress] = await Promise.all([
    supabase.from('cycles').select('id, title, position').eq('course_id', course.courseId),
    supabase
      .from('book_sections')
      .select('id, title, cycle_id, position, book:books ( kind )')
      .eq('course_id', course.courseId)
      .order('position'),
    supabase.from('group_cycles').select('cycle_id, state').eq('group_id', course.groupId),
    supabase
      .from('section_progress')
      .select('book_section_id, status')
      .eq('user_id', user.id)
      .eq('course_id', course.courseId),
  ]);
  for (const r of [cycles, sections, groupCycles, progress]) {
    if (r.error) throw new Error(`Could not load the notebook: ${r.error.message}`);
  }

  const state = new Map((groupCycles.data ?? []).map((g) => [g.cycle_id, g.state]));
  const status = new Map((progress.data ?? []).map((p) => [p.book_section_id, p.status]));
  const notebookSections = (sections.data ?? []).filter((s) => s.book?.kind === kind);

  const result = (cycles.data ?? [])
    .map((c) => ({
      id: c.id,
      title: c.title,
      position: c.position,
      active: state.get(c.id) === 'active',
      sections: notebookSections
        .filter((s) => s.cycle_id === c.id)
        .map((s) => ({ id: s.id, title: s.title, status: status.get(s.id) ?? 'not_started' })),
    }))
    .filter((c) => c.sections.length > 0)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.position - b.position)
    .map(({ id, title, active, sections }) => ({ id, title, active, sections }));

  return { courses, course, cycles: result };
}

export type SectionData = {
  id: string;
  title: string;
  courseId: string;
  kind: BookKind;
  cycleTitle: string;
  courseLang: string;
  aiTutorUrl: string | null;
  blocks: (Block | null)[];
};

async function loadSection(sectionId: string): Promise<SectionData | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('book_sections')
    .select(
      'id, title, blocks, course_id, cycle:cycles ( title ), book:books ( kind, course:courses ( ai_tutor_url, level:levels ( language:languages ( code ) ) ) )',
    )
    .eq('id', sectionId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the section: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    courseId: data.course_id,
    kind: data.book?.kind ?? 'notebook',
    cycleTitle: data.cycle?.title ?? '',
    courseLang: data.book?.course?.level?.language?.code ?? 'en',
    aiTutorUrl: data.book?.course?.ai_tutor_url ?? null,
    blocks: parseBlocksForRender(data.blocks),
  };
}

/** A section as a student sees it, with their own saved answers. Null if not visible. */
export async function getStudentSection(
  user: SessionUser,
  sectionId: string,
): Promise<(SectionData & { answers: Record<string, string>; status: ProgressStatus }) | null> {
  const section = await loadSection(sectionId);
  if (!section) return null;
  const supabase = await createSupabaseServerClient();
  const [answers, progress] = await Promise.all([
    supabase
      .from('block_responses')
      .select('block_id, item_index, answer')
      .eq('user_id', user.id)
      .eq('section_id', sectionId),
    supabase
      .from('section_progress')
      .select('status')
      .eq('user_id', user.id)
      .eq('book_section_id', sectionId)
      .maybeSingle(),
  ]);
  if (answers.error) throw new Error(`Could not load answers: ${answers.error.message}`);
  return {
    ...section,
    answers: Object.fromEntries(
      answers.data.map((a) => [`${a.block_id}:${a.item_index}`, a.answer]),
    ),
    status: progress.data?.status ?? 'not_started',
  };
}

/**
 * A section as a teacher of `groupId` sees it: teacher notes plus the
 * answers of that group's students. Null unless the caller teaches the group
 * and the section belongs to the group's course (RLS enforces the same).
 */
export async function getTeacherSection(
  groupId: string,
  sectionId: string,
): Promise<
  | (SectionData & {
      groupName: string;
      notes: TeacherNote[];
      groupAnswers: Record<string, { student: string; answer: string }[]>;
    })
  | null
> {
  const supabase = await createSupabaseServerClient();
  const { data: group, error } = await supabase
    .from('groups')
    .select('id, name, course_id, enrollments ( status, student:profiles ( id, display_name ) )')
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the group: ${error.message}`);
  if (!group) return null;

  const section = await loadSection(sectionId);
  if (!section || section.courseId !== group.course_id) return null;

  const students = new Map(
    group.enrollments
      .filter((e) => e.status === 'active' && e.student)
      .map((e) => [e.student!.id, e.student!.display_name]),
  );

  const [notes, answers] = await Promise.all([
    supabase
      .from('section_teacher_notes')
      .select('blocks')
      .eq('section_id', sectionId)
      .maybeSingle(),
    supabase
      .from('block_responses')
      .select('user_id, block_id, item_index, answer')
      .eq('section_id', sectionId)
      .in(
        'user_id',
        [...students.keys()].length
          ? [...students.keys()]
          : ['00000000-0000-0000-0000-000000000000'],
      ),
  ]);
  if (answers.error) throw new Error(`Could not load answers: ${answers.error.message}`);

  const groupAnswers: Record<string, { student: string; answer: string }[]> = {};
  for (const a of answers.data) {
    const key = `${a.block_id}:${a.item_index}`;
    (groupAnswers[key] ??= []).push({ student: students.get(a.user_id) ?? '', answer: a.answer });
  }
  for (const list of Object.values(groupAnswers))
    list.sort((x, y) => x.student.localeCompare(y.student));

  return {
    ...section,
    groupName: group.name,
    notes: parseTeacherNotes(notes.data?.blocks),
    groupAnswers,
  };
}

/** Notebook sections of a group's course, for the teacher's group page. */
export async function listGroupNotebook(
  courseId: string,
  groupId: string,
): Promise<{ cycle: string; active: boolean; sections: { id: string; title: string }[] }[]> {
  const supabase = await createSupabaseServerClient();
  const [cycles, sections, groupCycles] = await Promise.all([
    supabase
      .from('cycles')
      .select('id, title, position')
      .eq('course_id', courseId)
      .order('position'),
    supabase
      .from('book_sections')
      .select('id, title, cycle_id, book:books ( kind )')
      .eq('course_id', courseId)
      .order('position'),
    supabase.from('group_cycles').select('cycle_id, state').eq('group_id', groupId),
  ]);
  const state = new Map((groupCycles.data ?? []).map((g) => [g.cycle_id, g.state]));
  const notebook = (sections.data ?? []).filter((s) => s.book?.kind === 'notebook');
  return (cycles.data ?? [])
    .map((c) => ({
      cycle: c.title,
      active: state.get(c.id) === 'active',
      sections: notebook
        .filter((s) => s.cycle_id === c.id)
        .map((s) => ({ id: s.id, title: s.title })),
    }))
    .filter((c) => c.sections.length > 0);
}
