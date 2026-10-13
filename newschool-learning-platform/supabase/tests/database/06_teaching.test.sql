-- Teacher area (Phase 7): a teacher runs only their own groups. Every write
-- below is attempted with the teacher's own session, as the app does.
-- Fixtures: seed.sql (teacher X: groups X and W; teacher Y: group Y).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
\set TY '''teacher.y@example.com'''

-- ── homework ───────────────────────────────────────────────────────────────
select is(
  pg_temp.try_as(:TX, $$insert into public.assignments (group_id, course_id, activity_id, assigned_by)
    values ('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000b1')$$),
  'ok', 'teacher X can give homework to group X');
select is(
  pg_temp.try_as(:TX, $$insert into public.assignments (group_id, course_id, activity_id, assigned_by)
    values ('a0000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
            '70000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000b1')$$),
  '42501', 'but not to group Y, which teacher Y teaches');
select is(
  pg_temp.try_as(:TX, $$insert into public.assignments (group_id, course_id, activity_id, assigned_by)
    values ('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000b2')$$),
  '42501', 'and cannot sign homework in another teacher''s name');
select is(
  pg_temp.try_as(:TX, $$insert into public.assignments (group_id, course_id, activity_id, assigned_by)
    values ('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000b1')$$),
  '23503', 'homework must be an activity of the group''s own course');
select is(
  pg_temp.scalar_as(:TY, $$with d as (delete from public.assignments
    where group_id = 'a0000000-0000-4000-8000-000000000001' returning 1) select count(*) from d$$),
  0::bigint, 'teacher Y cannot remove group X''s homework');
select is(
  pg_temp.try_as(:A, $$insert into public.assignments (group_id, course_id, activity_id, assigned_by)
    values ('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000a1')$$),
  '42501', 'a student cannot give homework');

-- ── active cycle and class times ───────────────────────────────────────────
select is(
  pg_temp.try_as(:TX, $$update public.group_cycles set state = 'completed'
    where group_id = 'a0000000-0000-4000-8000-000000000001'$$),
  'ok', 'teacher X can change group X''s cycles');
select is(
  pg_temp.scalar_as(:TX, $$with u as (update public.group_cycles set state = 'completed'
    where group_id = 'a0000000-0000-4000-8000-000000000002' returning 1) select count(*) from u$$),
  0::bigint, 'but not group Y''s');
select is(
  pg_temp.try_as(:TX, $$insert into public.group_sessions (group_id, starts_at)
    values ('a0000000-0000-4000-8000-000000000001', now() + interval '7 days')$$),
  'ok', 'teacher X can schedule a class for group X');
select is(
  pg_temp.try_as(:TY, $$insert into public.group_sessions (group_id, starts_at)
    values ('a0000000-0000-4000-8000-000000000001', now() + interval '7 days')$$),
  '42501', 'teacher Y cannot schedule classes for group X');
select is(
  pg_temp.scalar_as(:TY, $$select count(*) from public.group_sessions
    where group_id = 'a0000000-0000-4000-8000-000000000001'$$),
  0::bigint, 'or even see them');
select is(
  pg_temp.try_as(:A, $$insert into public.group_sessions (group_id, starts_at)
    values ('a0000000-0000-4000-8000-000000000001', now() + interval '7 days')$$),
  '42501', 'a student cannot schedule classes');

-- ── what a teacher can read about students ─────────────────────────────────
select is(
  pg_temp.scalar_as(:TX, $$select count(distinct user_id) from public.responses
    where course_id = '30000000-0000-4000-8000-000000000001'$$),
  3::bigint, 'teacher X reads the answers of their Spanish students (A, B, D)');
select is(
  pg_temp.scalar_as(:TX, $$select count(*) from public.responses
    where course_id = '30000000-0000-4000-8000-000000000002'$$),
  0::bigint, 'but none from the French course they do not teach (B''s French work included)');
select is(
  pg_temp.scalar_as(:TX, $$select count(*) from public.learning_events
    where user_id = '00000000-0000-4000-8000-0000000000a3'$$),
  0::bigint, 'and nothing about a student who is not in their groups');
select is(
  pg_temp.scalar_as(:TY, $$select count(*) from public.activity_item_keys
    where course_id = '30000000-0000-4000-8000-000000000001'$$),
  0::bigint, 'teacher Y cannot read the Spanish answer keys');

select * from finish();
rollback;
