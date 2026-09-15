# Backup & recovery runbook

## Backups (SEC-008, §20.3)

- The approved deployment uses free tiers. Do not enable paid backups or
  Point-in-Time Recovery. Encrypted off-site backups and a successful restore
  rehearsal are required **before pilot data is entered**.
- Back up database contents and every uploaded file to a private QBBE Drive
  destination daily. Database dumps do not preserve Storage object bytes.
- Retain seven daily and four weekly recovery sets within available storage.
  Keep the encryption recovery key separately with the named custodian.
- Automation, missing-backup/capacity alerts and restore evidence are **pending**.
  Do not infer backup coverage from this runbook or a successful app build.
- The Git repository is the backup for schema (migrations) and application
  code. Keep `main` protected.
- Environment variables are documented in `.env.example`; real values live
  in Netlify/Supabase/GitHub secret managers and the QBBE password manager.

## Restore drill (run before pilot data is accepted)

1. Use an isolated scratch environment within approved free capacity; never
   overwrite production or purchase another project automatically.
2. Retrieve and decrypt a recovery set using the separately stored key. Restore
   its database dump and uploaded files. Verify object counts and checksums.
3. Point a preview deployment at the scratch project and verify: sign-in,
   Home dashboard, a channel's messages, a project detail, a report.
4. Verify scoped access, Auth recovery, attachments, and integration-disable
   settings. Prevent the scratch environment from emailing real users.
5. Record the date, duration, recovery-set timestamp and any gaps. Initial
   targets are a 24-hour recovery point and one-business-day recovery time;
   neither target is validated until the rehearsal succeeds.

| Drill date | Performed by | Duration | Notes |
|---|---|---|---|
| _pending_ | | | first drill due before pilot |

## Losing access scenarios

- **Netlify down / bad deploy**: restore a previously verified deployment when
  the provider is available; verify schema compatibility. A quota pause needs
  an operational decision, not an automatic paid upgrade.
- **Supabase project unavailable**: restore latest backup to a new project,
  update the two `NEXT_PUBLIC_SUPABASE_*` env vars, redeploy.
- **Admin lockout**: a second Workspace Admin or the Primary Owner restores
  access; follow the documented provider recovery process. Use two named
  administrators where the free plan supports them, otherwise designate a
  separate recovery custodian (ENV-002).

## Incident severity

Use the SEV-1..4 ladder from the master spec (§14.3). SEV-1 (data exposure,
sign-in outage, corruption) requires immediate leadership notification and
an entry in the incident register.
