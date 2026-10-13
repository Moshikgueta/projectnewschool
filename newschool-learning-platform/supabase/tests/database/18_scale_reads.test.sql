-- Reads that stay complete at school scale (migration 20261013002300,
-- docs/PERFORMANCE.md §8): the group page's summaries computed by the
-- database (group_item_first_tries, group_student_stats), the office's
-- searchable student list (office_students with contact details) and package
-- balances with what is left. None of them shows anyone more than they could
-- read before: each is compared with the same summary computed by the same
-- user from the tables themselves.
-- Fixtures (seed.sql): group X = students A, B, D, taught by teacher X;
-- question 80…01: A right, B and D wrong with the same answer at first.
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

create function pg_temp.text_as(p_email text, p_sql text, p_aal text default 'aal1')
returns text language plpgsql as $$
declare v_id uuid; v_t text;
begin
  select id into strict v_id from auth.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated', 'aal', p_aal, 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v_t;
  perform set_config('role', 'postgres', true);
  return v_t;
end;
$$;

-- What a user reads through the views, minus what the same user computes from
-- the tables (in both directions): 0 means identical.
create function pg_temp.stats_diff(p_email text, p_aal text default 'aal1') returns bigint
language sql as $$
  select pg_temp.scalar_as(p_email, $q$
    with v as (
      select group_id, student_id, answers, correct, last_active_at, attended, counted
        from public.group_student_stats
    ), t as (
      select e.group_id, e.student_id,
             (select count(*)::int from public.responses r
               where r.user_id = e.student_id and r.course_id = g.course_id
                 and r.try_no = 1 and r.is_correct is not null) as answers,
             (select count(*)::int from public.responses r
               where r.user_id = e.student_id and r.course_id = g.course_id
                 and r.try_no = 1 and r.is_correct) as correct,
             (select max(ev.occurred_at) from public.learning_events ev
               where ev.user_id = e.student_id and ev.course_id = g.course_id
                 and ev.type <> 'login') as last_active_at,
             (select count(*)::int from public.attendance a join public.group_sessions s on s.id = a.session_id
               where a.student_id = e.student_id and s.group_id = e.group_id
                 and a.status in ('present', 'late')) as attended,
             (select count(*)::int from public.attendance a join public.group_sessions s on s.id = a.session_id
               where a.student_id = e.student_id and s.group_id = e.group_id
                 and a.status <> 'excused') as counted
        from public.enrollments e join public.groups g on g.id = e.group_id
    )
    select (select count(*) from (select * from v except select * from t) x)
         + (select count(*) from (select * from t where group_id in (select group_id from v)
                                   except select * from v) y)
  $q$, p_aal);
$$;

-- The same for first encounters, computed another way (row_number instead of
-- distinct on; no restriction to the group's teachers, so a non-zero result
-- for a user who sees nothing through the view only counts the second half).
create function pg_temp.first_tries_diff(p_email text, p_aal text default 'aal1') returns bigint
language sql as $$
  select pg_temp.scalar_as(p_email, $q$
    with firsts as (
      select e.group_id, r.item_id, r.user_id, r.is_correct, r.answer, r.created_at,
             row_number() over (partition by e.group_id, r.item_id, r.user_id
                                order by r.created_at, r.id) as n
        from public.enrollments e
        join public.groups g on g.id = e.group_id
        join public.responses r on r.user_id = e.student_id and r.course_id = g.course_id
       where r.try_no = 1 and r.is_correct is not null
    ), t as (
      select group_id, item_id, count(*)::int as students,
             (count(*) filter (where not is_correct))::int as wrong
        from firsts where n = 1 group by group_id, item_id
    ), v as (
      select group_id, item_id, students, wrong from public.group_item_first_tries
    )
    select (select count(*) from (select * from v except select * from t) x)
         + (select count(*) from (select * from t where group_id in (select group_id from v)
                                   except select * from v) y)
  $q$, p_aal);
$$;

\set A '''student.a@example.com'''
\set TX '''teacher.x@example.com'''
\set TY '''teacher.y@example.com'''
\set PM '''manager@example.com'''
\set OF '''office@example.com'''
\set AD '''admin@example.com'''
\set GX '''a0000000-0000-4000-8000-000000000001'''
\set GY '''a0000000-0000-4000-8000-000000000002'''
\set ITEM '''80000000-0000-4000-8000-000000000001'''

