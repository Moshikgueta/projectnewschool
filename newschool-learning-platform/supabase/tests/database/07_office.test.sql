-- School office (merged from the staff room): rooms and the weekly timetable.
-- The office (with MFA) and admins change them; staff read them; students see
-- nothing. The database refuses double bookings by itself.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create function pg_temp.scalar_as(p_email text, p_sql text, p_aal text default 'aal1')
returns bigint language plpgsql as $$
declare v_id uuid; v_n bigint;
begin
  select id into strict v_id from auth.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated', 'aal', p_aal, 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v_n;
  perform set_config('role', 'postgres', true);
  return v_n;
end;
$$;

create function pg_temp.try_as(p_email text, p_sql text, p_aal text default 'aal1')
returns text language plpgsql as $$
declare v_id uuid; v_result text := 'ok';
begin
  select id into strict v_id from auth.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated', 'aal', p_aal, 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
  exception when others then
    v_result := sqlstate;
  end;
  perform set_config('role', 'postgres', true);
  return v_result;
end;
$$;

\set A '''student.a@example.com'''
\set TX '''teacher.x@example.com'''
\set O '''office@example.com'''

select is(pg_temp.scalar_as(:TX, 'select count(*) from public.timetable_entries'), 3::bigint,
  'a teacher reads the whole timetable');
select is(pg_temp.scalar_as(:TX, $$select count(*) from public.timetable_entries where teacher_name = 'Teacher Y'$$), 1::bigint,
  'with other teachers'' names, through the timetable view only');
select is(pg_temp.scalar_as(:TX, $$select count(*) from public.profiles where display_name = 'Teacher Y'$$), 0::bigint,
  'the view does not open other teachers'' profiles');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.timetable_entries'), 0::bigint,
  'a student sees no timetable');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.rooms'), 0::bigint,
  'and no rooms');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.teacher_choices'), 0::bigint,
  'teachers do not get the staff list for booking');

select is(
  pg_temp.try_as(:TX, $$insert into public.rooms (name) values ('Teacher room')$$),
  '42501', 'a teacher cannot add rooms');
select is(
  pg_temp.try_as(:O, $$insert into public.rooms (name) values ('Office room no MFA')$$),
  '42501', 'the office cannot change anything without two-step verification');
select is(
  pg_temp.try_as(:O, $$insert into public.rooms (name) values ('Room 4')$$, 'aal2'),
  'ok', 'with it, the office adds rooms');
select is(
  pg_temp.scalar_as(:O, 'select count(*) from public.teacher_choices', 'aal2'), 2::bigint,
  'and sees the teachers to book');
select is(
  pg_temp.scalar_as(:O, 'select count(*) from public.groups', 'aal2'), 3::bigint,
  'and the groups to link');

-- Room 1 is taken on Tuesday 18:00–19:30 (group X).
select is(
  pg_temp.try_as(:O, $$insert into public.room_bookings (room_id, title, weekday, start_min, end_min, created_by)
    values ('e0000000-0000-4000-8000-000000000001', 'Overlap', 2, 1110, 1200, '00000000-0000-4000-8000-0000000000e1')$$, 'aal2'),
  '23P01', 'the database refuses a double booking');
select is(
  pg_temp.try_as(:O, $$insert into public.room_bookings (room_id, title, weekday, start_min, end_min, created_by)
    values ('e0000000-0000-4000-8000-000000000001', 'Right after', 2, 1170, 1260, '00000000-0000-4000-8000-0000000000e1')$$, 'aal2'),
  'ok', 'a lesson that starts when the other ends is fine');
select is(
  pg_temp.try_as(:O, $$insert into public.room_bookings (room_id, title, weekday, start_min, end_min, created_by)
    values ('e0000000-0000-4000-8000-000000000002', 'Signed as someone else', 3, 600, 660, '00000000-0000-4000-8000-0000000000b1')$$, 'aal2'),
  '42501', 'and nobody books in someone else''s name');

select * from finish();
rollback;
