# Phase 0 planning report

> New School Learning Platform · 2026-10-02 · Status: **for approval**
> Each section is a summary; the linked document has the detail.

## 1. Recommended architecture
A server-first Next.js application on Supabase: React Server Components read data with
the user's own session, so Row Level Security applies; Server Actions handle every
mutation; a pure TypeScript `domain/` layer holds grading, recommendations, progress and
spaced review. Content is versioned JSON blocks rendered by a component registry, so
courses are data and need no deploy. → [ARCHITECTURE.md](ARCHITECTURE.md)

## 2. Technology stack
Next.js (App Router, strict TypeScript) · Tailwind v4 driven by New School tokens · React
Aria Components (accessible, RTL-aware primitives) · Supabase (Postgres, Auth, Storage,
RLS) · supabase-js with generated types (no RLS-bypassing ORM) · Zod · next-intl ·
Vitest, pgTAP, Playwright + axe · Sentry · Resend via Supabase SMTP.
**Changed from your proposal:** nothing fundamental. I added React Aria, Zod and pgTAP,
and I recommend *not* reusing the staff tool's Cloudflare D1 database, because it has no
RLS. → [ARCHITECTURE.md §3](ARCHITECTURE.md#3-stack-assessment)

## 3. Repository and GitHub organization strategy
Verified: the GitHub account in use is personal and belongs to no organization; no New
School organization exists (`NewSchoolApp` is an unrelated Brazilian nonprofit).
**Nothing has been pushed.** This repository exists locally only. Create the org
**`newschool-il`** (Team plan, two owners, 2FA, secret scanning + push protection), then
push to a **private** `newschool-learning-platform`.
→ [DEPLOYMENT.md §1](DEPLOYMENT.md#1-ownership)

## 4. Hosting strategy
**Vercel Pro** under a New School team (Next.js-native, previews per PR, lowest
maintenance), functions in Frankfurt next to the database; Cloudflare keeps DNS and the
existing staff tools. Cloudflare Workers is a valid cheaper alternative with more
operational friction. → [ARCHITECTURE.md §5](ARCHITECTURE.md#5-hosting-decision-vercel-vs-cloudflare)

## 5. Authentication strategy
Supabase Auth: invite-only (no public sign-up); email + password (≥ 10 characters,
leaked-password check), optional magic link; MFA mandatory for admins and pedagogical
managers; HttpOnly cookie sessions verified on the server; rotation and inactivity
timeouts; school-domain SMTP. → [SECURITY.md §2](SECURITY.md#2-controls)

## 6. Database architecture
Four domains: identity (`profiles`, `user_roles`), catalog (languages → levels → courses
→ cycles; books/sections; activities/items/**separate keys**; vocabulary; media),
delivery (groups, teachers, **enrollments as the single source of access**, active
cycles, assignments) and learner records (attempts, append-only responses, section
progress, vocabulary review state, event log), plus an insert-only audit log.
→ [DATABASE.md](DATABASE.md)

## 7. Roles and permissions
Student, teacher, pedagogical manager and admin, combinable, read from tables at request
time. Enforced twice: server guards and RLS. Admin is deliberately *not* a superset:
seeing learning data requires the pedagogical role.
→ [DATABASE.md §4](DATABASE.md#4-row-level-security-model)

## 8. Repository structure
```
src/app        routes (thin)          src/server    auth guards, queries, actions, privileged/
src/domain     pure logic + tests     src/content   block schemas, renderers, exercise engine
src/ui         design system          src/i18n      UI messages
supabase/      migrations, seed, pgTAP tests
content/       pilot course source files (YAML)       brand/   official assets
tests/e2e      Playwright             docs/          these documents
```

## 9. Content model
Language → Level → Course → **Cycles** → notebook sections, workbook sections, phased
activities, vocabulary, teacher notes and resources. Seventeen block types and six MVP
exercise types. Answer keys are stored separately and graded on the server. Every item
works on touch and keyboard without drag. → [CONTENT-MODEL.md](CONTENT-MODEL.md)

## 10. Student experience
Log in → "Good evening, Daniel · Spanish · Level 1" with **Continue where you left off**
→ My Course (Notebook, Workbook, Practice, Vocabulary, Homework, Review) → up to five
ranked recommendations ("Prepare these 5 words before Thursday's class") → recent
activity → a calm progress panel (activities completed, practice this week with a weekly
goal, cycle progress, vocabulary reviewed, topics to revisit). Mobile has a bottom tab
bar; desktop has a side rail.

## 11. Teacher experience
My Groups (e.g. "Spanish Level 1 · 12 students") → a group view with students, active
cycle (teacher sets it), assignments (assign "Restaurant vocabulary practice", due
Friday), recent activity, completion, and **common difficulties**: the questions with
the highest first-try error rate in that group, minimum sample size applied. Teacher
versions of activities show keys and teacher notes.

## 12. Admin experience
**Admin:** accounts (invite, deactivate, reset, roles), audit log, system settings, with
MFA required. **Pedagogical manager:** catalog (languages, levels, courses, cycles),
groups, teachers, enrollments, publish/unpublish, school-wide pedagogical analytics. The
full form-based CMS comes in Phase 8. The MVP ships the minimal screens needed so the
pilot can run without a developer.

## 13. Migrating existing materials
Preserve pedagogy, change the container. 18 Google Docs notebooks (6 languages × 3
levels) found. Pipeline: audit → export → scripted draft conversion → teacher editing →
validate/import to staging → sign-off → freeze the original. Media stays as assets; text,
vocabulary and exercises become data; recurring layouts become components. The staff
prototype becomes UX and security *requirements*, not code to port.
→ [CONTENT-MODEL.md §6](CONTENT-MODEL.md#migration)

## 14. Security model
Threat-modelled for curious students, teachers overreaching, compromised staff and
external attackers. Controls cover RLS-by-default, server-side grading, CSP with nonces,
Origin-checked Server Actions, Zod validation, no raw HTML in content, private storage
with signed URLs, rate limits, an audit log and secret scanning. **Explicit tests** use a
real student token against the REST API, as well as the UI. Privacy: data minimisation
(no phone, address, ID or birth date), separation of auth and profile data, no
third-party trackers, export/delete flows, retention policy, Israeli PPL and LGPD in
view. → [SECURITY.md](SECURITY.md)

## 15. MVP
One pilot course for one or two groups: auth, profiles, enrollment with minimal admin
screens, dashboard, notebook, workbook, six exercise types plus reflection, saved
progress, rule-based recommendations, a simple progress view and a basic teacher view.
→ [ROADMAP.md](ROADMAP.md#mvp)

## 16. Implementation phases
0 Planning · 1 Auth, database and permissions (exit = all authorization tests green) ·
2 Dashboard and design system · 3 Notebook engine · 4 Workbook engine · 5 Progress ·
6 Recommendations · 7 Teacher area · 8 CMS · 9 Analytics and mature gamification ·
10 Audits. A parallel **content track** is the real critical path.
→ [ROADMAP.md](ROADMAP.md#phases)

## 17. Technical risks
| Risk | Mitigation |
|---|---|
| **Content conversion effort** is larger than the code effort | Measure hours per cycle in the pilot; content owner assigned; tooling for drafts |
| RLS mistakes or slow policies | pgTAP tests per policy, helper functions, indexes, Phase 0 performance spike |
| Single-person dependency (people and accounts) | Org with two owners, school-owned vendor accounts, these docs |
| **Content IP**: Spanish materials live in personal repos | Confirm ownership/licence before the pilot (D5) |
| Personal-looking data in a public repo | See ROADMAP "Urgent" |
| Mixed-direction rendering bugs | Per-block `lang`/`dir`, `<bdi>`, RTL visual tests |
| Brand assets missing (no vector logo, no colour codes) | Token-based design system; values swapped in one file |
| Scope pull from operations (scheduling, billing, Tazman replacement) | Kept as a separate track (D10) |
| Next.js/Supabase churn | Pinned versions, Dependabot, thin adapters |
| Email deliverability for invites and resets | Own domain + SPF/DKIM/DMARC |
| Teacher adoption | Pilot with real teachers from Phase 7; their feedback gates Phase 8 |

## 18. Recurring infrastructure categories
Hosting · database/auth/storage · source control and CI · transactional email · error
monitoring · offsite backups · domain/DNS. Pilot estimate **≈ $65–160/month**; verify
current prices. → [DEPLOYMENT.md §7](DEPLOYMENT.md#7-estimated-recurring-costs-pilot-scale-verify-current-pricing)

## 19. Decisions needed before coding
D1–D15 in [ROADMAP.md](ROADMAP.md#decisions-needed-before-phase-1). The most blocking:
the **org name and second owner**, the **pilot course and its content ownership**, the
**official brand files**, and whether **any students are minors**.

## 20. Phase 0 checklist
→ [ROADMAP.md › Phase 0 checklist](ROADMAP.md#phase-0-checklist)
