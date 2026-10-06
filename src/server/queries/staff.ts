import 'server-only';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';

// Staff tools (stage E): feedback, training links, tasks, and the groups the
// lesson-plan builder can start from. Read with the caller's own session:
// RLS decides who sees which rows.

type FeedbackKind = Database['public']['Enums']['feedback_kind'];

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

export type PlannerGroup = {
  id: string;
  name: string;
  languageCode: string;
  cefr: string | null;
  cyclePosition: number | null;
  students: number;
};

/** The teacher's groups, with what the lesson-plan builder fills in from them. */
export async function listPlannerGroups(teacherId: string): Promise<PlannerGroup[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('group_teachers')
    .select(
      `group:groups ( id, name, enrollments ( status ),
         course:courses ( level:levels ( cefr, position, language:languages ( code ) ) ) )`,
    )
    .eq('teacher_id', teacherId);
  if (error) fail('groups', error);
  return data.flatMap(({ group }) =>
    group
      ? [
          {
            id: group.id,
            name: group.name,
            languageCode: group.course?.level?.language?.code ?? '',
            cefr: group.course?.level?.cefr ?? null,
            cyclePosition: group.course?.level?.position ?? null,
            students: group.enrollments.filter((e) => e.status === 'active').length,
          },
        ]
      : [],
  );
}

/** Students the teacher teaches (any of their groups), for feedback about a student. */
export async function listMyStudents(teacherId: string): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('group_teachers')
    .select('group:groups ( enrollments ( status, student:profiles ( id, display_name ) ) )')
    .eq('teacher_id', teacherId);
  if (error) fail('students', error);
  const byId = new Map<string, string>();
  for (const { group } of data) {
    for (const e of group?.enrollments ?? []) {
      if (e.student && e.status !== 'withdrawn') byId.set(e.student.id, e.student.display_name);
    }
  }
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export type Feedback = {
  id: string;
  kind: FeedbackKind;
  authorId: string;
  authorName: string;
  studentName: string | null;
  subject: string;
  verdict: string | null;
  languageCode: string | null;
  level: number | null;
  body: string;
  createdAt: string;
  handledAt: string | null;
};

/**
 * Feedback the caller may read: their own, or (for the manager with MFA)
 * everyone's. Newest first; unhandled before handled when `all`.
 */
export async function listFeedback(): Promise<Feedback[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('staff_feedback')
    .select(
      `id, kind, author_id, subject, verdict, language_code, level, body, created_at, handled_at,
       author:profiles!staff_feedback_author_id_fkey ( display_name ),
       student:profiles!staff_feedback_student_id_fkey ( display_name )`,
    )
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) fail('feedback', error);
  return data.map((f) => ({
    id: f.id,
    kind: f.kind,
    authorId: f.author_id,
    authorName: f.author?.display_name ?? '',
    studentName: f.student?.display_name ?? null,
    subject: f.subject,
    verdict: f.verdict,
    languageCode: f.language_code,
    level: f.level,
    body: f.body,
    createdAt: f.created_at,
    handledAt: f.handled_at,
  }));
}

export type Resource = {
  id: string;
  title: string;
  url: string;
  description: string;
  createdAt: string;
};

export async function listResources(): Promise<Resource[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('staff_resources')
    .select('id, title, url, description, created_at')
    .order('created_at', { ascending: false });
  if (error) fail('training links', error);
  return data.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    description: r.description,
    createdAt: r.created_at,
  }));
}

export type Task = {
  id: string;
  title: string;
  note: string;
  priority: Database['public']['Enums']['task_priority'];
  status: Database['public']['Enums']['task_status'];
  createdBy: string;
  assigneeId: string;
  assigneeName: string;
  senderName: string;
  createdAt: string;
  doneAt: string | null;
};

/** Tasks the caller sent or received, with who they are from and for. */
export async function listTasks(
  userId: string,
  userName: string,
): Promise<{
  tasks: Task[];
  assignees: { id: string; name: string }[];
}> {
  const supabase = await createSupabaseServerClient();
  const [tasks, assignees] = await Promise.all([
    supabase
      .from('staff_tasks')
      .select('id, title, note, priority, status, created_by, assignee_id, created_at, done_at')
      .order('created_at', { ascending: false })
      .limit(300),
    supabase.from('task_assignees').select('id, display_name').order('display_name'),
  ]);
  if (tasks.error) fail('tasks', tasks.error);
  if (assignees.error) fail('task recipients', assignees.error);
  const managerName = new Map(assignees.data.map((a) => [a.id!, a.display_name ?? '']));
  // Senders' names: the caller's own, or (for a recipient) read through the
  // profiles policy where it allows; otherwise left blank.
  const senders = [...new Set(tasks.data.map((t) => t.created_by).filter((id) => id !== userId))];
  const { data: senderProfiles } = senders.length
    ? await supabase.from('profiles').select('id, display_name').in('id', senders)
    : { data: [] };
  const senderName = new Map((senderProfiles ?? []).map((p) => [p.id, p.display_name]));
  senderName.set(userId, userName);
  return {
    tasks: tasks.data.map((t) => ({
      id: t.id,
      title: t.title,
      note: t.note,
      priority: t.priority,
      status: t.status,
      createdBy: t.created_by,
      assigneeId: t.assignee_id,
      assigneeName: managerName.get(t.assignee_id) ?? '',
      senderName: senderName.get(t.created_by) ?? '',
      createdAt: t.created_at,
      doneAt: t.done_at,
    })),
    assignees: assignees.data.map((a) => ({ id: a.id!, name: a.display_name ?? '' })),
  };
}
