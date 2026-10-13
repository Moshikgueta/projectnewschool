-- School-scale load data for the RLS performance check (docs/PERFORMANCE.md).
--
-- LOCAL ONLY. Never run against staging or production. Adds, on top of
-- supabase/seed.sql and the full content import
-- (`pnpm exec tsx scripts/content.ts import content`), a realistic school:
--
--   10,000 students · 150 teachers · 10 office users · 800 groups over the
--   18 imported courses (each student in 1–2 groups) · 30 sessions and 30
--   assignments per group (some for selected students) · ~40 attempts and
--   ~350 responses per student · reading progress, notebook answers,
--   vocabulary reviews, learning events · attendance for every past class ·
--   staff exercises · mistake reports · office records, packages, lessons ·
--   rooms and a weekly timetable.
--
-- Deterministic: every id is md5('perf:…') and every choice is a hash of the
-- row's own keys, so two runs on the same content give the same data. Times
-- are relative to the day the script runs (anchor = today 00:00 UTC), so
-- "due this week" and "last 7 days" always have rows.
--
-- One student exercise item is made "hot" on purpose: the first multiple
-- choice question of the first course is answered ~6,000 times (every
-- student of that course practised it six times), for the re-grade benchmark.
--
-- Run:   pnpm perf:seed            (psql against the local database)
-- Undo:  pnpm db:reset             (back to the normal seed)

\set ON_ERROR_STOP 1
\timing on
-- Before any temp table is touched in this session.
set temp_buffers = '1GB';

begin;
set local work_mem = '256MB';
set local maintenance_work_mem = '512MB';
set local synchronous_commit = off;

-- ── guards ──────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from public.profiles where id = md5('perf:student:1')::uuid) then
    raise exception 'scale data is already loaded; run pnpm db:reset first';
  end if;
  if (select count(*) from public.courses
       where status = 'published' and id::text not like '30000000-0000-4000-8000-%') < 18 then
    raise exception 'import the content first: pnpm exec tsx scripts/content.ts import content';
  end if;
end;
$$;

-- A non-negative 31-bit hash of a text key: the only source of "randomness".
create function pg_temp.h(p text) returns int language sql immutable as $$
  select (('x' || substr(md5(p), 1, 8))::bit(32)::int) & 2147483647
$$;

create temp table perf_anchor as select date_trunc('day', now()) as t0;

-- ── content index ───────────────────────────────────────────────────────────
create temp table perf_course as
select row_number() over (order by c.slug)::int - 1 as idx, c.id, c.title, c.slug
from public.courses c
where c.status = 'published' and c.id::text not like '30000000-0000-4000-8000-%';

create temp table perf_cycle as
select pc.idx as course_idx, y.id,
       row_number() over (partition by pc.idx order by y.position, y.slug)::int - 1 as ord
from perf_course pc join public.cycles y on y.course_id = pc.id and y.status = 'published';

create temp table perf_act as
select pc.idx as course_idx, a.id, a.cycle_id, a.scoring_mode,
       row_number() over (partition by pc.idx order by y.position, a.slug)::int - 1 as ord
from perf_course pc
join public.activities a on a.course_id = pc.id and a.status = 'published' and a.created_by is null
join public.cycles y on y.id = a.cycle_id;
create index on perf_act (course_idx, ord);
create index on perf_act (id);

create temp table perf_section as
select pc.idx as course_idx, s.id, s.cycle_id, b.kind,
       row_number() over (partition by pc.idx order by y.position, s.position, s.id)::int - 1 as ord
from perf_course pc
join public.book_sections s on s.course_id = pc.id and s.status = 'published'
join public.books b on b.id = s.book_id
join public.cycles y on y.id = s.cycle_id;
create index on perf_section (course_idx, ord);

create temp table perf_vset as
select pc.idx as course_idx, v.id,
       row_number() over (partition by pc.idx order by v.created_at, v.id)::int - 1 as ord
from perf_course pc join public.vocabulary_sets v on v.course_id = pc.id and v.status = 'published';

create temp table perf_vitem as
select pc.idx as course_idx, vi.id,
       row_number() over (partition by pc.idx order by vi.set_id, vi.position)::int - 1 as ord
from perf_course pc join public.vocabulary_items vi on vi.course_id = pc.id;

alter table perf_course add column n_act int, add column n_sec int, add column n_vset int,
  add column n_vitem int, add column n_cycle int;
update perf_course pc set
  n_act = (select count(*) from perf_act a where a.course_idx = pc.idx),
  n_sec = (select count(*) from perf_section s where s.course_idx = pc.idx),
  n_vset = (select count(*) from perf_vset s where s.course_idx = pc.idx),
  n_vitem = (select count(*) from perf_vitem s where s.course_idx = pc.idx),
  n_cycle = (select count(*) from perf_cycle s where s.course_idx = pc.idx);

