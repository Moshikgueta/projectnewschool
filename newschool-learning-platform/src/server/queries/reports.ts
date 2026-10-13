import 'server-only';
import type { Database } from '@/server/db.types';
import { createSupabaseServerClient } from '@/server/supabase/server';

// Mistake reports (ADR-040), read with the caller's own session: RLS shows a
// student only their own, a teacher those about courses they teach, and the
// pedagogical manager (MFA) all of them.

export type ReportStatus = Database['public']['Enums']['report_status'];

export type ContentReport = {
  id: string;
  status: ReportStatus;
  message: string;
  suggestedAnswer: string;
  createdAt: string;
  resolvedAt: string | null;
  resolverName: string | null;
  /** Null when the caller may not see the student's name. */
  reporterName: string | null;
  course: { id: string; title: string };
  activity: { id: string; title: string } | null;
  /** Position of the question in its exercise (1-based), when a question was reported. */
  question: number | null;
  /** The reported question's id, when a question was reported. */
  itemId: string | null;
  /** The answer correction made for this report (manager only, ADR-041). */
  correction: { at: string; reason: string } | null;
  section: { id: string; title: string; kind: Database['public']['Enums']['book_kind'] } | null;
};

export async function listReports(filter: ReportStatus | 'all'): Promise<ContentReport[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from('content_reports')
    .select(
      `id, status, message, suggested_answer, created_at, resolved_at, course_id, activity_id, item_id, book_section_id,
       course:courses!content_reports_course_id_fkey ( id, title ),
       activity:activities!content_reports_activity_id_course_id_fkey ( id, title ),
       item:activity_items!content_reports_item_id_course_id_fkey ( position ),
       section:book_sections!content_reports_book_section_id_course_id_fkey ( id, title, book:books ( kind ) ),
       reporter:profiles!content_reports_reporter_id_fkey ( display_name ),
       resolver:profiles!content_reports_resolved_by_fkey ( display_name ),
       corrections:item_corrections!item_corrections_report_id_fkey ( corrected_at, reason )`,
    )
    .order('created_at', { ascending: false })
    .limit(500);
  if (filter !== 'all') query = query.eq('status', filter);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load reports: ${error.message}`);
  return data.map((r) => ({
    id: r.id,
    status: r.status,
    message: r.message,
    suggestedAnswer: r.suggested_answer,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolverName: r.resolver?.display_name ?? null,
    reporterName: r.reporter?.display_name ?? null,
    course: { id: r.course_id, title: r.course?.title ?? '' },
    activity: r.activity_id ? { id: r.activity_id, title: r.activity?.title ?? '' } : null,
    question: r.item ? r.item.position : null,
    itemId: r.item_id,
    // RLS shows corrections to the manager only; teachers get none.
    correction: r.corrections.length
      ? {
          at: r.corrections[r.corrections.length - 1]!.corrected_at,
          reason: r.corrections[r.corrections.length - 1]!.reason,
        }
      : null,
    section: r.book_section_id
      ? {
          id: r.book_section_id,
          title: r.section?.title ?? '',
          kind: r.section?.book?.kind ?? 'notebook',
        }
      : null,
  }));
}

/** For a teacher: one of their groups per course, to link a report to the teacher's view. */
export async function myGroupPerCourse(teacherId: string): Promise<Map<string, string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('group_teachers')
    .select('group:groups ( id, course_id )')
    .eq('teacher_id', teacherId);
  if (error) throw new Error(`Could not load groups: ${error.message}`);
  const map = new Map<string, string>();
  for (const { group } of data) {
    if (group && !map.has(group.course_id)) map.set(group.course_id, group.id);
  }
  return map;
}
