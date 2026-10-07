-- Delivery: who studies what, with whom. Course access comes from exactly one
-- place: an active enrollment in a group of that course (ADR-008).

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 160),
  starts_on date,
  ends_on date,
  status public.group_status not null default 'active',
  schedule_note text not null default '' check (char_length(schedule_note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  unique (id, course_id)
);
create trigger groups_touch before update on public.groups
  for each row execute function app.touch_updated_at();

create table public.group_teachers (
  group_id uuid not null references public.groups (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  role public.teacher_role not null default 'lead',
  created_at timestamptz not null default now(),
  primary key (group_id, teacher_id)
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete restrict,
  student_id uuid not null references public.profiles (id) on delete cascade,
  status public.enrollment_status not null default 'active',
  started_on date not null default current_date,
  ended_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, student_id)
);
create trigger enrollments_touch before update on public.enrollments
  for each row execute function app.touch_updated_at();

create table public.group_cycles (
  group_id uuid not null,
  cycle_id uuid not null,
  course_id uuid not null,
  state public.group_cycle_state not null default 'upcoming',
  position int not null default 0,
  activated_at timestamptz,
  primary key (group_id, cycle_id),
  foreign key (group_id, course_id) references public.groups (id, course_id) on delete cascade,
  foreign key (cycle_id, course_id) references public.cycles (id, course_id) on delete cascade
);

create table public.group_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  starts_at timestamptz not null,
  cycle_id uuid references public.cycles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  course_id uuid not null,
  activity_id uuid,
  book_section_id uuid,
  vocabulary_set_id uuid,
  audience public.assignment_audience not null default 'group',
  phase public.learning_phase not null default 'after_class',
  available_from timestamptz not null default now(),
  due_at timestamptz,
  note text not null default '' check (char_length(note) <= 1000),
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- exactly one target
  check (num_nonnulls(activity_id, book_section_id, vocabulary_set_id) = 1),
  check (due_at is null or due_at >= available_from),
  foreign key (group_id, course_id) references public.groups (id, course_id) on delete cascade,
  foreign key (activity_id, course_id) references public.activities (id, course_id) on delete cascade,
  foreign key (book_section_id, course_id) references public.book_sections (id, course_id) on delete cascade,
  foreign key (vocabulary_set_id, course_id) references public.vocabulary_sets (id, course_id) on delete cascade
);

-- Only used when audience = 'selected'. A 'group' assignment automatically
-- includes students who join later.
create table public.assignment_recipients (
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  primary key (assignment_id, student_id)
);

-- Integrity: only students are enrolled, only teachers teach.
create function app.assert_has_role(p_user uuid, p_role public.app_role)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.user_roles where user_id = p_user and role = p_role) then
    raise exception 'user % does not have role %', p_user, p_role using errcode = '23514';
  end if;
end;
$$;

create function app.check_enrollment_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.assert_has_role(new.student_id, 'student');
  return new;
end;
$$;

create function app.check_group_teacher_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.assert_has_role(new.teacher_id, 'teacher');
  return new;
end;
$$;

create trigger enrollments_role_check before insert or update of student_id on public.enrollments
  for each row execute function app.check_enrollment_role();
create trigger group_teachers_role_check before insert or update of teacher_id on public.group_teachers
  for each row execute function app.check_group_teacher_role();

create index groups_course_idx on public.groups (course_id);
create index group_teachers_teacher_idx on public.group_teachers (teacher_id);
create index enrollments_student_status_idx on public.enrollments (student_id, status);
create index enrollments_group_idx on public.enrollments (group_id);
create index group_cycles_cycle_idx on public.group_cycles (cycle_id, course_id);
create index group_cycles_group_course_idx on public.group_cycles (group_id, course_id);
create index group_sessions_group_idx on public.group_sessions (group_id, starts_at);
create index group_sessions_cycle_idx on public.group_sessions (cycle_id);
create index assignments_group_due_idx on public.assignments (group_id, due_at);
create index assignments_group_course_idx on public.assignments (group_id, course_id);
create index assignments_activity_idx on public.assignments (activity_id, course_id);
create index assignments_section_idx on public.assignments (book_section_id, course_id);
create index assignments_vocab_idx on public.assignments (vocabulary_set_id, course_id);
create index assignments_assigned_by_idx on public.assignments (assigned_by);
create index assignment_recipients_student_idx on public.assignment_recipients (student_id);
create index user_roles_granted_by_idx on public.user_roles (granted_by);
