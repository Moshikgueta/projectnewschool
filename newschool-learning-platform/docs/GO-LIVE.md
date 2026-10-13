# Go-live checklist (pilot release)

> For the day New School's own Supabase and Vercel accounts exist. Decision of the school
> owner, 2026-10-13: **all courses open to students at once, labelled "Pilot", and
> mistakes are fixed as students report them** (ADR-040). The content in `content/` is
> already published as a pilot (`pnpm content:publish-pilot`); teachers keep answering
> each cycle's `review:` questions while students use it.
>
> Who: one **operator** (does the technical steps from their own computer), the
> **pedagogical manager** and the **office**. Allow half a day. Tick each box as you go.
> **No secret value is ever written into this repository, a ticket or a chat**: secrets go
> into the Supabase dashboard, Vercel, and the school's password manager only.

## 0. Before you start

- [ ] The accounts belong to the school, with two owners each (see
      [DEPLOYMENT.md §1](DEPLOYMENT.md#1-ownership)): GitHub organization, Vercel team,
      Supabase organization, the school's password manager.
- [ ] The repository is in the school's GitHub organization and `main` is green in CI.
- [ ] The operator's computer has: Node 22+, pnpm 10, `git`, `openssl`, and a fresh clone
      of the repository (`pnpm install` done). The operator does **not** need a local
      `.env.local` for production steps, and must not put production values in one.
- [ ] Decide the address, e.g. `https://learn.newschool.co.il` (written below as
      `<SITE_URL>`), and who controls DNS for it.

## 1. Create the Supabase project

1. Supabase dashboard → the school's organization → **New project**.
   - Name: `nslp-production`.
   - Region: **Central EU (Frankfurt) — `eu-central-1`** (closest to Israel with the same
     region as Vercel's `fra1`; see [ARCHITECTURE.md §6](ARCHITECTURE.md#6-data-residency-and-latency)).
   - Database password: generate a long one, store it in the password manager
     ("Supabase production DB password"). It is needed for migrations only.
   - Plan: Pro (daily backups).
2. Note the **project ref** (the `xxxxxxxx` in `https://xxxxxxxx.supabase.co`), written
   below as `<REF>`.
3. **Settings → API**:
   - Exposed schemas: `public` and `graphql_public` (the defaults, as in
     `supabase/config.toml`); **never `app`** (the authorization helpers live there).
   - "Automatically expose new tables": **off** (the migrations grant access table by
     table).
   - Copy the **publishable key** and the **secret key** straight into the password
     manager (the secret key: "Supabase production secret key — server only").

## 2. Apply the database migrations

From the operator's computer, in `newschool-learning-platform/`:

```sh
pnpm exec supabase login                       # opens the browser; school account
pnpm exec supabase link --project-ref <REF>    # asks for the DB password (password manager)
pnpm exec supabase db push                     # applies supabase/migrations/*, in order
```

- [ ] `db push` lists every migration up to `20261013002000_pilot_and_content_reports.sql`
      and finishes without errors.
- [ ] **Never** run `supabase db reset`, `--include-seed` or `supabase/seed.sql` against
      production: the seed contains test accounts with a published password.
- [ ] Dashboard → Table editor: every table shows "RLS enabled".

From now on, migrations reach production through the release workflow
([DEPLOYMENT.md §3](DEPLOYMENT.md#3-cicd)), not from a laptop.

## 3. Auth settings (Supabase dashboard → Authentication)

Match `supabase/config.toml`, which is what every test runs against:

| Where                        | Setting                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Sign In / Providers → Email  | Email provider **on**; "Allow new users to sign up" **off** (invite-only); "Confirm email" off (invites confirm) |
| Sign In / Providers → others | Phone, anonymous sign-ins and every social provider **off**                                                      |
| URL Configuration            | Site URL `<SITE_URL>`; Redirect URLs `<SITE_URL>/**` (add the Vercel production URL too until DNS is live)       |
| Password                     | Minimum length **10**                                                                                            |
| Multi-factor                 | TOTP (authenticator app): enroll **and** verify enabled. Managers, office and admins cannot work without it      |
| Sessions                     | Time-box 720 h, inactivity timeout 168 h; refresh-token rotation on                                              |
| JWT expiry                   | 3600 s                                                                                                           |
| Emails → SMTP                | The school's Resend account, verified sending domain (e.g. `mail.newschool.co.il`)                               |
| Emails → Templates           | "Invite user" and "Reset password": paste `supabase/templates/invite.html` and `recovery.html`                   |
| Rate limits                  | Keep the defaults or stricter                                                                                    |

## 4. Generate `STUDENT_CODE_PEPPER`

Students sign in with entry codes, stored as SHA-256 of this pepper + the code
([SECURITY.md](SECURITY.md), ADR-030).

- If the staff room's existing codes must keep working: use the **same value** as the
  staff room Worker's secret (copy it from Cloudflare → the Worker → Settings →
  Variables, straight into Vercel).
- Otherwise generate a new one on the operator's computer and paste it into the password
  manager, then into Vercel:

  ```sh
  openssl rand -hex 32
  ```

- [ ] Stored in the password manager as "STUDENT_CODE_PEPPER (production)". Changing it
      later invalidates every entry code.

## 5. Vercel project and environment variables

1. Vercel → the school's team → **Add New → Project** → import the repository from the
   school's GitHub organization.
   - Root directory: `newschool-learning-platform` (if the app sits in a subfolder of the
     repository).
   - Framework: Next.js (detected). Install command `pnpm install --frozen-lockfile`.
   - Function region: **Frankfurt (`fra1`)**. Node.js 22.
2. **Settings → Environment Variables**, scope **Production** (names only here; values from
   the password manager or the Supabase dashboard; see `.env.example` and
   [DEPLOYMENT.md §4](DEPLOYMENT.md#4-environment-variables)):

   | Name                                   | Secret? |
   | -------------------------------------- | ------- |
   | `APP_ENV` (= `production`)             | no      |
   | `NEXT_PUBLIC_SITE_URL`                 | no      |
   | `NEXT_PUBLIC_SUPABASE_URL`             | no      |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no      |
   | `SUPABASE_SECRET_KEY`                  | **yes** |
   | `STUDENT_CODE_PEPPER`                  | **yes** |
   | `SENTRY_DSN` (optional)                | no      |

   Mark the two secrets "Sensitive". Never give the secret key a `NEXT_PUBLIC_` name.

3. **Settings → Domains**: add `<SITE_URL>`'s host and create the DNS record Vercel shows
   (Cloudflare DNS, "DNS only").

## 6. Deploy

- [ ] Vercel → Deployments → deploy `main` to Production (or push a release tag, once the
      release workflow exists).
- [ ] `<SITE_URL>/login` loads over HTTPS, in Hebrew, with the school's logo.
- [ ] Response headers include `Content-Security-Policy` and `Strict-Transport-Security`
      (browser dev tools → Network → the document).

## 7. Import the content

From the operator's computer, in `newschool-learning-platform/`, on an up-to-date `main`.
The secret key is typed in (not saved in a file, not in shell history) and forgotten
afterwards:

```sh
git pull && pnpm install
pnpm content:validate                                   # must end with ✓ and no problems
export APP_ENV=production
export NEXT_PUBLIC_SUPABASE_URL=https://<REF>.supabase.co
read -rs SUPABASE_SECRET_KEY && export SUPABASE_SECRET_KEY   # paste from the password manager, Enter
pnpm content:import --production --confirm=<REF>.supabase.co
unset SUPABASE_SECRET_KEY APP_ENV NEXT_PUBLIC_SUPABASE_URL
```

- The import refuses production without `APP_ENV=production`, `--production` **and**
  `--confirm=` with the project's host (`src/content/import-target.ts`). With `APP_ENV` set
  it ignores `.env.local`.
- [ ] The output ends with `✓ imported into https://<REF>.supabase.co`, after 18
      `→ course … (published, pilot)` lines and their cycles.
- [ ] Running it a second time changes nothing (it upserts by slug).

## 8. First staff accounts

1. **First admin** (once): Supabase dashboard → Authentication → Users → **Invite user**
   (the school's admin address). Then SQL editor:

   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = '<admin email>';
   ```

2. The admin accepts the invite, sets a password, signs in and sets up the authenticator
   app (MFA) at `<SITE_URL>/admin`.
3. In `/admin`, the admin invites, each with one role:
   - [ ] the **pedagogical manager** (`pedagogical_manager`),
   - [ ] the **office** (`office`) — one account per person, not a shared one,
   - [ ] each **teacher** (`teacher`).
4. Everyone sets a password from the invite email; the manager and the office set up MFA
   at first sign-in. Recovery codes and a second authenticator go into the password
   manager for the manager's account.

## 9. Groups, teachers and students

1. **Office** (`/office/students`): register each student (name, contact details), then
   **issue an entry code** for each. Give the code to the student privately (in person or
   to their own phone); it is shown once.
2. **Pedagogical manager** (`/manage/groups`): create one group per course and class
   (e.g. "Spanish Level 1 · Tuesday"), add its teacher(s), and enrol its students. A
   private student is a group of one (ADR-008).
3. **Teachers** (`/teach`): open each group, set the **active cycle**, and add the next
   classes (and homework if wanted).

## 10. Smoke tests (real devices: a phone and a computer)

- [ ] A student signs in with an entry code, sees their course with the **"פיילוט / Pilot"**
      badge, the notebook and practice pages, and only their own course.
- [ ] The student opens an exercise, answers a question (right and wrong), finishes it.
- [ ] The student taps **"דווח על טעות / Report a mistake"** on a question, sends a short
      report, sees the thank-you message.
- [ ] Their teacher sees it in **Reports** (`/teach/reports`); the manager in
      `/manage/reports`; another student cannot (no menu item; the address is a 404).
- [ ] The manager marks it resolved; it moves to "Resolved".
- [ ] A teacher opens their group, marks attendance for a class, sees the student's
      progress.
- [ ] The office books a room and a private lesson.
- [ ] Sign out, password reset email arrives and works.
- [ ] A student opening `/manage` or another student's attempt address gets "not found".

## 11. Fixing a reported mistake

Reports arrive in `/manage/reports` (all courses) and `/teach/reports` (teachers: their
courses). Each links to the exercise or page. Two ways to fix:

**A. In the platform (quick, one fix):** pedagogical manager → **Open in the editor** →
change the page, or the exercise's question → Save → back in Reports, **Mark resolved**.
Then copy the same change into the YAML file in `content/` (a pull request), so the
repository stays the source of truth.

**B. In the content files (several fixes, or a teacher's review):** edit the cycle file in
`content/<course>/`, run `pnpm content:validate`, open a pull request, merge, then run the
import of §7 again. Mark the reports resolved.

Rules that decide which way:

- Pages edited in the platform are **not** overwritten by a later import (it warns and
  skips them unless `--overwrite-app-edits`). Exercises **are** rewritten from the file, so
  after fixing an exercise in the editor, put the same fix in its YAML file before the next
  import, or the import brings the old version back.
- A question students have already answered keeps its options and answer key (ADR-036):
  its wording, points and feedback can change, but a **wrong answer key on an answered
  question cannot be edited**. Fix it by adding a corrected question (new `id`) and
  setting the old one's feedback to explain, or by archiving the exercise and publishing
  a corrected copy under a new slug.
- When a teacher answers a cycle's `review:` questions, remove them from the file in the
  same pull request as the fix.

## 12. After the pilot

When teachers have reviewed a course: empty its cycles' `review:` lists, and either set
`pilot: false` in its `course.yaml` (and import) or untick **Pilot** in
`/manage/content/<course>`. The validator then refuses any published cycle that still has
open review questions in that course.
