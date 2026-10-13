-- Identity: educational profile and roles. Credentials stay in auth.users.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 300),
  ui_locale text not null default 'he' check (ui_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  timezone text not null default 'Asia/Jerusalem' check (char_length(timezone) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- A person may hold several roles (a teacher can also be a pedagogical manager).
create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Every new auth user gets a profile. Sign-up is disabled, so users only come
-- from admin invites, where the display name is set by staff.
create function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();
