-- Attendance per class (staff room merge, stage C; docs/STAFF-ROOM-MERGE.md).
-- One row per student per class. The teachers of the group mark it, from the
-- moment the class is about to start; the student sees their own; the
-- pedagogical manager (with MFA) reads it. Nobody deletes it: a class that
-- has attendance cannot be removed either (on delete restrict).

create type public.attendance_status as enum ('present', 'late', 'absent', 'excused');

create table public.attendance (
  session_id uuid not null references public.group_sessions (id) on delete restrict,
  student_id uuid not null references public.profiles (id) on delete cascade,
  status public.attendance_status not null,
  note text not null default '' check (char_length(note) <= 300),
  marked_by uuid references public.profiles (id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (session_id, student_id)
);
create index attendance_student_idx on public.attendance (student_id);

alter table public.attendance enable row level security;
alter table public.attendance force row level security;

/** The group a class belongs to (for policies; classes are visible only to members and teachers). */
create function app.session_group(p_session uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select group_id from public.group_sessions where id = p_session;
$$;

/**
 * Whether the caller may mark this student for this class: they teach the
 * group, the class starts within 30 minutes or has started, and the student
 * is enrolled in the group (active or paused).
 */
create function app.can_mark_attendance(p_session uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_sessions s
    join public.group_teachers gt on gt.group_id = s.group_id and gt.teacher_id = (select auth.uid())
    join public.enrollments e on e.group_id = s.group_id and e.student_id = p_student
    where s.id = p_session
      and s.starts_at <= now() + interval '30 minutes'
      and e.status in ('active', 'paused')
  );
$$;

revoke all on function app.session_group(uuid), app.can_mark_attendance(uuid, uuid) from public;
grant execute on function app.session_group(uuid), app.can_mark_attendance(uuid, uuid)
  to authenticated, service_role;

grant select, insert, update on public.attendance to authenticated;
grant all on public.attendance to service_role;

create policy attendance_select on public.attendance for select to authenticated using (
  student_id = (select auth.uid())
  or app.teaches_group(app.session_group(session_id))
  or (select app.is_manager())
);
create policy attendance_insert on public.attendance for insert to authenticated
  with check (app.can_mark_attendance(session_id, student_id) and marked_by = (select auth.uid()));
create policy attendance_update on public.attendance for update to authenticated
  using (app.teaches_group(app.session_group(session_id)))
  with check (app.can_mark_attendance(session_id, student_id) and marked_by = (select auth.uid()));

-- A mark always says when it was last changed, whatever the client sends.
create function app.attendance_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.marked_at := now();
  return new;
end;
$$;
revoke all on function app.attendance_touch() from public;
create trigger attendance_touch before insert or update on public.attendance
  for each row execute function app.attendance_touch();
