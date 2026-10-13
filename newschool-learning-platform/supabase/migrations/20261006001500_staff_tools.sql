-- Staff tools (staff room merge, stage E; docs/STAFF-ROOM-MERGE.md):
-- feedback from teachers to the pedagogical manager, training links, and
-- tasks for the manager. In the staff room all three lived in each browser's
-- localStorage, so nobody else ever saw them; here they are shared, and so
-- they have access rules. (The lesson-plan prompt builder stores nothing.)

-- ── feedback ───────────────────────────────────────────────────────────────
create type public.feedback_kind as enum ('student', 'material', 'missing_material');

create table public.staff_feedback (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind public.feedback_kind not null,
  student_id uuid references public.profiles (id) on delete cascade,
  subject text not null default '' check (char_length(subject) <= 200),
  verdict text,
  language_code text check (language_code is null or language_code ~ '^[a-z]{2,3}$'),
  level smallint check (level is null or level between 1 and 3),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  handled_at timestamptz,
  handled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- What each kind carries (as in the staff room's three tabs).
  check (case kind
    when 'student' then student_id is not null and subject = ''
      and verdict in ('ahead', 'on_track', 'needs_attention')
      and language_code is null and level is null
    when 'material' then student_id is null and subject <> ''
      and verdict in ('works_well', 'works_with_changes', 'problematic')
    when 'missing_material' then student_id is null and verdict is null
      and subject in ('grammar_practice', 'listening', 'speaking', 'reading', 'game_warmup', 'tests', 'homework')
  end),
  check ((handled_at is null) = (handled_by is null))
);
create index staff_feedback_author_idx on public.staff_feedback (author_id, created_at desc);
create index staff_feedback_created_idx on public.staff_feedback (created_at desc);

-- ── training links ─────────────────────────────────────────────────────────
create table public.staff_resources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  -- https only: a link staff will click, so no javascript:, data: or http.
  url text not null check (char_length(url) <= 2000 and url ~ '^https://[^\s<>"]+$'),
  description text not null default '' check (char_length(description) <= 500),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ── tasks for the pedagogical manager ──────────────────────────────────────
create type public.task_priority as enum ('normal', 'urgent');
create type public.task_status as enum ('open', 'done');

create table public.staff_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  note text not null default '' check (char_length(note) <= 1000),
  priority public.task_priority not null default 'normal',
  status public.task_status not null default 'open',
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  assignee_id uuid not null references public.profiles (id) on delete cascade,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'done') = (done_at is not null))
);
create index staff_tasks_assignee_idx on public.staff_tasks (assignee_id, status);
create index staff_tasks_creator_idx on public.staff_tasks (created_by);

-- Tasks go to a pedagogical manager (the staff room's "משימות למושיק").
create function app.staff_tasks_assignee()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not app.user_has_role(new.assignee_id, 'pedagogical_manager') then
    raise exception 'tasks go to a pedagogical manager' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.staff_tasks_assignee() from public;
create trigger staff_tasks_assignee before insert or update of assignee_id on public.staff_tasks
  for each row execute function app.staff_tasks_assignee();

-- Who a task can be sent to, for every member of staff (they may not read
-- user_roles themselves).
create view public.task_assignees with (security_barrier = true) as
  select p.id, p.display_name
  from public.profiles p
  where exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'pedagogical_manager')
    and app.is_staff();

-- ── access ─────────────────────────────────────────────────────────────────
alter table public.staff_feedback enable row level security;
alter table public.staff_feedback force row level security;
alter table public.staff_resources enable row level security;
alter table public.staff_resources force row level security;
alter table public.staff_tasks enable row level security;
alter table public.staff_tasks force row level security;

grant select, insert, delete on public.staff_feedback to authenticated;
grant update (handled_at, handled_by) on public.staff_feedback to authenticated;
grant select, insert, update, delete on public.staff_resources to authenticated;
grant select, insert, delete on public.staff_tasks to authenticated;
grant update (status, done_at) on public.staff_tasks to authenticated;
grant all on public.staff_feedback, public.staff_resources, public.staff_tasks to service_role;
revoke all on public.task_assignees from public, anon;
grant select on public.task_assignees to authenticated, service_role;

-- Feedback: written by staff in their own name, about students they teach;
-- read by its author and the pedagogical manager (MFA), who marks it
-- handled. Students never see it.
create policy staff_feedback_select on public.staff_feedback for select to authenticated
  using (author_id = (select auth.uid()) or (select app.is_manager()));
create policy staff_feedback_insert on public.staff_feedback for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and app.is_staff()
    and (student_id is null or app.teaches_student(student_id))
    and handled_at is null
  );
create policy staff_feedback_handle on public.staff_feedback for update to authenticated
  using ((select app.is_manager()))
  with check ((select app.is_manager()) and (handled_by is null or handled_by = (select auth.uid())));
create policy staff_feedback_delete on public.staff_feedback for delete to authenticated
  using (author_id = (select auth.uid()));

-- Training links: every member of staff reads them; the manager and admins
-- (MFA) keep them.
create policy staff_resources_select on public.staff_resources for select to authenticated
  using (app.is_staff());
create policy staff_resources_write on public.staff_resources for all to authenticated
  using ((select app.is_manager()) or (select app.is_admin()))
  with check ((select app.is_manager()) or (select app.is_admin()));

-- Tasks: sent by staff in their own name; seen by whoever sent them and
-- whoever they are for; only the latter marks them done; either removes them.
create policy staff_tasks_select on public.staff_tasks for select to authenticated
  using (created_by = (select auth.uid()) or assignee_id = (select auth.uid()));
create policy staff_tasks_insert on public.staff_tasks for insert to authenticated
  with check (created_by = (select auth.uid()) and app.is_staff() and status = 'open');
create policy staff_tasks_update on public.staff_tasks for update to authenticated
  using (assignee_id = (select auth.uid()))
  with check (assignee_id = (select auth.uid()));
create policy staff_tasks_delete on public.staff_tasks for delete to authenticated
  using (created_by = (select auth.uid()) or assignee_id = (select auth.uid()));
