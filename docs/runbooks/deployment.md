# Deployment runbook

## Environments (ENV-001)

| Environment | Web | Data | Notes |
|---|---|---|---|
| local | `npm run dev` | local Supabase (`supabase start`) or dev project | synthetic data only |
| preview | Vercel preview per PR | dev/test Supabase project | never production data |
| production | Vercel production | production Supabase project | protected branch, backups on |

All accounts (GitHub org/repo, Vercel, Supabase, domain/DNS, email provider)
must be **QBBE-owned** with at least two trusted admins and documented
recovery emails (ENV-002).

## First production deployment

1. Create the production Supabase project (QBBE org). Note the project URL
   and anon key.
2. Apply migrations: `supabase link --project-ref <ref> && supabase db push`.
3. In Supabase Auth settings:
   - Configure the site URL to the production domain and add
     `https://<domain>/auth/callback` to redirect URLs.
   - Enable email confirmation.
   - **Restrict signup**: either disable public signup once the Primary
     Owner exists, or restrict to invited emails (Admin → Invite user
     records the intended role which is applied automatically on sign-up).
4. Create the Vercel project from this repository. Set env vars:
   `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (plus optional integrations per
   `.env.example`). Never set `SUPABASE_SERVICE_ROLE_KEY` as a public var.
5. Deploy. Sign up the Primary Owner account **first** — the bootstrap
   trigger provisions the organization and mandatory channels.
6. Enable Supabase automated backups (daily) and verify Point-in-Time
   Recovery settings before entering pilot data.
7. Turn on MFA for the Primary Owner and Workspace Admin accounts
   (AUTH-006).

## Schema changes (ENV-005, REP-004)

- Migrations are append-only once applied to a shared environment. Fix
  forward with a new migration; never edit an applied file.
- Ship policies/indexes in the same migration as the tables they protect.
- `supabase db push` in CI/CD or manually by an admin — no undocumented
  dashboard edits in production.

## Rollback

- App: redeploy the previous Vercel deployment (instant).
- Schema: write an inverse migration; for risky changes use
  expand → migrate → contract so old app versions keep working (CICD-002).

## Release checks

`npm run lint && npm run typecheck && npm test && npm run build` must pass
(mirrored in `.github/workflows/ci.yml`). Production promotion is a manual,
auditable action in Vercel.
