import 'server-only';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { readAll } from './paging';

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

/** Feedback pages list at most this many, the latest first, and say how many there are. */
export const FEEDBACK_SHOWN = 300;

const FEEDBACK_COLUMNS = `id, kind, author_id, subject, verdict, language_code, level, body, created_at, handled_at,
  author:profiles!staff_feedback_author_id_fkey ( display_name ),
  student:profiles!staff_feedback_student_id_fkey ( display_name )`;

/**
 * Feedback the caller may read: their own, or (for the manager with MFA)
 * everyone's. The latest FEEDBACK_SHOWN, newest first, and how many there
 * are; `mine` limits it to what the caller wrote.
 */
export async function listFeedback(
  options: { authorId?: string; handled?: boolean } = {},
): Promise<{ feedback: Feedback[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from('staff_feedback')
    .select(FEEDBACK_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id')
    .limit(FEEDBACK_SHOWN);
  if (options.authorId) query = query.eq('author_id', options.authorId);
  if (options.handled !== undefined) {
    query = options.handled ? query.not('handled_at', 'is', null) : query.is('handled_at', null);
  }
  const { data, error, count } = await query;
  if (error) fail('feedback', error);
  return { feedback: data.map(toFeedback), total: count ?? data.length };
}

/**
 * Every feedback the caller may read that is not handled yet (all pages):
 * none may drop off the manager's list, and the "missing material" summary
 * counts them all.
 */
export async function listOpenFeedback(): Promise<Feedback[]> {
  const supabase = await createSupabaseServerClient();
  const data = await readAll('feedback', (from, to) =>
    supabase
      .from('staff_feedback')
      .select(FEEDBACK_COLUMNS)
      .is('handled_at', null)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  );
  return data.map(toFeedback);
}

type FeedbackRow = {
  id: string;
  kind: FeedbackKind;
  author_id: string;
  subject: string;
  verdict: string | null;
  language_code: string | null;
  level: number | null;
  body: string;
  created_at: string;
  handled_at: string | null;
  author: { display_name: string } | null;
  student: { display_name: string } | null;
};

function toFeedback(f: FeedbackRow): Feedback {
  return {
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
  };
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

/** Done tasks listed, the latest first (open tasks are always all listed). */
export const DONE_TASKS_SHOWN = 100;

/** Tasks the caller sent or received, with who they are from and for. */
export async function listTasks(
  userId: string,
  userName: string,
): Promise<{
  tasks: Task[];
  /** How many done tasks there are (the latest DONE_TASKS_SHOWN are listed). */
  doneTotal: number;
  assignees: { id: string; name: string }[];
}> {
  const supabase = await createSupabaseServerClient();
  const columns = 'id, title, note, priority, status, created_by, assignee_id, created_at, done_at';
  // Every open task (none may drop off the list), and the latest done ones.
  const [open, done, assignees] = await Promise.all([
    readAll('tasks', (from, to) =>
      supabase
        .from('staff_tasks')
        .select(columns)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    supabase
      .from('staff_tasks')
      .select(columns, { count: 'exact' })
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .order('id')
      .limit(DONE_TASKS_SHOWN),
    supabase.from('task_assignees').select('id, display_name').order('display_name'),
  ]);
  if (done.error) fail('tasks', done.error);
  if (assignees.error) fail('task recipients', assignees.error);
  const tasks = { data: [...open, ...done.data] };
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
    doneTotal: done.count ?? done.data.length,
    assignees: assignees.data.map((a) => ({ id: a.id!, name: a.display_name ?? '' })),
  };
}
