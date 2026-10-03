# Architecture

> Status: **Accepted** (2026-10-03, when Phase 1 was started). Phases 1 and 2 (except official
> brand values) are implemented locally.
> Last updated: 2026-10-03.

## 1. What we are building

One New School learning environment where a student logs in and finds everything for
their course — class notebook, workbook, homework, practice, vocabulary, review,
recommendations and progress — organised around the school's **Cycles** methodology and
the **before → during → after class** rhythm.

It is one product with four audiences (student, teacher, pedagogical manager, admin),
built so that new languages, levels, courses and cycles are **data**, not code.

## 2. Architecture at a glance

```
                ┌──────────────────────────────────────────────────────┐
 Browser        │  Next.js App Router (React Server Components)        │
 (desktop,      │                                                      │
  tablet,       │  app/            thin routes, layouts, loading/error │
  mobile)  ───► │  server/         auth guards · queries · actions     │
                │  domain/         pure TS: grading, recommendations,  │
                │                  progress, spaced repetition         │
                │  content/        block registry + exercise engine    │
                │  ui/             New School design system            │
                └───────────────┬──────────────────────────────────────┘
                                │ supabase-js with the *user's* session (RLS applies)
                                │ + one narrow privileged module (grading/admin)
                ┌───────────────▼──────────────────────────────────────┐
                │  Supabase                                            │
                │   Auth  (email+password, invites, MFA for staff)     │
                │   Postgres (+ Row Level Security on every table)     │
                │   Storage (private buckets, signed URLs)             │
                └──────────────────────────────────────────────────────┘
```

Key properties:

- **Server-first.** Pages read data in React Server Components; mutations go through
  Server Actions. The browser never talks to the database directly in the MVP. Client
  components exist only where interaction needs them (exercises, audio, navigation).
- **Two authorization layers.** Server code checks the session and role on every request
  (`server/auth`), and Postgres Row Level Security enforces the same rules again at the
  data layer. Either layer alone must be enough to stop a student reading another
  student's data.
- **Content is data.** Notebooks, workbooks and activities are stored as validated,
  versioned JSON block documents and rendered by a registry of React components
  (`<GrammarBox/>`, `<Dialogue/>`, `<FillBlank/>`, …). New courses need no deploy.
- **Pure domain logic.** Grading, recommendation rules, progress maths and the
  vocabulary scheduler are framework-free TypeScript functions with unit tests, so they
  can be moved (e.g. to a background job) without a rewrite.

## 3. Stack assessment

The preferred stack was evaluated against: security, maintainability, performance, low
operational complexity, cost, hireability of future developers, and scalability.

| Layer                 | Preferred                 | Recommendation                                              | Why                                                                                                                                                                                                                                            |
| --------------------- | ------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework             | Next.js + TS + App Router | **Keep**                                                    | Largest hiring pool, RSC keeps JS small, Server Actions give built-in CSRF origin checks. Pin the current stable major at scaffold time; `strict` TypeScript.                                                                                  |
| UI styling            | Tailwind                  | **Keep — Tailwind v4 driven by our own token layer**        | Tokens live in one CSS file (`@theme`); components never contain raw hex values. See [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md).                                                                                                                     |
| Accessible primitives | —                         | **Add React Aria Components** (owned/styled by us)          | Best-in-class keyboard, screen-reader, **RTL** and touch handling — including accessible drag-and-drop — which our exercises need. Unstyled, so it doesn't import someone else's look. (Radix is the fallback if the Phase 1 spike disagrees.) |
| Database              | PostgreSQL                | **Keep**                                                    | Relational data (courses → cycles → activities, groups, enrollments) and RLS.                                                                                                                                                                  |
| Platform              | Supabase                  | **Keep**                                                    | Postgres + Auth + Storage + RLS in one managed service; it's still plain Postgres, so we can leave.                                                                                                                                            |
| Auth                  | Supabase Auth             | **Keep**                                                    | Invites, password reset, MFA (TOTP), leaked-password protection, session refresh rotation.                                                                                                                                                     |
| Data access           | —                         | **supabase-js + generated types; no ORM in request paths**  | An ORM connecting as a privileged DB role silently bypasses RLS. Using the user's session keeps RLS in force on every read.                                                                                                                    |
| Validation            | —                         | **Zod** at every boundary                                   | Server Action inputs, content blocks, env vars.                                                                                                                                                                                                |
| i18n                  | —                         | **next-intl**                                               | UI strings; UI locale is independent of content language/direction.                                                                                                                                                                            |
| Hosting               | Vercel or Cloudflare      | **Vercel (Pro, New School team)** — Cloudflare kept for DNS | See §5.                                                                                                                                                                                                                                        |
| Tests                 | —                         | **Vitest + Testing Library, pgTAP, Playwright + axe**       | Unit/component, database/RLS, end-to-end + accessibility.                                                                                                                                                                                      |
| Errors                | —                         | **Sentry** (PII scrubbing on, no session replay)            | Production visibility without invasive tracking.                                                                                                                                                                                               |
| Email                 | —                         | **Resend via Supabase custom SMTP**, on a New School domain | Supabase's built-in mailer is rate-limited and not meant for production. The existing staff tools already use Resend.                                                                                                                          |

