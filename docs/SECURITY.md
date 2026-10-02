# Security and privacy

> Status: **Proposed — awaiting approval.** Controls marked ☐ are to be implemented in
> the phase shown; none are implemented yet.

The platform holds personal and educational data about students, some of whom may be
minors. The non-negotiable rule:

> **A logged-in student must never be able to read or change another student's data —
> not through the UI, not by editing a URL, and not by calling the API or database
> directly with their own token.**

## 1. Threat model

| Actor | Example | Primary controls |
|---|---|---|
| Curious student | Changes `/learn/attempts/<id>` to a classmate's id; calls the Supabase REST API with their own JWT | RLS on every table; ids taken from the session, never from input; tests that try exactly this |
| Student gaming scores | Reads answer keys from network traffic; posts `is_correct: true` | Keys never sent to the browser; server-side grading; no direct write policy on graded tables |
| Teacher overreach | Views a student in a group they don't teach | `teaches_student_in_course` policies; tests with an "unrelated teacher" fixture |
| Compromised staff account | Phished admin password | MFA (TOTP) required for admin and pedagogical manager; audit log; session revocation |
| External attacker | Credential stuffing, XSS, CSRF, injection | Rate limits, leaked-password check, CSP, origin checks, parameterised queries |
| Insider / ex-staff | Leaves school with access | Role removal is immediate (ADR-007); deactivation revokes sessions; ≥2 org owners |
| Supply chain | Malicious npm update | Lockfile, Dependabot, minimal dependencies, CI audit |

## 2. Controls

### Authentication — Phase 1
- ☐ Supabase Auth, **invite-only**: public sign-up disabled. Admin invites staff; admin
  or pedagogical manager invites students.
- ☐ Passwords: minimum 10 characters, leaked-password protection (HaveIBeenPwned)
  enabled, bcrypt hashing by Supabase. No composition rules beyond length (NIST 800-63B).
- ☐ **MFA (TOTP) mandatory** for `admin` and `pedagogical_manager`; admin-only RLS
  policies require `aal2` in the JWT. Optional for teachers at launch, required later.
- ☐ Password reset via Supabase's one-time, expiring email link; responses never reveal
  whether an email exists.
- ☐ Custom SMTP on a New School domain with SPF, DKIM and DMARC, so reset and invite
  emails arrive and can't be spoofed.
