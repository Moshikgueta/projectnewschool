-- Teachers and the office write exercises (Phase 8, ADR-038).
--
-- Decided by the school owner (2026-10-12): teachers and the office both
-- create exercises and assign them to groups; students get them as soon as
-- they are assigned; the pedagogical manager sees and edits everything.
--
-- 1. activities.created_by: null = the school's curriculum (manager-only, as
--    before); otherwise the member of staff who wrote it. Set once, in the
--    author's own name, and never changed.
-- 2. Who edits a staff exercise (app.can_edit_activity):
--      * its author, while they may still author in its course (a teacher of
--        the course, or the office);
--      * any office user, for exercises written by an office user (the
--        office is one desk: reception staff cover for each other);
--      * the pedagogical manager (MFA), everything (their existing policies).
--    Teachers never edit each other's exercises, and nobody but the manager
--    edits the curriculum. Nothing is deleted: exercises are archived.
-- 3. Who sees a staff exercise (app.can_view_staff_activity): its author;
--    the office (office-written ones in any status, others once published);
--    teachers of the course once published (so they can assign it too); the
--    manager. A STUDENT sees it only through an assignment they can see (to
--    their group, or to them by name) — never the whole course. Its items
--    follow it (activity_items_select checks the parent row), and its answer
--    keys stay out of students' reach as before.
-- 4. The office assigns to any group, in its own name, and updates or
--    removes only assignments it made.
-- 5. Which items of an exercise have answers is read through
--    app.answered_item_ids (only for people who may edit the exercise), so a
--    teacher's editor sees answers from every group, not only the students
--    RLS shows them. The triggers of 20261007001700 still refuse changes to
--    answered items whoever writes.

alter table public.activities
  add column created_by uuid references public.profiles (id) on delete restrict;
comment on column public.activities.created_by is
  'Author of a staff exercise (teacher or office); null for the school curriculum.';
create index activities_created_by_idx on public.activities (created_by) where created_by is not null;

-- ── helpers ────────────────────────────────────────────────────────────────

