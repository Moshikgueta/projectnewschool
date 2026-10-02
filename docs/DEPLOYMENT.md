# Deployment, environments and operations

> Status: **Proposed — nothing is provisioned yet.** Every account below must be created
> **by and for New School**, never under a personal account, and have **at least two
> owners**.

## 1. Ownership

### 1.1 Current state (verified 2026-10-02)
- The GitHub account used so far (`Moshikgueta`) is a **personal** account. It belongs
  to no organizations, and all existing New School-related repositories are personal.
- No New School GitHub organization was found. `NewSchoolApp` is an unrelated Brazilian
  nonprofit's platform — **not** New School.
- Therefore this repository exists **only locally** and has not been pushed anywhere.

### 1.2 Creating the GitHub organization
1. Sign in to GitHub as one of the two future owners (personal accounts are fine as
   *members*; the org owns the code).
2. github.com → **+** → **New organization** → plan **Team** (needed for branch
   protection and rulesets on private repositories; ≈ $4 per member per month).
   Free works to start, but `main` can't be protected while the repo is private.
3. Name: **`newschool-il`** (recommended; `newschool-israel` / `newschoolil` as
   fallbacks; all three looked unclaimed in a GitHub search on 2026-10-02). Contact
   email: a school role mailbox (e.g. `tech@newschool.co.il`), not a personal address.
   "Belongs to: My business or institution", legal name of the school.
4. **People → Invite** the second owner and set role **Owner**. Two owners minimum, so
   the school never depends on one person.
5. **Settings → Authentication security:** require two-factor authentication.
6. **Settings → Code security:** enable Dependabot alerts, secret scanning and **push
   protection** for all new repositories.
7. **Settings → Member privileges:** base permission *No access* or *Read*;
   repository creation restricted to owners; default visibility **private**.
8. Create a team `platform-developers` (write) and `platform-maintainers` (maintain).
9. **New repository:** `newschool-learning-platform`, **Private**, no template, no
   README (we push ours).
10. Push this local repository:
    ```sh
    git remote add origin git@github.com:newschool-il/newschool-learning-platform.git
    git push -u origin main
    ```
11. Optionally transfer `Moshikgueta/projectnewschool` (staff dashboard) into the org:
    repo **Settings → Danger zone → Transfer**. History, issues and PRs move with it, and
    GitHub redirects the old URL. Handle the public-data issue in ROADMAP.md first.

### 1.3 Other accounts (all owned by the school, two owners each)

| Service | Account | Notes |
|---|---|---|
| Vercel | Team "New School" (Pro) | Connect the GitHub *org*, not a personal account |
| Supabase | Organization "New School" (Pro) | Projects: `nslp-staging`, `nslp-production` (Frankfurt) |
| Cloudflare | Existing or new school account | DNS for `newschool.co.il`; keep the staff tools here |
| Resend | School account | Verified sending domain, e.g. `mail.newschool.co.il` |
| Sentry | School organization | EU data region |
| Password manager | Shared vault | Break-glass credentials, recovery codes |

Billing goes on a school payment method. Personal cards and personal emails as account
owners are the classic way a school loses access to its own systems.

## 2. Environments

| Env | Web | Database | Data | Who uses it |
|---|---|---|---|---|
| **local** | `pnpm dev` | Supabase CLI in Docker (`supabase start`) | seed fixtures | developers |
| **preview** | Vercel preview per PR | staging project | seed + test accounts | reviewers |
| **staging** | Vercel, `main` branch | `nslp-staging` | realistic, fake people | team, pilot rehearsal |
| **production** | Vercel, promoted releases | `nslp-production` | real students | students, staff |

Production data is never copied to other environments. If realistic data is needed,
generate it. Changes are never tested on students: everything reaches production only
after staging.

## 3. CI/CD

```
feature branch → Pull request
   ├─ CI (GitHub Actions): install (frozen lockfile) → lint → typecheck → unit/component tests
   │                       → supabase start → migrations → pgTAP (RLS) → integration
   │                       → build → Playwright E2E + axe → content:validate
   ├─ Vercel preview deployment (linked in the PR)
   └─ Review: 1 approval (2 for migrations/security-sensitive paths via CODEOWNERS)
        ↓ merge (squash)
main → migrations applied to staging → Vercel deploys staging
        ↓ "Release" workflow (manual, maintainers only, from a tag)
production → migrations applied to production → Vercel promotes the same build
```

