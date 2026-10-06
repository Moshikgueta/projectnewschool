-- Attendance per class (staff room merge, stage C). The group's teachers mark
-- it once the class is about to start, for students of that group only, in
-- their own name; students see their own; the manager (with MFA) reads it;
-- nobody deletes it, and a class with attendance cannot be removed.
-- Fixtures (seed.sql): group X classes f…02 (two days ago: A present, B late,
-- D absent), f…03 (nine days ago, not taken), f…01 (in two days).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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
\set TX '''teacher.x@example.com'''
\set TY '''teacher.y@example.com'''
\set PM '''manager@example.com'''
\set PAST '''f0000000-0000-4000-8000-000000000002'''
\set OLD '''f0000000-0000-4000-8000-000000000003'''
\set NEXT '''f0000000-0000-4000-8000-000000000001'''
\set SA '''00000000-0000-4000-8000-0000000000a1'''
\set SC '''00000000-0000-4000-8000-0000000000a3'''
\set SD '''00000000-0000-4000-8000-0000000000a4'''
\set TXID '''00000000-0000-4000-8000-0000000000b1'''

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.attendance'::regclass),
  'RLS is on and forced');

-- Teachers mark their own group's classes.
select is(
  pg_temp.try_as(:TX, format($$update public.attendance set status = 'excused', marked_by = %L
    where session_id = %L and student_id = %L$$, :TXID, :PAST, :SD)),
  'ok', 'teacher X can change a mark in group X');
select is(
  pg_temp.try_as(:TX, format($$insert into public.attendance (session_id, student_id, status, marked_by, marked_at)
    values (%L, %L, 'present', %L, '2000-01-01')$$, :OLD, :SD, :TXID)),
  'ok', 'teacher X can take attendance for an earlier class');
select is(
  pg_temp.try_as(:TX, format($$insert into public.attendance (session_id, student_id, status, marked_by)
    values (%L, %L, 'present', %L)$$, :NEXT, :SA, :TXID)),
  '42501', 'but not for a class days away');
select is(
  pg_temp.try_as(:TX, format($$insert into public.attendance (session_id, student_id, status, marked_by)
    values (%L, %L, 'present', %L)$$, :OLD, :SC, :TXID)),
  '42501', 'nor for a student who is not in the group');
select is(
  pg_temp.try_as(:TX, format($$insert into public.attendance (session_id, student_id, status, marked_by)
    values (%L, %L, 'present', '00000000-0000-4000-8000-0000000000b2')$$, :OLD, :SA)),
  '42501', 'nor in another teacher''s name');
select is(
  pg_temp.try_as(:TY, format($$insert into public.attendance (session_id, student_id, status, marked_by)
    select %L, %L, 'present', id from auth.users where email = 'teacher.y@example.com'$$, :OLD, :SA)),
  '42501', 'teacher Y cannot mark group X''s class');
select is(
  pg_temp.scalar_as(:TY, format($$with u as (update public.attendance set status = 'present'
    where session_id = %L returning 1) select count(*) from u$$, :PAST)),
  0::bigint, 'or change its marks');
select is(
  pg_temp.try_as(:A, format($$insert into public.attendance (session_id, student_id, status, marked_by)
    values (%L, %L, 'present', %L)$$, :OLD, :SA, :SA)),
  '42501', 'a student cannot mark themselves present');

-- Who reads what.
select is(pg_temp.scalar_as(:A, 'select count(*) from public.attendance'), 1::bigint,
  'student A sees only their own mark');
select is(
  pg_temp.scalar_as(:B, $$select count(*) from public.attendance where status = 'late'$$),
  1::bigint, 'student B sees their own');
select is(pg_temp.scalar_as(:TY, 'select count(*) from public.attendance'), 0::bigint,
  'teacher Y sees none of group X''s');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.attendance', 'aal2'), 4::bigint,
  'the manager with MFA sees all of it');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.attendance'), 0::bigint,
  'and nothing without MFA');

-- Nothing disappears.
select is(
  pg_temp.try_as(:TX, format('delete from public.attendance where session_id = %L', :PAST)),
  '42501', 'nobody deletes attendance');
select is(
  pg_temp.try_as(:TX, format('delete from public.group_sessions where id = %L', :PAST)),
  '23503', 'a class with attendance cannot be removed');
select ok(
  (select marked_at > now() - interval '1 minute' from public.attendance
    where session_id = 'f0000000-0000-4000-8000-000000000003'),
  'the database sets when a mark was made, whatever the client sends');

select * from finish();
rollback;
