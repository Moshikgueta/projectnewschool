-- Foundation: private helper schema, enums, shared trigger functions.
-- See docs/DATABASE.md.

-- Helper functions live in `app`, which is NOT exposed through the Data API
-- (config.toml exposes only `public`), so they cannot be called as RPCs.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create type public.app_role as enum ('student', 'teacher', 'pedagogical_manager', 'admin');
create type public.content_status as enum ('draft', 'in_review', 'published', 'archived');
create type public.learning_phase as enum ('before_class', 'during_class', 'after_class', 'review', 'optional');
create type public.scoring_mode as enum ('none', 'practice', 'scored');
create type public.book_kind as enum ('notebook', 'workbook');
create type public.text_direction as enum ('ltr', 'rtl');
create type public.group_status as enum ('planned', 'active', 'finished', 'archived');
create type public.enrollment_status as enum ('active', 'paused', 'completed', 'withdrawn');
create type public.group_cycle_state as enum ('upcoming', 'active', 'completed');
create type public.teacher_role as enum ('lead', 'assistant');
create type public.assignment_audience as enum ('group', 'selected');
create type public.attempt_status as enum ('in_progress', 'submitted');
create type public.progress_status as enum ('not_started', 'in_progress', 'completed');
create type public.learning_event_type as enum (
  'login', 'activity_started', 'activity_completed', 'answer_submitted',
  'section_opened', 'section_completed', 'vocab_reviewed', 'assignment_completed'
);

-- Keeps updated_at honest without relying on every writer to set it.
create function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
