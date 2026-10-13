-- Rooms and the weekly timetable, moved from the staff room (Cloudflare D1)
-- into the platform (docs/STAFF-ROOM-MERGE.md).
--
-- One booking row per recurring weekly slot: the same class, in the same
-- room, every Tuesday. Times are minutes from midnight (600 = 10:00) and the
-- weekday is 0 = Sunday … 6 = Saturday, as in the staff room, so imported
-- rows keep their meaning.
--
-- The double-booking rule lives in the database: an exclusion constraint
-- refuses two bookings of one room on one weekday whose times overlap. The
-- staff room checked this in application code; here no code path can skip it.

create extension if not exists btree_gist with schema extensions;

create function app.is_office()
returns boolean language sql stable set search_path = '' as $$
  select app.has_role('office') and app.is_aal2();
$$;

-- Any member of staff (any assurance level for reading the timetable).
create function app.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid())
      and role in ('teacher', 'pedagogical_manager', 'office', 'admin')
  );
$$;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  capacity int not null default 0 check (capacity between 0 and 500),  -- 0 = not stated
  kit text not null default '' check (char_length(kit) <= 300),        -- projector, whiteboard…
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.room_bookings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  group_id uuid references public.groups (id) on delete set null,
  teacher_id uuid references public.profiles (id) on delete set null,
  weekday smallint not null check (weekday between 0 and 6),
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 1 and 1440),
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (start_min < end_min),
  constraint room_bookings_no_overlap exclude using gist (
    room_id extensions.gist_uuid_ops with =,
    weekday extensions.gist_int2_ops with =,
    int4range(start_min, end_min) with &&
  )
);
create index room_bookings_teacher_idx on public.room_bookings (teacher_id);
create index room_bookings_group_idx on public.room_bookings (group_id);

alter table public.rooms enable row level security;
alter table public.rooms force row level security;
alter table public.room_bookings enable row level security;
alter table public.room_bookings force row level security;

grant select, insert, update, delete on public.rooms, public.room_bookings to authenticated;
grant all on public.rooms, public.room_bookings to service_role;

-- Staff read the timetable; the office and admins (with MFA) change it.
create policy rooms_select on public.rooms for select to authenticated
  using (app.is_staff());
create policy rooms_write on public.rooms for all to authenticated
  using (app.is_office() or (select app.is_admin()))
  with check (app.is_office() or (select app.is_admin()));

create policy room_bookings_select on public.room_bookings for select to authenticated
  using (app.is_staff());
create policy room_bookings_insert on public.room_bookings for insert to authenticated
  with check ((app.is_office() or (select app.is_admin())) and created_by = (select auth.uid()));
create policy room_bookings_update on public.room_bookings for update to authenticated
  using (app.is_office() or (select app.is_admin()))
  with check (app.is_office() or (select app.is_admin()));
create policy room_bookings_delete on public.room_bookings for delete to authenticated
  using (app.is_office() or (select app.is_admin()));

-- The office links a booking to a group, so it may see groups (names and
-- courses; no student data comes with them).
create policy groups_select_office on public.groups for select to authenticated
  using (app.is_office());

-- The timetable with names, for any member of staff. Teachers cannot read
-- other teachers' profiles, and should not need to: this view carries only
-- the display names the grid shows, and returns no rows to anyone who is not
-- staff. (A view, not a function: nothing in public is callable as RPC.)
create view public.timetable_entries with (security_barrier) as
  select b.id, b.room_id, r.name as room_name, r.sort_order as room_order, b.title,
         b.weekday, b.start_min, b.end_min, b.note,
         b.teacher_id, p.display_name as teacher_name, b.group_id, g.name as group_name
    from public.room_bookings b
    join public.rooms r on r.id = b.room_id
    left join public.profiles p on p.id = b.teacher_id
    left join public.groups g on g.id = b.group_id
   where app.is_staff();

-- Teachers to choose from when booking (office, admin, pedagogical manager).
create view public.teacher_choices with (security_barrier) as
  select p.id, p.display_name
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id and ur.role = 'teacher'
   where app.is_office() or app.is_admin() or app.is_manager();

revoke all on public.timetable_entries, public.teacher_choices from public, anon;
grant select on public.timetable_entries, public.teacher_choices to authenticated;

revoke all on function app.is_office(), app.is_staff() from public;
grant execute on function app.is_office(), app.is_staff() to authenticated, service_role;
