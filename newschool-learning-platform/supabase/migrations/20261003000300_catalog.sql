-- Catalog: what the school teaches. docs/CONTENT-MODEL.md.
--
-- Child tables carry course_id and reference their parent through a composite
-- (id, course_id) foreign key. That guarantees a section can never point at a
-- cycle of another course, and lets every access policy check course_id
-- directly instead of joining up the tree.

create table public.languages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  name text not null check (char_length(name) between 1 and 80),
  direction public.text_direction not null default 'ltr',
  created_at timestamptz not null default now()
);

create table public.levels (
  id uuid primary key default gen_random_uuid(),
  language_id uuid not null references public.languages (id) on delete restrict,
  code text not null check (char_length(code) between 1 and 40),
  title text not null check (char_length(title) between 1 and 120),
  position int not null default 0,
  cefr text check (cefr is null or cefr in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  created_at timestamptz not null default now(),
  unique (language_id, code)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  level_id uuid not null references public.levels (id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  instruction_locale text not null default 'he' check (instruction_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  status public.content_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger courses_touch before update on public.courses
  for each row execute function app.touch_updated_at();

create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 160),
  communicative_goal text not null default '' check (char_length(communicative_goal) <= 500),
  position int not null default 0,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, slug),
  unique (id, course_id)
);
create trigger cycles_touch before update on public.cycles
  for each row execute function app.touch_updated_at();

create table public.books (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  kind public.book_kind not null,
  title text not null check (char_length(title) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (course_id, kind),
  unique (id, course_id)
);

create table public.book_sections (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null,
  course_id uuid not null,
  cycle_id uuid not null,
  position int not null default 0,
  title text not null check (char_length(title) between 1 and 200),
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  schema_version int not null default 1 check (schema_version > 0),
  phase public.learning_phase,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (book_id, course_id) references public.books (id, course_id) on delete cascade,
  foreign key (cycle_id, course_id) references public.cycles (id, course_id) on delete cascade,
  unique (id, course_id)
);
create trigger book_sections_touch before update on public.book_sections
  for each row execute function app.touch_updated_at();

-- Teacher-only material lives in its own table so a student query can never
-- carry it along (row policies cannot filter inside a JSON document).
create table public.section_teacher_notes (
  section_id uuid primary key,
  course_id uuid not null,
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  updated_at timestamptz not null default now(),
  foreign key (section_id, course_id) references public.book_sections (id, course_id) on delete cascade
);
create trigger section_teacher_notes_touch before update on public.section_teacher_notes
  for each row execute function app.touch_updated_at();

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null,
  cycle_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 200),
  instructions jsonb not null default '[]'::jsonb check (jsonb_typeof(instructions) = 'array'),
  phase public.learning_phase not null default 'after_class',
  scoring_mode public.scoring_mode not null default 'practice',
  est_minutes int check (est_minutes is null or est_minutes between 1 and 240),
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cycle_id, course_id) references public.cycles (id, course_id) on delete cascade,
  unique (course_id, slug),
  unique (id, course_id)
);
create trigger activities_touch before update on public.activities
  for each row execute function app.touch_updated_at();

create table public.activity_items (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  course_id uuid not null,
  position int not null default 0,
  type text not null check (type in (
    'multipleChoice', 'trueFalse', 'fillBlank', 'matching', 'reorderSentence',
    'flashcards', 'shortAnswer', 'reflection'
  )),
  prompt jsonb not null default '[]'::jsonb check (jsonb_typeof(prompt) = 'array'),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  points numeric(5, 2) not null default 1 check (points >= 0),
  created_at timestamptz not null default now(),
  foreign key (activity_id, course_id) references public.activities (id, course_id) on delete cascade,
  unique (id, course_id)
);

-- Correct answers. Students never have any access to this table.
create table public.activity_item_keys (
  item_id uuid primary key,
  course_id uuid not null,
  answer jsonb not null,
  feedback jsonb not null default '{}'::jsonb check (jsonb_typeof(feedback) = 'object'),
  foreign key (item_id, course_id) references public.activity_items (id, course_id) on delete cascade
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  label text not null check (char_length(label) between 1 and 120)
);

create table public.activity_skills (
  activity_id uuid not null references public.activities (id) on delete cascade,
  skill_id uuid not null references public.skills (id) on delete cascade,
  primary key (activity_id, skill_id)
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses (id) on delete cascade,  -- null = shared (e.g. brand)
  bucket text not null check (char_length(bucket) between 1 and 63),
  path text not null check (char_length(path) between 1 and 500),
  kind text not null check (kind in ('audio', 'image', 'document', 'video')),
  mime text not null check (char_length(mime) <= 100),
  bytes bigint check (bytes is null or bytes >= 0),
  duration_s numeric(8, 2),
  alt_text text not null default '',
  transcript text not null default '',
  source text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

create table public.vocabulary_sets (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null,
  cycle_id uuid not null,
  title text not null check (char_length(title) between 1 and 160),
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  foreign key (cycle_id, course_id) references public.cycles (id, course_id) on delete cascade,
  unique (id, course_id)
);

create table public.vocabulary_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null,
  course_id uuid not null,
  position int not null default 0,
  term text not null check (char_length(term) between 1 and 200),
  gloss text not null default '' check (char_length(gloss) <= 400),
  example text not null default '' check (char_length(example) <= 600),
  notes text not null default '' check (char_length(notes) <= 600),
  audio_asset_id uuid references public.media_assets (id) on delete set null,
  image_asset_id uuid references public.media_assets (id) on delete set null,
  attrs jsonb not null default '{}'::jsonb check (jsonb_typeof(attrs) = 'object'),
  foreign key (set_id, course_id) references public.vocabulary_sets (id, course_id) on delete cascade,
  unique (id, course_id)
);

create index levels_language_idx on public.levels (language_id);
create index courses_level_idx on public.courses (level_id);
create index book_sections_book_cycle_idx on public.book_sections (book_id, cycle_id, position);
create index book_sections_course_idx on public.book_sections (course_id);
create index book_sections_cycle_idx on public.book_sections (cycle_id, course_id);
create index activities_course_cycle_phase_idx on public.activities (course_id, cycle_id, phase);
create index activities_cycle_idx on public.activities (cycle_id, course_id);
create index activity_items_activity_idx on public.activity_items (activity_id, position);
create index activity_items_course_idx on public.activity_items (activity_id, course_id);
create index activity_item_keys_course_idx on public.activity_item_keys (item_id, course_id);
create index section_teacher_notes_course_idx on public.section_teacher_notes (section_id, course_id);
create index activity_skills_skill_idx on public.activity_skills (skill_id);
create index media_assets_course_idx on public.media_assets (course_id);
create index vocabulary_sets_cycle_idx on public.vocabulary_sets (cycle_id, course_id);
create index vocabulary_items_set_idx on public.vocabulary_items (set_id, position);
create index vocabulary_items_set_course_idx on public.vocabulary_items (set_id, course_id);
create index vocabulary_items_audio_idx on public.vocabulary_items (audio_asset_id);
create index vocabulary_items_image_idx on public.vocabulary_items (image_asset_id);
create index media_assets_created_by_idx on public.media_assets (created_by);
