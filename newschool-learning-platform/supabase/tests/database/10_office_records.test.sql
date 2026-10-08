-- The office's records (staff room merge, stage D): contact details,
-- packages and private lessons. The office and admins (with MFA) run them;
-- the manager reads them; a teacher sees only their own private lessons and
-- never contact details or money; a student sees only their own.
-- Fixtures (seed.sql): records for A and B; package d…01 (A, paid),
-- d…02 (B, unpaid); lessons A–teacher X (d1…01–03), B–teacher Y (d1…04–07).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

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
\set B '''student.b@example.com'''
\set C '''student.c@example.com'''
\set TX '''teacher.x@example.com'''
\set TY '''teacher.y@example.com'''
\set PM '''manager@example.com'''
\set OF '''office@example.com'''
\set AD '''admin@example.com'''

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('public.student_records'::regclass, 'public.lesson_packages'::regclass,
                  'public.private_lessons'::regclass)),
  'RLS is on and forced on all three tables');

-- Contact details.
select is(pg_temp.scalar_as(:OF, 'select count(*) from public.student_records', 'aal2'), 2::bigint,
  'the office (MFA) reads contact details');
select is(pg_temp.scalar_as(:OF, 'select count(*) from public.student_records'), 0::bigint,
  'not without MFA');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.student_records'), 1::bigint,
  'a student reads only their own record');
select is(pg_temp.scalar_as(:A, $$select count(*) from public.student_records
    where student_id = '00000000-0000-4000-8000-0000000000a2'$$), 0::bigint,
  'and not a classmate''s, even by id');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.student_records'), 0::bigint,
  'a teacher reads no contact details, even of their own students');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.student_records', 'aal2'), 2::bigint,
  'the manager (MFA) reads them');
select is(
  pg_temp.try_as(:A, $$update public.student_records set office_note = 'VIP'
    where student_id = auth.uid()$$), 'ok', '');
select is(
  (select office_note from public.student_records where student_id = '00000000-0000-4000-8000-0000000000a1'),
  'Prefers evenings', 'a student cannot change their own record (the update touches nothing)');
select is(
  pg_temp.try_as(:PM, $$update public.student_records set phone = '1'$$, 'aal2'), 'ok', '');
select is(
  (select phone from public.student_records where student_id = '00000000-0000-4000-8000-0000000000a1'),
  '050-1234567', 'neither can the manager: reading only');

-- Packages and balances.
select is(pg_temp.scalar_as(:B, 'select count(*) from public.package_balances'), 1::bigint,
  'a student sees their own package balance only');
select is(
  pg_temp.scalar_as(:A, $$select used * 100 + booked from public.package_balances$$), 201::bigint,
  'student A: 2 used (done + late cancellation), 1 booked');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.lesson_packages'), 0::bigint,
  'a teacher sees no packages or prices');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.package_balances'), 0::bigint,
  'not even through the balances view');
select is(
  pg_temp.try_as(:A, $$insert into public.lesson_packages (student_id, lessons)
    values (auth.uid(), 100)$$), '42501', 'a student cannot give themselves lessons');
select is(
  pg_temp.try_as(:OF, $$insert into public.lesson_packages (student_id, lessons)
    values ('00000000-0000-4000-8000-0000000000a3', 8)$$, 'aal2'),
  'ok', 'the office (MFA) adds a package');

-- Private lessons.
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.private_lessons'), 3::bigint,
  'teacher X sees their own three private lessons');
select is(pg_temp.scalar_as(:TY, $$select count(*) from public.private_lessons
    where teacher_id = '00000000-0000-4000-8000-0000000000b1'$$), 0::bigint,
  'teacher Y sees none of teacher X''s');
select is(
  pg_temp.try_as(:TX, $$update public.private_lessons set status = 'done'
    where id = 'd1000000-0000-4000-8000-000000000003'$$), 'ok', '');
select is(
  (select status::text from public.private_lessons where id = 'd1000000-0000-4000-8000-000000000003'),
  'scheduled', 'a teacher cannot change lessons (the office does)');
select is(pg_temp.scalar_as(:C, 'select count(*) from public.private_lessons'), 0::bigint,
  'a student without private lessons sees none');

-- What the database refuses.
select is(
  pg_temp.try_as(:OF, $$insert into public.private_lessons (student_id, teacher_id, starts_at, ends_at)
    select '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000b1',
           starts_at + interval '30 minutes', ends_at + interval '30 minutes'
    from public.private_lessons where id = 'd1000000-0000-4000-8000-000000000003'$$, 'aal2'),
  '23P01', 'a teacher cannot be booked into two lessons at once');
select is(
  pg_temp.try_as(:OF, $$insert into public.private_lessons (student_id, teacher_id, starts_at, ends_at)
    values ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000e1',
            now() + interval '10 days', now() + interval '10 days 1 hour')$$, 'aal2'),
  '23514', 'the teacher of a lesson must be a teacher');
select is(
  pg_temp.try_as(:OF, $$insert into public.private_lessons (student_id, teacher_id, package_id, starts_at, ends_at)
    values ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000b1',
            'd0000000-0000-4000-8000-000000000001', now() + interval '10 days', now() + interval '10 days 1 hour')$$, 'aal2'),
  '23503', 'a lesson cannot draw on another student''s package');
select is(
  pg_temp.scalar_as(:A, 'select count(*) from public.office_students'), 0::bigint,
  'the office''s student list is empty for anyone else');

select * from finish();
rollback;
