-- Authorization: helper functions, Row Level Security policies and grants.
-- docs/DATABASE.md §4 and docs/SECURITY.md.
--
-- Principles
--   * Default deny: RLS is enabled AND forced on every table; anon gets nothing.
--   * Roles are read from tables at query time (ADR-007), so a revoked role
--     stops working immediately.
--   * Admin and pedagogical-manager powers require an MFA-verified session
--     (JWT aal = 'aal2').
--   * Helpers are SECURITY DEFINER (owner bypasses RLS) so policies can ask
--     "does the caller teach this group?" without recursive policy checks.
--   * Learner tables have no INSERT/UPDATE/DELETE grant for `authenticated`:
--     the server writes them after grading (ADR-006).

-- ── helpers ─────────────────────────────────────────────────────────────────

create function app.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = p_role
  );
$$;

create function app.is_aal2()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2';
$$;

create function app.is_manager()
returns boolean language sql stable set search_path = '' as $$
  select app.has_role('pedagogical_manager') and app.is_aal2();
$$;

create function app.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select app.has_role('admin') and app.is_aal2();
$$;

create function app.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.enrollments
    where group_id = p_group and student_id = (select auth.uid()) and status = 'active'
  );
$$;

create function app.teaches_group(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_teachers
    where group_id = p_group and teacher_id = (select auth.uid())
  );
$$;

create function app.teaches_course(p_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_teachers gt
    join public.groups g on g.id = gt.group_id
    where g.course_id = p_course and gt.teacher_id = (select auth.uid())
  );
$$;

create function app.is_enrolled_in_course(p_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.enrollments e
    join public.groups g on g.id = e.group_id
    where g.course_id = p_course and e.student_id = (select auth.uid()) and e.status = 'active'
  );
$$;

-- Students and teachers see a course only once it is published.
create function app.can_read_course(p_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_manager()
    or (
      exists (select 1 from public.courses where id = p_course and status = 'published')
      and (app.is_enrolled_in_course(p_course) or app.teaches_course(p_course))
    );
$$;

-- The caller teaches a group of p_course in which p_student is enrolled.
create function app.teaches_student_in_course(p_student uuid, p_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_teachers gt
    join public.groups g on g.id = gt.group_id
    join public.enrollments e on e.group_id = g.id
    where gt.teacher_id = (select auth.uid())
      and g.course_id = p_course
      and e.student_id = p_student
  );
$$;

create function app.teaches_student(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_teachers gt
    join public.enrollments e on e.group_id = gt.group_id
    where gt.teacher_id = (select auth.uid()) and e.student_id = p_student
  );
$$;

-- p_teacher teaches a group the caller is actively enrolled in.
create function app.is_my_teacher(p_teacher uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_teachers gt
    join public.enrollments e on e.group_id = gt.group_id
    where gt.teacher_id = p_teacher
      and e.student_id = (select auth.uid())
      and e.status = 'active'
  );
$$;

create function app.teaches_assignment(p_assignment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.assignments a
    join public.group_teachers gt on gt.group_id = a.group_id
    where a.id = p_assignment and gt.teacher_id = (select auth.uid())
  );
$$;

create function app.is_assignment_recipient(p_assignment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignment_recipients
    where assignment_id = p_assignment and student_id = (select auth.uid())
  );
$$;

-- ── enable + force RLS everywhere ──────────────────────────────────────────

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;
end;
$$;

-- ── grants ─────────────────────────────────────────────────────────────────
-- auto_expose_new_tables = false, so nothing is reachable until granted here.

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
revoke update, delete, truncate on public.audit_log from service_role;

grant select on all tables in schema public to authenticated;

-- Content and delivery: writable by the roles the policies allow.
grant insert, update, delete on
  public.languages, public.levels, public.courses, public.cycles, public.books,
  public.book_sections, public.section_teacher_notes, public.activities,
  public.activity_items, public.activity_item_keys, public.skills,
  public.activity_skills, public.media_assets, public.vocabulary_sets,
  public.vocabulary_items, public.groups, public.group_teachers,
  public.enrollments, public.group_cycles, public.group_sessions,
  public.assignments, public.assignment_recipients, public.user_roles
to authenticated;

-- Students may edit only these profile fields of their own row.
grant update (display_name, avatar_path, ui_locale, timezone) on public.profiles to authenticated;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
grant usage on schema app to supabase_auth_admin;
grant execute on function app.handle_new_auth_user() to supabase_auth_admin;

-- ── policies ───────────────────────────────────────────────────────────────

-- Identity
create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or app.teaches_student(id)
  or app.is_my_teacher(id)
  or (select app.is_manager())
  or (select app.is_admin())
);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy user_roles_select on public.user_roles for select to authenticated using (
  user_id = (select auth.uid()) or (select app.is_admin()) or (select app.is_manager())
);
create policy user_roles_admin_insert on public.user_roles for insert to authenticated
  with check ((select app.is_admin()));
