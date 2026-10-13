-- Proof that migration 20261013002200_rls_performance changed no policy's
-- meaning (docs/PERFORMANCE.md). LOCAL ONLY; changes nothing (one transaction,
-- rolled back).
--
-- For each test user (students, teachers, the office and the manager with and
-- without MFA, the admin) and every table and view in `public`, it records how
-- many rows the user sees and an order-insensitive checksum of them under the
-- policies now in place; then, inside the same transaction, puts back the
-- policy expressions as they were before the migration (verbatim from
-- pg_policies) and records the same again. Any difference is listed.
--
-- The seven large learner tables are compared over a sample of students
-- (every student of two teachers' groups, perf students 1–100 and the seed
-- students), because under the old policies a full scan of 3 million
-- responses per user takes minutes; that slowness is what the migration fixes.
--
-- Run after `pnpm db:reset` (seed only) or on top of scripts/perf/seed-scale.sql:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f scripts/perf/policy-equivalence.sql
-- Expect: "different = 0".

\set ON_ERROR_STOP 1
\set QUIET 1
begin;
set local statement_timeout = 0;
create temp table v_users (email text, aal text);
insert into v_users values
 ('perf.student.8@example.com','aal1'),('perf.student.1@example.com','aal1'),('student.a@example.com','aal1'),('student.b@example.com','aal1'),
 ('perf.teacher.1@example.com','aal1'),('perf.teacher.103@example.com','aal1'),('teacher.x@example.com','aal1'),('teacher.y@example.com','aal1'),
 ('perf.office.1@example.com','aal2'),('office@example.com','aal2'),('office@example.com','aal1'),
 ('manager@example.com','aal2'),('manager@example.com','aal1'),('admin@example.com','aal2');
create temp table v_rel as
select c.relname::text as rel from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','v') order by 1;
create temp table v_sample as
select distinct e.student_id as id from public.enrollments e
join public.group_teachers gt on gt.group_id = e.group_id
join auth.users u on u.id = gt.teacher_id
where u.email in ('perf.teacher.1@example.com','perf.teacher.103@example.com')
union select id from auth.users where email ~ '^perf\.student\.([0-9]|[1-9][0-9]|100)@' or email like 'student._@example.com';
create temp table v_sample_arr as select array_agg(id) as ids from v_sample;
grant select on v_sample_arr to authenticated;
create temp table v_out (phase text, email text, aal text, rel text, n bigint, h numeric, err text);
create function pg_temp.snap(p_phase text) returns void language plpgsql as $$
declare u record; r record; v_id uuid; v_n bigint; v_h numeric; v_err text;
begin
  for u in select v.* from v_users v where exists (select 1 from auth.users x where x.email = v.email) loop
    select id into strict v_id from auth.users where email = u.email;
    for r in select rel from v_rel loop
      v_err := null; v_n := null; v_h := null;
      perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role','authenticated','aal',u.aal,'email',u.email)::text, true);
      perform set_config('role','authenticated',true);
      begin
        execute format('select count(*), coalesce(sum(hashtextextended(t::text, 0)::numeric), 0) from public.%I t %s', r.rel,
          case when r.rel in ('responses','attempts','section_progress','vocab_review_state','block_responses','learning_events')
                 then 'where t.user_id = any ((select ids from v_sample_arr))'
               when r.rel = 'attendance' then 'where t.student_id = any ((select ids from v_sample_arr))'
               else '' end) into v_n, v_h;
      exception when others then v_err := sqlstate;
      end;
      perform set_config('role','postgres',true);
      insert into v_out values (p_phase, u.email, u.aal, r.rel, v_n, v_h, v_err);
    end loop;
  end loop;
