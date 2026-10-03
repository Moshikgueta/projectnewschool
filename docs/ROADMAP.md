# Roadmap

> Status: **Phase 1 implemented locally (2026-10-03); its exit is reached once CI runs green
> on GitHub.** Phase 0 ownership items are still open. Phases don't start until the previous
> phase's exit criteria are met. In particular, **Phase 2 doesn't start until authentication and
> authorization (Phase 1) are proven by tests.**

## MVP

**Goal:** one pilot course used by real students of one or two groups, end to end:
log in → see the course → study the notebook → practise in the workbook → progress
saved → recommendations → teacher sees the group.

| #   | In MVP                                                                                                                                                 | Phase         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| 1   | Authentication (invite-only, reset, MFA for staff)                                                                                                     | 1             |
| 2   | Student profiles (name, avatar, UI language)                                                                                                           | 1–2           |
| 3   | Groups and enrollment, plus **minimal admin screens** for invites, groups and enrollments, so the pilot doesn't need a developer for every new student | 1–2           |
| 4   | Student dashboard                                                                                                                                      | 2             |
| 5   | One pilot language, one level, one course                                                                                                              | content track |
| 6   | Class notebook (block engine)                                                                                                                          | 3             |
| 7   | Workbook                                                                                                                                               | 4             |
| 8   | Exercise components: multiple choice, true/false, fill-in-the-blank, matching, reorder sentence, vocabulary flashcards (+ ungraded reflection)         | 4             |
| 9   | Saved progress and resume                                                                                                                              | 4–5           |
| 10  | Rule-based recommendations                                                                                                                             | 6             |
| 11  | Simple progress view (activities completed, practice this week, cycle progress, vocabulary reviewed, topics to revisit)                                | 5             |
| 12  | Basic teacher view (groups, students, active cycle, completion, common difficulties, assign activity)                                                  | 7             |

**Not in MVP:** form-based CMS, drag-and-drop exercises, listening/reading
comprehension types, XP/badges, notifications, payments, scheduling/timetable, speech
recording, AI features, native apps.

## Phases

### Phase 0 — Infrastructure and technical planning _(documents done; ownership items open)_