create policy user_roles_admin_update on public.user_roles for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy user_roles_admin_delete on public.user_roles for delete to authenticated
  using ((select app.is_admin()));

-- Catalog: reference data readable by any signed-in user.
create policy languages_select on public.languages for select to authenticated using (true);
create policy levels_select on public.levels for select to authenticated using (true);
create policy skills_select on public.skills for select to authenticated using (true);

create policy courses_select on public.courses for select to authenticated using (
  app.can_read_course(id)
);
create policy cycles_select on public.cycles for select to authenticated using (
  (select app.is_manager()) or (status = 'published' and app.can_read_course(course_id))
);
create policy books_select on public.books for select to authenticated using (
  app.can_read_course(course_id)
);
create policy book_sections_select on public.book_sections for select to authenticated using (
  (select app.is_manager())
  or (status = 'published' and exists (select 1 from public.cycles c where c.id = cycle_id))
);
create policy activities_select on public.activities for select to authenticated using (
  (select app.is_manager())
  or (status = 'published' and exists (select 1 from public.cycles c where c.id = cycle_id))
);
create policy activity_items_select on public.activity_items for select to authenticated using (
  exists (select 1 from public.activities a where a.id = activity_id)
);
create policy activity_skills_select on public.activity_skills for select to authenticated using (
  exists (select 1 from public.activities a where a.id = activity_id)
);
create policy vocabulary_sets_select on public.vocabulary_sets for select to authenticated using (
  (select app.is_manager())
  or (status = 'published' and exists (select 1 from public.cycles c where c.id = cycle_id))
);
create policy vocabulary_items_select on public.vocabulary_items for select to authenticated using (
  exists (select 1 from public.vocabulary_sets s where s.id = set_id)
);
create policy media_assets_select on public.media_assets for select to authenticated using (
  course_id is null or app.can_read_course(course_id)
);

-- Teacher-only content: never students.
create policy section_teacher_notes_select on public.section_teacher_notes for select to authenticated using (
  (select app.is_manager())
  or (app.teaches_course(course_id) and exists (select 1 from public.book_sections s where s.id = section_id))
);
create policy activity_item_keys_select on public.activity_item_keys for select to authenticated using (
  (select app.is_manager())
  or (app.teaches_course(course_id) and exists (select 1 from public.activity_items i where i.id = item_id))
);

-- Pedagogical managers write the catalog.
do $$
declare t text;
begin
  foreach t in array array[
    'languages', 'levels', 'courses', 'cycles', 'books', 'book_sections',
    'section_teacher_notes', 'activities', 'activity_items', 'activity_item_keys',
    'skills', 'activity_skills', 'media_assets', 'vocabulary_sets', 'vocabulary_items',
    'groups', 'group_teachers', 'enrollments'
  ] loop
    execute format(
      'create policy %1$s_manager_insert on public.%1$I for insert to authenticated with check ((select app.is_manager()))', t);
    execute format(
      'create policy %1$s_manager_update on public.%1$I for update to authenticated using ((select app.is_manager())) with check ((select app.is_manager()))', t);
    execute format(
      'create policy %1$s_manager_delete on public.%1$I for delete to authenticated using ((select app.is_manager()))', t);
  end loop;
