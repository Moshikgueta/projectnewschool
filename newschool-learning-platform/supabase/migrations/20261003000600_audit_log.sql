-- Audit log: insert-only record of administrative changes. Written by
-- triggers; nobody (including the app and the service role) may change it.

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,           -- auth.uid() at the time; null = system / service role
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_id);

create function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(v_row ->> 'id', concat_ws(':', v_row ->> 'user_id', v_row ->> 'role', v_row ->> 'group_id', v_row ->> 'teacher_id')),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create function app.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function app.audit_log_is_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_log_is_append_only();

-- What gets audited: accounts and roles, who is in which group, who teaches
-- it, and publishing.
create trigger audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function app.audit_row();
create trigger audit_enrollments after insert or update or delete on public.enrollments
  for each row execute function app.audit_row();
create trigger audit_groups after insert or update or delete on public.groups
  for each row execute function app.audit_row();
create trigger audit_group_teachers after insert or update or delete on public.group_teachers
  for each row execute function app.audit_row();
create trigger audit_courses after insert or update or delete on public.courses
  for each row execute function app.audit_row();
create trigger audit_cycles after insert or update or delete on public.cycles
  for each row execute function app.audit_row();
create trigger audit_activities after insert or delete or update of status on public.activities
  for each row execute function app.audit_row();
create trigger audit_book_sections after insert or delete or update of status on public.book_sections
  for each row execute function app.audit_row();

-- The last admin cannot lose the admin role (lifted from the staff tool's rules).
create function app.keep_one_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (
       select 1 from public.user_roles
       where role = 'admin' and user_id <> old.user_id
     ) then
    raise exception 'cannot remove the last admin' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger user_roles_keep_one_admin before update or delete on public.user_roles
  for each row execute function app.keep_one_admin();
