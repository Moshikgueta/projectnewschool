-- Pilot release and mistake reports (ADR-040).
-- A student reports, in their own name, only content they can see (published,
-- in a course they are enrolled in), reads only their own reports, and is
-- limited to 10 an hour. Teachers of the course and the pedagogical manager
-- (MFA) read and resolve them; teachers of other courses, the office and other
-- students never see them.
-- Fixtures (seed.sql): Spanish L1 (pilot, group X: A, B, D; teacher X) with
-- the every-type exercise 70…06 (question 80…61), a draft exercise 70…02, the
-- page 60…01 and a draft page 60…02; French L1 (group Y: B, C; teacher Y);
-- the draft course Spanish L2 (group W: A; teacher X) with exercise 70…04.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

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

-- ── the pilot flag ─────────────────────────────────────────────────────────
select is(
  pg_temp.scalar_as(:A, $$select count(*) from public.courses where pilot$$), 1::bigint,
  'student A sees their Spanish course marked as a pilot');
select is(
  pg_temp.scalar_as(:C, $$select count(*) from public.courses where pilot$$), 0::bigint,
  'student C (French only) sees no pilot course');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'public.content_reports'::regclass),
  'RLS is on and forced on content_reports');

-- ── a student reports what they can see ────────────────────────────────────
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, item_id, message, suggested_answer)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006',
            '80000000-0000-4000-8000-000000000061', 'Two options look right.', 'Me llamo Ana.')$$),
  'ok', 'student A reports a question of a published exercise in their pilot course');
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, book_section_id, message)
    values ('30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'Typo in the dialogue.')$$),
  'ok', 'and a published notebook page');
select is(
  (select count(*) from public.content_reports
    where reporter_id = '00000000-0000-4000-8000-0000000000a1' and status = 'open'
      and resolved_by is null and resolved_at is null),
  2::bigint, 'both are stored in A''s own name, open');

select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, message)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'Draft')$$),
  '42501', 'but not a draft exercise');
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, book_section_id, message)
    values ('30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', 'Draft')$$),
  '42501', 'nor a draft page');
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, message)
    values ('30000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000004', 'Draft course')$$),
  '42501', 'nor an exercise of a draft course, even one they are enrolled in');
select is(
  pg_temp.try_as(:C, $$insert into public.content_reports (course_id, activity_id, message)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', 'Not mine')$$),
  '42501', 'student C cannot report a course they are not enrolled in');
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, item_id, message)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006',
            '80000000-0000-4000-8000-000000000071', 'Wrong pair')$$),
  '42501', 'a question is reported only with its own exercise');
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, message)
    values ('30000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000006', 'Wrong course')$$),
  '42501', 'and only under its own course');
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (reporter_id, course_id, activity_id, message)
    values ('00000000-0000-4000-8000-0000000000a2', '30000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000006', 'In B''s name')$$),
  '42501', 'a student cannot report in someone else''s name');
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, message, status)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', 'Done', 'resolved')$$),
  '42501', 'nor send a report already resolved');
select is(
  pg_temp.try_as(:TX, $$insert into public.content_reports (course_id, activity_id, message)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', 'Teacher')$$),
  '42501', 'reports come from students of the course (teacher X is not enrolled)');

-- ── length limits ──────────────────────────────────────────────────────────
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, message)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', repeat('x', 501))$$),
  '23514', 'a message longer than 500 characters is refused');
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, message)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', '   ')$$),
  '23514', 'so is an empty one');
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, message, suggested_answer)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', 'Long', repeat('x', 301))$$),
  '23514', 'and a suggested answer longer than 300 characters');

-- ── who reads what ─────────────────────────────────────────────────────────
select is(
  pg_temp.try_as(:B, $$insert into public.content_reports (course_id, activity_id, message)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', 'From B')$$),
  'ok', 'student B reports too');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.content_reports'), 2::bigint,
  'student A reads only their own two reports');
select is(pg_temp.scalar_as(:B, 'select count(*) from public.content_reports'), 1::bigint,
  'student B, a classmate, reads only their own');
select is(
  pg_temp.scalar_as(:B, $$select count(*) from public.content_reports
    where reporter_id = '00000000-0000-4000-8000-0000000000a1'$$), 0::bigint,
  'and cannot find A''s reports, or learn that A reported, by asking for them');
select is(pg_temp.scalar_as(:C, 'select count(*) from public.content_reports'), 0::bigint,
  'student C reads none');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.content_reports'), 3::bigint,
  'teacher X reads every report about the course they teach');
select is(pg_temp.scalar_as(:TY, 'select count(*) from public.content_reports'), 0::bigint,
  'teacher Y (another course) reads none');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.content_reports', 'aal2'), 3::bigint,
  'the manager (MFA) reads all of them');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.content_reports'), 0::bigint,
  'but not without MFA');
select is(pg_temp.scalar_as(:OF, 'select count(*) from public.content_reports', 'aal2'), 0::bigint,
  'the office reads none');

-- ── resolving ──────────────────────────────────────────────────────────────
select is(
  pg_temp.scalar_as(:A, $$with u as (update public.content_reports set status = 'resolved' returning 1)
    select count(*) from u$$), 0::bigint,
  'a student cannot resolve, even their own report');
select is(
  pg_temp.scalar_as(:TY, $$with u as (update public.content_reports set status = 'resolved' returning 1)
    select count(*) from u$$), 0::bigint,
  'teacher Y cannot resolve reports about another course');
select is(
  pg_temp.scalar_as(:TX, $$with u as (update public.content_reports set status = 'resolved'
    where message = 'From B' returning 1) select count(*) from u$$), 1::bigint,
  'teacher X resolves a report about their course');
select is(
  (select resolved_by from public.content_reports where message = 'From B'),
  '00000000-0000-4000-8000-0000000000b1'::uuid,
  'in their own name, with the time (set by the database)');
select is(
  pg_temp.try_as(:TX, $$update public.content_reports set message = 'Rewritten' where message = 'From B'$$),
  '42501', 'staff change only the status, never what the student wrote');
select is(
  pg_temp.try_as(:TX, $$update public.content_reports set resolved_by = '00000000-0000-4000-8000-0000000000c1'
    where message = 'From B'$$),
  '42501', 'nor who resolved it');
select is(
  pg_temp.scalar_as(:PM, $$with u as (update public.content_reports set status = 'open'
    where message = 'From B' returning resolved_by) select count(*) from u where resolved_by is null$$, 'aal2'),
  1::bigint, 'the manager (MFA) reopens it, which clears the resolution');
select is(
  pg_temp.try_as(:A, $$delete from public.content_reports$$),
  '42501', 'nobody deletes a report');

-- ── at most 10 reports an hour ─────────────────────────────────────────────
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, message)
    select '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', 'Report ' || n
    from generate_series(1, 8) n$$),
  'ok', 'student A sends eight more (ten in the hour)');
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, message)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', 'One too many')$$),
  'PT429', 'the eleventh in the hour is refused');
select is(
  pg_temp.try_as(:B, $$insert into public.content_reports (course_id, activity_id, message)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', 'B again')$$),
  'ok', 'the limit is per student: B can still report');
update public.content_reports set created_at = now() - interval '61 minutes'
  where reporter_id = '00000000-0000-4000-8000-0000000000a1';
select is(
  pg_temp.try_as(:A, $$insert into public.content_reports (course_id, activity_id, message)
    values ('30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', 'An hour later')$$),
  'ok', 'an hour later A can report again');

select * from finish();
rollback;