end;
$$;

-- Delivery
create policy groups_select on public.groups for select to authenticated using (
  app.is_group_member(id) or app.teaches_group(id)
  or (select app.is_manager()) or (select app.is_admin())
);
create policy group_teachers_select on public.group_teachers for select to authenticated using (
  app.teaches_group(group_id) or app.is_group_member(group_id)
  or (select app.is_manager()) or (select app.is_admin())
);
create policy enrollments_select on public.enrollments for select to authenticated using (
  student_id = (select auth.uid()) or app.teaches_group(group_id)
  or (select app.is_manager()) or (select app.is_admin())
);

-- Teachers choose the active cycles and sessions of their own groups.
create policy group_cycles_select on public.group_cycles for select to authenticated using (
  app.is_group_member(group_id) or app.teaches_group(group_id) or (select app.is_manager())
);
create policy group_cycles_write on public.group_cycles for all to authenticated
  using (app.teaches_group(group_id) or (select app.is_manager()))
  with check (app.teaches_group(group_id) or (select app.is_manager()));

create policy group_sessions_select on public.group_sessions for select to authenticated using (
  app.is_group_member(group_id) or app.teaches_group(group_id) or (select app.is_manager())
);
create policy group_sessions_write on public.group_sessions for all to authenticated
  using (app.teaches_group(group_id) or (select app.is_manager()))
  with check (app.teaches_group(group_id) or (select app.is_manager()));

create policy assignments_select on public.assignments for select to authenticated using (
  app.teaches_group(group_id)
  or (select app.is_manager())
  or (app.is_group_member(group_id) and (audience = 'group' or app.is_assignment_recipient(id)))
);
create policy assignments_insert on public.assignments for insert to authenticated with check (
  (app.teaches_group(group_id) or (select app.is_manager())) and assigned_by = (select auth.uid())
);
create policy assignments_update on public.assignments for update to authenticated
  using (app.teaches_group(group_id) or (select app.is_manager()))
  with check (app.teaches_group(group_id) or (select app.is_manager()));
create policy assignments_delete on public.assignments for delete to authenticated
  using (app.teaches_group(group_id) or (select app.is_manager()));

create policy assignment_recipients_select on public.assignment_recipients for select to authenticated using (
  student_id = (select auth.uid()) or app.teaches_assignment(assignment_id) or (select app.is_manager())
);
create policy assignment_recipients_write on public.assignment_recipients for all to authenticated
  using (app.teaches_assignment(assignment_id) or (select app.is_manager()))
  with check (app.teaches_assignment(assignment_id) or (select app.is_manager()));

-- Learner records: read-only for authenticated users.
create policy attempts_select on public.attempts for select to authenticated using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or app.teaches_student_in_course(user_id, course_id)
);
create policy responses_select on public.responses for select to authenticated using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or app.teaches_student_in_course(user_id, course_id)
);
create policy section_progress_select on public.section_progress for select to authenticated using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or app.teaches_student_in_course(user_id, course_id)
);
create policy vocab_review_state_select on public.vocab_review_state for select to authenticated using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or app.teaches_student_in_course(user_id, course_id)
);
create policy learning_events_select on public.learning_events for select to authenticated using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or (course_id is not null and app.teaches_student_in_course(user_id, course_id))
);
create policy recommendation_feedback_select on public.recommendation_feedback for select to authenticated using (
  user_id = (select auth.uid())
);

-- Operations
create policy audit_log_select on public.audit_log for select to authenticated using (
  (select app.is_admin())
);
