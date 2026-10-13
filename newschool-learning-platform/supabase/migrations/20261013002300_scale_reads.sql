-- Reads that stay complete at school scale (docs/PERFORMANCE.md §8).
--
-- PostgREST returns at most max_rows (1,000) rows per request, so a page that
-- summarised raw rows in the app silently summarised part of them once a
-- group had more than 1,000 first answers. The summaries the teacher's group
-- page shows are computed here instead and come back as a few rows.
--
-- Nothing here widens what anyone can read:
--  * group_item_first_tries and group_student_stats are security_invoker
--    views: every table underneath is read with the caller's own Row Level
--    Security, so a row summarises only records the caller could already read
--    one by one. They also return nothing unless the caller teaches the group
--    or is the pedagogical manager (MFA), so a student or the office gets no
--    rows at all (they could not read these records anyway, or only their own).
--  * office_students gains the student's phone and contact email (and a
--    search text made of them and the name). The view already answers only
--    the office (MFA) and admins (MFA), and both read student_records in full
--    under its own policy. student_records gains phone_digits, generated from
--    the phone: readable exactly where the phone is.
--  * package_balances gains two columns computed from its own row.
-- Views, not functions: nothing in public is callable as RPC.

-- ── the group page: common difficulties ────────────────────────────────────
-- Per group and question: each student's first encounter (their earliest
-- first try; ties broken by the answer's id), how many students answered it
-- and how many got it wrong, and the most frequent wrong first answer (most
-- students; then the one given first; then by text) when more than one
-- student gave it. Same rule as commonDifficulties() in
-- src/domain/teaching/insights.ts, which tests compare it with.
-- Filter by group_id (and item_id); both are pushed into the scan.
create view public.group_item_first_tries with (security_invoker = true) as
select group_id,
       item_id,
       students,
       wrong,
       wrong::numeric / students as wrong_rate,
       case when top_count > 1 then top_answer end as common_wrong_answer,
       case when top_count > 1 then top_count else 0 end as common_wrong_count
  from (
    select group_id,
           item_id,
           sum(n)::int as students,
           coalesce(sum(n) filter (where not is_correct), 0)::int as wrong,
           (array_agg(answer order by n desc, first_at, answer::text) filter (where not is_correct))[1]
             as top_answer,
           coalesce(max(n) filter (where not is_correct), 0)::int as top_count
      from (
        select group_id, item_id, is_correct, answer, count(*) as n, min(created_at) as first_at
          from (
            select distinct on (e.group_id, r.item_id, r.user_id)
                   e.group_id, r.item_id, r.user_id, r.is_correct, r.answer, r.created_at
              from public.enrollments e
              join public.groups g on g.id = e.group_id
              join public.responses r on r.user_id = e.student_id and r.course_id = g.course_id
             where r.try_no = 1
               and r.is_correct is not null
               and (e.group_id in (select app.taught_group_ids()) or (select app.is_manager()))
             order by e.group_id, r.item_id, r.user_id, r.created_at, r.id
          ) first_tries
         group by group_id, item_id, is_correct, answer
      ) answers
     group by group_id, item_id
  ) per_item;

comment on view public.group_item_first_tries is
  'Per group and question: first-encounter results of the group''s students (caller''s RLS; teachers of the group and the manager only).';

-- ── the group page: one row per enrolled student ───────────────────────────
-- First-try answers in the group's course (all of them, as the page counts
-- accuracy), the latest activity in that course (logins left out), and
-- attendance at this group's classes: present and late count as attended,
-- excused is left out of both (as attendanceByStudent()).
create view public.group_student_stats with (security_invoker = true) as
select e.group_id,
       e.student_id,
       a.answers,
       a.correct,
       l.last_active_at,
       m.attended,
       m.counted
  from public.enrollments e
  join public.groups g on g.id = e.group_id
  cross join lateral (
    select count(*)::int as answers,
           (count(*) filter (where r.is_correct))::int as correct
      from public.responses r
     where r.user_id = e.student_id
       and r.course_id = g.course_id
       and r.try_no = 1
       and r.is_correct is not null
  ) a
  cross join lateral (
    select max(ev.occurred_at) as last_active_at
      from public.learning_events ev
     where ev.user_id = e.student_id
       and ev.course_id = g.course_id
       and ev.type <> 'login'
  ) l
  cross join lateral (
    select (count(*) filter (where at.status in ('present', 'late')))::int as attended,
           (count(*) filter (where at.status <> 'excused'))::int as counted
      from public.attendance at
      join public.group_sessions s on s.id = at.session_id
     where at.student_id = e.student_id
       and s.group_id = e.group_id
  ) m
 where e.group_id in (select app.taught_group_ids()) or (select app.is_manager());

comment on view public.group_student_stats is
  'Per group and enrolled student: first-try answers, last activity and attendance (caller''s RLS; teachers of the group and the manager only).';

revoke all on public.group_item_first_tries, public.group_student_stats from public, anon;
grant select on public.group_item_first_tries, public.group_student_stats to authenticated, service_role;

-- ── the office's students: searchable and paged by the database ────────────
-- Same rows as before (everyone with the student role, for the office and
-- admins with MFA); now with the contact details the list shows and a
-- lower-case search text (name, phone, phone digits, contact email) that one
-- `like` searches: a security barrier view cannot use an index for a search,
-- so the work per row is kept small (10,000 students: ~15 ms). The access
-- check is wrapped in (select …) so it runs once per query, not per student.
alter table public.student_records
  add column phone_digits text generated always as (regexp_replace(phone, '[^0-9]', '', 'g')) stored;
comment on column public.student_records.phone_digits is
  'The phone without spaces, dashes or other signs, for searching.';

create or replace view public.office_students with (security_barrier = true) as
  select p.id, p.display_name, p.created_at,
         coalesce(r.phone, '') as phone,
         coalesce(r.contact_email, '') as contact_email,
         lower(concat_ws(' ', p.display_name, r.phone, r.phone_digits, r.contact_email)) as search_text
  from public.profiles p
  left join public.student_records r on r.student_id = p.id
  where exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'student')
    and ((select app.is_office()) or (select app.is_admin()));

-- ── package balances: what is left, for filtering in the database ──────────
create or replace view public.package_balances with (security_invoker = true) as
  select
    p.id as package_id,
    p.student_id,
    p.lessons,
    p.expires_on,
    p.paid_at,
    p.price,
    (count(l.id) filter (where l.status in ('done', 'cancelled_late', 'no_show')))::int as used,
    (count(l.id) filter (where l.status = 'scheduled'))::int as booked,
    -- balance() in src/domain/office/packages.ts
    (p.lessons - count(l.id) filter (where l.status in ('done', 'cancelled_late', 'no_show')))::int
      as lessons_left,
    (p.lessons - count(l.id) filter (where l.status in ('done', 'cancelled_late', 'no_show', 'scheduled')))::int
      as unbooked
  from public.lesson_packages p
  left join public.private_lessons l on l.package_id = p.id
  group by p.id;
