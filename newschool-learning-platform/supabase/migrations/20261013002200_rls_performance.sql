-- RLS at school scale (docs/PERFORMANCE.md). Same rules, evaluated once per
-- query instead of once per row.
--
-- Measured on 10,000 students (scripts/perf): the read policies called
-- SECURITY DEFINER helpers with a row's column — app.can_read_course(course_id),
-- app.teaches_student_in_course(user_id, course_id),
-- app.teaches_group(app.session_group(session_id)), … — so every row scanned
-- paid for one or more function calls (each with its own search_path and
-- nested helper calls), and app.is_office() / app.is_staff() were not wrapped
-- in a sub-select, so they too ran per row. The worst page query took 4.9 s.
--
-- The fix is the standard one: each per-row helper `app.f(col)` becomes a
-- semi-join `col in (select app.f_set())` against a set-returning helper that
-- lists exactly the values for which `app.f` is true for the caller. The set
-- is computed once per query (a hashed sub-plan) and probed per row. Every set
-- helper below restates its per-row helper's own predicate, unchanged, over
-- the same tables, with the same SECURITY DEFINER / STABLE / search_path = ''.
-- Bare app.is_office() / app.is_staff() are wrapped as (select …), which
-- Postgres evaluates once (initPlan); they take no row argument, so the value
-- is the same for every row.
--
-- Nothing is widened or narrowed: only SELECT policies and the USING / WITH
-- CHECK of FOR ALL policies (which also apply to reads) change, by ALTER
-- POLICY, keeping names, commands and roles. The old helpers stay: write
-- policies, triggers and other helpers still use them. Proven by the pgTAP
-- suite and by scripts/perf/bench.sql returning the same rows (count and
-- checksum) for every benchmarked query and user before and after.

-- ── set-returning helpers ───────────────────────────────────────────────────

/** Courses app.can_read_course() admits apart from the manager: published, and the caller is
    actively enrolled in a group of it or teaches one. */
create function app.readable_course_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 20 as $$
  select c.id from public.courses c
  where c.status = 'published'
    and (
      exists (
        select 1 from public.enrollments e join public.groups g on g.id = e.group_id
        where g.course_id = c.id and e.student_id = (select auth.uid()) and e.status = 'active'
      )
      or exists (
        select 1 from public.group_teachers gt join public.groups g on g.id = gt.group_id
        where g.course_id = c.id and gt.teacher_id = (select auth.uid())
      )
    );
$$;

/** Courses for which app.teaches_course() is true. */
create function app.taught_course_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 20 as $$
  select g.course_id
  from public.group_teachers gt
  join public.groups g on g.id = gt.group_id
  where gt.teacher_id = (select auth.uid());
$$;

/** Groups for which app.teaches_group() is true. */
create function app.taught_group_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 20 as $$
  select group_id from public.group_teachers where teacher_id = (select auth.uid());
$$;

/** Groups for which app.is_group_member() is true (active enrolment). */
create function app.member_group_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 5 as $$
  select group_id from public.enrollments
  where student_id = (select auth.uid()) and status = 'active';
$$;

/** Assignments for which app.is_assignment_recipient() is true. */
create function app.received_assignment_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 20 as $$
  select assignment_id from public.assignment_recipients where student_id = (select auth.uid());
$$;

/** Assignments for which app.teaches_assignment() is true. */
create function app.taught_assignment_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 200 as $$
  select a.id
  from public.assignments a
  join public.group_teachers gt on gt.group_id = a.group_id
  where gt.teacher_id = (select auth.uid());
$$;

/** Assignments the caller gave (app.office_owns_assignment() = app.is_office() and this). */
create function app.own_assignment_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 200 as $$
  select id from public.assignments where assigned_by = (select auth.uid());
$$;

/** (student, course) pairs for which app.teaches_student_in_course() is true. */
create function app.taught_student_courses()
returns table (student_id uuid, course_id uuid)
language sql stable security definer set search_path = '' rows 200 as $$
  select e.student_id, g.course_id
  from public.group_teachers gt
  join public.groups g on g.id = gt.group_id
  join public.enrollments e on e.group_id = g.id
  where gt.teacher_id = (select auth.uid());
$$;

/** Classes for which app.teaches_group(app.session_group(id)) is true. */
create function app.taught_session_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 500 as $$
  select s.id
  from public.group_sessions s
  join public.group_teachers gt on gt.group_id = s.group_id
  where gt.teacher_id = (select auth.uid());
$$;

