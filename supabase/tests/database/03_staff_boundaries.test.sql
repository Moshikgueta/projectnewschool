-- Teachers see only their own groups and those students' work in that course;
-- manager and admin powers require MFA and stay separate; the audit log and
-- the last-admin rule hold. Fixtures: supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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

\set TX '''teacher.x@example.com'''
\set TY '''teacher.y@example.com'''
\set M '''manager@example.com'''
\set ADM '''admin@example.com'''

-- ── teacher X (Spanish groups X and W) ──────────────────────────────────────
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.groups'), 2::bigint,
  'teacher X sees only the two groups they teach');
select is(pg_temp.scalar_as(:TX, $$select count(*) from public.groups where id = 'a0000000-0000-4000-8000-000000000002'$$), 0::bigint,
  'teacher X cannot see group Y');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.attempts'), 2::bigint,
  'teacher X sees the Spanish attempts of students A and B');
select is(pg_temp.scalar_as(:TX, $$select count(*) from public.attempts where id = 'c0000000-0000-4000-8000-000000000003'$$), 0::bigint,
  'teacher X cannot see student B''s attempt in a different course (French)');
select is(pg_temp.scalar_as(:TX, $$select count(*) from public.profiles where id = '00000000-0000-4000-8000-0000000000a3'$$), 0::bigint,
  'teacher X cannot see a student who is not in their groups');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.activity_item_keys'), 1::bigint,
  'teacher X reads answer keys of the course they teach only');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.section_teacher_notes'), 1::bigint,
  'teacher X reads teacher notes of the course they teach');
select is(
  pg_temp.try_as(:TX, $$update public.group_cycles set state = 'completed' where group_id = 'a0000000-0000-4000-8000-000000000001'$$),
  'ok', 'teacher X can change the active cycle of their own group');
select is(
  pg_temp.scalar_as(:TX, $$with u as (update public.group_cycles set state = 'completed' where group_id = 'a0000000-0000-4000-8000-000000000002' returning 1) select count(*) from u$$),
  0::bigint, 'teacher X cannot change the cycles of group Y');
select is(
  pg_temp.try_as(:TX, $$insert into public.assignments (group_id, course_id, activity_id, assigned_by)
    values ('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1')$$),
  'ok', 'teacher X can assign an activity to their own group');
select is(
  pg_temp.try_as(:TX, $$insert into public.assignments (group_id, course_id, activity_id, assigned_by)
    values ('a0000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
            '70000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000b1')$$),
  '42501', 'teacher X cannot assign work to group Y');
select is(
  pg_temp.try_as(:TX, $$insert into public.enrollments (group_id, student_id) values ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3')$$),
  '42501', 'teachers cannot enroll students');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.audit_log'), 0::bigint,
  'teachers cannot read the audit log');

-- ── teacher Y (French group Y) ──────────────────────────────────────────────
select is(pg_temp.scalar_as(:TY, 'select count(*) from public.attempts'), 2::bigint,
  'teacher Y sees only French attempts (students B and C)');
select is(pg_temp.scalar_as(:TY, $$select count(*) from public.enrollments where group_id = 'a0000000-0000-4000-8000-000000000001'$$), 0::bigint,
  'teacher Y cannot see who is enrolled in group X');

-- ── pedagogical manager: powers need MFA ────────────────────────────────────
select is(pg_temp.scalar_as(:M, 'select count(*) from public.courses', 'aal1'), 0::bigint,
  'manager without MFA sees no courses');
select is(
  pg_temp.try_as(:M, $$insert into public.cycles (course_id, slug, title) values ('30000000-0000-4000-8000-000000000001', 'viajar', 'Travel')$$, 'aal1'),
  '42501', 'manager without MFA cannot edit content');
select is(pg_temp.scalar_as(:M, 'select count(*) from public.courses', 'aal2'), 3::bigint,
  'manager with MFA sees every course, including drafts');
select is(pg_temp.scalar_as(:M, 'select count(*) from public.attempts', 'aal2'), 4::bigint,
  'manager with MFA sees learner work across the school');
select is(
  pg_temp.try_as(:M, $$insert into public.cycles (course_id, slug, title) values ('30000000-0000-4000-8000-000000000001', 'viajar', 'Travel')$$, 'aal2'),
  'ok', 'manager with MFA can add a cycle');
select is(
  pg_temp.try_as(:M, $$insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-0000000000a3', 'teacher')$$, 'aal2'),
  '42501', 'managers cannot grant roles (admin only)');

-- ── admin: accounts, not learning data ──────────────────────────────────────
select is(pg_temp.scalar_as(:ADM, 'select count(*) from public.audit_log', 'aal1'), 0::bigint,
  'admin without MFA cannot read the audit log');
select cmp_ok(pg_temp.scalar_as(:ADM, 'select count(*) from public.audit_log', 'aal2'), '>', 0::bigint,
  'admin with MFA reads the audit log');
select is(pg_temp.scalar_as(:ADM, 'select count(*) from public.attempts', 'aal2'), 0::bigint,
  'admin role alone gives no access to learner work');
select is(
  pg_temp.try_as(:ADM, $$insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-0000000000a3', 'teacher')$$, 'aal2'),
  'ok', 'admin with MFA can grant a role');
select is(
  pg_temp.try_as(:ADM, $$delete from public.user_roles where user_id = '00000000-0000-4000-8000-0000000000d1' and role = 'admin'$$, 'aal2'),
  '23514', 'the last admin cannot lose the admin role');

-- ── audit log is append-only, even for the database owner ──────────────────
select throws_ok('delete from public.audit_log', '42501', 'audit_log is append-only',
  'nobody can delete audit entries');

select * from finish();
rollback;
