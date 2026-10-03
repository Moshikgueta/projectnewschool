-- "A logged-in student must never be able to read or change another student's
-- data." These run as the real `authenticated` role with a student's JWT
-- claims — exactly what a student holding their own token can reach through
-- the API. Fixtures: supabase/seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Runs p_sql as p_email (or anonymously when p_email is null) and returns its
-- single bigint result. RLS and grants apply exactly as for an API call.
create function pg_temp.scalar_as(p_email text, p_sql text, p_aal text default 'aal1')
returns bigint language plpgsql as $$
declare v_id uuid; v_n bigint;
begin
  if p_email is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    perform set_config('role', 'anon', true);
  else
    select id into strict v_id from auth.users where email = p_email;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_id, 'role', 'authenticated', 'aal', p_aal, 'email', p_email)::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  execute p_sql into v_n;
  perform set_config('role', 'postgres', true);
  return v_n;
end;
$$;

-- Same, but returns 'ok' or the SQLSTATE the statement failed with.
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

-- ── reading other students' learner data ────────────────────────────────────
select is(pg_temp.scalar_as(:A, 'select count(*) from public.attempts'), 1::bigint,
  'student A sees exactly one attempt (their own)');
select is(pg_temp.scalar_as(:A, $$select count(*) from public.attempts where id = 'c0000000-0000-4000-8000-000000000002'$$), 0::bigint,
  'student A cannot read student B''s attempt even by its id');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.attempts where user_id <> ''00000000-0000-4000-8000-0000000000a1''::uuid'), 0::bigint,
  'student A sees no attempt that belongs to someone else');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.responses where user_id <> ''00000000-0000-4000-8000-0000000000a1''::uuid'), 0::bigint,
  'student A sees no one else''s answers');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.section_progress where user_id <> ''00000000-0000-4000-8000-0000000000a1''::uuid'), 0::bigint,
  'student A sees no one else''s notebook progress');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.vocab_review_state where user_id <> ''00000000-0000-4000-8000-0000000000a1''::uuid'), 0::bigint,
  'student A sees no one else''s vocabulary reviews');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.learning_events where user_id <> ''00000000-0000-4000-8000-0000000000a1''::uuid'), 0::bigint,
  'student A sees no one else''s learning events');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.recommendation_feedback where user_id <> ''00000000-0000-4000-8000-0000000000a1''::uuid'), 0::bigint,
  'student A sees no one else''s recommendation feedback');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.enrollments where student_id <> ''00000000-0000-4000-8000-0000000000a1''::uuid'), 0::bigint,
  'student A cannot list classmates through enrollments');
select is(pg_temp.scalar_as(:A, $$select count(*) from public.profiles where id = '00000000-0000-4000-8000-0000000000a2'$$), 0::bigint,
  'student A cannot read classmate B''s profile');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.profiles'), 2::bigint,
  'student A sees only their own profile and their teacher''s');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.user_roles'), 1::bigint,
  'student A sees only their own role');

-- ── content they are not entitled to ───────────────────────────────────────
select is(pg_temp.scalar_as(:A, 'select count(*) from public.activity_item_keys'), 0::bigint,
  'students can never read answer keys');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.section_teacher_notes'), 0::bigint,
  'students can never read teacher notes');
select is(pg_temp.scalar_as(:A, $$select count(*) from public.courses where slug = 'espanol-basico-pilot'$$), 1::bigint,
  'student A sees the published course they are enrolled in');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.courses'), 1::bigint,
  'student A sees no other course: not a course they are not enrolled in, not a draft course they are enrolled in');
select is(pg_temp.scalar_as(:A, $$select count(*) from public.cycles where status <> 'published' or course_id <> '30000000-0000-4000-8000-000000000001'$$), 0::bigint,
  'student A sees no draft cycle and no cycle from another or unpublished course');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.book_sections'), 2::bigint,
  'student A sees only the published sections of their course (one notebook, one workbook)');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.activities'), 2::bigint,
  'student A sees only the published activities of their course (not the draft, not other courses)');
select is(pg_temp.scalar_as(:A, $$select count(*) from public.activity_items where course_id <> '30000000-0000-4000-8000-000000000001'$$), 0::bigint,
  'student A sees no exercise items from other courses');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.assignments'), 1::bigint,
  'student A sees only the assignment for their group');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.audit_log'), 0::bigint,
  'students cannot read the audit log');

-- ── writing ────────────────────────────────────────────────────────────────
select is(
  pg_temp.try_as(:A, $$insert into public.responses (attempt_id, user_id, course_id, item_id, answer, is_correct, score)
    values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
            '30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '{}', true, 100)$$),
  '42501', 'student A cannot write a graded answer directly');
select is(
  pg_temp.try_as(:A, $$update public.attempts set score = 100 where id = 'c0000000-0000-4000-8000-000000000001'$$),
  '42501', 'student A cannot change their own score');
select is(
  pg_temp.try_as(:A, $$insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-0000000000a1', 'admin')$$),
  '42501', 'student A cannot grant themselves a role');
select is(
  pg_temp.try_as(:A, $$insert into public.enrollments (group_id, student_id) values ('a0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1')$$),
  '42501', 'student A cannot enroll themselves in another group');
select is(
  pg_temp.scalar_as(:A, $$with u as (update public.profiles set display_name = 'hacked' where id = '00000000-0000-4000-8000-0000000000a2' returning 1) select count(*) from u$$),
  0::bigint, 'student A cannot change classmate B''s profile');

-- ── anonymous visitors ─────────────────────────────────────────────────────
select throws_ok(
  $$select pg_temp.scalar_as(null, 'select count(*) from public.courses')$$,
  '42501', null, 'an anonymous visitor cannot read course content');

select * from finish();
rollback;
