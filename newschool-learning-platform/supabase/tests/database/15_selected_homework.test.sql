-- Homework for selected students (Phase 7, ADR-039). Every write is
-- attempted with the person's own session, as the app does.
-- Fixtures (seed.sql): teacher X teaches group X (Spanish L1: students A, B,
-- D); teacher Y teaches group Y (French L1: students B, C). Added here: a
-- published exercise teacher X wrote, and group Z, a second Spanish L1 group
-- of teacher X's with no students.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

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
\set D '''student.d@example.com'''
\set TX '''teacher.x@example.com'''
\set TY '''teacher.y@example.com'''
\set OF '''office@example.com'''

-- Teacher X's exercise; teacher X's assignment to selected students (SEL),
-- a group-wide one (ALL), and the office's to selected students (OFS).
\set EX '''e1000000-0000-4000-8000-0000000000c1'''
\set ITEM '''e2000000-0000-4000-8000-0000000000c1'''
\set SEL '''e3000000-0000-4000-8000-0000000000c1'''
\set ALL '''e3000000-0000-4000-8000-0000000000c2'''
\set OFS '''e3000000-0000-4000-8000-0000000000c3'''
\set SA '''00000000-0000-4000-8000-0000000000a1'''
\set SB '''00000000-0000-4000-8000-0000000000a2'''
\set SC '''00000000-0000-4000-8000-0000000000a3'''
\set SD '''00000000-0000-4000-8000-0000000000a4'''

insert into public.activities (id, course_id, cycle_id, slug, title, created_by, status)
values ('e1000000-0000-4000-8000-0000000000c1', '30000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001', 'x-selected', 'Only for some (teacher X)',
        '00000000-0000-4000-8000-0000000000b1', 'published');
insert into public.activity_items (id, activity_id, course_id, position, slug, type, prompt, data)
values ('e2000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-0000000000c1',
        '30000000-0000-4000-8000-000000000001', 1, 'q1', 'trueFalse',
        '[{"id":"prompt","type":"text","text":"¿Sí?"}]', '{}');
insert into public.groups (id, course_id, name, status)
values ('a0000000-0000-4000-8000-0000000000f2', '30000000-0000-4000-8000-000000000001', 'Spanish L1 (group Z)', 'active');
insert into public.group_teachers (group_id, teacher_id)
values ('a0000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000b1');

-- ── teacher X gives homework to selected students of group X ──────────────
select is(
  pg_temp.try_as(:TX, format($$insert into public.assignments (id, group_id, course_id, activity_id, audience, assigned_by)
    values (%L, 'a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', %L,
            'selected', '00000000-0000-4000-8000-0000000000b1')$$, :SEL, :EX)),
  'ok', 'teacher X gives homework to selected students of group X');
select is(
  pg_temp.try_as(:TX, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :SEL, :SB)),
  'ok', 'student B (group X) is chosen');
select is(
  pg_temp.try_as(:TX, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :SEL, :SC)),
  '23514', 'student C (not in group X) cannot be chosen');
select is(
  pg_temp.try_as(:TX, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :SEL, '00000000-0000-4000-8000-0000000000b2')),
  '23514', 'nor a member of staff');
select is(
  pg_temp.try_as(:TX, format($$insert into public.assignments (id, group_id, course_id, activity_id, assigned_by)
    values (%L, 'a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1')$$, :ALL)),
  'ok', 'teacher X gives group-wide homework');
select is(
  pg_temp.try_as(:TX, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :ALL, :SA)),
  '23514', 'group-wide homework has no recipients');

update public.enrollments set status = 'withdrawn'
 where group_id = 'a0000000-0000-4000-8000-000000000001' and student_id = '00000000-0000-4000-8000-0000000000a4';
select is(
  pg_temp.try_as(:TX, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :SEL, :SD)),
  '23514', 'a student who left the group cannot be chosen');
update public.enrollments set status = 'active'
 where group_id = 'a0000000-0000-4000-8000-000000000001' and student_id = '00000000-0000-4000-8000-0000000000a4';

select is(
  pg_temp.try_as(:TX, format($$update public.assignments set group_id = 'a0000000-0000-4000-8000-0000000000f2' where id = %L$$, :SEL)),
  '23514', 'homework with recipients cannot move to another group (its recipients would not be in it)');

-- ── teacher Y (another group) ─────────────────────────────────────────────
select is(
  pg_temp.try_as(:TY, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :SEL, :SA)),
  '42501', 'teacher Y cannot add recipients to group X''s homework');
select is(
  pg_temp.try_as(:TY, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :SEL, :SC)),
  '42501', 'and is refused before learning anything about who is enrolled in group X');
