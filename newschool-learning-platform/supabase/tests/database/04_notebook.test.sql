-- Notebook: optional in-class answers and reading position are own-row
-- writes (ADR-023). A student can write only their own rows, only on sections
-- they can read; teachers read their own students' answers. Fixtures: seed.sql.
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
\set B '''student.b@example.com'''
\set TX '''teacher.x@example.com'''
\set TY '''teacher.y@example.com'''

-- ── writing answers ────────────────────────────────────────────────────────
select is(
  pg_temp.try_as(:A, $$insert into public.block_responses (user_id, section_id, course_id, block_id, answer)
    values ('00000000-0000-4000-8000-0000000000a1', '60000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001', 'b2', 'Me llamo Daniel.')$$),
  'ok', 'a student can save their own answer on a published section of their course');
select is(
  pg_temp.try_as(:A, $$update public.block_responses set answer = 'Me llamo Dani.'
    where user_id = '00000000-0000-4000-8000-0000000000a1' and block_id = 'b2'$$),
  'ok', 'and change it');
select is(
  pg_temp.try_as(:A, $$insert into public.block_responses (user_id, section_id, course_id, block_id, answer)
    values ('00000000-0000-4000-8000-0000000000a2', '60000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001', 'b2', 'forged')$$),
  '42501', 'a student cannot write an answer as another student');
select is(
  pg_temp.try_as(:A, $$insert into public.block_responses (user_id, section_id, course_id, block_id, answer)
    values ('00000000-0000-4000-8000-0000000000a1', '60000000-0000-4000-8000-000000000003',
            '30000000-0000-4000-8000-000000000002', 'b1', 'x')$$),
  '42501', 'a student cannot answer in a course they are not enrolled in');
select is(
  pg_temp.try_as(:A, $$insert into public.block_responses (user_id, section_id, course_id, block_id, answer)
    values ('00000000-0000-4000-8000-0000000000a1', '60000000-0000-4000-8000-000000000002',
            '30000000-0000-4000-8000-000000000001', 'b1', 'x')$$),
  '42501', 'a student cannot answer in an unpublished section');
select is(
  pg_temp.try_as(:A, $$update public.block_responses set course_id = '30000000-0000-4000-8000-000000000002'
    where user_id = '00000000-0000-4000-8000-0000000000a1'$$),
  '42501', 'a student can change only the answer text, not where it belongs');

-- ── reading answers ────────────────────────────────────────────────────────
select is(pg_temp.scalar_as(:B, $$select count(*) from public.block_responses where user_id = '00000000-0000-4000-8000-0000000000a1'$$),
  0::bigint, 'a classmate cannot read another student''s answers');
select is(
  pg_temp.scalar_as(:TX, $$select count(*) from public.block_responses where user_id = '00000000-0000-4000-8000-0000000000a1'$$),
  1::bigint, 'the student''s teacher can read their answers');
select is(
  pg_temp.scalar_as(:TY, $$select count(*) from public.block_responses where user_id = '00000000-0000-4000-8000-0000000000a1'$$),
  0::bigint, 'a teacher of another course cannot');

-- ── reading position ───────────────────────────────────────────────────────
select is(
  pg_temp.try_as(:A, $$insert into public.section_progress (user_id, book_section_id, course_id, status, last_block_id)
    values ('00000000-0000-4000-8000-0000000000a1', '60000000-0000-4000-8000-000000000005',
            '30000000-0000-4000-8000-000000000001', 'in_progress', 'b1')$$),
  'ok', 'a student can record where they are in a section');
select is(
  pg_temp.try_as(:A, $$update public.section_progress set status = 'completed', completed_at = now()
    where user_id = '00000000-0000-4000-8000-0000000000a1' and book_section_id = '60000000-0000-4000-8000-000000000005'$$),
  'ok', 'and mark it finished');
select is(
  pg_temp.try_as(:A, $$insert into public.section_progress (user_id, book_section_id, course_id, status)
    values ('00000000-0000-4000-8000-0000000000a2', '60000000-0000-4000-8000-000000000005',
            '30000000-0000-4000-8000-000000000001', 'completed')$$),
  '42501', 'a student cannot record progress for someone else');
select is(
  pg_temp.scalar_as(:A, $$with u as (update public.section_progress set status = 'completed'
    where user_id = '00000000-0000-4000-8000-0000000000a2' returning 1) select count(*) from u$$),
  0::bigint, 'a student cannot change someone else''s progress');
select is(
  pg_temp.try_as(:A, $$update public.section_progress set user_id = '00000000-0000-4000-8000-0000000000a2'
    where user_id = '00000000-0000-4000-8000-0000000000a1'$$),
  '42501', 'a student cannot move their progress row to another student');

-- ── clearing answers ───────────────────────────────────────────────────────
select is(
  pg_temp.scalar_as(:A, $$with d as (delete from public.block_responses
    where user_id = '00000000-0000-4000-8000-0000000000a2' returning 1) select count(*) from d$$),
  0::bigint, 'a student cannot delete another student''s answer');
select is(
  pg_temp.scalar_as(:A, $$with d as (delete from public.block_responses
    where user_id = '00000000-0000-4000-8000-0000000000a1' returning 1) select count(*) from d$$),
  1::bigint, 'a student can clear their own answer');

select * from finish();
rollback;