### What I recommend _changing_ from the current state

The existing staff dashboard (`Moshikgueta/projectnewschool`) runs on **Cloudflare
Workers + D1 (SQLite)** with hand-written auth. That was the right call for a prototype,
but I recommend **not** building the learning platform on D1:

- D1 has no Row Level Security, so every authorization rule would live only in
  application code — one missed check is a data leak.
- Student-progress analytics (error rates per question, per group, over time) are
  relational, aggregate-heavy queries that Postgres handles far better.
- Supabase replaces ~1,000 lines of custom auth/session code with a maintained service.

The staff dashboard keeps running on its current stack. The two products converge later
(see §7), not now.

## 4. Module boundaries

```
src/
  app/          Routes only. A page = fetch via server/, render via ui/ + content/.
  server/       Everything that touches Supabase. 'server-only' imports.
    auth/         getSessionUser(), requireRole(), requireGroupTeacher()...
    queries/      read models per feature (dashboard, notebook, group...)
    actions/      Server Actions: Zod-validate → authorize → call domain → persist
    privileged/   the ONLY module allowed the Supabase secret key (grading, invites)
  domain/       Pure functions, no I/O: grading/, recommendations/, progress/, srs/
  content/      Block schemas (Zod), block renderer registry, exercise components
  ui/           Design-system components (Button, Card, ProgressBar, Logo, ...)
  i18n/         next-intl config + messages/{he,en,...}.json
```

Rules (enforced by ESLint `no-restricted-imports` where possible):

1. `app/` and `ui/` never import the Supabase client directly.
2. Only `server/privileged/` may read `SUPABASE_SECRET_KEY`; it never accepts a user id
   from input — it takes the id from the verified session.
3. `domain/` imports nothing from `server/`, `app/` or React.
4. No hex colour values outside the token file.

## 5. Hosting decision: Vercel vs Cloudflare

|                       | Vercel Pro                                  | Cloudflare Workers (OpenNext adapter)                         |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| Next.js compatibility | Native, first-party                         | Very good via adapter; occasional gaps after Next.js releases |
| Preview per PR        | Built in                                    | Possible, more setup                                          |
| Ops complexity        | Lowest                                      | Moderate (adapter, bundle-size limits, Node-compat flags)     |
| Cost (pilot)          | ~$20 / deploying seat / month               | ~$5 / month                                                   |
| Team familiarity      | New                                         | Already used for staff tools                                  |
| Commercial use        | Requires Pro (Hobby is non-commercial only) | Allowed on paid Workers plan                                  |

**Recommendation: Vercel Pro under a New School team**, functions pinned to the Frankfurt
region next to the Supabase database. The extra ~$15–35/month buys the lowest
maintenance burden and the smoothest path for future developers. Cloudflare stays as DNS
and for the existing staff tools. This is a reversible decision: the app has no
Vercel-specific APIs, so moving to Cloudflare later is an adapter change.

## 6. Data residency and latency

- Supabase project region: **Frankfurt (eu-central-1)** — closest Supabase region to
  Israel, EU-grade data protection that also serves LGPD transfers.
- Vercel function region: **fra1**, co-located with the database (every page does
  several queries; cross-region round trips would dominate latency).

## 7. Relationship to existing New School systems

