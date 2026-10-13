-- Exercises: answer keys and grading stay on the server (ADR-006). Students
-- read their own attempts and responses, never keys, and cannot write graded
-- records with their own session. Fixtures: seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

-- ── keys ───────────────────────────────────────────────────────────────────
select is(pg_temp.scalar_as(:A, 'select count(*) from public.activity_item_keys'), 0::bigint,
  'a student sees no answer keys at all');
select is(
  pg_temp.scalar_as(:A, $$select count(*) from public.activity_items where activity_id = '70000000-0000-4000-8000-000000000006'$$),
  6::bigint, 'but can read the public part of the items of a published activity');
select is(
  pg_temp.scalar_as(:A, $$select count(*) from public.activity_items i
    where i.activity_id = '70000000-0000-4000-8000-000000000006'
      and (i.data::text ilike '%accept%' or i.data::text ilike '%optionIds%' or i.data::text ilike '%pairs%')$$),
  0::bigint, 'and the public part carries no answers');

-- ── graded records are server-written ──────────────────────────────────────
select is(
  pg_temp.try_as(:A, $$insert into public.attempts (user_id, activity_id, course_id)
    values ('00000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001')$$),
  '42501', 'a student cannot start an attempt directly');
select is(
  pg_temp.try_as(:A, $$delete from public.responses where user_id = '00000000-0000-4000-8000-0000000000a1'$$),
  '42501', 'or delete their responses');
select is(
  pg_temp.try_as(:A, $$update public.attempts set state = '{}' where user_id = '00000000-0000-4000-8000-0000000000a1'$$),
  '42501', 'or change the player state');

-- ── one open attempt per activity ─────────────────────────────────────────
insert into public.attempts (user_id, activity_id, course_id, attempt_no)
  values ('00000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', 1);
select throws_ok(
  $$insert into public.attempts (user_id, activity_id, course_id, attempt_no)
    values ('00000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', 2)$$,
  '23505', null, 'a second open attempt for the same activity is refused');
update public.attempts set status = 'submitted'
  where user_id = '00000000-0000-4000-8000-0000000000a1' and activity_id = '70000000-0000-4000-8000-000000000006';
select lives_ok(
  $$insert into public.attempts (user_id, activity_id, course_id, attempt_no)
    values ('00000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', 2)$$,
  'once it is submitted, the student can practise again');

select * from finish();
rollback;
