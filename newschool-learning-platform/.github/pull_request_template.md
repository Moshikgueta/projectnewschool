## What and why

<!-- What does this change, and why? Link the roadmap item or issue. -->

## How it was tested

- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] Database / authorization changes: `pnpm test:db` and `pnpm test:api`, with a new test for every new policy
- [ ] UI changes: `pnpm test:e2e`, checked at 375 px, 768 px and 1280 px

## Security

- [ ] No secret, key or real personal data in this change
- [ ] Every new table has RLS enabled and forced, explicit grants and pgTAP tests
- [ ] User ids come from the session, never from request input
- [ ] Inputs validated with Zod at the boundary

## Brand consistency (UI changes — docs/DESIGN-SYSTEM.md §11)

- [ ] Official logo via `<Logo />` only, unmodified
- [ ] Only tokens, no raw colours (`pnpm check:tokens` passes)
- [ ] Looks like the same product as the other screens
- [ ] Works in LTR and RTL; keyboard and screen reader usable