/** The caller may write exercises in this course: a teacher of it, or the office (MFA). */
create function app.can_author_activity(p_course uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.teaches_course(p_course) or app.is_office();
$$;

/** The caller may edit this exercise's content, details and status. */
create function app.can_edit_activity(p_activity uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_manager() or exists (
    select 1 from public.activities a
    where a.id = p_activity
      and a.created_by is not null
      and app.can_author_activity(a.course_id)
      and (
        a.created_by = (select auth.uid())
        or (app.is_office() and app.user_has_role(a.created_by, 'office'))
      )
  );
$$;

/** The caller may edit the exercise this item belongs to. */
create function app.can_edit_item(p_item uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.activity_items i
    where i.id = p_item and app.can_edit_activity(i.activity_id)
  );
$$;

/**
 * The caller may see this staff exercise (see 3. above). Used by
 * activities_select with the row's own values, so it also decides correctly
 * for a row being inserted or updated (a lookup of the row by id would see
 * the version before the statement). SECURITY DEFINER so it reads
 * assignments without going through their policies (no recursion).
 */
create function app.can_view_staff_activity(
  p_course uuid, p_author uuid, p_status public.content_status, p_activity uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_author is not null and (
    p_author = (select auth.uid())
    or (app.is_office() and (p_status = 'published' or app.user_has_role(p_author, 'office')))
    or (p_status = 'published' and app.teaches_course(p_course))
    or (
      p_status = 'published'
      and exists (select 1 from public.courses c where c.id = p_course and c.status = 'published')
      and exists (
        select 1 from public.assignments s
        where s.activity_id = p_activity
          and s.course_id = p_course
          and app.is_group_member(s.group_id)
          and (s.audience = 'group' or app.is_assignment_recipient(s.id))
      )
    )
  );
$$;

/** Items of an exercise that students have answered, with how many answers; empty unless the caller may edit it. */
create function app.answered_item_ids(p_activity uuid)
returns table (item_id uuid, answers int)
language sql stable security definer set search_path = '' as $$
  select r.item_id, count(*)::int
  from public.responses r
  join public.activity_items i on i.id = r.item_id
  where i.activity_id = p_activity and app.can_edit_activity(p_activity)
  group by r.item_id;
$$;

revoke all on function app.can_author_activity(uuid), app.can_edit_activity(uuid),
  app.can_edit_item(uuid), app.can_view_staff_activity(uuid, uuid, public.content_status, uuid),
  app.answered_item_ids(uuid)
  from public, anon;
grant execute on function app.can_author_activity(uuid), app.can_edit_activity(uuid),
  app.can_edit_item(uuid), app.can_view_staff_activity(uuid, uuid, public.content_status, uuid),
  app.answered_item_ids(uuid)
  to authenticated, service_role;

-- ── the author is set once, in the author's own name ──────────────────────

create function app.activities_created_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- A signed-in user writes only in their own name (the import, with the
    -- secret key, has no auth.uid() and writes the curriculum).
    if new.created_by is not null and (select auth.uid()) is not null
       and new.created_by <> (select auth.uid()) then
      raise exception 'an exercise is written in its author''s own name' using errcode = '42501';
    end if;
  elsif new.created_by is distinct from old.created_by then
    raise exception 'the author of an exercise cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.activities_created_by() from public, anon;
create trigger activities_created_by before insert or update on public.activities
  for each row execute function app.activities_created_by();

-- ── activities ─────────────────────────────────────────────────────────────

drop policy activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated using (
  (select app.is_manager())
  or (created_by is null and status = 'published'
      and exists (select 1 from public.cycles c where c.id = cycle_id))
  or (created_by is not null
      and app.can_view_staff_activity(course_id, created_by, status, id))
);

create policy activities_staff_insert on public.activities for insert to authenticated
  with check (created_by = (select auth.uid()) and app.can_author_activity(course_id));
create policy activities_staff_update on public.activities for update to authenticated
  using (created_by is not null and app.can_edit_activity(id))
  with check (created_by is not null and app.can_author_activity(course_id));
-- No delete for staff: an exercise is archived (status), as the manager does.

-- ── items, answer keys, authored source: through the parent exercise ──────

create policy activity_items_staff_insert on public.activity_items for insert to authenticated
  with check (app.can_edit_activity(activity_id));
create policy activity_items_staff_update on public.activity_items for update to authenticated
  using (app.can_edit_activity(activity_id)) with check (app.can_edit_activity(activity_id));
create policy activity_items_staff_delete on public.activity_items for delete to authenticated
  using (app.can_edit_activity(activity_id));

create policy activity_item_keys_staff_select on public.activity_item_keys for select to authenticated
  using (app.can_edit_item(item_id));
create policy activity_item_keys_staff_insert on public.activity_item_keys for insert to authenticated
  with check (app.can_edit_item(item_id));
create policy activity_item_keys_staff_update on public.activity_item_keys for update to authenticated
  using (app.can_edit_item(item_id)) with check (app.can_edit_item(item_id));
create policy activity_item_keys_staff_delete on public.activity_item_keys for delete to authenticated
  using (app.can_edit_item(item_id));

create policy activity_sources_staff_select on public.activity_sources for select to authenticated
  using (app.can_edit_activity(activity_id));
create policy activity_sources_staff_insert on public.activity_sources for insert to authenticated
  with check (app.can_edit_activity(activity_id));
create policy activity_sources_staff_update on public.activity_sources for update to authenticated
  using (app.can_edit_activity(activity_id)) with check (app.can_edit_activity(activity_id));

-- ── the office reads the catalogue it writes into, and assigns ────────────

create policy courses_select_office on public.courses for select to authenticated
  using (status = 'published' and app.is_office());
create policy cycles_select_office on public.cycles for select to authenticated
  using (status = 'published' and app.is_office());

create policy assignments_select_office on public.assignments for select to authenticated
  using (app.is_office());
create policy assignments_insert_office on public.assignments for insert to authenticated
  with check (app.is_office() and assigned_by = (select auth.uid()));
create policy assignments_update_office on public.assignments for update to authenticated
  using (app.is_office() and assigned_by = (select auth.uid()))
  with check (app.is_office() and assigned_by = (select auth.uid()));
create policy assignments_delete_office on public.assignments for delete to authenticated
  using (app.is_office() and assigned_by = (select auth.uid()));

-- ── read-only views for the editor (nothing in public is callable as RPC) ──

-- Exercises the caller may edit. Filter by activity_id; the condition is
-- evaluated by the helper, so the view shows nothing else.
create view public.editable_activities with (security_barrier) as
  select a.id as activity_id
    from public.activities a
   where app.can_edit_activity(a.id);

-- Answered items of the exercises the caller may edit (see 5. above).
create view public.activity_answered_items with (security_barrier) as
  select a.id as activity_id, x.item_id, x.answers
    from public.activities a
   cross join lateral app.answered_item_ids(a.id) x;

revoke all on public.editable_activities, public.activity_answered_items from public, anon;
grant select on public.editable_activities, public.activity_answered_items to authenticated, service_role;