Deliverables: the planning documents in `docs/`, the README, `.env.example`, and the
decisions below answered. See the [Phase 0 checklist](#phase-0-checklist).
**Exit:** architecture approved; GitHub organization and accounts owned by New School
with two owners; brand assets in `brand/`; pilot course chosen.

### Phase 1 — Foundations: auth, database, permissions _(implemented locally)_

Status 2026-10-03:

- [x] Scaffold (Next.js 16, strict TS, Tailwind v4, ESLint/Prettier, Vitest, Playwright), module-boundary lint rules, token and RTL check script
- [x] Local Supabase; 7 migrations; RLS helpers and policies; audit log; seed fixtures; generated types
- [x] Invite (admin) → email → set password; login; logout; password reset; TOTP MFA; area guards
- [x] Nonce CSP and security headers; Zod environment validation
- [x] Tests: 61 pgTAP · 10 API-level attacks · 16 end-to-end (incl. axe, mobile) · 12 unit
- [x] CI workflow, CODEOWNERS, PR template, Dependabot (written; not yet run, repo not on GitHub)
- [ ] CI green on GitHub; branch protection (needs the `newschool-il` repository)
- [ ] Sentry (needs a New School Sentry account; deliberately not added before that)

Planned scope:

- Scaffold: Next.js + strict TS + Tailwind v4 + ESLint/Prettier + Vitest + Playwright;
  `src/` module boundaries with lint rules.
- Supabase local dev; migrations for identity, catalog, delivery, learner and audit tables;
  RLS policies and helper functions; seed fixtures; generated types.
- Auth flows: invite acceptance, login, logout, reset, MFA for staff; route-group guards.
- Security headers + CSP; env validation; Sentry.
- CI pipeline (lint, typecheck, unit, pgTAP, build, E2E) and branch protection.
- **Exit:** every authorization test in SECURITY.md §3 passes in CI; a student
  can log in and see _only_ an empty "my courses" list for their enrollment.

### Phase 2 — Student dashboard and design system

- Design-system tokens from official brand values, core components, `/design-system`.
- App shell (desktop rail, mobile bottom bar), RTL/LTR, he + en UI messages.
- Dashboard: welcome, continue-learning, My Course cards, recent activity, progress
  placeholders, empty/loading/error states.
- **Exit:** brand consistency checklist passes; axe clean; 375/768/1280 px verified.

### Phase 3 — Notebook content engine

- Block schemas + registry + renderers; media via signed URLs; section navigation;
  reading-position save; teacher notes view.
- Content tooling: `content:validate`, `content:import`; first cycles of the pilot.
- **Exit:** pilot notebook cycles render correctly on mobile and desktop, in both
  directions; invalid content fails CI.

### Phase 4 — Interactive workbook engine

- Exercise engine and the six MVP item types; server-side grading; attempts and
  responses; autosave and resume; immediate feedback; vocabulary flashcards with
  Leitner scheduling.
- **Exit:** critical E2E flow passes (complete activity → log out → log in → progress
  remains); answer keys provably absent from the client.

### Phase 5 — Progress tracking

- `learning_events` pipeline; progress read models; cycle progress; "practice this
  week"; topics to revisit (skills with low accuracy).
- **Exit:** metrics match a hand-computed fixture.

### Phase 6 — Recommendations

- `RecommendationProvider` interface; rule engine v1 (below); dismiss/act feedback.
- **Exit:** each rule has unit tests; dashboard shows at most 3–5 ranked items.

### Phase 7 — Teacher dashboard

- My groups, group detail (students, active cycle, assignments, recent activity,
  completion, common difficulties), set active cycle, assign activity with a due date,
  teacher version of activities (keys + notes).
- **Exit:** teacher authorization tests pass; pilot teachers use it for two weeks.

### Phase 8 — Pedagogical CMS

- Forms for language/level/course/cycle; block editor; activity editor; media upload;
  draft → review → publish; audit trail; group and enrollment management UI expanded.

### Phase 9 — Analytics and mature gamification

- Item difficulty and error-pattern reports; engagement over time (privacy-conscious);
  weekly goal and consistency, milestones, a small set of meaningful badges; XP only if
  pilot feedback supports it.

### Phase 10 — Performance, accessibility and security audit

- External RLS review; OWASP ASVS L2 pass; WCAG 2.2 AA audit with real assistive
  technology; load test at 10× expected users; restore drill; pre-production checklist
  in SECURITY.md §5.

### Parallel track — Content

Starts in Phase 0 with the audit, runs alongside Phases 3–7. Owner: pedagogical manager.
This is the true critical path: code can be ready before content is.

## Recommendation rules v1 (Phase 6)

| Priority | Rule                                                                     | Recommendation                               |
| -------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| 1        | Teacher assignment open, due soon                                        | "Due Friday: Restaurant vocabulary practice" |
| 2        | Active cycle has `before_class` items not done, next class within 3 days | "Prepare these 5 words before class"         |
| 3        | Activity in progress                                                     | "Finish the exercise from today's class"     |
| 4        | Skill accuracy < 70% over last 10 responses                              | another activity tagged with that skill      |
| 5        | Vocabulary items due for review                                          | "Review 12 words"                            |
| 6        | No practice in 4+ days                                                   | short mixed review from recent cycles        |
| 7        | Completed after-class item ~3 days ago                                   | spaced `review` activity                     |

Each rule returns candidates with a score and reason; the engine dedupes, ranks and caps
the list. Rules are pure functions of a learner snapshot, so a smarter provider can
replace or blend with them later without touching the UI.

## Gamification stance

Encourage **consistency**, not points-chasing: a _weekly practice goal_ (e.g. 3 days a
week, fitting adults with two classes a week) rather than a daily streak that punishes
busy weeks; cycle completion bars; a few milestone badges with real meaning ("Completed
Cycle 3"). Calm visuals, no confetti storms, nothing childish.

---

## Decisions needed before Phase 1

| #   | Decision                                                                                                                       | Recommendation                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| D1  | GitHub organization name, and the **second owner** (a person, with their own account)                                          | `newschool-il` (or `new-school-israel`); repo `newschool-learning-platform`           |
| D2  | Which legal entity and email own the vendor accounts (GitHub, Vercel, Supabase, domain, email)                                 | a role mailbox such as `tech@newschool.co.il`, billed to the school                   |
| D3  | Hosting                                                                                                                        | Vercel Pro (see ARCHITECTURE.md §5)                                                   |
| D4  | Data region                                                                                                                    | Frankfurt                                                                             |
| D5  | Pilot course, and confirmation that its content belongs to New School (several Spanish materials are in personal repositories) | Spanish Level 1, _if_ ownership is confirmed; otherwise English Foundations           |
| D6  | Interface languages at launch                                                                                                  | Hebrew + English (add Portuguese if Brazilian students are in scope)                  |
| D7  | Are any students under 18?                                                                                                     | Determines consent flow and data fields                                               |
| D8  | Student login                                                                                                                  | email + password (with optional magic link); entry codes only as one-time claim links |
| D9  | What happens to the existing public repo `projectnewschool`                                                                    | see "Urgent" below                                                                    |
| D10 | Relationship to the staff/operations dashboard (rooms, timetable, Tazman replacement)                                          | Keep separate for now; learning platform first; converge on shared identity later     |
| D11 | Show scores to students?                                                                                                       | Only for `scored` activities; practice shows feedback, not grades                     |
| D12 | Retention periods                                                                                                              | see SECURITY.md §4 proposal                                                           |
| D13 | Domain                                                                                                                         | e.g. `learn.newschool.co.il`                                                          |
| D14 | Who may publish content                                                                                                        | pedagogical managers; teachers propose                                                |
| D15 | Official brand assets and typeface                                                                                             | see DESIGN-SYSTEM.md §2                                                               |

### ⚠️ Urgent, independent of this project

`Moshikgueta/projectnewschool` is **public**, has GitHub Pages enabled, and its seed data
contains realistic Israeli mobile numbers, personal Gmail/Outlook addresses and Hebrew
full names of "students", plus links to the school's Google Docs notebooks. If any of
that is real, it's personal data published on the internet. Recommended: confirm
whether it's real; if so, make the repository private (Pages will stop on the free
plan), remove the data **from Git history**, and check who can open the linked Google
Docs. Then transfer the repository into the New School organization.

---

## Phase 0 checklist

**Ownership and accounts**

- [ ] Create GitHub organization (Team plan: branch protection on private repos needs it) — owners: 2 people
- [ ] Enforce 2FA for all org members; enable secret scanning + push protection; default repo visibility private
- [ ] Create **private** repo `newschool-learning-platform` in the org; push this Phase 0 history
- [ ] Transfer (or archive) the existing staff-dashboard repo into the org
- [ ] Vercel team owned by New School; Supabase organization owned by New School (2 owners each)
- [ ] Domain/DNS in a New School Cloudflare account; email sending domain with SPF/DKIM/DMARC
- [ ] Password manager (shared vault) for break-glass credentials

**Product and content**

- [x] Planning documents (`docs/`) and README drafted
- [ ] Architecture approved (ADR-001…012)
- [ ] Decisions D1–D15 answered
- [ ] Official logo files, brand colours and typeface in `brand/`; colour canonicalisation done
- [ ] Content audit of 2–3 notebooks; block catalogue confirmed
- [ ] Pilot course chosen and content ownership confirmed; pilot groups identified

**Technical spikes (time-boxed, throwaway)**

- [ ] React Aria vs Radix for RTL + accessible matching/reorder interactions
- [ ] RLS performance with helper functions on a seeded 10k-student dataset
- [ ] `@supabase/ssr` with HttpOnly cookies and server-only data access

## Running TODO

- Re-check vendor pricing before committing budgets (figures in DEPLOYMENT.md are estimates).
- Decide on Supabase Branching vs a shared staging database for previews once migrations churn.
