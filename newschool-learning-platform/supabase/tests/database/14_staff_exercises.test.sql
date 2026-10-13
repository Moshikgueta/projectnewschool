-- Exercises written by teachers and the office (Phase 8, ADR-038). Every
-- write is attempted with the person's own session, as the app does.
-- Fixtures (seed.sql): teacher X teaches Spanish L1 (group X: students A, B,
-- D); teacher Y teaches French L1 (group Y: students B, C). Added here:
-- group Z, a second Spanish L1 group with student C, and a second office user.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

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
\set OF2 '''office.two@example.com'''

-- Teacher X's exercise, office exercises (Spanish and French), group Z.
\set EX '''e1000000-0000-4000-8000-000000000001'''
\set EXO '''e1000000-0000-4000-8000-000000000002'''
\set EXO2 '''e1000000-0000-4000-8000-000000000003'''
\set ITEM '''e2000000-0000-4000-8000-000000000001'''

insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000e2',
        'authenticated', 'authenticated', 'office.two@example.com');
insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-0000000000e2', 'office');
insert into public.groups (id, course_id, name, status)
values ('a0000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-000000000001', 'Spanish L1 (group Z)', 'active');
insert into public.enrollments (group_id, student_id)
values ('a0000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a3');

-- ── who writes ─────────────────────────────────────────────────────────────
select is(
  pg_temp.try_as(:TX, format($$insert into public.activities (id, course_id, cycle_id, slug, title, created_by)
    values (%L, '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
            'x-tx-saludos', 'Saludos (teacher X)', '00000000-0000-4000-8000-0000000000b1')$$, :EX)),
  'ok', 'teacher X writes an exercise in a course they teach');
select is(
  pg_temp.try_as(:TX, $$insert into public.activities (course_id, cycle_id, slug, title, created_by)
    values ('30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003',
            'x-tx-francais', 'Français', '00000000-0000-4000-8000-0000000000b1')$$),
  '42501', 'but not in a course they don''t teach');
select is(
  pg_temp.try_as(:TX, $$insert into public.activities (course_id, cycle_id, slug, title, created_by)
    values ('30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
            'x-tx-as-ty', 'In Y''s name', '00000000-0000-4000-8000-0000000000b2')$$),
  '42501', 'nor in another teacher''s name');
select is(
  pg_temp.try_as(:TX, $$insert into public.activities (course_id, cycle_id, slug, title)
    values ('30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
            'x-tx-curriculum', 'Curriculum')$$),
  '42501', 'nor as part of the school curriculum (no author)');
select is(
  pg_temp.try_as(:A, $$insert into public.activities (course_id, cycle_id, slug, title, created_by)
    values ('30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
            'x-student', 'Student', '00000000-0000-4000-8000-0000000000a1')$$),
  '42501', 'a student cannot write an exercise');

select is(
  pg_temp.try_as(:TX, format($$insert into public.activity_items (id, activity_id, course_id, position, slug, type, prompt, data)
    values (%L, %L, '30000000-0000-4000-8000-000000000001', 1, 'q1', 'trueFalse',
            '[{"id":"prompt","type":"text","text":"«Hola» es un saludo."}]', '{}')$$, :ITEM, :EX)),
  'ok', 'teacher X adds a question to their exercise');
select is(
  pg_temp.try_as(:TX, format($$insert into public.activity_item_keys (item_id, course_id, answer)
    values (%L, '30000000-0000-4000-8000-000000000001', '{"value": true}')$$, :ITEM)),
  'ok', 'and its answer');
select is(
  pg_temp.try_as(:TX, format($$insert into public.activity_sources (activity_id, course_id, source)
    values (%L, '30000000-0000-4000-8000-000000000001', '{"instructions": [], "items": []}')$$, :EX)),
  'ok', 'and keeps its authored source');
select is(
  pg_temp.try_as(:TX, format($$update public.activities set created_by = '00000000-0000-4000-8000-0000000000b2'
    where id = %L$$, :EX)),
  '42501', 'the author of an exercise cannot change');
select is(
  pg_temp.scalar_as(:TX, format($$with d as (delete from public.activities where id = %L returning 1)
    select count(*) from d$$, :EX)),
  0::bigint, 'staff archive exercises; they cannot delete them');