-- ── how the views are built ────────────────────────────────────────────────
select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('group_item_first_tries', 'group_student_stats', 'package_balances')
      and 'security_invoker=true' = any (c.reloptions)),
  array['group_item_first_tries', 'group_student_stats', 'package_balances'],
  'the summary views run with the caller''s own rights (security_invoker)');
select ok(
  (select 'security_barrier=true' = any (reloptions) from pg_class where oid = 'public.office_students'::regclass),
  'office_students is still a security barrier view');
select is(
  (select array_agg(v order by v) from unnest(array['group_item_first_tries', 'group_student_stats',
     'office_students', 'package_balances']) v
    where has_table_privilege('anon', format('public.%I', v), 'SELECT')),
  null, 'anonymous visitors cannot read any of them');
select is(
  (select array_agg(v || ':' || p order by v, p)
     from unnest(array['group_item_first_tries', 'group_student_stats', 'office_students', 'package_balances']) v,
          unnest(array['INSERT', 'UPDATE', 'DELETE']) p
    where has_table_privilege('authenticated', format('public.%I', v), p)),
  null, 'signed-in users can only read them');
select is(
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace),
  0::bigint, 'still no functions in public (nothing callable as RPC)');

-- ── group summaries: who sees what ─────────────────────────────────────────
select is(pg_temp.scalar_as(:TX, format('select count(*) from public.group_student_stats where group_id = %L', :GX)),
  3::bigint, 'teacher X sees one row per student of group X');
select is(pg_temp.text_as(:TX, format(
    $$select students || '/' || wrong || ' ' || common_wrong_answer::text || ' x' || common_wrong_count
        from public.group_item_first_tries where group_id = %L and item_id = %L$$, :GX, :ITEM)),
  '3/2 {"optionIds": ["o2"]} x2',
  'teacher X: question 1 answered by 3, wrong for 2, both with the same answer');
select is(pg_temp.text_as(:TX, format(
    $$select answers || '/' || correct || ' ' || attended || '/' || counted
        from public.group_student_stats where group_id = %L and student_id = '00000000-0000-4000-8000-0000000000a4'$$, :GX)),
  '1/0 0/1', 'teacher X: student D answered once (wrong) and missed the one class marked');
select is(pg_temp.scalar_as(:TX, format('select count(*) from public.group_student_stats where group_id = %L', :GY)),
  0::bigint, 'teacher X sees nothing of group Y');

select is(pg_temp.scalar_as(:TY, format('select count(*) from public.group_student_stats where group_id = %L', :GX)),
  0::bigint, 'teacher Y (another group) sees no student of group X');
select is(pg_temp.scalar_as(:TY, format('select count(*) from public.group_item_first_tries where group_id = %L', :GX)),
  0::bigint, 'teacher Y sees no question results of group X');
select is(pg_temp.scalar_as(:TY, format('select count(*) from public.group_student_stats where group_id = %L', :GY)),
  2::bigint, 'teacher Y sees their own group');

select is(pg_temp.scalar_as(:A, 'select count(*) from public.group_student_stats'),
  0::bigint, 'a student sees no student summary, not even their own group''s');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.group_item_first_tries'),
  0::bigint, 'a student sees no question results');
select is(pg_temp.scalar_as(:OF, 'select count(*) from public.group_student_stats', 'aal2'),
  0::bigint, 'the office (with MFA) sees no student summary');
select is(pg_temp.scalar_as(:OF, 'select count(*) from public.group_item_first_tries', 'aal2'),
  0::bigint, 'the office (with MFA) sees no question results');
select is(pg_temp.scalar_as(:OF, 'select count(*) from public.group_student_stats'),
  0::bigint, 'the office without MFA sees nothing either');
select is(pg_temp.scalar_as(:AD, 'select count(*) from public.group_student_stats', 'aal2'),
  0::bigint, 'the admin sees no learning data');
select is(pg_temp.scalar_as(:PM, format('select count(*) from public.group_student_stats where group_id = %L', :GX), 'aal2'),
  3::bigint, 'the manager with MFA sees every group');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.group_item_first_tries'),
  0::bigint, 'the manager without MFA sees nothing');

