-- Content editing (Phase 8, ADR-034): pedagogical managers with MFA edit
-- content with their own session; nobody else writes it; nothing is deleted
-- from the editor; every change to a section is in the audit log.
-- Fixtures (seed.sql): section 60…01 "¡Hola!" (Spanish L1, published) with
-- teacher notes; course 30…03 (draft); teacher X teaches Spanish L1.
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
\set PM '''manager@example.com'''
\set AD '''admin@example.com'''
\set HOLA '''60000000-0000-4000-8000-000000000001'''

select is(
  pg_temp.scalar_as(:PM, format($$with u as (update public.book_sections
    set blocks = '[{"id":"h1","type":"heading","level":2,"text":"Hola"}]'
    where id = %L returning 1) select count(*) from u$$, :HOLA), 'aal2'),
  1::bigint, 'the manager (MFA) edits a section');
select ok(
  exists (select 1 from public.audit_log where entity_type = 'book_sections'
    and entity_id = '60000000-0000-4000-8000-000000000001' and action = 'UPDATE'
    and after -> 'blocks' -> 0 ->> 'text' = 'Hola' and before -> 'blocks' <> after -> 'blocks'),
  'the change is in the audit log, before and after');
select is(
  pg_temp.scalar_as(:PM, format($$with u as (update public.book_sections set title = 'x'
    where id = %L returning 1) select count(*) from u$$, :HOLA)),
  0::bigint, 'not without MFA');
select is(
  pg_temp.scalar_as(:TX, format($$with u as (update public.book_sections set title = 'x'
    where id = %L returning 1) select count(*) from u$$, :HOLA)),
  0::bigint, 'a teacher of the course cannot edit it');
select is(
  pg_temp.scalar_as(:AD, format($$with u as (update public.book_sections set title = 'x'
    where id = %L returning 1) select count(*) from u$$, :HOLA), 'aal2'),
  0::bigint, 'nor an admin (content is the pedagogical manager''s)');
select is(
  pg_temp.try_as(:A, $$insert into public.courses (level_id, slug, title)
    values ('20000000-0000-4000-8000-000000000001', 'my-course', 'Mine')$$),
  '42501', 'a student cannot create a course');
select is(
  pg_temp.try_as(:TX, $$insert into public.cycles (course_id, slug, title)
    values ('30000000-0000-4000-8000-000000000001', 'extra', 'Extra')$$),
  '42501', 'a teacher cannot add a cycle');
select is(
  pg_temp.try_as(:TX, format($$update public.section_teacher_notes set blocks = '[]'
    where section_id = %L$$, :HOLA)),
  'ok', '');
select isnt(
  (select blocks from public.section_teacher_notes where section_id = '60000000-0000-4000-8000-000000000001'),
  '[]'::jsonb, 'a teacher cannot change teacher notes');
select is(
  pg_temp.try_as(:PM, format('delete from public.book_sections where id = %L', :HOLA), 'aal2'),
  '42501', 'sections are archived, not deleted, even by the manager');
select is(
  pg_temp.try_as(:PM, $$update public.courses set status = 'published'
    where id = '30000000-0000-4000-8000-000000000003'$$, 'aal2'),
  'ok', 'the manager publishes a course');
select ok(
  (select published_at is not null from public.courses where id = '30000000-0000-4000-8000-000000000003'),
  'and it gets its publication date');
select is(
  pg_temp.scalar_as(:PM, format($$with u as (update public.section_teacher_notes set blocks = '[]'
    where section_id = %L returning 1) select count(*) from u$$, :HOLA), 'aal2'),
  1::bigint, 'the manager edits teacher notes');
select ok(
  exists (select 1 from public.audit_log where entity_type = 'section_teacher_notes'
    and entity_id = '60000000-0000-4000-8000-000000000001'),
  'teacher-note changes are logged under their section');

select * from finish();
rollback;