select is(
  pg_temp.scalar_as(:TY, format($$with u as (update public.activities set title = 'Mine now'
    where id = %L returning 1) select count(*) from u$$, :EX)),
  0::bigint, 'teacher Y cannot change teacher X''s exercise');
select is(
  pg_temp.try_as(:TY, format($$insert into public.activity_items (activity_id, course_id, type)
    values (%L, '30000000-0000-4000-8000-000000000001', 'reflection')$$, :EX)),
  '42501', 'nor add questions to it');
select is(
  pg_temp.scalar_as(:TX, $$with u as (update public.activities set title = 'Mine now'
    where id = '70000000-0000-4000-8000-000000000001' returning 1) select count(*) from u$$),
  0::bigint, 'teacher X cannot change a curriculum exercise');
select is(
  pg_temp.try_as(:TX, $$insert into public.activity_items (activity_id, course_id, type)
    values ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'reflection')$$),
  '42501', 'nor add questions to one');
select is(
  pg_temp.scalar_as(:TX, $$with u as (update public.activity_item_keys set feedback = '{}'
    where item_id = '80000000-0000-4000-8000-000000000001' returning 1) select count(*) from u$$),
  0::bigint, 'nor change its answers');

select is(
  pg_temp.try_as(:OF, format($$insert into public.activities (id, course_id, cycle_id, slug, title, created_by, status)
    values (%L, '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003',
            'x-office-salut', 'Salut (office)', '00000000-0000-4000-8000-0000000000e1', 'published')$$, :EXO), 'aal2'),
  'ok', 'the office (MFA) writes an exercise in any course');
select is(
  pg_temp.try_as(:OF, $$insert into public.activities (course_id, cycle_id, slug, title, created_by)
    values ('30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003',
            'x-office-nomfa', 'No MFA', '00000000-0000-4000-8000-0000000000e1')$$),
  '42501', 'but not without MFA');
select is(
  pg_temp.try_as(:OF, format($$insert into public.activities (id, course_id, cycle_id, slug, title, created_by, status)
    values (%L, '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
            'x-office-hola', 'Hola (office)', '00000000-0000-4000-8000-0000000000e1', 'published')$$, :EXO2), 'aal2'),
  'ok', 'the office writes one in Spanish too');
select is(
  pg_temp.scalar_as(:OF2, format($$with u as (update public.activities set title = 'Salut !'
    where id = %L returning 1) select count(*) from u$$, :EXO), 'aal2'),
  1::bigint, 'another office user can edit an office exercise (one desk)');
select is(
  pg_temp.scalar_as(:OF, format($$with u as (update public.activities set title = 'Office edit'
    where id = %L returning 1) select count(*) from u$$, :EX), 'aal2'),
  0::bigint, 'the office cannot edit a teacher''s exercise');
select is(
  pg_temp.scalar_as(:TX, format($$with u as (update public.activities set title = 'Teacher edit'
    where id = %L returning 1) select count(*) from u$$, :EXO2)),
  0::bigint, 'a teacher cannot edit an office exercise');
select is(
  pg_temp.scalar_as(:PM, format($$with u as (update public.activities set est_minutes = 5
    where id = %L returning 1) select count(*) from u$$, :EX), 'aal2'),
  1::bigint, 'the manager (MFA) edits any staff exercise');

-- ── who sees ───────────────────────────────────────────────────────────────
select is(
  pg_temp.scalar_as(:TX, format('select count(*) from public.editable_activities where activity_id in (%L, %L, %L)', :EX, :EXO, :EXO2)),
  1::bigint, 'teacher X''s editable exercises are their own only');
select is(
  pg_temp.scalar_as(:TX, format('select count(*) from public.activities where id = %L', :EXO2)),
  1::bigint, 'teachers of the course see a published office exercise (to assign it)');
select is(
  pg_temp.scalar_as(:TY, format('select count(*) from public.activities where id in (%L, %L)', :EX, :EXO2)),
  0::bigint, 'a teacher of another course sees none of them');

update public.activities set status = 'published' where id = 'e1000000-0000-4000-8000-000000000001';
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.activities where id = %L', :EX)),
  0::bigint, 'published but not assigned: student A does not see it');
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.activity_items where activity_id = %L', :EX)),
  0::bigint, 'nor its questions');

