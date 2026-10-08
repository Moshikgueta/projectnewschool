-- Notebook (Phase 3): stable slugs for imported content, the course's AI-tutor
-- link, optional in-class answers, and students recording their own reading
-- position. docs/CONTENT-AUDIT.md §5 (decisions C1, C2), ADR-022/023.

-- ── content identity for idempotent imports ────────────────────────────────
alter table public.book_sections add column slug text
  check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
create unique index book_sections_book_slug_key on public.book_sections (book_id, slug);

alter table public.vocabulary_sets add column slug text
  check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
create unique index vocabulary_sets_course_slug_key on public.vocabulary_sets (course_id, slug);
create unique index vocabulary_items_set_term_key on public.vocabulary_items (set_id, term);

-- Teacher notes are anchored to block ids of the student view (ADR-022). The
-- shape is validated by the content schema; the database only checks it is a list.
comment on column public.section_teacher_notes.blocks is
  'Teacher-only notes: [{ id, anchor (student block id or null), text, minutes? }]';

-- ── AI tutor link (decision C1: link out, one link per course) ─────────────
alter table public.courses add column ai_tutor_url text
  check (ai_tutor_url is null or ai_tutor_url ~ '^https://[^\s]{4,500}$');

-- ── optional in-class answers (decision C2) ────────────────────────────────
-- Ungraded free text a student types into a sentence frame or reflection.
-- Saved privately; readable by the student, their teacher and managers.
create table public.block_responses (
  user_id uuid not null references public.profiles (id) on delete cascade,
  section_id uuid not null,
  course_id uuid not null,
  block_id text not null check (block_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  item_index int not null default 0 check (item_index between 0 and 50),
  answer text not null check (char_length(answer) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (user_id, section_id, block_id, item_index),
  foreign key (section_id, course_id) references public.book_sections (id, course_id) on delete cascade
);
create trigger block_responses_touch before update on public.block_responses
  for each row execute function app.touch_updated_at();

create index block_responses_section_idx on public.block_responses (section_id, course_id);
create index block_responses_course_user_idx on public.block_responses (course_id, user_id);

alter table public.block_responses enable row level security;
alter table public.block_responses force row level security;

grant select on public.block_responses to authenticated;
grant insert on public.block_responses to authenticated;
grant update (answer) on public.block_responses to authenticated;
grant delete on public.block_responses to authenticated;
grant all on public.block_responses to service_role;

create policy block_responses_select on public.block_responses for select to authenticated using (
  user_id = (select auth.uid())
  or (select app.is_manager())
  or app.teaches_student_in_course(user_id, course_id)
);

-- A student may write only their own answers, only on a section they can
-- read (the subquery runs under book_sections' own RLS: published content of
-- a course they are enrolled in).
create policy block_responses_insert_own on public.block_responses for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.book_sections s
      where s.id = block_responses.section_id and s.course_id = block_responses.course_id
    )
  );
create policy block_responses_update_own on public.block_responses for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.book_sections s
      where s.id = block_responses.section_id and s.course_id = block_responses.course_id
    )
  );
-- Answers are optional: a student may clear their own.
create policy block_responses_delete_own on public.block_responses for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── reading position (own rows, ungraded) ──────────────────────────────────
grant insert on public.section_progress to authenticated;
grant update (status, last_block_id, completed_at) on public.section_progress to authenticated;

create policy section_progress_insert_own on public.section_progress for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.book_sections s
      where s.id = section_progress.book_section_id and s.course_id = section_progress.course_id
    )
  );
create policy section_progress_update_own on public.section_progress for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