end $$;
select pg_temp.snap('new') \g /dev/null
-- The policies as they were before 20261013002200_rls_performance.
alter policy courses_select on public.courses using (app.can_read_course(id));
alter policy courses_select_office on public.courses using (((status = 'published'::content_status) AND app.is_office()));
alter policy cycles_select on public.cycles using ((( SELECT app.is_manager() AS is_manager) OR ((status = 'published'::content_status) AND app.can_read_course(course_id))));
alter policy cycles_select_office on public.cycles using (((status = 'published'::content_status) AND app.is_office()));
alter policy books_select on public.books using (app.can_read_course(course_id));
alter policy media_assets_select on public.media_assets using (((course_id IS NULL) OR app.can_read_course(course_id)));
alter policy section_teacher_notes_select on public.section_teacher_notes using ((( SELECT app.is_manager() AS is_manager) OR (app.teaches_course(course_id) AND (EXISTS ( SELECT 1
   FROM book_sections s
  WHERE (s.id = section_teacher_notes.section_id))))));
alter policy activity_item_keys_select on public.activity_item_keys using ((( SELECT app.is_manager() AS is_manager) OR (app.teaches_course(course_id) AND (EXISTS ( SELECT 1
   FROM activity_items i
  WHERE (i.id = activity_item_keys.item_id))))));