select is(
  pg_temp.try_as(:TX, format($$insert into public.assignments (id, group_id, course_id, activity_id, assigned_by)
    values ('e3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001', %L, '00000000-0000-4000-8000-0000000000b1')$$, :EX)),
  'ok', 'teacher X assigns it to group X');
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.activities where id = %L', :EX)),
  1::bigint, 'now student A (group X) sees it');
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.activity_items where activity_id = %L', :EX)),
  1::bigint, 'and its questions');
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.activity_item_keys where item_id = %L', :ITEM)),
  0::bigint, 'but never its answers');
select is(
  pg_temp.scalar_as(:C, format('select count(*) from public.activities where id = %L', :EX)),
  0::bigint, 'student C (group Z, same course) does not see it');
select is(
  pg_temp.scalar_as(:C, format('select count(*) from public.activity_items where id = %L', :ITEM)),
  0::bigint, 'nor its question, even by id');
select is(
  pg_temp.scalar_as(:C, format('select count(*) from public.assignments where activity_id = %L', :EX)),
  0::bigint, 'nor group X''s assignment');

update public.activities set status = 'archived' where id = 'e1000000-0000-4000-8000-000000000001';
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.activities where id = %L', :EX)),
  0::bigint, 'archived, it leaves student A''s list');
update public.activities set status = 'published' where id = 'e1000000-0000-4000-8000-000000000001';

-- Assigned by name: only the chosen student.
select is(
  pg_temp.try_as(:TX, format($$insert into public.assignments (id, group_id, course_id, activity_id, audience, assigned_by)
    values ('e3000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001', %L, 'selected', '00000000-0000-4000-8000-0000000000b1')$$, :EXO2)),
  'ok', 'teacher X assigns the office''s exercise to chosen students of group X');
select is(
  pg_temp.try_as(:TX, $$insert into public.assignment_recipients (assignment_id, student_id)
    values ('e3000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2')$$),
  'ok', 'student B is chosen');
select is(
  pg_temp.scalar_as(:B, format('select count(*) from public.activities where id = %L', :EXO2)),
  1::bigint, 'student B sees it');
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.activities where id = %L', :EXO2)),
  0::bigint, 'student A, in the same group but not chosen, does not');

-- ── the office assigns ─────────────────────────────────────────────────────
select is(
  pg_temp.try_as(:OF, format($$insert into public.assignments (group_id, course_id, activity_id, assigned_by)
    values ('a0000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
            %L, '00000000-0000-4000-8000-0000000000e1')$$, :EXO), 'aal2'),
  'ok', 'the office assigns to any group');
select is(
  pg_temp.try_as(:OF, format($$insert into public.assignments (group_id, course_id, activity_id, assigned_by)
    values ('a0000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
            %L, '00000000-0000-4000-8000-0000000000b2')$$, :EXO), 'aal2'),
  '42501', 'in its own name only');
select is(
  pg_temp.scalar_as(:OF, $$with d as (delete from public.assignments
    where id = 'e3000000-0000-4000-8000-000000000001' returning 1) select count(*) from d$$, 'aal2'),
  0::bigint, 'it cannot remove homework a teacher gave');
select is(
  pg_temp.try_as(:TX, $$insert into public.assignments (group_id, course_id, activity_id, assigned_by)
    values ('a0000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
            '70000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000b1')$$),
  '42501', 'teacher X still cannot assign to teacher Y''s group');

-- ── answered questions stay locked ─────────────────────────────────────────
insert into public.attempts (id, user_id, activity_id, course_id, status)
values ('e4000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
        'e1000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'in_progress');
insert into public.responses (attempt_id, user_id, course_id, item_id, answer, is_correct, score)
values ('e4000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
        '30000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', '{"value": true}', true, 1);

select is(
  pg_temp.scalar_as(:TX, format('select count(*) from public.activity_answered_items where activity_id = %L', :EX)),
  1::bigint, 'the author sees which questions have answers');
select is(
  pg_temp.scalar_as(:TY, format('select count(*) from app.answered_item_ids(%L)', :EX)),
  0::bigint, 'nobody who cannot edit the exercise does');
select is(
  pg_temp.try_as(:TX, format($$update public.activity_items set data = '{"x": 1}' where id = %L$$, :ITEM)),
  '23001', 'an answered question keeps its options');
select is(
  pg_temp.try_as(:TX, format('delete from public.activity_items where id = %L', :ITEM)),
  '23001', 'and cannot be removed');

select * from finish();
rollback;