-- Items with one right and some wrong answers in the grader's own shapes
-- (src/content/items.ts), so stored answers re-grade like real ones.
create temp table perf_item as
select i.activity_id, i.id as item_id, i.course_id, i.type, i.points,
       row_number() over (partition by i.activity_id order by i.position)::int - 1 as pos,
       i.type not in ('shortAnswer', 'reflection') as graded,
       case i.type
         when 'multipleChoice' then jsonb_build_object('optionIds', k.answer -> 'optionIds')
         when 'trueFalse' then jsonb_build_object('value', k.answer -> 'value')
         when 'fillBlank' then jsonb_build_object('blanks', jsonb_path_query_array(k.answer, '$.blanks[*].accept[0]'))
         when 'matching' then jsonb_build_object('pairs', k.answer -> 'pairs')
         when 'reorderSentence' then jsonb_build_object('tokenIds', coalesce((
           select jsonb_agg(t.id order by w.ord)
           from unnest(string_to_array(k.answer -> 'accept' ->> 0, ' ')) with ordinality w(word, ord)
           cross join lateral (
             select tok ->> 'id' as id from jsonb_array_elements(i.data -> 'tokens') tok
             where tok ->> 'text' = w.word limit 1) t), '[]'::jsonb))
         else jsonb_build_object('text', 'Mi respuesta / my answer')
       end as right_answer,
       case i.type
         when 'multipleChoice' then coalesce((
           select array_agg(jsonb_build_object('optionIds', jsonb_build_array(o ->> 'id')) order by o ->> 'id')
           from jsonb_array_elements(i.data -> 'options') o
           where not (k.answer -> 'optionIds') ? (o ->> 'id')), array[jsonb_build_object('optionIds', '[]'::jsonb)])
         when 'trueFalse' then array[jsonb_build_object('value', not coalesce((k.answer ->> 'value')::boolean, true))]
         when 'fillBlank' then array[jsonb_build_object('blanks', (
           select coalesce(jsonb_agg('zzz'::text), '[]'::jsonb) from jsonb_array_elements(k.answer -> 'blanks')))]
         when 'matching' then array[jsonb_build_object('pairs', (
           select coalesce(jsonb_object_agg(l, r2), '{}'::jsonb) from (
             select l, coalesce(lead(r) over (order by l), first_value(r) over (order by l)) as r2
             from jsonb_each_text(k.answer -> 'pairs') e(l, r)) s))]
         when 'reorderSentence' then array[jsonb_build_object('tokenIds', (
           select coalesce(jsonb_agg(tok -> 'id'), '[]'::jsonb) from jsonb_array_elements(i.data -> 'tokens') tok))]
         else array[jsonb_build_object('text', 'No sé')]
       end as wrong_answers,
       case i.type
         when 'multipleChoice' then coalesce((
           select array_agg('chose:' || (o ->> 'id') order by o ->> 'id')
           from jsonb_array_elements(i.data -> 'options') o
           where not (k.answer -> 'optionIds') ? (o ->> 'id')), array['chose:missing'])
         when 'reorderSentence' then array['order']
         else array['incorrect']
       end as wrong_codes
from public.activity_items i
join perf_act a on a.id = i.activity_id
left join public.activity_item_keys k on k.item_id = i.id;
create index on perf_item (activity_id);

-- The hot question: first single-answer multiple choice with 3+ options in course 0.
create temp table perf_hot as
select a.id as activity_id, it.item_id,
       (select o ->> 'id' from public.activity_items i, jsonb_array_elements(i.data -> 'options') o
         where i.id = it.item_id and not (it.right_answer -> 'optionIds') ? (o ->> 'id')
         order by o ->> 'id' limit 1) as option_x
from perf_act a
join perf_item it on it.activity_id = a.id
join public.activity_items i on i.id = it.item_id
where a.course_idx = 0 and it.type = 'multipleChoice'
  and jsonb_array_length(i.data -> 'options') >= 3
  and jsonb_array_length(it.right_answer -> 'optionIds') = 1
order by a.ord, it.pos
limit 1;

do $$ begin
  if (select count(*) from perf_hot) <> 1 then raise exception 'no hot item found'; end if;
end $$;

-- ── people ──────────────────────────────────────────────────────────────────
create temp table perf_names as
select array['Noa','Yael','Tamar','Maya','Shira','Michal','Roni','Adi','Lior','Dana','Gal','Inbar',
             'Daniel','Itai','Omer','Yonatan','Ariel','Eitan','Amit','Nadav','Tomer','Yuval','Ido','Guy',
             'Ana','Lucas','Sofia','Mateo','Camila','Pedro','Laura','Hugo','Clara','Leon','Emma','Paul',
             'Rania','Omar','Lina','Samir'] as first,
       array['Cohen','Levi','Mizrahi','Peretz','Biton','Dahan','Avraham','Friedman','Azoulay','Katz',
             'Shapiro','Ben David','Goldberg','Rosen','Klein','Weiss','Silva','Santos','Costa','Oliveira',
             'Martin','Bernard','Moreau','Garcia','Lopez','Rossi','Bianchi','Muller','Schmidt','Haddad'] as last;

