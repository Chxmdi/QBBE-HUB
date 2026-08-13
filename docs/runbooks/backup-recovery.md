# Backup & recovery runbook

## Backups (SEC-008, §20.3)

- Supabase automated daily backups must be enabled **before pilot data is
  entered**. Prefer enabling Point-in-Time Recovery for production.
- The Git repository is the backup for schema (migrations) and application
  code. Keep `main` protected.
- Environment variables are documented in `.env.example`; real values live
  in Vercel/Supabase secret managers and the QBBE password manager.

## Restore drill (run before organization-wide rollout)

1. Create a scratch Supabase project.
2. Restore the latest production backup into it (Supabase dashboard →
   Backups → Restore, or `pg_restore` of a downloaded dump).
3. Point a preview deployment at the scratch project and verify: sign-in,
   Home dashboard, a channel's messages, a project detail, a report.
4. Record the date, duration, and any gaps in this file.

| Drill date | Performed by | Duration | Notes |
|---|---|---|---|
| _pending_ | | | first drill due before pilot |

## Losing access scenarios

- **Vercel down / bad deploy**: redeploy previous build from the Vercel
  dashboard (two clicks) or `vercel rollback`.
- **Supabase project unavailable**: restore latest backup to a new project,
  update the two `NEXT_PUBLIC_SUPABASE_*` env vars, redeploy.
- **Admin lockout**: a second Workspace Admin or the Primary Owner restores
  access; Supabase org owners can reset auth. Keep ≥2 trusted admins at all
  times (ENV-002).

## Incident severity

Use the SEV-1..4 ladder from the master spec (§14.3). SEV-1 (data exposure,
sign-in outage, corruption) requires immediate leadership notification and
an entry in the incident register.