select is(
  pg_temp.scalar_as(:TY, format('select count(*) from public.assignment_recipients where assignment_id = %L', :SEL)),
  0::bigint, 'nor see who they are');
select is(
  pg_temp.scalar_as(:TY, format('with d as (delete from public.assignment_recipients where assignment_id = %L returning 1) select count(*) from d', :SEL)),
  0::bigint, 'nor remove them');

-- ── the office ────────────────────────────────────────────────────────────
select is(
  pg_temp.try_as(:OF, format($$insert into public.assignments (id, group_id, course_id, activity_id, audience, assigned_by)
    values (%L, 'a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000002', 'selected', '00000000-0000-4000-8000-0000000000e1')$$, :OFS), 'aal2'),
  'ok', 'the office gives homework to selected students of group X');
select is(
  pg_temp.scalar_as(:OF, $$select count(*) from public.enrollments where group_id = 'a0000000-0000-4000-8000-000000000001'$$, 'aal2'),
  3::bigint, 'the office reads the students of the group to choose from');
select is(
  pg_temp.try_as(:OF, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :OFS, :SA), 'aal2'),
  'ok', 'and chooses student A');
select is(
  pg_temp.try_as(:OF, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :OFS, :SC), 'aal2'),
  '23514', 'but not student C, who is not in group X');
select is(
  pg_temp.try_as(:OF, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :OFS, :SD)),
  '42501', 'not without MFA');
select is(
  pg_temp.scalar_as(:OF, $$select count(*) from public.enrollments$$),
  0::bigint, 'and without MFA it reads no enrolments');
select is(
  pg_temp.try_as(:OF, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :SEL, :SD), 'aal2'),
  '42501', 'the office cannot add recipients to a teacher''s homework');
select is(
  pg_temp.scalar_as(:OF, format('with d as (delete from public.assignment_recipients where assignment_id = %L returning 1) select count(*) from d', :SEL), 'aal2'),
  0::bigint, 'nor remove them');
select is(
  pg_temp.scalar_as(:OF, format('select count(*) from public.assignment_recipients where assignment_id in (%L, %L)', :SEL, :OFS), 'aal2'),
  1::bigint, 'it sees the recipients of its own homework only');
select is(
  pg_temp.scalar_as(:TX, format('select count(*) from public.assignment_recipients where assignment_id = %L', :OFS)),
  1::bigint, 'teacher X sees who the office chose in their group');

-- ── students ──────────────────────────────────────────────────────────────
select is(
  pg_temp.scalar_as(:B, format('select count(*) from public.assignments where id = %L', :SEL)),
  1::bigint, 'student B, a recipient, sees the homework');
select is(
  pg_temp.scalar_as(:B, format('select count(*) from public.activities where id = %L', :EX)),
  1::bigint, 'and the exercise given through it');
select is(
  pg_temp.scalar_as(:B, format('select count(*) from public.activity_items where id = %L', :ITEM)),
  1::bigint, 'and its question');
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.assignments where id = %L', :SEL)),
  0::bigint, 'student A, same group but not chosen, does not see it');
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.activities where id = %L', :EX)),
  0::bigint, 'nor the exercise given only through it');
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.activity_items where id = %L', :ITEM)),
  0::bigint, 'nor its question, even by id');
select is(
  pg_temp.scalar_as(:D, format('select count(*) from public.assignments where id in (%L, %L)', :SEL, :OFS)),
  0::bigint, 'student D, chosen for neither, sees neither');
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.assignments where id = %L', :OFS)),
  1::bigint, 'student A sees the office''s homework they were chosen for');
select is(
  pg_temp.scalar_as(:A, $$select count(*) from public.assignment_recipients$$),
  1::bigint, 'a student sees only their own recipient rows, never who else was chosen');
select is(
  pg_temp.scalar_as(:C, format('select count(*) from public.assignments where id in (%L, %L, %L)', :SEL, :ALL, :OFS)),
  0::bigint, 'student C (another group) sees none of group X''s homework');
select is(
  pg_temp.try_as(:A, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :SEL, :SA)),
  '42501', 'student A cannot add themselves to the homework');
select is(
  pg_temp.try_as(:D, format('insert into public.assignment_recipients (assignment_id, student_id) values (%L, %L)', :OFS, :SD)),
  '42501', 'nor can student D to the office''s');
select is(
  pg_temp.scalar_as(:B, format('with d as (delete from public.assignment_recipients where assignment_id = %L returning 1) select count(*) from d', :SEL)),
  0::bigint, 'and student B cannot remove themselves');

select * from finish();
rollback;
