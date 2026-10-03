# New School Learning Platform

The New School student learning environment: one place where each student finds their
course's class notebook, workbook, homework, practice, vocabulary, review,
recommendations and progress. It connects **before → during → after class** around the
school's **Cycles** methodology, and gives teachers and pedagogical managers the tools
to run it.

> **Status: Phases 1–2 implemented locally.** Sign-in, roles, the database with Row Level
> Security, a Hebrew/English (RTL-ready) interface, the design-system components and the
> student dashboard on real data. Notebook, workbook and exercises come in later phases
> ([ROADMAP.md](docs/ROADMAP.md)). Brand colours and logo are **placeholders** until the
> official files arrive ([brand/README.md](brand/README.md)).
>
> **Ownership:** this code belongs to New School. It must live in the New School GitHub
> organization as a **private** repository, never in a personal account. Until that
> organization exists, this repository is kept **local only**. See
> [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#1-ownership).

## Documentation

| Document                                           | Contents                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| [docs/PLANNING-REPORT.md](docs/PLANNING-REPORT.md) | The Phase 0 report: 20-point summary for approval                          |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)       | System design, stack assessment, module boundaries, ADR log                |
| [docs/DATABASE.md](docs/DATABASE.md)               | Schema, relationships, RLS model, indexes                                  |
| [docs/SECURITY.md](docs/SECURITY.md)               | Threat model, controls, security tests, privacy                            |
| [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)     | New School brand audit, tokens, typography, components, RTL, accessibility |
| [docs/CONTENT-MODEL.md](docs/CONTENT-MODEL.md)     | Cycles model, block documents, exercises, migration of existing materials  |
| [docs/CONTENT-AUDIT.md](docs/CONTENT-AUDIT.md)     | What the existing notebooks contain and what that changes                  |
| [docs/ROADMAP.md](docs/ROADMAP.md)                 | MVP, phases, decisions needed, Phase 0 checklist, TODO                     |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)           | GitHub org setup, environments, CI/CD, env vars, backups, costs            |

## Architecture overview

Next.js (App Router, strict TypeScript) on Vercel, with Supabase for Postgres, Auth and
Storage. Pages are server-rendered and read data with the signed-in user's own session,
so Postgres Row Level Security applies to every query; mutations go through validated
Server Actions. Course content is stored as versioned JSON blocks and rendered by a
registry of New School components, so new courses need no code changes. Full detail in
[ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository structure

```
src/
  app/        routes: (auth) · learn/ (student) · teach/ (teacher) · manage/ (ped. manager) · admin/
  server/     auth guards, queries, Server Actions, privileged/ (only place with the secret key)
  domain/     pure TypeScript: grading, recommendations, progress, spaced review
  content/    block schemas, block renderers, exercise engine            (Phase 3)
  ui/         New School design system (tokens.css + components)
  i18n/       UI messages per locale                                    (Phase 2)
  proxy.ts    per-request CSP nonce + session refresh
supabase/     migrations/, seed.sql, tests/ (pgTAP RLS tests), templates/ (auth emails)
content/      course source files imported into the database             (Phase 3)
brand/        official New School logo files and brand references
tests/e2e/    Playwright end-to-end and accessibility tests
tests/integration/  API-level authorization attacks with real tokens
docs/         documentation
```

## Local setup

Prerequisites: Node 22 or 24 LTS, pnpm 10, Docker. The Supabase CLI comes with `pnpm install`.

```sh
pnpm install
pnpm db:start                   # local Postgres, Auth, Storage, mail catcher (Docker)
cp .env.example .env.local      # then fill in the values `pnpm exec supabase status` prints
pnpm db:reset                   # apply migrations and seed data
pnpm dev                        # http://localhost:3000
```

Local test accounts (from `supabase/seed.sql`, all fictional, password `Local-dev-password-1`):

| Account                 | Role                | Notes                                               |
| ----------------------- | ------------------- | --------------------------------------------------- |
| `student.a@example.com` | student             | Spanish L1, plus a draft Spanish L2 course (hidden) |
| `student.b@example.com` | student             | Spanish L1 and French L1                            |
| `teacher.x@example.com` | teacher             | teaches the Spanish groups                          |
| `teacher.y@example.com` | teacher             | teaches the French group                            |
| `manager@example.com`   | pedagogical manager | asked to set up MFA at first sign-in                |
| `admin@example.com`     | admin               | asked to set up MFA at first sign-in                |

Invite and password-reset emails land in the local mail catcher at http://127.0.0.1:54324.

## Environment variables

Listed with explanations in [.env.example](.env.example) and
[DEPLOYMENT.md §4](docs/DEPLOYMENT.md#4-environment-variables). Never commit real values.
Secrets live in Vercel and GitHub Actions secrets only.

## Common commands

| Command                                   | What it does                                          |
| ----------------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                                | Run the app locally                                   |
| `pnpm lint` / `pnpm typecheck`            | Static checks                                         |
| `pnpm test`                               | Unit and component tests (Vitest)                     |
| `pnpm test:db`                            | Database and RLS tests (pgTAP via `supabase test db`) |
| `pnpm test:api`                           | API-level authorization tests (needs local Supabase)  |
| `pnpm check:tokens`                       | No raw colours, no left/right utilities (brand + RTL) |
| `pnpm test:e2e`                           | End-to-end and accessibility tests (Playwright + axe) |
| `pnpm build`                              | Production build                                      |
| `pnpm exec supabase migration new <name>` | Create a database migration                           |
| `pnpm db:types`                           | Regenerate DB types after a migration                 |

## Deployment

Pull request → automated checks and tests → preview deployment → review → merge to
`main` (deploys staging) → manual release (deploys production). `main` is protected.
See [DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Contributing

- Read the docs above before changing architecture; record significant decisions as ADRs
  in [ARCHITECTURE.md §8](docs/ARCHITECTURE.md#8-architecture-decision-records-adr-log).
- Every UI change passes the brand consistency checklist
  ([DESIGN-SYSTEM.md §11](docs/DESIGN-SYSTEM.md#11-brand-consistency-check-definition-of-done-for-every-ui-page)).
- Never weaken authorization for convenience; every new table ships with RLS policies
  **and** pgTAP tests.