create temp table perf_person as
select 'student' as kind, s as n, md5('perf:student:' || s)::uuid as id,
       'perf.student.' || s || '@example.com' as email,
       nm.first[1 + pg_temp.h('fn:' || s) % 40] || ' ' || nm.last[1 + pg_temp.h('ln:' || s) % 30] as display_name
from generate_series(1, 10000) s, perf_names nm
union all
select 'teacher', t, md5('perf:teacher:' || t)::uuid, 'perf.teacher.' || t || '@example.com',
       'Teacher ' || nm.first[1 + pg_temp.h('tfn:' || t) % 40] || ' ' || nm.last[1 + pg_temp.h('tln:' || t) % 30]
from generate_series(1, 150) t, perf_names nm
union all
select 'office', o, md5('perf:office:' || o)::uuid, 'perf.office.' || o || '@example.com', 'Office ' || o
from generate_series(1, 10) o;
create unique index on perf_person (kind, n);

-- Same local-only password as supabase/seed.sql; one hash for everyone (bcrypt is slow).
create temp table perf_pw as select extensions.crypt('Local-dev-password-1', extensions.gen_salt('bf')) as hash;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select '00000000-0000-0000-0000-000000000000', p.id, 'authenticated', 'authenticated', p.email,
       pw.hash, (select t0 from perf_anchor) - interval '200 days',
       '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', p.display_name),
       (select t0 from perf_anchor) - interval '200 days', (select t0 from perf_anchor) - interval '200 days',
       '', '', '', '', '', '', '', ''
from perf_person p, perf_pw pw;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select md5('perf:identity:' || p.id)::uuid, p.id, p.id::text,
       jsonb_build_object('sub', p.id::text, 'email', p.email, 'email_verified', true),
       'email', now(), now(), now()
from perf_person p;

insert into public.user_roles (user_id, role)
select id, kind::public.app_role from perf_person;

create temp table perf_student as
select n as s, id, 50 + pg_temp.h('ability:' || n) % 45 as ability
from perf_person where kind = 'student';
create unique index on perf_student (s);
create temp table perf_teacher as select n as t, id from perf_person where kind = 'teacher';
create unique index on perf_teacher (t);
create temp table perf_office as select n as o, id from perf_person where kind = 'office';

-- ── groups, teachers, enrolments ───────────────────────────────────────────
create temp table perf_group as
select g, md5('perf:group:' || g)::uuid as id, pc.idx as course_idx, pc.id as course_id,
       'G' || lpad(g::text, 3, '0') || ' · ' || pc.title as name,
       (select id from perf_teacher where t = (g - 1) % 150 + 1) as lead_id,
       case when g % 10 = 0 then (select id from perf_teacher where t = (g + 72) % 150 + 1) end as assistant_id
from generate_series(1, 800) g
join perf_course pc on pc.idx = (g - 1) % 18;
create unique index on perf_group (g);
create unique index on perf_group (id);

insert into public.groups (id, course_id, name, starts_on, status, schedule_note, created_at)
select id, course_id, name, ((select t0 from perf_anchor) - interval '120 days')::date,
       case when g % 40 = 0 then 'planned'::public.group_status else 'active' end,
       'Twice a week', (select t0 from perf_anchor) - interval '130 days'
from perf_group;

insert into public.group_teachers (group_id, teacher_id, role)
select id, lead_id, 'lead'::public.teacher_role from perf_group
union all
select id, assistant_id, 'assistant' from perf_group where assistant_id is not null;

create temp table perf_enr as
with pairs as (
  select s.s, s.id as student_id, (s.s - 1) % 800 + 1 as g from perf_student s
  union all
  select s.s, s.id, (s.s - 1 + 401) % 800 + 1 from perf_student s
  where pg_temp.h('second:' || s.s) % 2 = 0
)
select p.s, p.student_id, gr.g, gr.id as group_id, gr.course_idx, gr.course_id,
       case
         when pg_temp.h('st:' || p.s || ':' || p.g) % 100 < 90 then 'active'
         when pg_temp.h('st:' || p.s || ':' || p.g) % 100 < 94 then 'paused'
         when pg_temp.h('st:' || p.s || ':' || p.g) % 100 < 97 then 'completed'
         else 'withdrawn'
       end::public.enrollment_status as status
from pairs p join perf_group gr on gr.g = p.g;
create index on perf_enr (group_id);
create index on perf_enr (s);

insert into public.enrollments (id, group_id, student_id, status, started_on, created_at)
select md5('perf:enr:' || s || ':' || g)::uuid, group_id, student_id, status,
       ((select t0 from perf_anchor) - interval '120 days')::date,
       (select t0 from perf_anchor) - interval '125 days'
from perf_enr;

