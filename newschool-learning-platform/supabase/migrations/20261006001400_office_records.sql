-- The office's student records, lesson packages and private lessons (staff
-- room merge, stage D: the Tazman replacement; docs/STAFF-ROOM-MERGE.md).
--
-- Who sees what:
--   office (MFA), admin (MFA)   everything here, and they write it
--   pedagogical manager (MFA)   reads it
--   teacher                     their own private lessons (no contact
--                               details, packages or payments)
--   student                     their own record, packages and lessons
--
-- How many lessons a package has left is never stored: package_balances
-- counts it from the lessons, so the two cannot drift apart.

create type public.private_lesson_status as enum
  ('scheduled', 'done', 'cancelled_early', 'cancelled_late', 'no_show');

-- ── contact details ────────────────────────────────────────────────────────
-- Only what the office needs to reach a student. Nothing about guardians
-- until the minors question (ROADMAP D7) is answered.
create table public.student_records (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  phone text not null default '' check (phone ~ '^[0-9+() -]{0,30}$'),
  contact_email text not null default ''
    check (contact_email = '' or (char_length(contact_email) <= 254 and contact_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  office_note text not null default '' check (char_length(office_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger student_records_touch before update on public.student_records
  for each row execute function app.touch_updated_at();

-- ── packages ───────────────────────────────────────────────────────────────
create table public.lesson_packages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  lessons int not null check (lessons between 1 and 200),
  minutes_per_lesson int not null default 60 check (minutes_per_lesson between 15 and 240),
  starts_on date not null default current_date,
  expires_on date check (expires_on is null or expires_on >= starts_on),
  price numeric(10, 2) check (price is null or price >= 0),
  paid_at timestamptz,
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, student_id)
);
create index lesson_packages_student_idx on public.lesson_packages (student_id);

-- ── private lessons ────────────────────────────────────────────────────────
create table public.private_lessons (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  package_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.private_lesson_status not null default 'scheduled',
  cancelled_at timestamptz,
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A lesson can only draw on the same student's package.
  foreign key (package_id, student_id) references public.lesson_packages (id, student_id)
    on delete restrict,
  check (ends_at > starts_at and ends_at - starts_at <= interval '6 hours'),
  check ((status in ('cancelled_early', 'cancelled_late')) = (cancelled_at is not null)),
  -- Neither the teacher nor the student can be in two lessons at once.
  exclude using gist (
    teacher_id extensions.gist_uuid_ops with =, tstzrange(starts_at, ends_at) with &&
  ) where (status not in ('cancelled_early', 'cancelled_late')),
  exclude using gist (
    student_id extensions.gist_uuid_ops with =, tstzrange(starts_at, ends_at) with &&
  ) where (status not in ('cancelled_early', 'cancelled_late'))
);
create index private_lessons_teacher_idx on public.private_lessons (teacher_id, starts_at);
create index private_lessons_student_idx on public.private_lessons (student_id, starts_at);
create index private_lessons_package_idx on public.private_lessons (package_id);
create trigger private_lessons_touch before update on public.private_lessons
  for each row execute function app.touch_updated_at();

/** Whether a user holds a role (not the caller: for checking the people in a row). */
create function app.user_has_role(p_user uuid, p_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = p_user and role = p_role);
$$;

-- The people in a lesson are a teacher and a student; checked in the
-- database, so no form can book a lesson "with" someone else.
create function app.private_lessons_people()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not app.user_has_role(new.teacher_id, 'teacher') then
    raise exception 'the teacher of a private lesson must have the teacher role' using errcode = '23514';
  end if;
  if not app.user_has_role(new.student_id, 'student') then
    raise exception 'the student of a private lesson must have the student role' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger private_lessons_people before insert or update of teacher_id, student_id
  on public.private_lessons for each row execute function app.private_lessons_people();

/** Whether the caller teaches this student privately (any lesson, any status). */
create function app.teaches_privately(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.private_lessons
    where teacher_id = (select auth.uid()) and student_id = p_student
  );
$$;

/** Whether the caller has private lessons with this teacher. */
create function app.is_my_private_teacher(p_teacher uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.private_lessons
    where student_id = (select auth.uid()) and teacher_id = p_teacher
  );
$$;

/** Whether a profile belongs to a student or a teacher (the people the office deals with). */
create function app.is_student_or_teacher(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles where user_id = p_user and role in ('student', 'teacher')
  );
$$;

revoke all on function app.user_has_role(uuid, public.app_role), app.private_lessons_people(),
  app.teaches_privately(uuid), app.is_my_private_teacher(uuid), app.is_student_or_teacher(uuid)
  from public;
grant execute on function app.user_has_role(uuid, public.app_role), app.teaches_privately(uuid),
  app.is_my_private_teacher(uuid), app.is_student_or_teacher(uuid)
  to authenticated, service_role;

-- ── balances ───────────────────────────────────────────────────────────────
-- Used: lessons that took place or count as if they had (late cancellation,
-- no-show). Booked: lessons still to come. security_invoker: the caller's
-- own RLS applies to both tables underneath.
create view public.package_balances with (security_invoker = true) as
  select
    p.id as package_id,
    p.student_id,
    p.lessons,
    p.expires_on,
    p.paid_at,
    p.price,
    (count(l.id) filter (where l.status in ('done', 'cancelled_late', 'no_show')))::int as used,
    (count(l.id) filter (where l.status = 'scheduled'))::int as booked
  from public.lesson_packages p
  left join public.private_lessons l on l.package_id = p.id
  group by p.id;

-- The office's list of students: everyone with the student role. A view,
-- because the office may not read user_roles itself.
create view public.office_students with (security_barrier = true) as
  select p.id, p.display_name, p.created_at
  from public.profiles p
  where exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'student')
    and (app.is_office() or (select app.is_admin()));

-- ── access ─────────────────────────────────────────────────────────────────
alter table public.student_records enable row level security;
alter table public.student_records force row level security;
alter table public.lesson_packages enable row level security;
alter table public.lesson_packages force row level security;
alter table public.private_lessons enable row level security;
alter table public.private_lessons force row level security;

grant select, insert, update, delete on public.student_records, public.lesson_packages,
  public.private_lessons to authenticated;
grant all on public.student_records, public.lesson_packages, public.private_lessons to service_role;
revoke all on public.package_balances, public.office_students from public, anon;
grant select on public.package_balances, public.office_students to authenticated, service_role;

create policy student_records_select on public.student_records for select to authenticated using (
  student_id = (select auth.uid()) or app.is_office() or (select app.is_admin()) or (select app.is_manager())
);
create policy student_records_write on public.student_records for all to authenticated
  using (app.is_office() or (select app.is_admin()))
  with check (app.is_office() or (select app.is_admin()));

create policy lesson_packages_select on public.lesson_packages for select to authenticated using (
  student_id = (select auth.uid()) or app.is_office() or (select app.is_admin()) or (select app.is_manager())
);
create policy lesson_packages_write on public.lesson_packages for all to authenticated
  using (app.is_office() or (select app.is_admin()))
  with check (app.is_office() or (select app.is_admin()));

create policy private_lessons_select on public.private_lessons for select to authenticated using (
  student_id = (select auth.uid())
  or teacher_id = (select auth.uid())
  or app.is_office() or (select app.is_admin()) or (select app.is_manager())
);
create policy private_lessons_write on public.private_lessons for all to authenticated
  using (app.is_office() or (select app.is_admin()))
  with check (app.is_office() or (select app.is_admin()));

-- Names: the office sees students and teachers; a private teacher and their
-- student see each other.
create policy profiles_select_office on public.profiles for select to authenticated
  using (app.is_office() and app.is_student_or_teacher(id));
create policy profiles_select_private on public.profiles for select to authenticated
  using (app.teaches_privately(id) or app.is_my_private_teacher(id));

-- Money and lessons are audited (who changed a package or a lesson, when).
create trigger audit_lesson_packages after insert or update or delete on public.lesson_packages
  for each row execute function app.audit_row();
create trigger audit_private_lessons after insert or update or delete on public.private_lessons
  for each row execute function app.audit_row();
