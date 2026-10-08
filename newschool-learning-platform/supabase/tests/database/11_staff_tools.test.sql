-- Staff tools (staff room merge, stage E). Feedback: written by staff in
-- their own name about students they teach, read by the author and the
-- manager (MFA), never by students. Training links: read by staff, kept by
-- the manager. Tasks: go to a pedagogical manager, seen by sender and
-- recipient, done only by the recipient.
-- Fixtures (seed.sql): feedback d3…01 (teacher X about D), d3…02 (teacher Y,
-- missing material); task d4…01 (teacher X → manager); three links.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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
\set D '''student.d@example.com'''
\set TX '''teacher.x@example.com'''
\set TY '''teacher.y@example.com'''
\set PM '''manager@example.com'''
\set OF '''office@example.com'''

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('public.staff_feedback'::regclass, 'public.staff_resources'::regclass,
                  'public.staff_tasks'::regclass)),
  'RLS is on and forced on all three tables');

-- Feedback.
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.staff_feedback'), 1::bigint,
  'teacher X sees only their own feedback');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.staff_feedback', 'aal2'), 2::bigint,
  'the manager (MFA) sees all of it');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.staff_feedback'), 0::bigint,
  'but not without MFA');
select is(pg_temp.scalar_as(:D, 'select count(*) from public.staff_feedback'), 0::bigint,
  'the student it is about never sees it');
select is(
  pg_temp.try_as(:TX, $$insert into public.staff_feedback (kind, student_id, verdict, body)
    values ('student', '00000000-0000-4000-8000-0000000000a1', 'on_track', 'Doing well')$$),
  'ok', 'teacher X writes feedback about a student they teach');
select is(
  pg_temp.try_as(:TX, $$insert into public.staff_feedback (kind, student_id, verdict, body)
    values ('student', '00000000-0000-4000-8000-0000000000a3', 'on_track', 'Never met them')$$),
  '42501', 'but not about a student they do not teach');
select is(
  pg_temp.try_as(:TX, $$insert into public.staff_feedback (author_id, kind, subject, verdict, body)
    values ('00000000-0000-4000-8000-0000000000b2', 'material', 'Unit 3', 'problematic', 'x')$$),
  '42501', 'nor in another teacher''s name');
select is(
  pg_temp.try_as(:A, $$insert into public.staff_feedback (kind, subject, verdict, body)
    values ('material', 'Unit 3', 'problematic', 'I hate it')$$),
  '42501', 'students cannot send staff feedback');
select is(
  pg_temp.try_as(:TX, $$insert into public.staff_feedback (kind, subject, body)
    values ('missing_material', 'astrology', 'x')$$),
  '23514', 'each kind carries only its own fields');
select is(
  pg_temp.try_as(:TX, $$update public.staff_feedback set body = 'rewritten'$$),
  '42501', 'feedback is not edited after it is sent');
select is(
  pg_temp.scalar_as(:TX, $$with u as (update public.staff_feedback set handled_at = now(),
    handled_by = auth.uid() returning 1) select count(*) from u$$),
  0::bigint, 'only the manager marks it handled');
select is(
  pg_temp.scalar_as(:PM, $$with u as (update public.staff_feedback set handled_at = now(),
    handled_by = auth.uid() where id = 'd3000000-0000-4000-8000-000000000002' returning 1)
    select count(*) from u$$, 'aal2'),
  1::bigint, 'the manager marks feedback handled, in their own name');
select is(
  pg_temp.scalar_as(:TY, $$with d as (delete from public.staff_feedback returning 1) select count(*) from d$$),
  1::bigint, 'an author can withdraw only their own feedback');

-- Training links.
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.staff_resources'), 3::bigint,
  'teachers read the training links');
select is(pg_temp.scalar_as(:OF, 'select count(*) from public.staff_resources'), 3::bigint,
  'so does the office');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.staff_resources'), 0::bigint,
  'students do not');
select is(
  pg_temp.try_as(:TX, $$insert into public.staff_resources (title, url) values ('x', 'https://example.com')$$),
  '42501', 'teachers cannot add links');
select is(
  pg_temp.try_as(:PM, $$insert into public.staff_resources (title, url) values ('x', 'javascript:alert(1)')$$, 'aal2'),
  '23514', 'only https links are stored, even from the manager');

-- Tasks.
select is(pg_temp.scalar_as(:TY, 'select count(*) from public.staff_tasks'), 0::bigint,
  'teacher Y does not see teacher X''s task');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.staff_tasks'), 1::bigint,
  'the manager sees the task sent to them');
select is(
  pg_temp.try_as(:TY, $$insert into public.staff_tasks (title, assignee_id)
    values ('Do my job', '00000000-0000-4000-8000-0000000000b1')$$),
  '23514', 'tasks go only to a pedagogical manager');
select is(
  pg_temp.scalar_as(:TX, $$with u as (update public.staff_tasks set status = 'done', done_at = now()
    returning 1) select count(*) from u$$),
  0::bigint, 'the sender cannot mark it done');
select is(
  pg_temp.try_as(:PM, $$update public.staff_tasks set title = 'Something else'$$),
  '42501', 'nobody rewrites a task');
select is(
  pg_temp.scalar_as(:PM, $$with u as (update public.staff_tasks set status = 'done', done_at = now()
    returning 1) select count(*) from u$$),
  1::bigint, 'the manager marks it done');

select * from finish();
rollback;