-- ── group summaries: the same numbers as the tables give the same user ────
select is(pg_temp.stats_diff(:TX), 0::bigint, 'teacher X: student summaries = their own count from the tables');
select is(pg_temp.stats_diff(:TY), 0::bigint, 'teacher Y: student summaries = their own count from the tables');
select is(pg_temp.stats_diff(:PM, 'aal2'), 0::bigint, 'manager: student summaries = their own count from the tables');
select is(pg_temp.first_tries_diff(:TX), 0::bigint, 'teacher X: question results = their own count from the tables');
select is(pg_temp.first_tries_diff(:TY), 0::bigint, 'teacher Y: question results = their own count from the tables');
select is(pg_temp.first_tries_diff(:PM, 'aal2'), 0::bigint, 'manager: question results = their own count from the tables');

-- A later, correct first try in a new attempt does not hide the first encounter.
insert into public.attempts (id, user_id, activity_id, course_id, attempt_no, status)
values ('c0000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a2',
        '70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 9, 'submitted');
insert into public.responses (attempt_id, user_id, course_id, item_id, answer, is_correct, score, try_no, created_at)
values ('c0000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a2',
        '30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001',
        '{"optionIds":["o1"]}', true, 1, 1, now() + interval '1 day');
select is(pg_temp.text_as(:TX, format(
    $$select students || '/' || wrong from public.group_item_first_tries where group_id = %L and item_id = %L$$, :GX, :ITEM)),
  '3/2', 'practising again later does not change the first encounter');
select is(pg_temp.text_as(:TX, format(
    $$select answers || '/' || correct from public.group_student_stats
       where group_id = %L and student_id = '00000000-0000-4000-8000-0000000000a2'$$, :GX)),
  '2/1', 'but accuracy counts every first try');

-- ── the office's student list ──────────────────────────────────────────────
select is(pg_temp.scalar_as(:OF, 'select count(*) from public.office_students', 'aal2'),
  (select count(*) from public.user_roles where role = 'student'),
  'the office (MFA) still sees every student, once');
select is(pg_temp.text_as(:OF,
    $$select phone || ' ' || contact_email || ' ' || (search_text like '%0527654321%')::text
             || ' ' || (search_text like '%maya.family%')::text || ' ' || (search_text = lower(search_text))::text
        from public.office_students where id = '00000000-0000-4000-8000-0000000000a2'$$, 'aal2'),
  '052-7654321 maya.family@example.com true true true',
  'with the contact details the list shows, and a lower-case search text (phone digits included)');
select is(pg_temp.scalar_as(:OF,
    $$select count(*) from public.office_students o join public.student_records r on r.student_id = o.id
       where o.phone <> r.phone or o.contact_email <> r.contact_email$$, 'aal2'),
  0::bigint, 'the same contact details the office reads from student_records');
select is(pg_temp.scalar_as(:AD, 'select count(*) from public.office_students', 'aal2'),
  (select count(*) from public.user_roles where role = 'student'), 'admins (MFA) as before');
select is(pg_temp.scalar_as(:OF, 'select count(*) from public.office_students'),
  0::bigint, 'the office without MFA sees no student');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.office_students'),
  0::bigint, 'teachers see no student here');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.office_students', 'aal2'),
  0::bigint, 'nor does the manager (as before)');
select is(pg_temp.scalar_as(:A, $$select count(*) from public.office_students where phone <> ''$$),
  0::bigint, 'nor a student, even their own phone');

-- ── package balances ───────────────────────────────────────────────────────
select is(pg_temp.scalar_as(:OF,
    'select count(*) from public.package_balances where lessons_left <> lessons - used or unbooked <> lessons - used - booked',
    'aal2'),
  0::bigint, 'lessons left and unbooked follow from the row');
select is(pg_temp.text_as(:OF,
    $$select used || '/' || booked || ' left ' || lessons_left || ', ' || unbooked || ' to book'
        from public.package_balances where package_id = 'd0000000-0000-4000-8000-000000000001'$$, 'aal2'),
  '2/1 left 8, 7 to book', 'student A''s package: 2 used, 1 booked');
select is(pg_temp.scalar_as(:OF, 'select count(*) from public.package_balances', 'aal2'),
  (select count(*) from public.lesson_packages), 'the office sees every package, as before');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.package_balances'),
  1::bigint, 'a student sees only their own package');

select * from finish();
rollback;
