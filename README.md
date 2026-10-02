# New School Learning Platform

The New School student learning environment: one place where each student finds their
course's class notebook, workbook, homework, practice, vocabulary, review,
recommendations and progress. It connects **before → during → after class** around the
school's **Cycles** methodology, and gives teachers and pedagogical managers the tools
to run it.

> **Status: Phase 0 (planning).** This repository currently contains the architecture
> and planning documents only; no application code yet. Nothing is implemented until the
> architecture is approved.
>
> **Ownership:** this code belongs to New School. It must live in the New School GitHub
> organization as a **private** repository, never in a personal account. Until that
> organization exists, this repository is kept **local only**. See
> [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#1-ownership).

## Documentation

| Document | Contents |
|---|---|
| [docs/PLANNING-REPORT.md](docs/PLANNING-REPORT.md) | The Phase 0 report: 20-point summary for approval |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, stack assessment, module boundaries, ADR log |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, relationships, RLS model, indexes |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, controls, security tests, privacy |
| [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) | New School brand audit, tokens, typography, components, RTL, accessibility |
| [docs/CONTENT-MODEL.md](docs/CONTENT-MODEL.md) | Cycles model, block documents, exercises, migration of existing materials |
| [docs/ROADMAP.md](docs/ROADMAP.md) | MVP, phases, decisions needed, Phase 0 checklist, TODO |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | GitHub org setup, environments, CI/CD, env vars, backups, costs |

## Architecture overview

Next.js (App Router, strict TypeScript) on Vercel, with Supabase for Postgres, Auth and
Storage. Pages are server-rendered and read data with the signed-in user's own session,
so Postgres Row Level Security applies to every query; mutations go through validated
Server Actions. Course content is stored as versioned JSON blocks and rendered by a
registry of New School components, so new courses need no code changes. Full detail in
[ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Planned repository structure

```
src/
  app/        routes: (auth) · learn/ (student) · teach/ (teacher) · manage/ (ped. manager) · admin/
  server/     auth guards, queries, Server Actions, privileged/ (only place with the secret key)
  domain/     pure TypeScript: grading, recommendations, progress, spaced review
  content/    block schemas, block renderers, exercise engine
  ui/         New School design system (tokens.css + components)
  i18n/       UI messages per locale
supabase/     migrations/, seed.sql, tests/ (pgTAP RLS tests)
content/      course source files imported into the database
brand/        official New School logo files and brand references
tests/e2e/    Playwright end-to-end and accessibility tests
docs/         documentation
```

## Local setup *(available from Phase 1)*

Prerequisites: Node 24 LTS, pnpm, Docker, [Supabase CLI](https://supabase.com/docs/guides/cli).

```sh
pnpm install
cp .env.example .env.local      # fill with the values `supabase start` prints
supabase start                  # local Postgres, Auth, Storage
supabase db reset               # apply migrations and seed data
pnpm dev                        # http://localhost:3000
```

## Environment variables

Listed with explanations in [.env.example](.env.example) and
[DEPLOYMENT.md §4](docs/DEPLOYMENT.md#4-environment-variables). Never commit real values.
Secrets live in Vercel and GitHub Actions secrets only.

## Common commands *(from Phase 1)*

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app locally |
| `pnpm lint` / `pnpm typecheck` | Static checks |
| `pnpm test` | Unit and component tests (Vitest) |
| `pnpm test:db` | Database and RLS tests (pgTAP via `supabase test db`) |
| `pnpm test:e2e` | End-to-end and accessibility tests (Playwright + axe) |
| `pnpm build` | Production build |
| `pnpm content:validate` | Validate course content files |
| `pnpm content:import --env=staging` | Import course content into a database |
| `supabase migration new <name>` | Create a database migration |
| `supabase gen types typescript --local > src/server/db.types.ts` | Regenerate DB types |

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
