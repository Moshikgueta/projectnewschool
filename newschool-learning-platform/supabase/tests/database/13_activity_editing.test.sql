-- Exercise editing (Phase 8, ADR-036): the pedagogical manager (MFA) writes
-- exercises, items and keys; the authored source is theirs alone; an item
-- students have answered keeps its options and answers and cannot be removed,
-- for anyone (the import's secret key included).
-- Fixtures (seed.sql): item 80…01 (multiple choice, answered); activity 70…06
-- with item 80…66 "saludo" (short answer, not answered).
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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
\set PM '''manager@example.com'''
\set ANSWERED '''80000000-0000-4000-8000-000000000001'''
\set FREE '''80000000-0000-4000-8000-000000000066'''

insert into public.activity_sources (activity_id, course_id, source)
values ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        '{"instructions": [], "items": [{"id": "q", "type": "trueFalse", "prompt": "x", "answer": true}]}');

-- The authored source carries the answers: the manager's only.
select is(pg_temp.scalar_as(:A, 'select count(*) from public.activity_sources'), 0::bigint,
  'a student cannot read an exercise''s source (it holds the answers)');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.activity_sources'), 0::bigint,
  'nor can a teacher of the course');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.activity_sources'), 0::bigint,
  'nor the manager without MFA');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.activity_sources', 'aal2'), 1::bigint,
  'the manager with MFA can');

-- Who writes.
select is(
  pg_temp.scalar_as(:TX, format($$with u as (update public.activity_items set points = 5
    where id = %L returning 1) select count(*) from u$$, :FREE)),
  0::bigint, 'a teacher cannot change an item');
select is(
  pg_temp.try_as(:A, $$insert into public.activity_item_keys (item_id, course_id, answer)
    values ('80000000-0000-4000-8000-000000000066', '30000000-0000-4000-8000-000000000001', '{}')$$),
  '42501', 'a student cannot write an answer key');
select is(
  pg_temp.try_as(:PM, $$insert into public.activities (course_id, cycle_id, slug, title)
    values ('30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'nuevo', 'Nuevo')$$, 'aal2'),
  'ok', 'the manager creates an exercise');

-- Answered items keep their answers.
select is(
  pg_temp.try_as(:PM, format($$update public.activity_items set prompt = '[{"id":"prompt","type":"text","text":"New wording"}]'
    where id = %L$$, :ANSWERED), 'aal2'),
  'ok', 'the wording of an answered item can change');
select is(
  pg_temp.try_as(:PM, format($$update public.activity_items set data = '{"options":[],"multiple":false}'
    where id = %L$$, :ANSWERED), 'aal2'),
  '23001', 'its options cannot');
select is(
  pg_temp.try_as(:PM, format($$update public.activity_item_keys set answer = '{"optionIds":["x"]}'
    where item_id = %L$$, :ANSWERED), 'aal2'),
  '23001', 'nor its answers');
select is(
  pg_temp.try_as(:PM, format('delete from public.activity_items where id = %L', :ANSWERED), 'aal2'),
  '23001', 'and it cannot be removed (it would take the answers with it)');
select is(
  pg_temp.try_as(:PM, format('delete from public.activity_item_keys where item_id = %L', :ANSWERED), 'aal2'),
  '23001', 'nor can its key be removed');
set local role postgres;
select throws_ok(
  format('delete from public.activity_items where id = %L', '80000000-0000-4000-8000-000000000001'),
  '23001', null, 'the rule holds for the import''s secret key too');

-- Unanswered items can change freely.
select is(
  pg_temp.try_as(:PM, format($$update public.activity_items set data = '{"maxLength": 50}'
    where id = %L$$, :FREE), 'aal2'),
  'ok', 'an unanswered item can change completely');
select is(
  pg_temp.try_as(:PM, format('delete from public.activity_items where id = %L', :FREE), 'aal2'),
  'ok', 'and can be removed');

select * from finish();
rollback;
