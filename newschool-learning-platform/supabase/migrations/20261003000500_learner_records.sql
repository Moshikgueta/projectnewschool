-- Learner records. user_id and course_id are carried on every row so access
-- policies are simple column checks. Students have no write policy on these
-- tables: writes go through server actions (ADR-006).

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  activity_id uuid not null,
  course_id uuid not null,
  assignment_id uuid references public.assignments (id) on delete set null,
  attempt_no int not null default 1 check (attempt_no > 0),
  status public.attempt_status not null default 'in_progress',
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  score numeric(7, 2) check (score is null or score >= 0),
  max_score numeric(7, 2) check (max_score is null or max_score >= 0),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  foreign key (activity_id, course_id) references public.activities (id, course_id) on delete cascade,
  unique (user_id, activity_id, attempt_no),
  unique (id, user_id, course_id)
);
create trigger attempts_touch before update on public.attempts
  for each row execute function app.touch_updated_at();

-- Append-only: every check of an answer is a row (that is what makes
-- "common difficulties" possible).
create table public.responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  user_id uuid not null,
  course_id uuid not null,
  item_id uuid not null,
  answer jsonb not null,
  is_correct boolean,
  score numeric(7, 2) check (score is null or score >= 0),
  feedback_code text check (feedback_code is null or char_length(feedback_code) <= 64),
  try_no int not null default 1 check (try_no > 0),
  created_at timestamptz not null default now(),
  foreign key (attempt_id, user_id, course_id) references public.attempts (id, user_id, course_id) on delete cascade,
  foreign key (item_id, course_id) references public.activity_items (id, course_id) on delete cascade
);

create table public.section_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  book_section_id uuid not null,
  course_id uuid not null,
  status public.progress_status not null default 'in_progress',
  last_block_id text check (last_block_id is null or char_length(last_block_id) <= 64),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, book_section_id),
  foreign key (book_section_id, course_id) references public.book_sections (id, course_id) on delete cascade
);
create trigger section_progress_touch before update on public.section_progress
  for each row execute function app.touch_updated_at();

create table public.vocab_review_state (
  user_id uuid not null references public.profiles (id) on delete cascade,
  vocabulary_item_id uuid not null,
  course_id uuid not null,
  box smallint not null default 1 check (box between 1 and 5),
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  correct_streak int not null default 0 check (correct_streak >= 0),
  lapses int not null default 0 check (lapses >= 0),
  primary key (user_id, vocabulary_item_id),
  foreign key (vocabulary_item_id, course_id) references public.vocabulary_items (id, course_id) on delete cascade
);

create table public.learning_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.learning_event_type not null,
  occurred_at timestamptz not null default now(),
  course_id uuid references public.courses (id) on delete cascade,
  cycle_id uuid references public.cycles (id) on delete set null,
  activity_id uuid references public.activities (id) on delete set null,
  section_id uuid references public.book_sections (id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object')
);

create table public.recommendation_feedback (
  user_id uuid not null references public.profiles (id) on delete cascade,
  rec_key text not null check (char_length(rec_key) between 1 and 200),
  action text not null check (action in ('dismissed', 'opened', 'completed')),
  at timestamptz not null default now(),
  primary key (user_id, rec_key, action)
);

create index attempts_user_activity_idx on public.attempts (user_id, activity_id, updated_at desc);
create index attempts_course_idx on public.attempts (course_id);
create index attempts_activity_idx on public.attempts (activity_id, course_id);
create index attempts_assignment_idx on public.attempts (assignment_id);
create index responses_attempt_idx on public.responses (attempt_id, user_id, course_id);
create index responses_item_idx on public.responses (item_id, created_at);
create index responses_item_course_idx on public.responses (item_id, course_id);
create index responses_user_course_idx on public.responses (user_id, course_id);
create index section_progress_user_idx on public.section_progress (user_id, updated_at desc);
create index section_progress_section_idx on public.section_progress (book_section_id, course_id);
create index vocab_review_state_due_idx on public.vocab_review_state (user_id, due_at);
create index vocab_review_state_item_idx on public.vocab_review_state (vocabulary_item_id, course_id);
create index learning_events_user_idx on public.learning_events (user_id, occurred_at desc);
create index learning_events_course_idx on public.learning_events (course_id);
create index learning_events_cycle_idx on public.learning_events (cycle_id);
create index learning_events_activity_idx on public.learning_events (activity_id);
create index learning_events_section_idx on public.learning_events (section_id);
