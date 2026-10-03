import 'server-only';
import type { Role } from '@/domain/auth/access';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';

type Enums = Database['public']['Enums'];

// Every query here runs with the pedagogical manager's own session; the
// database returns the whole school only to a manager whose session passed
// two-step verification (RLS: is_manager()).

export type CourseOverview = {
  id: string;
  title: string;
  status: Enums['content_status'];
  levelTitle: string;
  languageCode: string;
  languageName: string;
  groupCount: number;
};

export async function listCoursesForManager(): Promise<CourseOverview[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('courses')
    .select(
      'id, title, status, level:levels ( title, language:languages ( code, name ) ), groups ( id )',
    )
    .order('title');
  if (error) throw new Error(`Could not load courses: ${error.message}`);
  return data.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    levelTitle: c.level?.title ?? '',
    languageCode: c.level?.language?.code ?? '',
    languageName: c.level?.language?.name ?? '',
    groupCount: c.groups.length,
  }));
}

export type GroupRow = {
  id: string;
  name: string;
  status: Enums['group_status'];
  courseTitle: string;
  teachers: string[];
  activeStudents: number;
};

export async function listGroupsForManager(): Promise<GroupRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('groups')
    .select(
      'id, name, status, course:courses ( title ), group_teachers ( teacher:profiles ( display_name ) ), enrollments ( status )',
    )
    .order('name');
  if (error) throw new Error(`Could not load groups: ${error.message}`);
  return data.map((g) => ({
    id: g.id,
    name: g.name,
    status: g.status,
    courseTitle: g.course?.title ?? '',
    teachers: g.group_teachers.flatMap((t) => (t.teacher ? [t.teacher.display_name] : [])),
    activeStudents: g.enrollments.filter((e) => e.status === 'active').length,
  }));
}

export type GroupDetail = {
  id: string;
  name: string;
  status: Enums['group_status'];
  scheduleNote: string;
  startsOn: string | null;
  courseId: string;
  courseTitle: string;
  teachers: { id: string; name: string }[];
  enrollments: {
    id: string;
    studentId: string;
    name: string;
    status: Enums['enrollment_status'];
  }[];
  cycles: {
    id: string;
    title: string;
    position: number;
    published: boolean;
    state: Enums['group_cycle_state'] | null;
  }[];
};

export async function getGroupForManager(groupId: string): Promise<GroupDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('groups')
    .select(
      `id, name, status, schedule_note, starts_on, course_id,
       course:courses ( title, cycles ( id, title, position, status ) ),
       group_teachers ( teacher:profiles ( id, display_name ) ),
       enrollments ( id, status, student:profiles ( id, display_name ) ),
       group_cycles ( cycle_id, state )`,
    )
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw new Error(`Could not load group: ${error.message}`);
  if (!data) return null;

  const states = new Map(data.group_cycles.map((gc) => [gc.cycle_id, gc.state]));
  return {
    id: data.id,
    name: data.name,
    status: data.status,
    scheduleNote: data.schedule_note,
    startsOn: data.starts_on,
    courseId: data.course_id,
    courseTitle: data.course?.title ?? '',
    teachers: data.group_teachers.flatMap((t) =>
      t.teacher ? [{ id: t.teacher.id, name: t.teacher.display_name }] : [],
    ),
    enrollments: data.enrollments
      .flatMap((e) =>
        e.student
          ? [{ id: e.id, studentId: e.student.id, name: e.student.display_name, status: e.status }]
          : [],
      )
      .sort((a, b) => a.name.localeCompare(b.name)),
    cycles: (data.course?.cycles ?? [])
      .map((c) => ({
        id: c.id,
        title: c.title,
        position: c.position,
        published: c.status === 'published',
        state: states.get(c.id) ?? null,
      }))
      .sort((a, b) => a.position - b.position),
  };
}

/** People holding a role, for the teacher and student pickers. */
export async function listPeopleWithRole(role: Role): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('user_roles')
    .select('profile:profiles!user_roles_user_id_fkey ( id, display_name )')
    .eq('role', role);
  if (error) throw new Error(`Could not load people: ${error.message}`);
  return data
    .flatMap((r) => (r.profile ? [{ id: r.profile.id, name: r.profile.display_name }] : []))
    .sort((a, b) => a.name.localeCompare(b.name));
}
