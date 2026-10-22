# Provider custody register

Issue: #52. Companion to `environment-ownership.md`, which says what must be
true; this file is where it gets written down.

**Never record a secret value here.** Record where the secret lives. This file
is in the repository and anyone who can read the code can read it.

## How to fill this in

One row per provider. A row is complete when every column has a real name or
identifier in it — not "QBBE", not "the team", not "TBD". The point of the
register is that when an account needs recovering at short notice, somebody can
read a name and phone them.

- **QBBE owner** — the organizational account that owns the resource, not a
  person. If the answer is a personal account, the row is not done.
- **Primary / backup custodian** — named people who can sign in today. Two,
  because one person is a single point of failure, and the backup is the reason
  a holiday is not an outage.
- **Recovery contact** — the address or phone the provider sends recovery to.
  If it is a personal mailbox, the row is not done.
- **MFA** — `enforced` only if the provider refuses a sign-in without it.
  "Enabled for my account" is not enforcement.
- **Secret location** — the store and key name, e.g.
  `GitHub Environment "staging" → DEPLOY_SSH_KEY`.
- **Rotated** — the date it was last rotated, and the interval it is due on.

| Provider | QBBE owner | Primary custodian | Backup custodian | Recovery contact | MFA | Staging resource | Production resource | Secret location | Rotated |
|---|---|---|---|---|---|---|---|---|---|
| GitHub | | | | | | | | | |
| Oracle Cloud (QBBE server, hosting.md) | | | | | container `qbbe-app-staging` | container `qbbe-app-production` (same server) | GitHub Environments → `DEPLOY_SSH_KEY`, `APP_ENV` | |
| Supabase | | | | _to record: also the mailbox of the organization's billing email, which receives the Free Plan quota warnings ([backup-recovery.md](backup-recovery.md), "Supabase traffic")_ | | | | _besides the app's own environments: GitHub Environments `backup-staging` and `backup-production` → `SUPABASE_DB_PASSWORD` and `SUPABASE_SERVICE_ROLE_KEY` (preferably a dedicated secret key named `backup`)_ | |
| Google Workspace / OAuth | | | | | | | | | |
| Transactional email | | | | | | | | | |
| Malware scanning | | | | | | | | | |
| Monitoring / alerting | | | | | | | | | |
| Backup storage ([backup-recovery.md](backup-recovery.md)) | _to record: the QBBE account that owns the bucket (the Oracle tenancy, if Oracle is used)_ | _to record: name; holds backup key 1 (age private key)_ | _to record: name; holds backup key 2 (age private key)_ | _to record: the bucket account's recovery mailbox_ | _to record_ | the bucket named in `BACKUP_S3_BUCKET`: archives under `staging/`, files under `blobs/staging/<YYYY-MM>-<key tag>/` | the same bucket: `production/` and `blobs/production/<YYYY-MM>-<key tag>/` | GitHub Environments `backup-staging` and `backup-production` → `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_AGE_RECIPIENT` (public keys only), `BACKUP_INDEX_KEY` (a different one per environment, kept nowhere else: losing it costs one full re-download of the files), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `BACKUP_HEALTHCHECK_URL`; the bucket key also in the password-manager entry "QBBE backup bucket key", shared with both custodians for restores; each age private key: that custodian's own password-manager entry plus one offline copy, never GitHub, the server, email or a shared drive | _to record: date the bucket key was made; rotate it yearly and when a custodian leaves. Rotate `BACKUP_INDEX_KEY` when someone who could read these environments' secrets leaves_ |
| Backup check-in monitor (healthchecks.io or similar; [backup-recovery.md](backup-recovery.md) setup step 6) | _to record: the QBBE mailbox the account is registered to_ | _to record: name (one of the backup custodians)_ | _to record: name (the other backup custodian)_ | _to record_ | _to record_ | check "QBBE backup staging" | check "QBBE backup production" | each check's ping address: GitHub Environment `backup-staging` / `backup-production` → `BACKUP_HEALTHCHECK_URL`. Each check's log also holds every night's archive name and sha256 (the body of each successful check-in): the source of `EXPECTED_SHA256` for a restore when GitHub is unavailable, so both custodians must be able to sign in to this account | _to record: rotate a ping address if it leaks (anyone holding it can report a backup that never happened, or add a false sha256 to the log)_ |

**Backup storage** has two kinds of custody. The bucket account is like any
other row. The two custodians are the people who each hold one of the age
private keys that open the encrypted backups: with both keys lost, every
backup is unreadable, so they must be two different, named people, and the
keys never sit in GitHub or on the QBBE server. When a custodian changes,
follow "Backup custodian unavailable or key lost" in backup-recovery.md.
The check-in monitor is what notices when the nightly backup stops running
altogether; its alerts go to both custodians. Its log is also the second
record, besides GitHub's run summaries, of each night's archive sha256,
which a restore needs (backup-recovery.md, Restore step 1).

**`backup-production` is a production credential store.** It holds
production's database password and a Supabase secret key that bypasses
row-level security: together, full read and write over every row and file
in production. It has no approval step (the nightly backup must not wait for
one); its only protection is that it accepts runs from `main` only. So
`main` must be protected (deployment.md, "Branches and gates"), and whoever
can write to `main` must be listed in the **GitHub** row as a custodian of
production data.

## Open ownership questions

These are recorded because they block #52, not because they are unknowable.

1. The repository is owned by the personal `Chxmdi` account. Until it sits
   under a QBBE organization, every branch protection and environment secret is
   held by an individual.
2. The production Supabase project ref in the repository (`xvxahcbwydsnllqbjnlr`)
   is not visible from the Supabase account currently connected to this
   workspace, so its ownership cannot be confirmed from here. Somebody with
   access has to confirm it, or it has to be recreated under QBBE control.
3. Whether staging and production are separate Supabase projects or one project
   with branching. Either is defensible; the register needs to say which, because
   the isolation checks in `environment-ownership.md` are written differently for
   each.
