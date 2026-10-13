-- Student entry codes, moved from the staff room (docs/STAFF-ROOM-MERGE.md).
-- A student signs in by typing one short code a teacher hands out. Only a
-- hash is stored: SHA-256 of a server-side pepper + "$" + the code, the same
-- scheme as the staff room, so imported students keep their codes. Without
-- the pepper (a server secret, never in the database) a leaked table cannot
-- be ground down offline.
--
-- Neither table is reachable with a user's session: no grants, RLS forced and
-- no policies. Only the server's privileged module reads and writes them,
-- after its own checks (the issuing teacher teaches the student).

create table public.student_codes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  issued_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Wrong-code throttle, per caller and overall ("ip:<address>" and "all"):
-- a code guess is aimed at every student at once, so the counter hangs off
-- the caller, not an account.
create table public.code_attempts (
  scope text primary key check (char_length(scope) between 1 and 120),
  window_start timestamptz not null,
  n int not null default 0 check (n >= 0)
);

alter table public.student_codes enable row level security;
alter table public.student_codes force row level security;
alter table public.code_attempts enable row level security;
alter table public.code_attempts force row level security;

revoke all on public.student_codes, public.code_attempts from public, anon, authenticated;
grant all on public.student_codes, public.code_attempts to service_role;
