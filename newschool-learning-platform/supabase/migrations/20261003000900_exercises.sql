-- Exercises (Phase 4): stable item identity for imports, and at most one open
-- attempt per student and activity. Grading, attempts and responses are
-- written only by Server Actions through the privileged module after checking
-- the student's access with their own session (ADR-006); students keep
-- read-only access to their own attempts and responses, and none to keys.

alter table public.activity_items add column slug text
  check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
create unique index activity_items_activity_slug_key on public.activity_items (activity_id, slug);

-- Resuming instead of duplicating: a second "start" while one is open (double
-- click, two tabs) fails, and the server returns the open attempt.
create unique index attempts_one_open_key on public.attempts (user_id, activity_id)
  where status = 'in_progress';

comment on column public.attempts.state is
  'Player state written by the server: { items: { <itemId>: { status, tries, answer } } }. Never contains keys.';