/** Students for which app.teaches_student() is true. */
create function app.taught_student_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 200 as $$
  select e.student_id
  from public.group_teachers gt
  join public.enrollments e on e.group_id = gt.group_id
  where gt.teacher_id = (select auth.uid());
$$;

/** Teachers for which app.is_my_teacher() is true. */
create function app.my_teacher_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 5 as $$
  select gt.teacher_id
  from public.group_teachers gt
  join public.enrollments e on e.group_id = gt.group_id
  where e.student_id = (select auth.uid()) and e.status = 'active';
$$;

/** Students for which app.teaches_privately() is true. */
create function app.private_student_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 20 as $$
  select student_id from public.private_lessons where teacher_id = (select auth.uid());
$$;

/** Teachers for which app.is_my_private_teacher() is true. */
create function app.private_teacher_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 5 as $$
  select teacher_id from public.private_lessons where student_id = (select auth.uid());
$$;

/** Users for which app.is_student_or_teacher() is true. */
create function app.student_or_teacher_ids()
returns setof uuid language sql stable security definer set search_path = '' rows 1000 as $$
  select user_id from public.user_roles where role in ('student', 'teacher');
$$;

revoke all on function app.readable_course_ids(), app.taught_course_ids(), app.taught_group_ids(),
  app.member_group_ids(), app.received_assignment_ids(), app.taught_assignment_ids(),
  app.own_assignment_ids(), app.taught_student_courses(), app.taught_session_ids(),
  app.taught_student_ids(), app.my_teacher_ids(), app.private_student_ids(),
  app.private_teacher_ids(), app.student_or_teacher_ids()
  from public, anon;
grant execute on function app.readable_course_ids(), app.taught_course_ids(), app.taught_group_ids(),
  app.member_group_ids(), app.received_assignment_ids(), app.taught_assignment_ids(),
  app.own_assignment_ids(), app.taught_student_courses(), app.taught_session_ids(),
  app.taught_student_ids(), app.my_teacher_ids(), app.private_student_ids(),
  app.private_teacher_ids(), app.student_or_teacher_ids()
  to authenticated, service_role;

-- ── catalog ─────────────────────────────────────────────────────────────────
-- app.can_read_course(c) = app.is_manager() or c in app.readable_course_ids().

alter policy courses_select on public.courses using (
  (select app.is_manager()) or id in (select app.readable_course_ids())
);
alter policy courses_select_office on public.courses using (
  status = 'published' and (select app.is_office())
);
alter policy cycles_select on public.cycles using (
  (select app.is_manager())
  or (status = 'published' and course_id in (select app.readable_course_ids()))
);
alter policy cycles_select_office on public.cycles using (
  status = 'published' and (select app.is_office())
);
alter policy books_select on public.books using (
  (select app.is_manager()) or course_id in (select app.readable_course_ids())
);
alter policy media_assets_select on public.media_assets using (
  course_id is null or (select app.is_manager()) or course_id in (select app.readable_course_ids())
);
alter policy section_teacher_notes_select on public.section_teacher_notes using (
  (select app.is_manager())
  or (course_id in (select app.taught_course_ids())
      and exists (select 1 from public.book_sections s where s.id = section_id))
);
alter policy activity_item_keys_select on public.activity_item_keys using (
  (select app.is_manager())
  or (course_id in (select app.taught_course_ids())
      and exists (select 1 from public.activity_items i where i.id = item_id))
);

-- ── delivery ────────────────────────────────────────────────────────────────

alter policy groups_select on public.groups using (
  id in (select app.member_group_ids()) or id in (select app.taught_group_ids())
  or (select app.is_manager()) or (select app.is_admin())
);
alter policy groups_select_office on public.groups using ((select app.is_office()));

alter policy group_teachers_select on public.group_teachers using (
  group_id in (select app.taught_group_ids()) or group_id in (select app.member_group_ids())
  or (select app.is_manager()) or (select app.is_admin())
);

alter policy enrollments_select on public.enrollments using (
  student_id = (select auth.uid()) or group_id in (select app.taught_group_ids())
  or (select app.is_manager()) or (select app.is_admin())
);
alter policy enrollments_select_office on public.enrollments using ((select app.is_office()));

alter policy group_cycles_select on public.group_cycles using (
  group_id in (select app.member_group_ids()) or group_id in (select app.taught_group_ids())
  or (select app.is_manager())
);
alter policy group_cycles_write on public.group_cycles
  using (group_id in (select app.taught_group_ids()) or (select app.is_manager()))
  with check (group_id in (select app.taught_group_ids()) or (select app.is_manager()));