- ☐ Student "entry codes" (in the staff prototype) are **not** carried over as a
  permanent credential. If wanted, a code becomes a one-time *claim* link that leads to
  setting a password. See [ROADMAP.md decisions](ROADMAP.md#decisions-needed-before-phase-1).

### Sessions — Phase 1
- ☐ `@supabase/ssr` cookie sessions: `HttpOnly`, `Secure`, `SameSite=Lax`. The browser
  never needs the token because it never calls Supabase directly (server-first).
- ☐ On the server, identity comes from `auth.getUser()` / verified JWT claims, **never**
  from the unverified `getSession()` cookie payload.
- ☐ Short-lived access tokens (≤ 1 h) with refresh-token rotation and reuse detection.
- ☐ Inactivity timeout and maximum session lifetime configured (staff shorter than
  students).
- ☐ Logout revokes the session server-side. Deactivating a user revokes all of their
  sessions.

### Authorization — Phase 1
- ☐ Layer 1: every route group (`/learn`, `/teach`, `/manage`, `/admin`) has a server
  layout guard (`requireRole`). Every Server Action re-checks — layouts alone are not
  a security boundary in Next.js.
- ☐ Layer 2: RLS enabled **and forced** on every table; default deny. See
  [DATABASE.md §4](DATABASE.md#4-row-level-security-model).
- ☐ The Supabase secret key is used only in `server/privileged/`, imported with
  `server-only`, and that code takes the user id from the session.
- ☐ Roles are read from tables at request time, so removing a role works immediately.

### Input, output and injection — Phases 1–4
- ☐ Zod schemas validate every Server Action input, every content document and the
  environment at boot.
- ☐ **SQL injection:** all queries are parameterised through supabase-js/PostgREST or
  typed RPC arguments. No string-built SQL. User input is never interpolated into
  PostgREST filter strings (`.or("...")`). That filter-injection risk is specific to
  this stack, so it's in the review checklist.
- ☐ **XSS:** React escapes by default. Content blocks use a restricted inline format
  (bold, italic, links to allow-listed hosts) rendered by our own component. No raw HTML
  from content, no `dangerouslySetInnerHTML`. Enforced by an ESLint rule.
- ☐ **CSRF:** Server Actions are POST-only and Next.js compares `Origin` with `Host`;
  cookies are `SameSite=Lax`; any custom Route Handler that mutates checks origin
  explicitly.
- ☐ **IDOR:** ids are UUIDs (not enumerable), but security never relies on that. Every
  lookup goes through RLS with the caller's session.

### HTTP security headers — Phase 1
- ☐ Content-Security-Policy with per-request nonces: `default-src 'self'`; scripts by
  nonce; `img-src`/`media-src` self + Supabase Storage host; `frame-ancestors 'none'`;
  `object-src 'none'`; `base-uri 'none'`.
- ☐ `Strict-Transport-Security` (2 years, preload once stable), `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
  (microphone only where speaking activities need it, later).
- ☐ Fonts self-hosted via `next/font` — no requests to Google from students' browsers.

### Rate limiting — Phases 1 & 4
- ☐ Auth endpoints: Supabase Auth's built-in limits (tightened), plus CAPTCHA
  (Cloudflare Turnstile) on login/reset if abuse appears.
- ☐ App: Vercel WAF rate-limit rules on login/reset paths; per-user limit on answer
  submissions (e.g. 60/min) enforced in the grading action.

### Storage — Phase 3
- ☐ Buckets are **private**. Paths are `courses/<course_id>/…`; the server issues
  short-lived signed URLs (≤ 1 h) only after `can_view_course`. Avatars are in a separate
  bucket with own-folder policies.
- ☐ Uploads (staff only) are checked for type, size and extension; SVG uploads are
  rejected or sanitised (SVG can carry script).

### Audit logging — Phase 1 (schema), Phase 8 (UI)
- ☐ `audit_log` records role grants and revocations, account creation and deactivation,
  enrollments, group/teacher assignment, publish/unpublish, and data exports and
  deletions. It is insert-only, and admins can read it but not change it.

### Secrets — Phase 0
- ☐ No secret in Git, ever. `.env.example` lists names only. `.env*.local` is git-ignored.
- ☐ Secrets are stored in Vercel environment variables (per environment) and GitHub
  Actions secrets. Production and staging keys are different.
- ☐ GitHub **secret scanning + push protection** enabled at organization level.
- ☐ `NEXT_PUBLIC_` is used only for genuinely public values (Supabase URL, publishable
  key); CI fails if a known secret name gets that prefix.

### Dependencies and CI — Phase 0/1
- ☐ Lockfile committed; `pnpm install --frozen-lockfile` in CI; Dependabot weekly;
  `pnpm audit --prod` gate on high/critical vulnerabilities.
- ☐ CodeQL (or equivalent) on pull requests.
- ☐ Branch protection: no direct pushes to `main`, required reviews and checks.

## 3. Security testing

Authorization tests run in CI on every pull request against a local Supabase with the
seed fixtures (student A, student B, teacher of group X, teacher of unrelated group Y,
manager, admin, anonymous).

**Database level (pgTAP, `supabase test db`)** — the most important layer, because it's
what an attacker holding a real student token can reach:
- Student A selects `attempts`/`responses`/`section_progress`/`learning_events` → only
  A's rows; selecting by B's ids returns 0 rows.
- Student A cannot insert or update `responses`, `attempts.score` or `enrollments`.
- Student cannot select `activity_item_keys` or `section_teacher_notes`.
- Student cannot see unpublished content, or content of a course they aren't enrolled in.
- Teacher Y cannot see group X, its students, or their attempts.
- Teacher X cannot see X's students' attempts in a *different* course.
- Anonymous role sees nothing.
- `audit_log` cannot be updated or deleted by any app role.

**API level (Vitest integration)** — call the Supabase REST endpoint directly with
student A's JWT and the public key, attempting B's rows. This replicates the "manipulate
the API call" attack exactly.

**Application level (Playwright)**
- Student opening `/teach`, `/manage`, `/admin` → redirected/403.
- Teacher Y opening `/teach/groups/<X>` → 404 (not found, not "forbidden", to avoid
  confirming existence).
- Anonymous visitor opening any `/learn` URL → login.
- Student A pasting B's attempt URL → 404.
- Answer key absent from page HTML and network responses (asserted).

Before production launch (Phase 10): an external or independent review of RLS policies,
an OWASP ASVS Level 2 checklist pass, and a dependency/secret scan.

## 4. Privacy and data minimisation

New School appears to operate in Israel (Privacy Protection Law, including Amendment 13
in force since August 2025, and the Data Security Regulations) and may teach students in
Brazil (LGPD). Have counsel confirm obligations — this section is engineering design, not
legal advice.

### What we collect

| Data | Why | Where |
|---|---|---|
| Email | Login, password reset | `auth.users` (separate from profile) |
| Display name, optional avatar | Shown to student and teacher | `profiles` |
| Interface language, timezone | UI, "practice this week" | `profiles` |
| Enrollment and group membership | Course access | `enrollments` |
| Answers, attempts, progress, events | The learning service itself | learner tables |

### What we deliberately do **not** collect in this platform
National ID, phone, address, birth date, payment data, health or other special
categories, device fingerprints, precise location, third-party advertising or analytics
identifiers. Phone numbers and billing belong to the school's operations system, not the
learning platform.

> ⚠️ **If any students are under 18**, a parent/guardian consent flow and an age
> attribute become necessary (LGPD Art. 14; Israeli law on minors' data). This is a
> decision needed before Phase 1.

### Principles in the design
- Authentication data (`auth` schema) is separate from the educational profile.
- Analytics shown to teachers are about their own groups only. School-wide analytics
  are aggregated, with small-group suppression (n < 5) when shown outside the teaching
  relationship.
- No session replay, no third-party trackers, no ad pixels (ADR-012).
- **Data subject rights:** self-service "download my data" (JSON) by Phase 10; deletion
  on request through admin. Deletion removes the profile and auth user, and
  **anonymises** learner records (keeping aggregate question statistics).
- **Retention:** proposed: learner records kept for the enrollment plus 24 months, then
  anonymised; audit log 24 months; backups 30 days. Needs school approval.
- **Sub-processors:** Supabase, Vercel, Resend, Sentry. Each needs a DPA signed by the
  New School legal entity (not an individual). The list is maintained in this file.
- **Breach response:** documented runbook (contain → assess → notify the school's
  responsible person → notify regulators/data subjects where required → post-mortem).

## 5. Pre-production checklist (Phase 10)

- [ ] All pgTAP + API + E2E authorization tests green
- [ ] Every table has RLS enabled and forced (CI query asserts this)
- [ ] Supabase Security Advisor: no warnings
- [ ] CSP has no `unsafe-inline` for scripts
- [ ] MFA enforced for admin/manager
- [ ] Secrets rotated from any value ever used in development
- [ ] Backups verified by a real restore drill
- [ ] Privacy notice published; DPAs signed; retention job running
- [ ] Two organization owners have tested their access to GitHub, Vercel, Supabase, DNS