| System                                                          | Today                                          | Plan                                                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff dashboard (חדר המורים) — rooms, timetable, staff accounts | Cloudflare Worker + D1, personal repo (public) | Keeps running. Its UX research and security decisions feed this platform. Long term, scheduling/operations become a module on the same Postgres and identity. |
| Spanish course site with paid buyer accounts (PayPlus)          | Cloudflare + D1, personal repo                 | Out of MVP scope. Later: a paid purchase creates an enrollment here.                                                                                          |
| 18 digital notebooks (Google Docs)                              | Google Drive                                   | Pilot course converted to structured content; see [CONTENT-MODEL.md](CONTENT-MODEL.md#migration).                                                             |

## 8. Architecture decision records (ADR log)

Each entry: decision · reason · consequence. ADR-001…012 were accepted when Phase 1 started
(2026-10-03); ADR-013…017 record decisions made while building Phase 1.

| #       | Decision                                                                                                                                                                                                                                                                        | Status                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| ADR-001 | Next.js App Router + strict TypeScript, server-first rendering                                                                                                                                                                                                                  | Accepted              |
| ADR-002 | Supabase (Postgres, Auth, Storage) as the platform; RLS on every table                                                                                                                                                                                                          | Accepted              |
| ADR-003 | Vercel Pro hosting, Frankfurt; Cloudflare for DNS                                                                                                                                                                                                                               | Accepted              |
| ADR-004 | Learning platform does **not** use the staff dashboard's D1 database                                                                                                                                                                                                            | Accepted              |
| ADR-005 | Content stored as Zod-validated, versioned JSON blocks rendered by a component registry; authored in-repo files until the CMS exists                                                                                                                                            | Accepted              |
| ADR-006 | Grading runs on the server in TypeScript; answer keys never reach the browser; students have no direct write access to graded tables                                                                                                                                            | Accepted              |
| ADR-007 | Authorization reads roles from tables via `SECURITY DEFINER` helper functions, not JWT claims, so revoking a role takes effect immediately                                                                                                                                      | Accepted              |
| ADR-008 | Access to a course comes from **one** source: an active enrollment in a group of that course (private students = a group of one)                                                                                                                                                | Accepted              |
| ADR-009 | UI locale (interface language) and content language/direction are independent; direction is set per block                                                                                                                                                                       | Accepted              |
| ADR-010 | Recommendations are rule-based, computed on request behind a provider interface; only dismissals and actions are stored                                                                                                                                                         | Accepted              |
| ADR-011 | Single repository, single Next.js app (no monorepo tooling until a second deployable exists)                                                                                                                                                                                    | Accepted              |
| ADR-012 | No third-party analytics or tracking scripts; educational analytics come from our own event table                                                                                                                                                                               | Accepted              |
| ADR-013 | The session cookie is `HttpOnly`; the browser never calls Supabase directly. All reads and writes go through the server                                                                                                                                                         | Accepted              |
| ADR-014 | Content-Security-Policy uses a per-request nonce (`src/proxy.ts`), so every page renders dynamically                                                                                                                                                                            | Accepted              |
| ADR-015 | Pedagogical-manager and admin powers require an MFA-verified session (`aal2`), enforced in the database policies, not only in the UI                                                                                                                                            | Accepted              |
| ADR-016 | Tooling pins: TypeScript 6.0 (typescript-eslint does not support 7 yet) and ESLint 9 (eslint-plugin-react is not ESLint 10-ready). Revisit when they catch up                                                                                                                   | Accepted              |
| ADR-017 | Phase 1 screens were English/LTR only                                                                                                                                                                                                                                           | Superseded by ADR-018 |
| ADR-018 | Interface language without locale URLs: the profile's `ui_locale` (signed in), else a cookie, else `Accept-Language`, else Hebrew. Hebrew and English at launch; `dir` follows the interface language; message keys are typed and both languages must have the same keys (test) | Accepted              |
| ADR-019 | Course language names come from `Intl.DisplayNames` in the interface language, not from translated database rows; content inside UI sentences is isolated with Unicode isolates or `dir`/`<bdi>`                                                                                | Accepted              |
| ADR-020 | One shell for every area (desktop side rail, mobile bottom tab bar); components built on React Aria where behaviour is non-trivial (dialog, tabs); one icon set (Phosphor)                                                                                                      | Accepted              |

ADR-006 in more detail, because it's the least obvious: if exercises were checked in the
browser, every answer key would be downloadable, and a student could write
`is_correct = true` straight into the database with their own session token. Instead the
browser sends the answer to a Server Action. The action validates it, loads the key
through the privileged module, grades it with `domain/grading`, stores the response and
returns feedback. A round trip is ~100 ms within the region, which is fast enough for
immediate feedback.

## 9. Performance budget (initial targets)

| Metric                                     | Target           |
| ------------------------------------------ | ---------------- |
| Dashboard server response (p75, in region) | < 300 ms         |
| LCP on mid-range mobile, 4G                | < 2.5 s          |
| First-load JS for student routes           | < 150 kB gzipped |
| Exercise check round trip                  | < 250 ms p75     |

Techniques: RSC by default; client components only for interactivity; `next/image`;
audio `preload="none"`; route-level `loading.tsx`; indexes for every RLS predicate; one
"learner snapshot" SQL function for the dashboard instead of N queries.
