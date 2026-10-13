-- Pilot release and "report a mistake" (school owner, 2026-10-13; ADR-040).
--
-- The owner opened every course to students at once, labelled "pilot", with
-- teachers' review continuing while students use the material. Two pieces:
--
-- 1. courses.pilot: shown to students as a "Pilot" badge with a line saying
--    the material is new and mistakes can be reported. Set from course.yaml
--    (`pilot: true`) by the content import, or by the manager in the editor.
--
-- 2. content_reports: a student reports a mistake in an exercise question, an
--    exercise, or a notebook/workbook page.
--      * A student writes only in their own name, only about content they can
--        see (the subqueries run under the content tables' own RLS: published,
--        in a course they are enrolled in) and only while enrolled in it.
--      * A student reads only their own reports; nobody but staff sees who
--        reported, and no student sees another student's report.
--      * Teachers of the course and the pedagogical manager (MFA) read and
--        resolve (or reopen) them, in their own name. The office does not:
--        reports are about teaching material, not administration.
--      * Length limits are in the table; at most 10 reports per student per
--        hour (trigger; SQLSTATE PT429 = HTTP 429 through the API).
--      * Nobody deletes a report (no grant); a resolution is in the audit log.

-- ── pilot flag ─────────────────────────────────────────────────────────────
alter table public.courses add column pilot boolean not null default false;
comment on column public.courses.pilot is
  'Published as a pilot: students see a "Pilot" badge and can report mistakes (ADR-040).';

-- ── content reports ────────────────────────────────────────────────────────
create type public.report_status as enum ('open', 'resolved');

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  -- What the report is about: an exercise (optionally one of its questions),
  -- or a notebook/workbook page. Exactly one of the two.
  activity_id uuid,
  item_id uuid,
  book_section_id uuid,
  message text not null check (char_length(btrim(message)) between 1 and 500),
  suggested_answer text not null default '' check (char_length(suggested_answer) <= 300),
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  foreign key (activity_id, course_id) references public.activities (id, course_id) on delete cascade,
  foreign key (item_id, course_id) references public.activity_items (id, course_id) on delete cascade,
  foreign key (book_section_id, course_id) references public.book_sections (id, course_id) on delete cascade,
  check ((activity_id is null) <> (book_section_id is null)),
  check (item_id is null or activity_id is not null),
  check ((status = 'resolved') = (resolved_at is not null)),
  check (status = 'resolved' or resolved_by is null)
);
create index content_reports_course_idx on public.content_reports (course_id, status, created_at desc);
create index content_reports_reporter_idx on public.content_reports (reporter_id, created_at desc);
create index content_reports_activity_idx on public.content_reports (activity_id) where activity_id is not null;
create index content_reports_item_idx on public.content_reports (item_id) where item_id is not null;
create index content_reports_section_idx on public.content_reports (book_section_id) where book_section_id is not null;
create index content_reports_resolved_by_idx on public.content_reports (resolved_by) where resolved_by is not null;

-- Reports a student may send per rolling hour.
create function app.content_reports_per_hour()
returns int language sql immutable set search_path = '' as $$ select 10 $$;

-- A new report: open, stamped now (so the hourly count cannot be dodged with
-- a back-dated row), within the hourly limit. SECURITY DEFINER so it counts
-- the reporter's rows whatever RLS shows (it reads nothing else, so it
-- reveals nothing about content); the advisory lock makes two reports sent
-- at once count against each other. That a question belongs to its exercise
-- is checked by the insert policy, under the caller's RLS.
create function app.content_reports_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.status := 'open';
  new.created_at := now();
  new.resolved_by := null;
  new.resolved_at := null;
  perform pg_advisory_xact_lock(hashtextextended('content_reports:' || new.reporter_id::text, 0));
  if (
    select count(*) from public.content_reports
    where reporter_id = new.reporter_id and created_at > now() - interval '1 hour'
  ) >= app.content_reports_per_hour() then
    raise exception 'too many reports in the last hour' using errcode = 'PT429';
  end if;
  return new;
end;
$$;
create trigger content_reports_before_insert before insert on public.content_reports
  for each row execute function app.content_reports_before_insert();

-- Resolving or reopening is done in the caller's own name, now. (Signed-in
-- users may update only the status column, so what a student wrote stays as
-- written; see the grants below.)
create function app.content_reports_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'resolved' and old.status = 'open' then
    new.resolved_at := now();
    new.resolved_by := (select auth.uid());
  elsif new.status = 'open' then
    new.resolved_at := null;
    new.resolved_by := null;
  else
    new.resolved_at := old.resolved_at;
    new.resolved_by := old.resolved_by;
  end if;
  return new;
end;
$$;
create trigger content_reports_before_update before update on public.content_reports
  for each row execute function app.content_reports_before_update();

create trigger audit_content_reports after update on public.content_reports
  for each row execute function app.audit_row();

revoke all on function app.content_reports_per_hour(), app.content_reports_before_insert(),
  app.content_reports_before_update() from public, anon;
grant execute on function app.content_reports_per_hour() to authenticated, service_role;

-- ── access ─────────────────────────────────────────────────────────────────
alter table public.content_reports enable row level security;
alter table public.content_reports force row level security;

grant select on public.content_reports to authenticated;
-- A student names what the report is about and writes it; the reporter,
-- status, dates and resolver are never theirs to set.
grant insert (course_id, activity_id, item_id, book_section_id, message, suggested_answer)
  on public.content_reports to authenticated;
grant update (status) on public.content_reports to authenticated;
grant all on public.content_reports to service_role;

create policy content_reports_select on public.content_reports for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or (select app.is_manager())
    or app.teaches_course(course_id)
  );

-- The exists() subqueries run under the content tables' RLS: a student sees
-- only published content of courses they are enrolled in (and a staff
-- exercise only through homework they were given).
create policy content_reports_insert on public.content_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and app.is_enrolled_in_course(course_id)
    and (
      (
        activity_id is not null
        and exists (
          select 1 from public.activities a
          where a.id = content_reports.activity_id and a.course_id = content_reports.course_id
        )
        and (
          item_id is null or exists (
            select 1 from public.activity_items i
            where i.id = content_reports.item_id and i.activity_id = content_reports.activity_id
          )
        )
      )
      or (
        book_section_id is not null
        and exists (
          select 1 from public.book_sections s
          where s.id = content_reports.book_section_id and s.course_id = content_reports.course_id
        )
      )
    )
  );

create policy content_reports_resolve on public.content_reports for update to authenticated
  using ((select app.is_manager()) or app.teaches_course(course_id))
  with check ((select app.is_manager()) or app.teaches_course(course_id));