alter policy groups_select on public.groups using ((app.is_group_member(id) OR app.teaches_group(id) OR ( SELECT app.is_manager() AS is_manager) OR ( SELECT app.is_admin() AS is_admin)));
alter policy groups_select_office on public.groups using (app.is_office());
alter policy group_teachers_select on public.group_teachers using ((app.teaches_group(group_id) OR app.is_group_member(group_id) OR ( SELECT app.is_manager() AS is_manager) OR ( SELECT app.is_admin() AS is_admin)));
alter policy enrollments_select on public.enrollments using (((student_id = ( SELECT auth.uid() AS uid)) OR app.teaches_group(group_id) OR ( SELECT app.is_manager() AS is_manager) OR ( SELECT app.is_admin() AS is_admin)));
alter policy enrollments_select_office on public.enrollments using (app.is_office());
alter policy group_cycles_select on public.group_cycles using ((app.is_group_member(group_id) OR app.teaches_group(group_id) OR ( SELECT app.is_manager() AS is_manager)));
alter policy group_cycles_write on public.group_cycles using ((app.teaches_group(group_id) OR ( SELECT app.is_manager() AS is_manager))) with check ((app.teaches_group(group_id) OR ( SELECT app.is_manager() AS is_manager)));
alter policy group_sessions_select on public.group_sessions using ((app.is_group_member(group_id) OR app.teaches_group(group_id) OR ( SELECT app.is_manager() AS is_manager)));
alter policy group_sessions_write on public.group_sessions using ((app.teaches_group(group_id) OR ( SELECT app.is_manager() AS is_manager))) with check ((app.teaches_group(group_id) OR ( SELECT app.is_manager() AS is_manager)));
alter policy assignments_select on public.assignments using ((app.teaches_group(group_id) OR ( SELECT app.is_manager() AS is_manager) OR (app.is_group_member(group_id) AND ((audience = 'group'::assignment_audience) OR app.is_assignment_recipient(id)))));
alter policy assignments_select_office on public.assignments using (app.is_office());
alter policy assignment_recipients_select on public.assignment_recipients using (((student_id = ( SELECT auth.uid() AS uid)) OR app.teaches_assignment(assignment_id) OR ( SELECT app.is_manager() AS is_manager)));
alter policy assignment_recipients_write on public.assignment_recipients using ((app.teaches_assignment(assignment_id) OR ( SELECT app.is_manager() AS is_manager))) with check ((app.teaches_assignment(assignment_id) OR ( SELECT app.is_manager() AS is_manager)));
alter policy assignment_recipients_select_office on public.assignment_recipients using (app.office_owns_assignment(assignment_id));
alter policy attempts_select on public.attempts using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT app.is_manager() AS is_manager) OR app.teaches_student_in_course(user_id, course_id)));
alter policy responses_select on public.responses using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT app.is_manager() AS is_manager) OR app.teaches_student_in_course(user_id, course_id)));
alter policy section_progress_select on public.section_progress using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT app.is_manager() AS is_manager) OR app.teaches_student_in_course(user_id, course_id)));
alter policy vocab_review_state_select on public.vocab_review_state using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT app.is_manager() AS is_manager) OR app.teaches_student_in_course(user_id, course_id)));
alter policy block_responses_select on public.block_responses using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT app.is_manager() AS is_manager) OR app.teaches_student_in_course(user_id, course_id)));
alter policy learning_events_select on public.learning_events using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT app.is_manager() AS is_manager) OR ((course_id IS NOT NULL) AND app.teaches_student_in_course(user_id, course_id))));
alter policy attendance_select on public.attendance using (((student_id = ( SELECT auth.uid() AS uid)) OR app.teaches_group(app.session_group(session_id)) OR ( SELECT app.is_manager() AS is_manager)));
alter policy content_reports_select on public.content_reports using (((reporter_id = ( SELECT auth.uid() AS uid)) OR ( SELECT app.is_manager() AS is_manager) OR app.teaches_course(course_id)));
alter policy profiles_select on public.profiles using (((id = ( SELECT auth.uid() AS uid)) OR app.teaches_student(id) OR app.is_my_teacher(id) OR ( SELECT app.is_manager() AS is_manager) OR ( SELECT app.is_admin() AS is_admin)));
alter policy profiles_select_office on public.profiles using ((app.is_office() AND app.is_student_or_teacher(id)));
alter policy profiles_select_private on public.profiles using ((app.teaches_privately(id) OR app.is_my_private_teacher(id)));
alter policy student_records_select on public.student_records using (((student_id = ( SELECT auth.uid() AS uid)) OR app.is_office() OR ( SELECT app.is_admin() AS is_admin) OR ( SELECT app.is_manager() AS is_manager)));
alter policy student_records_write on public.student_records using ((app.is_office() OR ( SELECT app.is_admin() AS is_admin))) with check ((app.is_office() OR ( SELECT app.is_admin() AS is_admin)));
alter policy lesson_packages_select on public.lesson_packages using (((student_id = ( SELECT auth.uid() AS uid)) OR app.is_office() OR ( SELECT app.is_admin() AS is_admin) OR ( SELECT app.is_manager() AS is_manager)));
alter policy lesson_packages_write on public.lesson_packages using ((app.is_office() OR ( SELECT app.is_admin() AS is_admin))) with check ((app.is_office() OR ( SELECT app.is_admin() AS is_admin)));
alter policy private_lessons_select on public.private_lessons using (((student_id = ( SELECT auth.uid() AS uid)) OR (teacher_id = ( SELECT auth.uid() AS uid)) OR app.is_office() OR ( SELECT app.is_admin() AS is_admin) OR ( SELECT app.is_manager() AS is_manager)));
alter policy private_lessons_write on public.private_lessons using ((app.is_office() OR ( SELECT app.is_admin() AS is_admin))) with check ((app.is_office() OR ( SELECT app.is_admin() AS is_admin)));
alter policy rooms_select on public.rooms using (app.is_staff());
alter policy rooms_write on public.rooms using ((app.is_office() OR ( SELECT app.is_admin() AS is_admin))) with check ((app.is_office() OR ( SELECT app.is_admin() AS is_admin)));
alter policy room_bookings_select on public.room_bookings using (app.is_staff());
alter policy staff_resources_select on public.staff_resources using (app.is_staff());
select pg_temp.snap('old') \g /dev/null
select count(*) as compared,
       count(*) filter (where o.n is distinct from n.n or o.h is distinct from n.h or o.err is distinct from n.err) as different
from v_out o join v_out n on n.phase='new' and o.phase='old' and n.email=o.email and n.aal=o.aal and n.rel=o.rel;
select o.email, o.aal, o.rel, o.n old_n, n.n new_n, o.err, n.err
from v_out o join v_out n on n.phase='new' and o.phase='old' and n.email=o.email and n.aal=o.aal and n.rel=o.rel
where o.n is distinct from n.n or o.h is distinct from n.h or o.err is distinct from n.err;
select o.email, o.aal, sum(o.n) rows_visible, count(*) filter (where o.err is not null) denied
from v_out o where o.phase='new' group by 1,2 order by 1,2;
rollback;
