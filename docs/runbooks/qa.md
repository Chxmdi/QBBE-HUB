# QA runbook

Two suites, split by what they need.

## 1. Public-route QA — runs anywhere, runs in CI

Covers the routes that render without a database round-trip, across the full
§16.1 matrix: six widths (1440/1280/1024/768/390/320), both themes,
horizontal-overflow detection, axe (WCAG 2.2 A + AA), keyboard traversal,
focus visibility, reduced motion, and unauthenticated redirects.

```bash
npm run build
npx next start -p 3000 -H 127.0.0.1 &
npm run test:a11y
```

This runs on every pull request via `.github/workflows/ci.yml`.

## 2. Authenticated QA matrix — needs network access to Supabase

`tests/e2e/qa-matrix.spec.ts` covers all 18 authenticated routes at every
width in both themes, axe on each, 200% zoom, the command palette, the task
drawer and its deep links, URL-shareable filters, empty/permission states,
and volunteer-vs-staff authorization boundaries.

It needs a reachable Supabase project and a seeded QA database, so it does
**not** run in the default sandbox (egress policy blocks `*.supabase.co`
there) and is not wired into CI.

To run it:

```bash
# 1. Point at a NON-PRODUCTION Supabase project
cp .env.example .env.local   # fill in the staging project's URL + anon key

# 2. Apply migrations to that project
supabase link --project-ref <staging-ref> && supabase db push

# 3. Seed QA fixtures (creates three users across owner/staff/volunteer)
#    See supabase/seed/seed.sql, plus the QA users block below.

# 4. Build, serve, and run
npm run build
npx next start -p 3000 -H 127.0.0.1 &
npm run test:qa
```

### QA test users

The matrix expects three confirmed accounts, all with password
`QaTest!2026`:

| Email | Role | Purpose |
|---|---|---|
| `qa-owner@example.com` | owner | Full-access surfaces |
| `qa-staff@example.com` | staff | Staff-scoped surfaces |
| `qa-volunteer@example.com` | volunteer | Negative authorization cases |

Because Supabase confirms email by default, insert them directly into
`auth.users` with `email_confirmed_at` set (the bootstrap trigger then
provisions profiles, membership, and mandatory channels). Never create these
in the production project — the first sign-up there becomes Primary Owner.

## 3. Contrast regression guard — always on

`tests/unit/contrast.test.ts` computes WCAG contrast for every colored-text
token against surface, canvas, and soft-surface in **both** themes, plus
white-on-fill for buttons. It runs with `npm test`, so a token edit that
would fail the browser accessibility matrix fails in CI first.

If it fails, adjust the `--color-*-fg` tokens in
`src/design-system/styles/globals.css`. Fill tokens (`--color-brand`,
`--color-danger`, …) keep the exact Part II §2.2 brand values; only the
`-fg` text variants are tuned for contrast, as Appendix A permits.

## 4. Still manual before launch

- Screen-reader smoke test (VoiceOver / NVDA) of: post a message, move a
  task, acknowledge an announcement, complete a meeting.
- Real-device touch check on iOS Safari and Android Chrome.
- Load/performance measurement with representative data volume (§20.5).
- Backup restore rehearsal (see `backup-recovery.md`).
- Privacy / retention review (`privacy.md`).
- Launch-gate ticks (`launch-gate.md`).

## 5. Database / RLS tests (TST-003)

Against **local** Supabase after `supabase start`:

```bash
npm run test:db
```

That concatenates `supabase/tests/qa-users.sql` (idempotent owner/staff/volunteer
with password `QaTest!2026`) and `supabase/tests/rls.sql` (allow **and** deny
cases) into `psql` on `supabase_db_workspace`.

**Recipe when you add a table:** ship indexes + RLS in the same migration, then
add one allow and one deny assertion to `rls.sql`. Coverage status lives in
`docs/spec-coverage.md`.
