# Security and privacy

> Status: **Phase 1 controls implemented locally** — see §0. Controls marked ☐ below are
> the full design; §0 says which are in place.

The platform holds personal and educational data about students, some of whom may be
minors. The non-negotiable rule:

> **A logged-in student must never be able to read or change another student's data —
> not through the UI, not by editing a URL, and not by calling the API or database
> directly with their own token.**

## 0. Phase 1 implementation status (2026-10-03)

**In place and covered by automated tests:**
invite-only accounts (public sign-up refused); 10-character minimum password; TOTP MFA,
with manager and admin powers requiring `aal2` in the database; password reset and invites
through one-time links verified on the server (`/auth/confirm`); HttpOnly, `SameSite=Lax`
session cookie; identity from the verified JWT; sign-out; route guards on every area
layout, page and server action (`requireArea`); RLS enabled and forced on every table
with default deny; secret key confined to `src/server/privileged`; roles read from
tables; Zod validation of every action input and of the environment; no RPC surface;
no raw-HTML rendering (lint rule); same-site checks on server actions; 404 for
other people's records (IDOR); nonce-based CSP, HSTS, `nosniff`, `X-Frame-Options`,
`Permissions-Policy`, no `X-Powered-By`; open-redirect protection on `next`; identical
error for wrong password and unknown account; append-only audit log; last-admin
protection; `.env.example` only, with `.env*.local` ignored; dependency audit, Dependabot
and CODEOWNERS for sensitive paths.

**Known limit, by design:** pages verify the access token locally (fast, signature
checked), so after sign-out or deactivation an already-issued access token keeps working
until it expires (≤ 1 hour); the refresh token is revoked at once. Removing a role takes
effect immediately because roles are read from the database on every request. Sensitive
actions that must see revocation instantly should call `auth.getUser()` (round trip to
Supabase Auth) rather than rely on the token alone.

**Test evidence:** 66 pgTAP database checks, 10 API-level attack tests with a real
student token, 23 end-to-end tests (including axe accessibility checks and the full
invite → email → set-password flow and the manager group-setup flow), and 34 unit tests. Opening up a single policy
on purpose makes 7 tests fail (checked).

**Still to do:** custom SMTP on the school domain and leaked-password protection
(hosted-project settings); Vercel WAF rate limits; Sentry with PII scrubbing; CodeQL;
branch protection (needs the GitHub organization); storage policies (Phase 3);
"download my data" and retention jobs (Phase 10); external review (Phase 10).

## 1. Threat model

| Actor                     | Example                                                                                            | Primary controls                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Curious student           | Changes `/learn/attempts/<id>` to a classmate's id; calls the Supabase REST API with their own JWT | RLS on every table; ids taken from the session, never from input; tests that try exactly this |
| Student gaming scores     | Reads answer keys from network traffic; posts `is_correct: true`                                   | Keys never sent to the browser; server-side grading; no direct write policy on graded tables  |
| Teacher overreach         | Views a student in a group they don't teach                                                        | `teaches_student_in_course` policies; tests with an "unrelated teacher" fixture               |
| Compromised staff account | Phished admin password                                                                             | MFA (TOTP) required for admin and pedagogical manager; audit log; session revocation          |
| External attacker         | Credential stuffing, XSS, CSRF, injection                                                          | Rate limits, leaked-password check, CSP, origin checks, parameterised queries                 |
| Insider / ex-staff        | Leaves school with access                                                                          | Role removal is immediate (ADR-007); deactivation revokes sessions; ≥2 org owners             |
| Supply chain              | Malicious npm update                                                                               | Lockfile, Dependabot, minimal dependencies, CI audit                                          |

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
- ☑ Student **entry codes** (from the staff room, ADR-030), students only. A teacher
  issues a code for a student in a group they teach; it is shown once, and only
  SHA-256(pepper + "$" + code) is stored, with the pepper a server secret
  (`STUDENT_CODE_PEPPER`), so a leaked table can't be guessed offline. The tables have no
  grants for any user session (pgTAP and API tests). A new code replaces the old one. A
  code never opens an account with any staff role. Every failure gets the same message.
  The code space is about 8.5 × 10¹¹; with the throttle below, guessing any one of 1,000
  students' codes takes centuries. Trade-off accepted from the staff room: a flood of
  wrong codes can pause code sign-in for everyone for 15 minutes (password sign-in is
  unaffected).

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
  lookup goes through RLS with the caller's session. Covered by tests: pgTAP proves
  that a student can't read or write another student's attempts, notebook answers or
  progress, and E2E proves that pages for other students' records, other courses'
  sections, drafts and other groups return the same 404 as a missing page.
  Server Actions take ids only as references that RLS re-checks; the acting user
  always comes from the verified session, never from the form.

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
- ☐ App: Vercel WAF rate-limit rules on login/reset paths.
- ☑ Wrong entry codes: 10 per caller address and 100 overall per 15 minutes (only misses
  count, so a class on one school network is never locked out). The caller address is
  the hosting edge's `x-forwarded-for`; the overall cap holds even if it is spoofed.
- ☑ Per-user limit on answer submissions: 60 checked answers per minute, enforced in
  the grading action (Phase 4).

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
- Teacher X cannot see X's students' attempts in a _different_ course.
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
- Teacher Y opening group X's page or its activities' teacher view → 404; teacher X
  opening an activity of a course they don't teach through their own group → 404;
  a student opening any teacher view → 404.
- Student B's answer request rewritten in flight to carry student A's attempt id →
  refused, and nothing is written to A's attempt (checked in the database).

**Answer keys (Phase 4)** — beyond "students can't read `activity_item_keys`": the
public part of an exercise must not give the answer away either. An API test signs in
as a student, reads every exercise they can see, and checks each one against its key
(no key text in the data; options, matches and words not in answer order; ids not
aligned with the answer). The content tooling refuses such items at import (ADR-024).

Before production launch (Phase 10): an external or independent review of RLS policies,
an OWASP ASVS Level 2 checklist pass, and a dependency/secret scan.

## 4. Privacy and data minimisation

New School appears to operate in Israel (Privacy Protection Law, including Amendment 13
in force since August 2025, and the Data Security Regulations) and may teach students in
Brazil (LGPD). Have counsel confirm obligations — this section is engineering design, not
legal advice.

### What we collect

| Data                                | Why                          | Where                                |
| ----------------------------------- | ---------------------------- | ------------------------------------ |
| Email                               | Login, password reset        | `auth.users` (separate from profile) |
| Display name, optional avatar       | Shown to student and teacher | `profiles`                           |
| Interface language, timezone        | UI, "practice this week"     | `profiles`                           |
| Enrollment and group membership     | Course access                | `enrollments`                        |
| Answers, attempts, progress, events | The learning service itself  | learner tables                       |

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