-- Each group is somewhere in its course: earlier cycles done, one active.
insert into public.group_cycles (group_id, cycle_id, course_id, state, position, activated_at)
select gr.id, y.id, gr.course_id,
       case
         when y.ord < pg_temp.h('gc:' || gr.g) % pc.n_cycle then 'completed'
         when y.ord = pg_temp.h('gc:' || gr.g) % pc.n_cycle then 'active'
         else 'upcoming'
       end::public.group_cycle_state,
       y.ord,
       case when y.ord <= pg_temp.h('gc:' || gr.g) % pc.n_cycle
            then (select t0 from perf_anchor) - (pg_temp.h('gc:' || gr.g) % pc.n_cycle - y.ord) * interval '10 days' end
from perf_group gr
join perf_course pc on pc.idx = gr.course_idx
join perf_cycle y on y.course_idx = gr.course_idx;

-- 30 classes per group, twice a week: 24 in the past, 6 to come.
create temp table perf_session as
select gr.g, gr.id as group_id, n,
       md5('perf:session:' || gr.g || ':' || n)::uuid as id,
       (select t0 from perf_anchor) + (n - 24) * interval '84 hours'
         + ((8 + gr.g % 12) * interval '1 hour') as starts_at
from perf_group gr, generate_series(0, 29) n;

insert into public.group_sessions (id, group_id, starts_at, created_at)
select id, group_id, starts_at, (select t0 from perf_anchor) - interval '130 days' from perf_session;

insert into public.attendance (session_id, student_id, status, note, marked_by)
select ss.id, e.student_id,
       case
         when pg_temp.h('att:' || ss.id || ':' || e.s) % 100 < 80 then 'present'
         when pg_temp.h('att:' || ss.id || ':' || e.s) % 100 < 88 then 'late'
         when pg_temp.h('att:' || ss.id || ':' || e.s) % 100 < 96 then 'absent'
         else 'excused'
       end::public.attendance_status,
       case when pg_temp.h('attn:' || ss.id || ':' || e.s) % 50 = 0 then 'Came late from work' else '' end,
       gr.lead_id
from perf_session ss
join perf_group gr on gr.g = ss.g
join perf_enr e on e.group_id = ss.group_id and e.status in ('active', 'paused')
where ss.starts_at < (select t0 from perf_anchor);

-- ── rooms and the weekly timetable (two slots per group) ───────────────────
insert into public.rooms (id, name, capacity, kit, sort_order)
select md5('perf:room:' || r)::uuid, 'Room P' || lpad(r::text, 2, '0'), 12 + r % 10, 'Whiteboard', 100 + r
from generate_series(0, 29) r;

insert into public.room_bookings (id, room_id, title, group_id, teacher_id, weekday, start_min, end_min, note, created_by)
select md5('perf:booking:' || b)::uuid, md5('perf:room:' || (b % 30))::uuid, left(gr.name, 160), gr.id, gr.lead_id,
       ((b / 30) % 6)::smallint, 480 + ((b / 30) / 6) * 90, 480 + ((b / 30) / 6) * 90 + 90, '',
       (select id from perf_office where o = 1)
from generate_series(0, 1599) b
join perf_group gr on gr.g = b / 2 + 1;

-- ── staff exercises (ADR-038): 2 per teacher, 3 per office user ────────────
create temp table perf_staff_act as
select md5('perf:staffact:t' || t.t || ':' || n)::uuid as id, t.id as author_id,
       pc.id as course_id, pc.idx as course_idx,
       (select y.id from perf_cycle y where y.course_idx = pc.idx and y.ord = (t.t + n) % pc.n_cycle) as cycle_id,
       'perf-staff-t' || t.t || '-' || n as slug,
       'Extra practice ' || n || ' (teacher ' || t.t || ')' as title,
       case when pg_temp.h('sa:' || t.t || ':' || n) % 10 < 7 then 'published' else 'draft' end::public.content_status as status,
       (t.t - 1) % 150 + 1 as group_g
from perf_teacher t
join perf_course pc on pc.idx = (t.t - 1) % 18
cross join generate_series(1, 2) n
union all
select md5('perf:staffact:o' || o.o || ':' || n)::uuid, o.id, pc.id, pc.idx,
       (select y.id from perf_cycle y where y.course_idx = pc.idx and y.ord = n % pc.n_cycle),
       'perf-staff-o' || o.o || '-' || n, 'Office practice ' || n || ' (office ' || o.o || ')',
       'published', null
from perf_office o
join perf_course pc on pc.idx = (o.o * 5) % 18
cross join generate_series(1, 3) n;

insert into public.activities (id, course_id, cycle_id, slug, title, phase, scoring_mode, est_minutes, status, created_by)
select id, course_id, cycle_id, slug, title, 'after_class', 'practice', 10, status, author_id
from perf_staff_act;

insert into public.activity_items (id, activity_id, course_id, position, slug, type, prompt, data, points)
select md5('perf:staffitem:' || a.id || ':' || q)::uuid, a.id, a.course_id, q, 'q' || q, 'multipleChoice',
       jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Question ' || q)),
       jsonb_build_object('multiple', false, 'options', jsonb_build_array(
         jsonb_build_object('id', 'o1', 'text', 'first'),
         jsonb_build_object('id', 'o2', 'text', 'second'),
         jsonb_build_object('id', 'o3', 'text', 'third'))),
       1