**Branch protection / ruleset on `main`:** pull request required; required status checks
(CI jobs above); 1 approving review; dismiss stale approvals; CODEOWNERS review for
`supabase/migrations/**`, `src/server/auth/**`, `src/server/privileged/**`; linear
history; no force pushes or deletions; admins included.

**Database migrations:** forward-only SQL in `supabase/migrations`; `supabase db push`
runs from CI with a scoped access token; never from a laptop against production.
Destructive changes use expand → migrate → contract across two releases.

**Rollback:** the web app rolls back instantly with Vercel "Promote previous deployment".
The database rolls *forward* with a fix migration; restoring from backup is a last
resort (§5).

## 4. Environment variables

See `.env.example` for the canonical list. Rules: secrets only in Vercel (per
environment) and GitHub Actions secrets; production and staging secrets differ;
`NEXT_PUBLIC_*` only for values that are safe in a browser; the app validates its
environment with Zod at startup and refuses to boot if something is missing.

| Variable | Scope | Secret | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | no | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | no (RLS protects data) | Supabase publishable key |
| `SUPABASE_SECRET_KEY` | server only (`server/privileged`) | **yes** | grading writes, invites |
| `NEXT_PUBLIC_SITE_URL` | both | no | absolute URLs in emails/redirects |
| `APP_ENV` | server | no | `local` / `preview` / `staging` / `production` |
| `SENTRY_DSN` | both | no | error reporting |
| `SENTRY_AUTH_TOKEN` | CI only | **yes** | source map upload |
| `SUPABASE_ACCESS_TOKEN` | CI only | **yes** | migrations |
| `SUPABASE_PROJECT_REF_STAGING` / `_PRODUCTION` | CI only | no | migration targets |
| `SUPABASE_DB_PASSWORD_*` | CI only | **yes** | migrations |
| `BACKUP_*` | CI only | **yes** | offsite backup bucket credentials |

SMTP credentials (Resend) are set in the **Supabase dashboard** (Auth → SMTP), not in
the app.

## 5. Backups and restore

| Layer | What | Retention |
|---|---|---|
| Supabase Pro automatic | daily database backups | 7 days |
| Our nightly job (GitHub Actions) | `supabase db dump` (schema + data), encrypted, to a school-owned R2/S3 bucket | 30 daily + 12 monthly |
| Storage files | Supabase backups **do not include Storage objects** → nightly sync of buckets to the same offsite bucket | 30 days |
| Code and content | GitHub (org) + content files in repo | permanent |

Point-in-time recovery is a paid add-on; enable it when real usage justifies it.

**Restore procedure** (practised quarterly into a scratch project):
1. Declare an incident; freeze deploys.
2. Choose a restore point (Supabase dashboard backup, or the latest offsite dump).
3. Restore into a **new** project first; verify row counts and spot-check data.
4. Restore Storage objects from the offsite copy.
5. Point the app at the restored project (env vars) or restore into production per the
   Supabase runbook; rotate keys.
6. Record the post-mortem in `docs/incidents/`.

## 6. Local development (once Phase 1 scaffolds the app)

Prerequisites: Node 24 LTS, pnpm, Docker, Supabase CLI.
```sh
pnpm install
cp .env.example .env.local      # local values are printed by `supabase start`
supabase start                  # local Postgres, Auth, Storage, Studio
supabase db reset               # apply migrations + seed
pnpm dev                        # http://localhost:3000
pnpm test                       # unit + component
pnpm test:db                    # pgTAP RLS tests
pnpm test:e2e                   # Playwright
```

## 7. Estimated recurring costs (pilot scale, verify current pricing)

| Category | Service | Estimate / month |
|---|---|---|
| Hosting | Vercel Pro (1–2 deploying members) | $20–40 |
| Database/Auth/Storage | Supabase Pro + a small staging project | $35–50 |
| Source control / CI | GitHub Team (2–4 members) | $8–16 |
| Transactional email | Resend free tier → paid if volume grows | $0–20 |
| Error monitoring | Sentry developer/team | $0–26 |
| Offsite backups | Cloudflare R2 / S3 | < $5 |
| Domain/DNS | existing domain; Cloudflare DNS free | ~$0 |
| **Total** | | **≈ $65–160** |

Growth costs that come later: Supabase compute upgrade, PITR, more Vercel seats,
storage/egress for audio and video.
