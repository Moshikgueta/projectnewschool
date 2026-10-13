-- Homework for selected students (Phase 7, ADR-039).
--
-- An assignment with audience = 'selected' reaches only the students listed
-- in assignment_recipients (assignments_select and
-- app.can_view_staff_activity already check app.is_assignment_recipient).
-- This migration makes the list trustworthy whoever writes it:
--
-- 1. A recipient must be a student of the assignment's group (active or
--    paused enrolment), and recipients exist only for 'selected'
--    assignments. Checked by a trigger, so neither a teacher nor the office
--    can address homework to a student outside the group, whatever the app
--    sends.
-- 2. An assignment that has recipients cannot move to another group (its
--    recipients would no longer be students of it).
-- 3. The office (MFA) manages the recipients of assignments it gave itself
--    (assigned_by = the caller), as it already updates and removes only
--    those. Teachers keep managing recipients of any assignment of a group
--    they teach (assignment_recipients_write, unchanged).
-- 4. The office reads enrolments, to offer the students of a group when it
--    assigns. It already reads every student's profile and contact details;
--    enrolments add which group each student is in, nothing about learning.

-- ── 1. recipients are students of the assignment's group ──────────────────

create function app.check_assignment_recipient()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_group uuid;
  v_audience public.assignment_audience;
begin
  select a.group_id, a.audience into v_group, v_audience
    from public.assignments a where a.id = new.assignment_id;
  if not found then
    return null; -- the foreign key reports the missing assignment
  end if;
  if v_audience <> 'selected' then
    raise exception 'recipients are only for homework given to selected students'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.enrollments e
    where e.group_id = v_group
      and e.student_id = new.student_id
      and e.status in ('active', 'paused')
  ) then
    raise exception 'a recipient must be a student of the assignment''s group'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

-- AFTER, so the row policies have refused anyone who may not choose
-- recipients for this assignment before this check says anything about who
-- is enrolled.
create trigger assignment_recipients_enrolled
  after insert or update on public.assignment_recipients
  for each row execute function app.check_assignment_recipient();

-- ── 2. an assignment with recipients stays in its group ───────────────────

create function app.assignments_keep_recipients_group()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.group_id is distinct from old.group_id
     and exists (select 1 from public.assignment_recipients r where r.assignment_id = old.id) then
    raise exception 'homework given to selected students cannot move to another group'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger assignments_keep_recipients_group
  before update of group_id on public.assignments
  for each row execute function app.assignments_keep_recipients_group();

-- ── 3. the office and the recipients of its own assignments ───────────────

/** The caller is the office (MFA) and gave this assignment themselves. */
create function app.office_owns_assignment(p_assignment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_office() and exists (
    select 1 from public.assignments a
    where a.id = p_assignment and a.assigned_by = (select auth.uid())
  );
$$;

create policy assignment_recipients_select_office on public.assignment_recipients
  for select to authenticated using (app.office_owns_assignment(assignment_id));
create policy assignment_recipients_insert_office on public.assignment_recipients
  for insert to authenticated with check (app.office_owns_assignment(assignment_id));
create policy assignment_recipients_delete_office on public.assignment_recipients
  for delete to authenticated using (app.office_owns_assignment(assignment_id));
-- No update: a recipient row is a key; it is removed and added again.

-- ── 4. the office reads enrolments ────────────────────────────────────────

create policy enrollments_select_office on public.enrollments
  for select to authenticated using (app.is_office());

revoke all on function app.check_assignment_recipient(), app.assignments_keep_recipients_group(),
  app.office_owns_assignment(uuid)
  from public, anon;
grant execute on function app.office_owns_assignment(uuid) to authenticated, service_role;