from perf_staff_act a, generate_series(1, 6) q;

insert into public.activity_item_keys (item_id, course_id, answer, feedback)
select md5('perf:staffitem:' || a.id || ':' || q)::uuid, a.course_id, '{"optionIds": ["o2"]}', '{}'
from perf_staff_act a, generate_series(1, 6) q;

-- ── assignments: 30 per group (+2 staff exercises for each teacher's first group) ──
create temp table perf_asg as
select md5('perf:asg:' || gr.g || ':' || k)::uuid as id, gr.g, gr.id as group_id, gr.course_id, gr.course_idx, k,
       pg_temp.h('as:' || gr.g || ':' || k) as hv,
       case
         when k % 10 = 8 then 'section'
         when k % 10 = 9 and pc.n_vset > 0 then 'vocab'
         else 'activity'
       end as kind,
       (select a.id from perf_act a where a.course_idx = gr.course_idx
         and a.ord = pg_temp.h('as:' || gr.g || ':' || k) % pc.n_act) as activity_id,
       (select s.id from perf_section s where s.course_idx = gr.course_idx
         and s.ord = pg_temp.h('as:' || gr.g || ':' || k) % pc.n_sec) as section_id,
       (select v.id from perf_vset v where v.course_idx = gr.course_idx
         and v.ord = pg_temp.h('as:' || gr.g || ':' || k) % greatest(pc.n_vset, 1)) as vset_id,
       (select t0 from perf_anchor) + (k - 24) * interval '3 days' + interval '20 hours' as due_at,
       case when (pg_temp.h('as:' || gr.g || ':' || k) / 10000) % 100 < 8
            then (select id from perf_office where o = gr.g % 10 + 1) else gr.lead_id end as assigned_by
from perf_group gr
join perf_course pc on pc.idx = gr.course_idx
cross join generate_series(0, 29) k;

insert into public.assignments (id, group_id, course_id, activity_id, book_section_id, vocabulary_set_id,
                                audience, phase, available_from, due_at, note, assigned_by, created_at)
select id, group_id, course_id,
       case when kind = 'activity' then activity_id end,
       case when kind = 'section' then section_id end,
       case when kind = 'vocab' then vset_id end,
       case when kind = 'activity' and (hv / 100) % 100 < 12 then 'selected' else 'group' end::public.assignment_audience,
       'after_class', due_at - interval '6 days', due_at,
       case when hv % 7 = 0 then 'Please finish before class' else '' end,
       assigned_by, due_at - interval '6 days'
from perf_asg;

insert into public.assignments (id, group_id, course_id, activity_id, audience, phase, available_from, due_at, assigned_by, created_at)
select md5('perf:asg-staff:' || sa.id)::uuid, gr.id, sa.course_id, sa.id, 'group', 'after_class',
       (select t0 from perf_anchor) - interval '4 days', (select t0 from perf_anchor) + interval '3 days',
       sa.author_id, (select t0 from perf_anchor) - interval '4 days'
from perf_staff_act sa
join perf_group gr on gr.g = sa.group_g
where sa.status = 'published';

-- Homework for selected students: 3–5 of the group's (active or paused) students.
insert into public.assignment_recipients (assignment_id, student_id)
select a.id, r.student_id
from perf_asg a
cross join lateral (
  select e.student_id from perf_enr e
  where e.group_id = a.group_id and e.status in ('active', 'paused')
  order by pg_temp.h('rcp:' || a.id || ':' || e.s)
  limit 3 + a.hv % 3
) r
where a.kind = 'activity' and (a.hv / 100) % 100 < 12;

-- ── attempts, responses ─────────────────────────────────────────────────────
-- About 55% of a course's exercises are tried by each student of a group, a
-- quarter of those twice; the hot exercise six times by everyone in course 0.
create temp table perf_att as
with combos as (
  select e.s, e.student_id, e.g, e.group_id, e.course_id, e.status as enr_status,
         a.id as activity_id, a.cycle_id, a.scoring_mode, (a.id = h.activity_id) as hot,
         pg_temp.h('at:' || e.s || ':' || a.id) as hv
  from perf_enr e
  join perf_act a on a.course_idx = e.course_idx
  cross join perf_hot h
)
select c.s, c.student_id, c.g, c.group_id, c.course_id, c.activity_id, c.cycle_id, c.scoring_mode, c.hot,
       n.no as attempt_no, c.hv,
       md5('perf:attempt:' || c.s || ':' || c.activity_id || ':' || n.no)::uuid as id,
       case
         when n.no < n.total then 'submitted'
         when (c.hv / 10000) % 100 < 15 and c.enr_status in ('active', 'paused') then 'in_progress'
         else 'submitted'
       end::public.attempt_status as status,
       case when c.hot then (select t0 from perf_anchor) - (40 - n.no * 6) * interval '1 day'
            else (select t0 from perf_anchor) - ((c.hv / 1000000) % 140) * interval '1 day' + (n.no - 1) * interval '2 days'
       end + (8 + c.hv % 13) * interval '1 hour' + (c.hv % 60) * interval '1 minute' as started_at
from combos c
cross join lateral (
  select gs as no, t.total
  from (select case when c.hot then 6 else 1 + ((c.hv / 100) % 100 < 25)::int end as total) t,
       generate_series(1, t.total) gs
) n
where c.hot or c.hv % 100 < 55;
create index on perf_att (activity_id);

-- Homework links: the student's group's latest assignment of that exercise.
create temp table perf_asg_link as
select distinct on (a.group_id, a.activity_id) a.group_id, a.activity_id, a.id
from public.assignments a
where a.group_id in (select id from perf_group) and a.activity_id is not null
order by a.group_id, a.activity_id, a.created_at desc;
create unique index on perf_asg_link (group_id, activity_id);

-- One row per (attempt, question answered): how it went. First try right
-- with the student's ability; in practice mode, half of the wrong first tries
-- get a second, right, try. Hot question: 45% the key, 40% option X (the
-- answer the key "should" have had), 15% another option.
create temp table perf_ai as
select at.id as attempt_id, at.student_id, at.course_id, at.started_at,
       it.item_id, it.pos, it.points, v.first_ok,
       case when it.graded and not v.first_ok and at.scoring_mode <> 'scored' and (r.rh / 100000) % 100 < 50
            then 2 else 1 end as tries,
       case
         when v.first_ok is not false then it.right_answer
         when r.hot and r.rh % 100 < 85 then jsonb_build_object('optionIds', jsonb_build_array(h.option_x))
         else it.wrong_answers[1 + ((r.rh / 100) % 997) % array_length(it.wrong_answers, 1)]
       end as first_answer,
       case
         when v.first_ok is null then 'saved'
         when v.first_ok then 'correct'
         when r.hot and r.rh % 100 < 85 then 'chose:' || h.option_x
         else it.wrong_codes[1 + ((r.rh / 100) % 997) % array_length(it.wrong_codes, 1)]
       end as first_code
from perf_att at
join perf_item it on it.activity_id = at.activity_id
join perf_student st on st.id = at.student_id
cross join perf_hot h
cross join lateral (
  select pg_temp.h('r:' || at.id || ':' || it.item_id) as rh, it.item_id = h.item_id as hot
) r
cross join lateral (
  select case when not it.graded then null
              when r.hot then r.rh % 100 < 45
              else r.rh % 100 < st.ability end as first_ok
) v
where at.status = 'submitted' or it.pos < (at.hv / 7) % 9;

-- attempts.state is what the player stores (src/domain/grading/attempt.ts).
create temp table perf_state as
select ai.attempt_id,
       jsonb_object_agg(ai.item_id::text, jsonb_build_object(
         'status', case when ai.first_ok is null then 'saved'
                        when ai.first_ok or ai.tries > 1 then 'correct' else 'incorrect' end,
         'tries', ai.tries,
         'answer', case when ai.tries > 1 then it.right_answer else ai.first_answer end,
         'firstScore', case when ai.first_ok then ai.points else 0 end)) as items,
       sum(case when ai.first_ok then ai.points else 0 end) as score,
       count(*) as n
from perf_ai ai join perf_item it on it.item_id = ai.item_id
group by ai.attempt_id;

create temp table perf_act_max as
select activity_id, sum(points) as max_score from perf_item where graded group by activity_id;

insert into public.attempts (id, user_id, activity_id, course_id, assignment_id, attempt_no, status, state,
                             score, max_score, started_at, updated_at, submitted_at)
select at.id, at.student_id, at.activity_id, at.course_id, l.id, at.attempt_no, at.status,
       jsonb_build_object('items', coalesce(st.items, '{}'::jsonb)),
       case when at.status = 'submitted' then coalesce(st.score, 0) end,
       case when at.status = 'submitted' then coalesce(mx.max_score, 0) end,
       at.started_at,
       at.started_at + coalesce(st.n, 0) * interval '50 seconds',
       case when at.status = 'submitted' then at.started_at + coalesce(st.n, 0) * interval '50 seconds' end
from perf_att at
left join perf_asg_link l on l.group_id = at.group_id and l.activity_id = at.activity_id
left join perf_state st on st.attempt_id = at.id
left join perf_act_max mx on mx.activity_id = at.activity_id;

insert into public.responses (attempt_id, user_id, course_id, item_id, answer, is_correct, score, feedback_code, try_no, created_at)
select ai.attempt_id, ai.student_id, ai.course_id, ai.item_id,
       case when t.no = 1 then ai.first_answer else it.right_answer end,
       case when t.no = 1 then ai.first_ok else true end,
       case when t.no = 1 and ai.first_ok then ai.points when t.no > 1 then ai.points else 0 end,
       case when t.no = 1 then ai.first_code else 'correct' end,
       t.no,
       ai.started_at + ai.pos * interval '50 seconds' + (t.no - 1) * interval '15 seconds'
from perf_ai ai
join perf_item it on it.item_id = ai.item_id
cross join lateral generate_series(1, ai.tries) t(no);

drop table perf_ai, perf_state;

-- ── reading progress, notebook answers, vocabulary ─────────────────────────
create temp table perf_sp as
select e.s, e.student_id, e.course_id, sec.id as section_id, sec.cycle_id, sec.kind, x.hv,
       (x.hv / 100) % 100 < 70 as done,
       (select t0 from perf_anchor) - ((x.hv / 10000) % 140) * interval '1 day' + (x.hv % 600) * interval '1 minute' as at
from perf_enr e
join perf_section sec on sec.course_idx = e.course_idx
cross join lateral (select pg_temp.h('sp:' || e.s || ':' || sec.id) as hv) x
where x.hv % 100 < 45;

insert into public.section_progress (user_id, book_section_id, course_id, status, last_block_id, updated_at, completed_at)
select student_id, section_id, course_id,
       case when done then 'completed' else 'in_progress' end::public.progress_status,
       'b' || (hv % 9), at, case when done then at end
from perf_sp;

insert into public.block_responses (user_id, section_id, course_id, block_id, item_index, answer, updated_at)
select sp.student_id, sp.section_id, sp.course_id, 'q' || b, 0,
       'Mi respuesta número ' || b || ' para esta página.',
       (select t0 from perf_anchor) - ((sp.hv / 10000) % 140) * interval '1 day'
from perf_sp sp, generate_series(1, 2) b
where sp.kind = 'notebook' and (sp.hv / 100) % 100 < 70 and (sp.hv / 1000000) % 100 < 30;

insert into public.vocab_review_state (user_id, vocabulary_item_id, course_id, box, due_at, last_reviewed_at, correct_streak, lapses)
select e.student_id, vi.id, e.course_id,
       (1 + pg_temp.h('vr:' || e.s || ':' || vi.id) / 100 % 5)::smallint,
       (select t0 from perf_anchor) + ((pg_temp.h('vr:' || e.s || ':' || vi.id) / 1000) % 21 - 7) * interval '1 day',
       (select t0 from perf_anchor) - ((pg_temp.h('vr:' || e.s || ':' || vi.id) / 1000) % 30) * interval '1 day',
       pg_temp.h('vr:' || e.s || ':' || vi.id) / 100 % 5,
       pg_temp.h('vr:' || e.s || ':' || vi.id) / 100000 % 3
from perf_enr e
join perf_vitem vi on vi.course_idx = e.course_idx
where pg_temp.h('vr:' || e.s || ':' || vi.id) % 100 < 12;

-- ── learning events ─────────────────────────────────────────────────────────
insert into public.learning_events (user_id, type, occurred_at, course_id, cycle_id, activity_id)
select student_id, 'activity_started', started_at, course_id, cycle_id, activity_id from perf_att;

insert into public.learning_events (user_id, type, occurred_at, course_id, cycle_id, activity_id)
select a.user_id, 'activity_completed', a.submitted_at, a.course_id, at.cycle_id, a.activity_id
from public.attempts a join perf_att at on at.id = a.id
where a.status = 'submitted' and a.user_id in (select id from perf_student);

insert into public.learning_events (user_id, type, occurred_at, course_id, cycle_id, activity_id)
select a.user_id, 'assignment_completed', a.submitted_at, a.course_id, at.cycle_id, a.activity_id
from public.attempts a join perf_att at on at.id = a.id
where a.status = 'submitted' and a.assignment_id is not null;

insert into public.learning_events (user_id, type, occurred_at, course_id, cycle_id, section_id)
select student_id, 'section_opened', at - interval '10 minutes', course_id, cycle_id, section_id from perf_sp;

insert into public.learning_events (user_id, type, occurred_at, course_id, cycle_id, section_id)
select student_id, 'section_completed', at, course_id, cycle_id, section_id from perf_sp where done;

insert into public.learning_events (user_id, type, occurred_at, course_id)
select e.student_id, 'vocab_reviewed',
       (select t0 from perf_anchor) - (pg_temp.h('ve:' || e.s || ':' || e.g || ':' || n) % 120) * interval '1 day'
         + interval '19 hours', e.course_id
from perf_enr e, generate_series(1, 10) n;

insert into public.learning_events (user_id, type, occurred_at)
select st.id, 'login',
       (select t0 from perf_anchor) - (pg_temp.h('lg:' || st.s || ':' || n) % 120) * interval '1 day' + interval '18 hours'
from perf_student st, generate_series(1, 20) n;

-- ── mistake reports (ADR-040): ~1,500, a third resolved ────────────────────
-- The insert trigger forces created_at = now() and status = open; switched
-- off for this one statement so the reports have a history.
alter table public.content_reports disable trigger content_reports_before_insert;
insert into public.content_reports (id, reporter_id, course_id, activity_id, item_id, message, suggested_answer,
                                    status, created_at, resolved_by, resolved_at)
select md5('perf:report:' || n)::uuid, e.student_id, e.course_id, it.activity_id, it.item_id,
       'I think the answer to this question is wrong (' || n || ')', 'maybe the other option',
       case when n % 3 = 0 then 'resolved' else 'open' end::public.report_status,
       (select t0 from perf_anchor) - (n % 90) * interval '1 day',
       case when n % 3 = 0 then gr.lead_id end,
       case when n % 3 = 0 then (select t0 from perf_anchor) - (n % 90) * interval '1 day' + interval '2 days' end
from generate_series(1, 1500) n
join perf_enr e on e.s = (n * 37) % 10000 + 1 and e.g = ((n * 37) % 10000) % 800 + 1
join perf_group gr on gr.id = e.group_id
join lateral (
  select a.id as activity_id, i.item_id from perf_act a join perf_item i on i.activity_id = a.id
  where a.course_idx = e.course_idx and a.ord = n % 30 order by i.pos limit 1
) it on true;
alter table public.content_reports enable trigger content_reports_before_insert;

-- ── office records: contact details, packages, private lessons ─────────────
insert into public.student_records (student_id, phone, contact_email, office_note)
select id, '050-' || lpad((pg_temp.h('ph:' || s) % 10000000)::text, 7, '0'), '', ''
from perf_student;

insert into public.lesson_packages (id, student_id, lessons, minutes_per_lesson, starts_on, expires_on, price, paid_at, created_by)
select md5('perf:pkg:' || p)::uuid, st.id, 10, 60,
       ((select t0 from perf_anchor) - interval '60 days')::date,
       ((select t0 from perf_anchor) + (p % 90 - 10) * interval '1 day')::date,
       1800, case when p % 5 = 0 then null else (select t0 from perf_anchor) - interval '55 days' end,
       (select id from perf_office where o = 1)
from generate_series(1, 1500) p
join perf_student st on st.s = p * 6;

-- 6,000 lessons: each teacher one every 13 hours, each slot a different student.
insert into public.private_lessons (id, student_id, teacher_id, package_id, starts_at, ends_at, status, cancelled_at, created_by)
select md5('perf:lesson:' || j)::uuid, st.id, t.id, md5('perf:pkg:' || ((j * 7) % 1500 + 1))::uuid,
       l.starts_at, l.starts_at + interval '1 hour',
       case
         when l.starts_at > (select t0 from perf_anchor) then 'scheduled'
         when j % 23 = 0 then 'cancelled_early'
         when j % 31 = 0 then 'no_show'
         else 'done'
       end::public.private_lesson_status,
       case when l.starts_at <= (select t0 from perf_anchor) and j % 23 = 0 then l.starts_at - interval '2 days' end,
       (select id from perf_office where o = 1)
from generate_series(0, 5999) j
cross join lateral (select (select t0 from perf_anchor) - interval '20 days' + (j / 150) * interval '13 hours' as starts_at) l
join perf_teacher t on t.t = j % 150 + 1
join perf_student st on st.s = ((j * 7) % 1500 + 1) * 6;

commit;

-- Steady state: statistics and visibility maps as autovacuum would leave them.
vacuum (analyze) public.responses, public.attempts, public.learning_events, public.section_progress,
  public.vocab_review_state, public.block_responses, public.attendance, public.enrollments,
  public.assignments, public.assignment_recipients, public.group_sessions, public.group_cycles,
  public.group_teachers, public.groups, public.profiles, public.user_roles, public.content_reports,
  public.activities, public.activity_items, public.activity_item_keys, public.student_records,
  public.lesson_packages, public.private_lessons, public.room_bookings, public.rooms, public.audit_log;
analyze auth.users, auth.identities;

-- What was loaded.
select 'students' as what, count(*) as n from public.user_roles where role = 'student'
union all select 'teachers', count(*) from public.user_roles where role = 'teacher'
union all select 'office', count(*) from public.user_roles where role = 'office'
union all select 'groups', count(*) from public.groups
union all select 'enrollments', count(*) from public.enrollments
union all select 'group_sessions', count(*) from public.group_sessions
union all select 'attendance', count(*) from public.attendance
union all select 'assignments', count(*) from public.assignments
union all select 'assignment_recipients', count(*) from public.assignment_recipients
union all select 'activities (staff)', count(*) from public.activities where created_by is not null
union all select 'attempts', count(*) from public.attempts
union all select 'responses', count(*) from public.responses
union all select 'section_progress', count(*) from public.section_progress
union all select 'block_responses', count(*) from public.block_responses
union all select 'vocab_review_state', count(*) from public.vocab_review_state
union all select 'learning_events', count(*) from public.learning_events
union all select 'content_reports', count(*) from public.content_reports
union all select 'private_lessons', count(*) from public.private_lessons
union all select 'room_bookings', count(*) from public.room_bookings
union all select 'database size (MB)', pg_database_size(current_database()) / 1048576;
