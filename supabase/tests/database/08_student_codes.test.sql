-- Student entry codes (merged from the staff room). Only hashes are stored,
-- and no signed-in user (student, teacher, office, manager or admin) and no
-- visitor can read or write the codes or the wrong-code counter: only the
-- server's privileged module can.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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

-- A code for student A, issued by teacher X (as the server would).
insert into public.student_codes (user_id, code_hash, issued_by)
select s.id, repeat('ab', 32), t.id
from auth.users s, auth.users t
where s.email = 'student.a@example.com' and t.email = 'teacher.x@example.com';

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.student_codes'::regclass)
  and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.code_attempts'::regclass),
  'RLS is on and forced for both tables'
);
select ok(
  not has_table_privilege('anon', 'public.student_codes', 'select')
  and not has_table_privilege('authenticated', 'public.student_codes', 'select')
  and not has_table_privilege('authenticated', 'public.student_codes', 'insert')
  and not has_table_privilege('authenticated', 'public.code_attempts', 'select')
  and not has_table_privilege('authenticated', 'public.code_attempts', 'update'),
  'visitors and signed-in users have no privileges at all'
);

select is(pg_temp.try_as('student.a@example.com', 'select 1 from public.student_codes'), '42501',
  'a student cannot read even their own code row');
select is(pg_temp.try_as('teacher.x@example.com', 'select 1 from public.student_codes'), '42501',
  'the teacher who issued it cannot read it back');
select is(pg_temp.try_as('admin@example.com', 'select 1 from public.student_codes', 'aal2'), '42501',
  'an admin with MFA cannot read codes either');
select is(pg_temp.try_as('office@example.com', 'select 1 from public.code_attempts', 'aal2'), '42501',
  'the office cannot read the wrong-code counter');
select is(
  pg_temp.try_as('teacher.x@example.com',
    $$insert into public.student_codes (user_id, code_hash)
      select id, repeat('cd', 32) from auth.users where email = 'student.b@example.com'$$),
  '42501', 'a teacher cannot plant a code for a student');
select is(
  pg_temp.try_as('student.b@example.com',
    $$update public.student_codes set user_id = auth.uid()$$),
  '42501', 'a student cannot move someone''s code onto their own account');
select is(
  pg_temp.try_as('student.a@example.com', $$delete from public.code_attempts$$),
  '42501', 'nobody can reset the wrong-code counter');

-- What the table accepts.
select throws_ok(
  $$insert into public.student_codes (user_id, code_hash)
    select id, 'ABCD2345' from auth.users where email = 'student.b@example.com'$$,
  '23514', null, 'only a 64-character lowercase hex hash can be stored, never a code');
select throws_ok(
  $$insert into public.student_codes (user_id, code_hash)
    select id, repeat('ab', 32) from auth.users where email = 'student.b@example.com'$$,
  '23505', null, 'two students cannot share a code');
select throws_ok(
  $$insert into public.student_codes (user_id, code_hash)
    select id, repeat('ef', 32) from auth.users where email = 'student.a@example.com'$$,
  '23505', null, 'a student has one live code at a time');

select * from finish();
rollback;