alter policy group_sessions_select on public.group_sessions using (
  group_id in (select app.member_group_ids()) or group_id in (select app.taught_group_ids())
  or (select app.is_manager())
);
alter policy group_sessions_write on public.group_sessions
  using (group_id in (select app.taught_group_ids()) or (select app.is_manager()))
  with check (group_id in (select app.taught_group_ids()) or (select app.is_manager()));

alter policy assignments_select on public.assignments using (
  group_id in (select app.taught_group_ids())
  or (select app.is_manager())
  or (group_id in (select app.member_group_ids())
      and (audience = 'group' or id in (select app.received_assignment_ids())))
);
alter policy assignments_select_office on public.assignments using ((select app.is_office()));

alter policy assignment_recipients_select on public.assignment_recipients using (
  student_id = (select auth.uid()) or assignment_id in (select app.taught_assignment_ids())
  or (select app.is_manager())
);
alter policy assignment_recipients_write on public.assignment_recipients
  using (assignment_id in (select app.taught_assignment_ids()) or (select app.is_manager()))
  with check (assignment_id in (select app.taught_assignment_ids()) or (select app.is_manager()));
alter policy assignment_recipients_select_office on public.assignment_recipients using (
  (select app.is_office()) and assignment_id in (select app.own_assignment_ids())
);

-- ── learner records ─────────────────────────────────────────────────────────

alter policy attempts_select on public.attempts using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or (user_id, course_id) in (select t.student_id, t.course_id from app.taught_student_courses() t)
);
alter policy responses_select on public.responses using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or (user_id, course_id) in (select t.student_id, t.course_id from app.taught_student_courses() t)
);
alter policy section_progress_select on public.section_progress using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or (user_id, course_id) in (select t.student_id, t.course_id from app.taught_student_courses() t)
);
alter policy vocab_review_state_select on public.vocab_review_state using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or (user_id, course_id) in (select t.student_id, t.course_id from app.taught_student_courses() t)
);
alter policy block_responses_select on public.block_responses using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or (user_id, course_id) in (select t.student_id, t.course_id from app.taught_student_courses() t)
);
alter policy learning_events_select on public.learning_events using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or (course_id is not null
      and (user_id, course_id) in (select t.student_id, t.course_id from app.taught_student_courses() t))
);

alter policy attendance_select on public.attendance using (
  student_id = (select auth.uid())
  or session_id in (select app.taught_session_ids())
  or (select app.is_manager())
);

alter policy content_reports_select on public.content_reports using (
  reporter_id = (select auth.uid())
  or (select app.is_manager())
  or course_id in (select app.taught_course_ids())
);

-- ── people, office records, staff room ─────────────────────────────────────

alter policy profiles_select on public.profiles using (
  id = (select auth.uid())
  or id in (select app.taught_student_ids())
  or id in (select app.my_teacher_ids())
  or (select app.is_manager())
  or (select app.is_admin())
);
alter policy profiles_select_office on public.profiles using (
  (select app.is_office()) and id in (select app.student_or_teacher_ids())
);
alter policy profiles_select_private on public.profiles using (
  id in (select app.private_student_ids()) or id in (select app.private_teacher_ids())
);

alter policy student_records_select on public.student_records using (
  student_id = (select auth.uid()) or (select app.is_office()) or (select app.is_admin())
  or (select app.is_manager())
);
alter policy student_records_write on public.student_records
  using ((select app.is_office()) or (select app.is_admin()))
  with check ((select app.is_office()) or (select app.is_admin()));

alter policy lesson_packages_select on public.lesson_packages using (
  student_id = (select auth.uid()) or (select app.is_office()) or (select app.is_admin())
  or (select app.is_manager())
);
alter policy lesson_packages_write on public.lesson_packages
  using ((select app.is_office()) or (select app.is_admin()))
  with check ((select app.is_office()) or (select app.is_admin()));

alter policy private_lessons_select on public.private_lessons using (
  student_id = (select auth.uid()) or teacher_id = (select auth.uid())
  or (select app.is_office()) or (select app.is_admin()) or (select app.is_manager())
);
alter policy private_lessons_write on public.private_lessons
  using ((select app.is_office()) or (select app.is_admin()))
  with check ((select app.is_office()) or (select app.is_admin()));

alter policy rooms_select on public.rooms using ((select app.is_staff()));
alter policy rooms_write on public.rooms
  using ((select app.is_office()) or (select app.is_admin()))
  with check ((select app.is_office()) or (select app.is_admin()));
alter policy room_bookings_select on public.room_bookings using ((select app.is_staff()));
alter policy staff_resources_select on public.staff_resources using ((select app.is_staff()));
