# Backup & recovery runbook

## Where things stand (2026-10-22)

- **Built and rehearsed locally:** a nightly GitHub Actions workflow
  (`.github/workflows/backup.yml`, named **Backup**) that copies each
  environment's database and every uploaded file, encrypts the copy, and
  stores it in a bucket outside Supabase. After the first night it downloads
  only files that are new or changed, to stay inside Supabase's free traffic
  allowance. A restore script puts a copy back into an empty project and
  checks that nothing is missing. Both were run end to end against the local
  Supabase stack on 2026-10-22, twice: before and after the second round of
  review fixes (the [drill record](#drill-record)).
- **Not running yet:** it needs the owner's one-time setup below (a bucket,
  an access key, two encryption keys, an index-signing key, an outside
  monitor, two GitHub environments, and branch protection on `main`).
  **Until that is done there is no backup of staging or production at
  all.**
- **Not proven yet:** a restore of a real hosted backup into a scratch
  Supabase project (the hosted drill). This is required before real people's
  data goes in. See [Restore drill](#restore-drill). In particular, nobody has
  yet checked that people can sign in with their authenticator app (MFA)
  after a hosted restore; see the warning in
  [What is backed up](#what-is-backed-up-and-what-is-not).
- **Format:** these scripts write index format `qbbe-backup-index/2` and
  manifest format `qbbe-backup/3`. They cannot restore archives made by
  earlier versions of the scripts. No real backup has been made with an
  earlier version, so nothing is lost.

Terms used below:

- **age** is a small, widely used file-encryption tool. A *key pair* is two
  matching keys: the **public key** (starts with `age1`) can only lock files,
  so it is safe to give to GitHub; the **private key** (starts with
  `AGE-SECRET-KEY-`) unlocks them and must stay with a named person.
- **S3-compatible bucket**: online file storage that speaks Amazon's S3
  protocol. Oracle Object Storage (the QBBE server's provider), Backblaze B2,
  Cloudflare R2 and Amazon S3 all do.
- **sha256**: a 64-character fingerprint of a file's bytes. Two files with
  the same sha256 have the same contents; change one byte and it changes.
- **Blob**: one uploaded file, encrypted on its own and stored in the bucket
  under the sha256 of its contents, so each file is stored once however many
  nights refer to it.
- **Key tag**: 16 characters worked out from the custodians' public keys
  (the first 16 hex characters of the sha256 of the sorted list of keys). It
  is part of each blob folder's name, so blobs encrypted to different keys
  never mix.
- **Index**: a small unencrypted file stored next to each archive. It lists
  the blobs the archive needs and lets the next night tell which files have
  not changed. It names no file.
- **Index key** (`BACKUP_INDEX_KEY`): a random secret that GitHub uses to
  *sign* each index (an HMAC-SHA256, a checksum that only someone holding
  the key can make). A night only trusts the previous index if its signature
  is right.
- **Egress**: data leaving Supabase. The free plan allows 5 GB a month for all
  of an organization's projects together.
- **`PGPASSWORD`**: the environment variable that `psql`, `pg_dump` and the
  Supabase CLI read a database password from. Every database address in this
  runbook and in the scripts is written **without** a password, and the
  password goes in `PGPASSWORD`. The scripts refuse an address that contains
  one, so the password never shows in a process list or in a log.
- **RPO** (recovery point objective): how much recent work can be lost.
  **RTO** (recovery time objective): how long it takes to be working again.

## Why this exists, on any Supabase plan

Supabase's Free plan keeps no backups. Its Pro plan adds daily backups (7 days
kept) and, as a paid add-on, point-in-time recovery (restore to any minute).
Neither is enough on its own, for two reasons that Supabase states itself:

1. **Supabase backups do not include the bytes of uploaded files.** The
   database holds only the list of files; documents, receipts, form files and
   signing documents live in Supabase Storage, and no Supabase backup copies
   them.
2. **Supabase backups are deleted with the project.** A deleted project, a
   lost account or a locked-out owner takes them along.

So this workflow is needed even after an upgrade to a paid plan. A paid plan
would add a faster way back from a bad migration (point-in-time recovery),
not replace this.

## What is backed up, and what is not

Checked against the actual dump files on 2026-10-22.

| What | Backed up? | Notes |
|---|---|---|
| All app data (the `public` and `app` schemas: 233 tables in `public`) | Yes | `data.sql`. Each table's row count is in the manifest. Every night the backup also lists the tables that hold rows in the live database and fails if one of them is missing from the dump. |
| Database structure: tables, functions, row-level security on app tables, grants | Yes | `schema.sql`. Also rebuildable from `supabase/migrations` in Git. |
| Sign-in accounts: `auth.users` (with password hashes), `auth.identities` (Google sign-in links), `auth.mfa_factors` (authenticator-app secrets), MFA recovery codes, the Auth audit log | Yes | `data.sql`. Passwords come back with the hashes. See the MFA warning below this table. |
| Signed-in sessions (`auth.sessions`, `auth.refresh_tokens`) | Copied, but not usable | A new project signs sessions with different keys, so everyone signs in again once. |
| Uploaded files (every bucket, every folder) | Yes | One encrypted blob per file. The list of files is the database's own (`storage.objects` in the same dump), so files and database match; each file's size and sha256 are in the manifest, and each blob's encrypted size and sha256 too. |
| The file list and bucket settings (`storage.objects`, `storage.buckets`) | Yes | `data.sql`. A restore checks each bucket's public flag, size limit and file types against the backup. |
| Who may read and upload files (18 policies on `storage.objects`), and the app's triggers on `auth.users` and `storage.objects` (new sign-ups, immutable registered files) | Yes | `platform.sql`. Supabase's standard dump leaves these out because the platform owns those schemas. |
| Background job schedule (31 `pg_cron` jobs) and queue definitions (3 `pgmq` queues) | Yes | `platform.sql`. |
| Messages waiting in the queues at backup time (unsent notification emails) | **No** | Short-lived; at most one night's pending emails are lost. |
| Migration history (`supabase_migrations`) | Yes | `history_schema.sql`, `history_data.sql` (one `psql` query, `scripts/backup/migration-history.sql`), restored in the same transaction as the data, so `supabase db push` on a restored project says "up to date". |
| Realtime (which tables send live updates) | Yes | `schema.sql`. |
| **Vault secrets** (the job runner's address and shared secret) | **No** | Supabase's dump never copies the `vault` schema. After a restore, run `app.configure_job_runner` again with a new secret ([jobs.md](jobs.md)). |
| Supabase project settings: Auth address list, email (SMTP), Google provider, MFA settings, JWT signing keys, API keys, Storage's upload size limit | **No** | Dashboard settings, not data. Redo them from [hosting.md](hosting.md) step 7, [deployment.md](deployment.md) steps 3 and 9, and [google-sign-in.md](google-sign-in.md). |
| GitHub secrets and variables, the `APP_ENV` settings | No | They live in GitHub and the QBBE password manager. |
| The QBBE server | No | It holds no data; rebuild it as [hosting.md](hosting.md) "Rebuilding the server" says. |
| Code and migrations | Git | Keep `main` protected. |

> **Warning — MFA after a restore is not verified yet.** In the local
> rehearsal the authenticator-app secrets in `auth.mfa_factors` are stored as
> plain values and come back intact. A hosted Supabase project may instead
> encrypt them with a key that belongs to that one project. If it does, after
> a restore into a new project no administrator could pass MFA, and every
> administrator must use MFA. The hosted drill ([step 3](#restore-drill))
> checks this by signing in with an authenticator code. Until that check has
> passed, treat "people keep their authenticator app" as unproven, and if it
> fails, use [Lost administrator MFA factor](#losing-access-scenarios) for
> each administrator.

## How the nightly backup works

- **When:** every day at 07:17 UTC (03:17 in Montreal in summer, 02:17 in
  winter). The nightly run backs up **production only**, unless the
  repository variable `BACKUP_STAGING_NIGHTLY` is exactly `on`; then staging
  too, in parallel. Any time from **Actions**, **Backup**, **Run workflow**,
  you can back up `staging`, `production` or `both`, whatever that variable
  says. (Staging is off by default to save Supabase traffic; see
  [Supabase traffic](#supabase-traffic-egress).)
- **What it stores in the bucket:**
  - `<environment>/<YYYY-MM-DD>/qbbe-<environment>-<time>.tar.gz.age`: the
    archive. Inside (once decrypted): the six SQL files and `manifest.json`,
    which lists each SQL file's size and sha256, each table's row count, and
    every uploaded file with its size, sha256 and blob (with the blob's
    encrypted size and sha256).
  - `<environment>/<YYYY-MM-DD>/qbbe-<environment>-<time>.index.json`: the
    signed index. It lists the blobs that archive needs, each with its
    encrypted size and sha256, and the archive's own sha256. It names no
    file.
  - `blobs/<environment>/<YYYY-MM>-<key tag>/<sha256>.age`: one encrypted
    blob per uploaded file, in a folder per month and per set of custodian
    keys.
- **Only changes are downloaded.** Each night compares every file's version
  with the previous night's index. A file that has not changed, and whose
  blob is already in this month's folder, is not downloaded again. On the
  first night of a month the backup copies the blobs still in use from last
  month's folder to the new one, inside the bucket, without touching
  Supabase. Each copy goes through a private temporary file and is checked
  against the encrypted size and sha256 recorded when the blob was first
  stored; a blob that fails that check is not copied, and its file is
  downloaded again from Supabase instead. That way the lifecycle rule can
  delete a whole old month folder (and with it files that were deleted from
  the app) without breaking any archive that is still kept.
- **When the custodians' keys change** (`BACKUP_AGE_RECIPIENT`), the key tag
  changes, so the next night starts new, empty blob folders: it downloads
  every file from Supabase once and encrypts it to the new keys. Nothing is
  ever kept or copied across key tags. The old folders are deleted by the
  70-day rule. See [A custodian leaves](#keeping-it-running) for the cost.
- **Encryption:** the archive and every blob are locked with age to every
  custodian's public key. Either custodian's private key opens them. No
  private key is in GitHub or on the server, so neither can read a backup.
  Plain file bytes never touch the runner's disk: each file is encrypted as it
  downloads.
- **Checks every night:**
  - the tables that hold rows in the live database must all be in the dump;
  - every file the database lists must be accounted for: copied, recorded
    as an error, or recorded as deleted while the backup ran (its row is
    gone from the database too, which is recorded, not failed);
  - a file whose downloaded bytes do not match the database's size or MD5
    (a second fingerprint Storage keeps) for the same version is an error,
    not a warning;
  - if a migration is applied while the database is being dumped, the dumps
    are redone once, and the run fails if it happens again;
  - the previous index's signature must be right, or it is not used (every
    file is then downloaded again, with a warning);
  - the SQL files are checked against the manifest before encrypting;
  - every blob the archive needs must be in the bucket at the encrypted size
    recorded when it was stored;
  - the archive and its index are each downloaded again after upload, in
    full, and must have the same sha256 as the local file. New blobs are
    uploaded from complete local files and checked by size, not downloaded
    again (that would double the first night's transfer).
- **Safety, stated plainly:** each environment's job runs under its own
  GitHub environment (`backup-staging`, `backup-production`). They leave out
  the app's `APP_ENV` settings, and that is all they leave out.
  **`backup-production` holds production's database password and a Supabase
  secret key that bypasses row-level security: together they read and write
  every row and every file in production.** It has no approval step, by
  design, so the nightly run never waits. Its only protection is the rule
  that it accepts runs from the `main` branch. So anyone who can get a commit
  onto `main` (a person with write access, or a leaked token that can write
  to the repository) can read both. That is why `main` must be protected
  before this environment is filled ([setup step 7](#7-put-the-settings-into-github)).
  The job also refuses to run unless the Supabase project is the one
  registered for that environment (the same rule the Deploy workflow uses)
  and the service-role key is that project's.
- **When it fails:** a separate job opens a GitHub issue titled
  **Backup failed: staging** (or **production**), or comments on the one
  already open, with a link to the run. It is assigned to the GitHub user in
  the repository variable `BACKUP_ALERT_ASSIGNEE`, which sends that person an
  email. The outside monitor also emails both custodians straight away, also
  when the run was cancelled or stopped by its 90-minute time limit.
- **When it stops running at all:** the outside monitor
  (`BACKUP_HEALTHCHECK_URL`, setup step 6) expects a check-in every day from
  production. If none arrives within 26 hours, it emails both custodians.
  This is the only alarm for a schedule that silently stopped, which GitHub
  does in a public repository after 60 days without activity (see
  [Keeping it running](#keeping-it-running)).
- **How long copies are kept:** the bucket's lifecycle rules delete archives
  after 35 days, so about 35 nightly copies per environment exist at any
  time, and blob folders after 70 days (long enough for every kept archive
  to find its blobs: a blob copied on the 1st of a month can be needed by an
  archive from the 31st, kept until 35 days later). The access key made in
  setup step 5 cannot delete or overwrite anything.
- **The 35-day point of no return.** Because archives are deleted after 35
  days, **if no backup of an environment succeeds for 35 days, the bucket
  holds no backup of it at all.** The clock starts at the last good backup,
  usually a day before the first alert (issue or monitor email). Fix the job
  well before then. This also applies to
  staging while its nightly run is off: run it by hand at least every 30
  days.
- **Personal data and deletion requests (Quebec Law 25, for the privacy
  officer):** a person's database rows stay in the archives for up to 35
  days after they are deleted from the app. **An uploaded file deleted from
  the app stays in the bucket, encrypted, for up to about 70 days**: its
  name and row disappear from new archives at once and from all archives
  after 35 days, but its blob lives until its month folder is deleted. After
  a change of custodian keys, the old folders also last up to 70 days. The
  copies stay in Oracle's Montreal region and only the custodians' private
  keys open them. Answer deletion requests with "removed from backups within
  70 days", not 35.
- **What the bucket shows without a private key:** dates, sizes, how many
  files there are, and the sha256 of each file's contents. That last one is
  enough for someone with access to the bucket to confirm whether a file
  they already have is stored there; it never reveals a file they do not
  have, or any file name.
- **What someone holding the bucket key could do:** read the encrypted
  objects, and add new ones (the key cannot delete or overwrite). Two kinds
  of planted object matter, and both are caught:
  - *A planted archive.* A restore refuses to decrypt any archive whose
    sha256 differs from the one in the green Backup run's summary
    (`EXPECTED_SHA256`, [Restore](#restore-a-real-incident) step 4).
  - *A planted index.* An index tells later nights which stored copy belongs
    to which unchanged file, so a forged one would make every later backup
    record some files with another file's contents, until each affected
    file changes. The index is signed with `BACKUP_INDEX_KEY`, which is only
    in GitHub, so a forged index fails the signature check and is ignored
    (the night downloads every file again, with a warning). As a second
    line, the restore checks every restored file against the size and MD5
    that the database itself recorded.
  - Both environments use the same bucket key. This was accepted because
    both backup environments have the same protection (the `main` rule), so
    separate keys would add little, while the protections above do not
    depend on the bucket key. Give each environment its **own**
    `BACKUP_INDEX_KEY`, so a leak of staging's settings cannot sign a
    production index. Keep the bucket key as closely as the backups
    themselves, and rotate it, and the index keys, when in doubt.
- **RPO: 24 hours** for production (one copy per night). For staging with
  the nightly run off: the time since the last manual run.
- **RTO:** measured only locally so far (about 16 seconds of machine time for
  today's demo data, see the drill record). The working target stays **one
  business day** until the hosted drill measures it.

### Supabase traffic (egress)

Everything the backup reads from Supabase counts toward the free plan's
5 GB a month, shared by staging, production and the app's own use. If the
organization stays over the allowance, Supabase can restrict every project in
it, production included.

Each run's summary has a line **Read from Supabase by this run**, for
example:

> 42.1 MB: database dump 36.9 MB, about 5.2 MB of catalog reads by pg_dump
> (a fixed estimate, not measured per run), 0 new or changed files 0 B. At
> this rate, about 1.2 GB a month

- *Database dump* is the size of the SQL files read that night. It grows
  with the data.
- *Catalog reads* are the questions `pg_dump` asks the database about its
  own structure before it dumps anything. They do not show in the file
  sizes. They were measured with a byte-counting proxy on 2026-10-22 at
  about 5.5 million bytes a night per environment (shown as 5.2 MB, because
  the summary counts 1 MB as 1,048,576 bytes). The figure is a fixed
  estimate, not measured each night. It grows with the number of tables,
  functions and policies, not with the data.
- *Files* are the new or changed files downloaded that night.
- *A month* is the night's total × 30, for that one environment.

When that monthly figure is over 2 GB for one environment, the run shows a
yellow warning **Supabase traffic** (`::warning title=Supabase traffic::…`).
The run stays green. A first night, or the night after the custodians' keys
change, reads every file once and raises it for that night only; if it
appears on an ordinary night, do the [monthly check](#keeping-it-running)
now.

Estimate from the local rehearsal on 2026-10-22 (demo data: 54,529 rows,
30 files of 75.1 MB), in the summary's own units:

| Night | Read from Supabase |
|---|---|
| First night (empty bucket) | about 117 MB: database dump 36.9 MB, catalog reads about 5.2 MB, all 30 files 75.1 MB |
| A night with no new files | about 42 MB: database dump and catalog reads |
| A night with 3 new small files | about 42 MB plus the 3 files |
| First night of a new month | about 42 MB: the blobs are copied inside the bucket, not read from Supabase |

So a month costs about **30 × (database dump + 5.2 MB) for each environment
that runs nightly**, plus the files that were added or changed. At the
rehearsal's size that is about 1.2 GB a month for production alone, and about
2.5 GB with staging nightly too: half the allowance, before the app's own
traffic. That is why staging's nightly run is off by default.

**Nights that read every file again.** Each of these reads all of an
environment's stored files from Supabase once, on top of the dump. Plan for
them:

- the very first night;
- the night after `BACKUP_AGE_RECIPIENT` changes (new key tag), with the
  warning `The custodians' keys (BACKUP_AGE_RECIPIENT) changed since the
  previous backup`;
- the night after `BACKUP_INDEX_KEY` changes or is lost, or after any
  previous index fails its signature check, with the warning `The previous
  index … failed its signature check`;
- the first run after a gap of more than 35 days (all indexes have expired;
  the log says `previous index: none (every file will be downloaded)`). This
  includes turning the schedule back on late after
  [GitHub's 60-day rule](#keeping-it-running), and a manual staging run more
  than 35 days after the last one;
- the first night after a real restore into a new project: restored files
  get a new version and date, so every file looks changed once;
- the hosted [restore drill](#restore-drill): the restore downloads every
  restored file again from the scratch project (in the same organization)
  to check it, so it costs about the total size of the files.

A run of failed nights also costs more: each one downloads again every file
changed since the last good night.

> **Check before relying on it** (part of setup step 8): read the **Read from
> Supabase** line of production's first ordinary night (not the first night)
> and note its "about … a month". Staging's nightly run stays off unless
> production's monthly figure plus staging's (from an ordinary staging run
> by hand, not its first) stays under 2.5 GB, half the allowance. A week
> after setup, do the [monthly egress check](#keeping-it-running) once.

> **If Supabase emails** the organization's billing address that the Free
> Plan quota is exceeded, a grace period has started. Act the same day: set
> `BACKUP_STAGING_NIGHTLY` to `off` (setup step 7, point 7), then do the
> monthly egress check. Supabase's usage documentation says that once the
> grace period ends, every project in the organization, production
> included, can be restricted (requests answered with error 402). Which
> mailbox receives these emails is recorded in
> [provider-custody.md](provider-custody.md), row **Supabase**.

### Bucket capacity

Oracle's Always Free tier includes 20 GB of Object Storage and 50,000
requests a month.

- **Space.** The bucket holds about 35 archives per environment (4.5 MB each
  in the rehearsal, because files are no longer inside them) plus the blobs.
  On average there are about 2.3 copies of every file (this month's folder,
  last month's, and part of the month before). **Size for 3 copies**: in
  roughly the first 10 days of each month, three month folders exist at
  once. After a change of custodian keys, add one more full copy for up to
  70 days.
- **Requests.** A night makes about 10 requests plus 2 per new file. The
  first night of a month makes 2 per file (one to read the blob, one to
  write the copy), per environment. That keeps the month under 50,000
  requests up to roughly 12,000 files per environment.
- **Time.** The job is stopped after 90 minutes. The monthly copy runs four
  blobs at a time; at the first rehearsal's speed (about 1.5 s per blob per
  worker), 90 minutes covers roughly 14,000 blobs, fewer over a slow
  connection.
- Together: past about **10,000 files in one environment**, tell the
  developers before the first night of a month fails.

Look at the bucket's size once a month ([Keeping it running](#keeping-it-running)).
If it approaches 20 GB, move to a paid tier, or shorten both lifecycle rules
together: the `blobs/` rule must always stay at least 35 days longer than the
archives' rule.

## One-time setup (owner)

Do these in order. Each step says what you should see.

### 1. Choose the two backup custodians

Two named people who will each hold one private key. One person is a single
point of failure: if that person is unreachable, or loses the key, every
backup is unreadable.

Write their names in [provider-custody.md](provider-custody.md), row
**Backup storage**, columns *Primary custodian* and *Backup custodian*.

### 2. Each custodian makes a key pair, on their own computer

> **Warning — read before you start.** The private key is the only way to
> open a backup. If both custodians lose theirs, every backup ever made is
> permanently unreadable, and nobody (not Oracle, not GitHub, not Supabase)
> can recover them. If a private key leaks, anyone holding a backup file can
> read every person's data in it.

Each custodian, separately:

1. Install age:
   - macOS: `brew install age`
   - Windows: `winget install --id FiloSottile.age`
   - Ubuntu or Debian: `sudo apt install age`

   You should see `age --version` print a version such as `1.1.1`. If the
   command is not found, close and reopen the terminal and try again.
2. Make the key pair:
   ```sh
   age-keygen -o qbbe-backup-key.txt
   ```
   You should see one line: `Public key: age1…` (62 characters).
3. Keep the file `qbbe-backup-key.txt` (it holds the private key) in two
   places: the custodian's own entry in the QBBE password manager (as an
   attached file or secure note), and one offline copy (for example a USB key
   in a sealed envelope in the office safe). Then delete it from the
   Downloads folder or desktop, and empty the bin.

   **Never** put the private key in GitHub, on the QBBE server, in email,
   chat, or a shared drive folder.
4. Send the **public key** line (`age1…`) to the owner. It is not secret.
   Send only that line, never the whole file: the file holds the private
   key.

### 3. Create the bucket (Oracle Object Storage, Montreal)

Oracle is recommended because QBBE already has the account (the QBBE server)
and because the Montreal region keeps the copies in Quebec, which matters
for Law 25. Another provider is fine (see the end of step 5), but copies
stored outside Quebec need the privacy officer's assessment first.

Oracle renames console menus from time to time. If a name below does not
match, type the bold name into the console's search bar.

1. Sign in to the Oracle Cloud console with the QBBE account. Check the region
   at the top right says **Canada Southeast (Montreal)**.
2. Navigation menu (☰), **Storage**, **Buckets** (under *Object Storage &
   Archive Storage*). Compartment: the root compartment (your tenancy name).
3. **Create Bucket**. Name: `qbbe-hub-backups`. Default Storage Tier:
   **Standard**. Leave encryption on **Encrypt using Oracle managed keys**.
   **Create**.

   You should see the bucket in the list. Open it: *Visibility* says
   **Private**. Note the **Namespace** shown on the bucket's page.
4. Your two settings for GitHub are now:
   - `BACKUP_S3_ENDPOINT` = `https://<namespace>.compat.objectstorage.ca-montreal-1.oraclecloud.com`
   - `BACKUP_S3_REGION` = `ca-montreal-1`

### 4. Make the bucket delete old copies by itself (lifecycle rules)

Oracle needs permission to delete old copies on your behalf first.

1. Navigation menu, **Identity & Security**, **Policies**, root compartment,
   **Create Policy**. Name: `objectstorage-lifecycle`. Switch to **Show
   manual editor** and enter:
   ```
   Allow service objectstorage-ca-montreal-1 to manage object-family in tenancy
   ```
   **Create**. You should see the policy listed with that one statement.
2. Back on the bucket's page: **Lifecycle Policy Rules** (under *Resources*),
   **Create Rule**, three times:

   | Name | Lifecycle Rule Target | Lifecycle Action | Number of Days | Object Name Filters (prefixes) |
   |---|---|---|---|---|
   | `delete-archives-after-35-days` | Objects | Delete | `35` | `staging/` and `production/` |
   | `delete-blobs-after-70-days` | Objects | Delete | `70` | `blobs/` |
   | `delete-unfinished-uploads-after-2-days` | Uncommitted multipart uploads | Delete | `2` | none |

   State: **Enabled** for each, then **Create**. You should see three rules,
   each with status **Enabled**. If Oracle says it lacks permission, the
   policy in point 1 is missing or in another compartment.

   > **Warning:** do not give `blobs/` the 35-day rule. Blobs must outlive the
   > archives that point to them; with 35 days, a restore of an older archive
   > would find files missing.

### 5. Create an access key that can only add and read backups

The key GitHub uses must not be able to delete or overwrite backups, so a
stolen GitHub secret cannot erase them.

1. Navigation menu, **Identity & Security**, **Domains**, **Default** domain,
   **User management**:
   - **Groups**, **Create group**: name `qbbe-backup-writers`. You should see
     the group in the list with 0 members.
   - **Users**, **Create user**: name `qbbe-backup-ci` (a QBBE mailbox is
     fine for the email). Do not give it a console password. Open the user,
     **Groups**, **Assign user to groups**, `qbbe-backup-writers`. You should
     see the group listed on the user's page.
2. **Identity & Security**, **Policies**, root compartment, **Create Policy**.
   Name: `qbbe-backup-writers`, manual editor:
   ```
   Allow group 'Default'/'qbbe-backup-writers' to read buckets in tenancy where target.bucket.name = 'qbbe-hub-backups'
   Allow group 'Default'/'qbbe-backup-writers' to manage objects in tenancy where all {target.bucket.name = 'qbbe-hub-backups', any {request.permission = 'OBJECT_CREATE', request.permission = 'OBJECT_INSPECT', request.permission = 'OBJECT_READ'}}
   ```
   **Create**. You should see the policy with these two statements. Neither
   allows `OBJECT_DELETE` or `OBJECT_OVERWRITE`.
3. Open the user `qbbe-backup-ci`, **Customer secret keys** (under
   *Resources*, or the *Tokens and keys* tab), **Generate secret key**, name
   `github-backup`.

   > **Warning:** Oracle shows the secret **once**. Copy it straight into the
   > password manager before closing the window. If you lose it, delete the
   > key and generate a new one.

   The **Secret** is `BACKUP_S3_SECRET_ACCESS_KEY`. After closing, the key's
   **Access Key** column is `BACKUP_S3_ACCESS_KEY_ID`.
4. Save both values in the password manager entry **QBBE backup bucket key**,
   shared with both custodians. They need it to download backups for a
   restore ([Restore](#restore-a-real-incident) step 3); GitHub never shows a
   secret again once saved.

**Another provider instead of Oracle** (same GitHub settings, different values):

- *Backblaze B2*: **Buckets**, **Create a Bucket** (Private). **Lifecycle
  Settings**, custom, two rules: prefix `staging/` and `production/`, hide
  after 35 days, delete 1 day later; prefix `blobs/`, hide after 70 days,
  delete 1 day later. **Application Keys**, **Add a New Application Key**,
  *Allow access to Bucket(s)*: only this bucket, *Type of Access*: Read and
  Write. Endpoint `https://s3.<region>.backblazeb2.com`, region as in the
  endpoint. B2 keys with write access can also delete; turn on **Object
  Lock** on the bucket to stop that.
- *Cloudflare R2*: **R2**, **Create bucket**; bucket **Settings**, **Object
  lifecycle rules**: delete `staging/` and `production/` after 35 days,
  `blobs/` after 70 days, and abort incomplete multipart uploads after 2
  days. **Manage R2 API Tokens**, **Create API token**, *Object Read &
  Write*, this bucket only. Endpoint
  `https://<account id>.r2.cloudflarestorage.com`, region `auto`.
  **Caveat:** an R2 *Object Read & Write* token can also delete objects; R2
  has no write-only token. If you choose R2, a stolen GitHub secret could
  erase backups.

### 6. Set up the outside monitor

This is what tells you when the backup stopped running altogether. It uses
[healthchecks.io](https://healthchecks.io) (free for up to 20 checks); any
service that emails when an expected web request does not arrive works the
same way.

1. Create a healthchecks.io account with a QBBE mailbox (not a personal one).
2. **Add Check**, twice:
   - `QBBE backup production`: **Schedule**, **Simple**, *Period* `1 day`,
     *Grace Time* `2 hours`, **Save**.
   - `QBBE backup staging`: **Schedule**, **Simple**, *Period* `30 days`,
     *Grace Time* `1 day`, **Save**. Staging is backed up by hand while its
     nightly run is off (the default), so this check emails when nobody has
     backed staging up for a month. If you later turn staging's nightly run
     on, change this check's *Period* to `1 day` and its *Grace Time* to
     `2 hours`.
3. **Integrations**: add both custodians' email addresses, and make sure both
   checks use them.
4. Copy each check's **Ping URL** (`https://hc-ping.com/…`). It goes into
   GitHub in step 7.

You should see both checks with the status **new** (grey). After the first
successful backup they turn **up** (green). If a check goes **down** (red)
and emails you, read [When a backup fails](#when-a-backup-fails).

> **Do not use Pause to silence a check.** On healthchecks.io a paused check
> comes back on by itself at the next ping (unless its *manual resume*
> option is ticked), so the next backup by hand re-arms it and it emails
> "down" a period later: a false alarm that teaches people to ignore the
> monitor. Change the check's *Period* instead, as in point 2.

Record the account in [provider-custody.md](provider-custody.md), row
**Backup check-in monitor**.

### 7. Put the settings into GitHub

The backup uses two GitHub environments of its own, **not** `staging` and
`production`: those hold all of the app's secrets and, for production,
required reviewers that would make every nightly backup wait for someone's
approval.

> **Warning — read before you fill `backup-production`.** It will hold
> production's database password and a Supabase secret key that bypasses
> row-level security: together, full read and write over every row and file
> in production. It has no approval step. **Its only protection is that it
> accepts runs from `main` only**, so anyone who can land a commit on `main`
> can read both. Before point 1:
>
> 1. Protect `main`: run `scripts/protect-main.sh` as
>    [deployment.md](deployment.md), "Branches and gates", describes. You
>    should see it print the live rules. To check it in GitHub: repository
>    **Settings**, **Branches** (the script's ruleset `main: require CI` is
>    listed under **Settings**, **Rules**, **Rulesets**, status **Active**).
>    If it is not there, stop: do not put production's secrets in GitHub
>    yet.
> 2. Repository **Settings**, **Collaborators** (**Collaborators and
>    teams** once the repository is in an organization): keep write access
>    to named people only. You should see no account you cannot name.
> 3. Do not give any automation token (a personal access token, an app)
>    permission to write to this repository's contents.
>
> This is the price of nightly backups that run without anyone present.

> **Warning:** do not add **Required reviewers** to `backup-staging` or
> `backup-production`. The nightly backup would wait for an approval, store
> nothing, and no alert would be raised while it waits.

1. Repository **Settings**, **Environments**, **New environment**, name
   `backup-staging`, **Configure environment**.
2. Under **Deployment branches and tags**, choose **Selected branches and
   tags**, **Add deployment branch or tag rule**, `main`. Leave **Required
   reviewers** unticked.
3. Make this environment's index key, on your own computer:
   ```sh
   openssl rand -base64 48
   ```
   You should see one line of 64 characters. It goes in the table below as
   `BACKUP_INDEX_KEY`. Do not keep a copy anywhere else: if it is ever lost
   or replaced, the only cost is that the next night downloads every file
   once (see [Supabase traffic](#supabase-traffic-egress)). Make a
   **different** one for `backup-production` in point 6.
4. **Environment secrets**, **Add environment secret**, once per line:

   | Name | Value |
   |---|---|
   | `SUPABASE_DB_PASSWORD` | staging's database password (the same value as in the `staging` environment; it is in the password manager) |
   | `SUPABASE_SERVICE_ROLE_KEY` | a Supabase secret key for staging. Preferred: a dedicated one, so it can be revoked on its own without touching the app: Supabase dashboard, staging project, **Project Settings**, **API Keys**, **Secret keys**, **New secret key**, name `backup` (starts with `sb_secret_`). Otherwise the **Legacy API Keys** `service_role` key (**Reveal**). |
   | `BACKUP_AGE_RECIPIENT` | both custodians' public keys, separated by a space: `age1… age1…` |
   | `BACKUP_INDEX_KEY` | the line from point 3 |
   | `BACKUP_S3_ACCESS_KEY_ID` | from step 5 |
   | `BACKUP_S3_SECRET_ACCESS_KEY` | from step 5 |
   | `BACKUP_HEALTHCHECK_URL` | the **staging** check's Ping URL from step 6 |

   `BACKUP_AGE_RECIPIENT` holds only public keys, but it is a secret so that,
   if a private key is ever pasted there by mistake, GitHub hides it in the
   (public) logs; the workflow then refuses to run.

   About the dedicated `sb_secret_` key: the settings check cannot confirm
   which project such a key belongs to (it can for a legacy `service_role`
   key), and it has not yet been tried against a hosted project. Step 8 is
   that test: if the file copy fails with `HTTP 401` or `HTTP 403`, use the
   legacy `service_role` key instead.
5. **Environment variables**, **Add environment variable**:

   | Name | Value |
   |---|---|
   | `SUPABASE_PROJECT_REF` | staging's project ref (the 20 letters in its dashboard address) |
   | `BACKUP_S3_ENDPOINT` | from step 3 |
   | `BACKUP_S3_BUCKET` | `qbbe-hub-backups` |
   | `BACKUP_S3_REGION` | from step 3 |

   You should see 7 secrets and 4 variables on the environment's page, and
   `main` under deployment branches.
6. Repeat points 1 to 5 for `backup-production`, with **production's**
   database password, a production secret key (the dedicated `backup` key
   is strongly preferred here), project ref and Ping URL, and a **new**
   index key from `openssl rand -base64 48`. The bucket values and public
   keys are the same.
7. Repository **Settings**, **Secrets and variables**, **Actions**,
   **Variables**: check that `STAGING_SUPABASE_PROJECT_REF` and
   `PRODUCTION_SUPABASE_PROJECT_REF` exist (the Deploy workflow set them up),
   and add **`BACKUP_ALERT_ASSIGNEE`** = the GitHub user name of the person
   who should get the "Backup failed" issues (a person, not an
   organization). You should see all three in the list.

   Leave **`BACKUP_STAGING_NIGHTLY`** out for now: without it (or with any
   value other than `on`), the nightly run backs up production only. To back
   staging up every night too, add it with the value `on` (exactly, lower
   case) on this same page, and change the staging check's period (step 6,
   point 2). To turn it off again, delete the variable or set it to `off`.
   You should see the next nightly run list only **Back up production**
   (off) or both jobs (on).

> **Warning:** `BACKUP_AGE_RECIPIENT` takes the **public** keys only. If a
> private key was ever saved there, treat it as exposed: delete it, make a new
> key pair, and use the new one.

### 8. Run it once and check

This first run is also the first real test of the upload against Oracle and
of GitHub's own runner; the rehearsal used a local stand-in for both.

1. **Actions**, **Backup**, **Run workflow**, branch `main`, environment
   **both**, **Run workflow**.
2. You should see two jobs, **Back up staging** and **Back up production**,
   turn green. The first run downloads every file, so it takes longest (the
   local rehearsal took 31 seconds for demo data; the hosted connection and
   setup add a few minutes). Each run's summary shows where the archive is
   stored (`Stored as s3://qbbe-hub-backups/production/<date>/qbbe-production-<time>.tar.gz.age`),
   its size and sha256, and a table of what was backed up, including **Read
   from Supabase by this run**. A **Supabase traffic** warning on this first
   run is expected (it reads every file).
3. In Oracle, open the bucket: you should see folders `staging/`,
   `production/` and `blobs/`, with today's date under the first two.
4. In healthchecks.io, both checks should now say **up**.
5. The next morning, open production's nightly run and do the traffic check
   in [Supabase traffic](#supabase-traffic-egress).

If a job fails: its log has a red `Error:` line naming the problem, for
example `Missing BACKUP_INDEX_KEY: add it as a secret on the backup-staging
environment (Settings, Environments, backup-staging, Environment secrets).`
Fix that setting and run the workflow again. A **Backup failed: …** issue
will also have been opened; close it once a run is green.

### 9. Each custodian proves their key opens a backup

On the custodian's computer (Linux, WSL on Windows, or a Mac with `brew
install bash age awscli node`), in a checkout of this repository. Do this
once now, and again whenever `BACKUP_AGE_RECIPIENT` changes.

1. Put the bucket key into this terminal without it landing in your shell
   history. Type each `read` line, press Enter, paste the value from the
   password manager entry **QBBE backup bucket key**, press Enter (nothing
   appears while you paste; that is expected):
   ```sh
   export BACKUP_S3_ENDPOINT='<from step 3>' BACKUP_S3_BUCKET=qbbe-hub-backups BACKUP_S3_REGION=ca-montreal-1
   read -rs BACKUP_S3_ACCESS_KEY_ID; export BACKUP_S3_ACCESS_KEY_ID
   read -rs BACKUP_S3_SECRET_ACCESS_KEY; export BACKUP_S3_SECRET_ACCESS_KEY
   ```
2. Save your private key from the password manager as
   `~/qbbe-backup-key.txt`, then make it readable by you only:
   ```sh
   chmod 600 ~/qbbe-backup-key.txt
   ```
   You should see no output.
3. Download the newest staging backup:
   ```sh
   bash scripts/backup/bucket.sh fetch staging latest ~/qbbe-backup-check
   ```
   You should see `Fetched …` and `Archive sha256: …`. Compare that sha256
   with the one in the summary of the newest green Backup run of staging
   (GitHub, **Actions**, **Backup**, the run, **Back up staging**'s
   summary). They must be identical.
4. Open the archive and every blob with your key:
   ```sh
   mkdir ~/qbbe-backup-check/work
   age -d -i ~/qbbe-backup-key.txt ~/qbbe-backup-check/qbbe-staging-*.tar.gz.age | tar -xzf - -C ~/qbbe-backup-check/work
   AGE_IDENTITY_FILE=~/qbbe-backup-key.txt node scripts/backup/manifest.mjs unpack-blobs ~/qbbe-backup-check/work ~/qbbe-backup-check/blobs
   node scripts/backup/manifest.mjs check-files ~/qbbe-backup-check/work
   ```
   You should see `Files: N of N unpacked from … blob(s); 0 blob(s) missing
   from …, 0 could not be decrypted.`, then an `ok` line for each of the six
   `db/` files and a last line `ok    files: N checked against their sha256
   and the database's size and MD5, 0 missing, 0 changed, …`. Any count
   other than 0 there, or a `FAIL` line, means the check failed: send the
   output (it holds no file names) to the other custodian and the owner.
   Checking every blob matters after a key change: files that changed after
   the change open with the new key, while an unchanged file's blob would
   not if something went wrong.

   If `age` says `no identity matched any of the recipients`, that
   custodian's public key is not in `BACKUP_AGE_RECIPIENT`: fix step 7 and
   wait for the next backup (or run staging by hand), then repeat from
   point 3 into a new folder.
5. Delete what you downloaded and your key file:
   ```sh
   rm -rf ~/qbbe-backup-check ~/qbbe-backup-key.txt
   ```
   You should see no output. The folder held people's personal data.

## Keeping it running

- **Monthly** (put it in the calendar of the person in
  `BACKUP_ALERT_ASSIGNEE`):
  1. GitHub, **Actions**, **Backup**: the last nights are green. You should
     see one green run per day.
  2. Oracle, the bucket's page: its size is well under 20 GB (see
     [Bucket capacity](#bucket-capacity)).
  3. **Supabase egress.** Supabase dashboard, select the QBBE organization,
     **Usage**, the **Egress** chart for the current billing period. Work
     out the projection: egress so far ÷ days elapsed × 30. You should see
     it under 4 GB.
     - If it is over 4 GB: set `BACKUP_STAGING_NIGHTLY` to `off` (setup
       step 7, point 7) the same day, and change the staging check's period
       back to 30 days.
     - If it is still over 4 GB with staging off: tell the developers. The
       nightly database dump must become less frequent or cheaper, or the
       organization needs a paid plan (the owner's decision).
  4. If staging's nightly run is off: run **Backup** for **staging** by
     hand (**Actions**, **Backup**, **Run workflow**, environment
     `staging`). You should see **Back up staging** turn green, and the
     staging check in healthchecks.io say **up**. Missing this for more than
     35 days leaves no staging backup at all, and the next run downloads
     every staging file again.
- **GitHub's 60-day rule.** This repository is public. GitHub turns off a
  public repository's scheduled workflows after 60 days with no activity
  (no commit or other change). Nothing fails and no issue is opened; only
  the outside monitor notices, by emailing that the check-in is late. To turn
  it back on: **Actions**, **Backup**; a yellow banner says the scheduled
  workflow is disabled; click **Enable workflow**. You should see the banner
  disappear; run the workflow once by hand to close the gap. Remember the
  [35-day point of no return](#how-the-nightly-backup-works): after 35
  quiet days there is no backup left, and the first run reads every file.
- **A custodian leaves, or a private key is lost.** Follow "Backup custodian
  unavailable or key lost" in [Losing access](#losing-access-scenarios).
  It changes `BACKUP_AGE_RECIPIENT`, which makes the next night of each
  environment download every stored file from Supabase once (about the
  total size of that environment's files). Do it early in a month with
  room in the egress figure, not near the end of a heavy month.
- **Rotating the bucket key** (yearly, and when a custodian leaves):
  1. Oracle, user `qbbe-backup-ci`, **Customer secret keys**, **Generate
     secret key** (step 5, point 3). Copy the secret into the password
     manager entry **QBBE backup bucket key** before closing the window.
  2. Replace `BACKUP_S3_ACCESS_KEY_ID` and `BACKUP_S3_SECRET_ACCESS_KEY` in
     both `backup-staging` and `backup-production` (**Settings**,
     **Environments**, the environment, the secret's pencil icon).
  3. **Actions**, **Backup**, **Run workflow**, `both`. You should see both
     jobs green.
  4. Only then delete the old key: Oracle, user `qbbe-backup-ci`,
     **Customer secret keys**, the old key's **⋮** menu, **Delete**.
- **Rotating an index key** (when someone who could read the GitHub
  environments' secrets leaves, or if a leak is suspected): make a new one
  with `openssl rand -base64 48` and replace `BACKUP_INDEX_KEY` in that
  environment. The next night prints `The previous index … failed its
  signature check` and downloads every file once; that is expected. Restores
  never need this key.

## When a backup fails

The issue **Backup failed: <environment>** links to the run (the outside
monitor's email says only that a check-in failed or is late). Open the run,
and read the first red `Error:` line. Remember: 35 days after the last good
backup, there is none left.

| The error says | What it means | What to do |
|---|---|---|
| `Missing <NAME>` | a setting is not in GitHub | add it where the message says, run **Backup** again |
| `BACKUP_INDEX_KEY holds N bytes` or `BACKUP_INDEX_KEY is neither hex nor base64` | the index key is too short or mistyped | make a new one with `openssl rand -base64 48`, replace the secret, run again (that night downloads every file once) |
| `Refusing: …registered project` or `…belongs to another Supabase project` | the environment points at the wrong Supabase project, or holds another project's key | fix `SUPABASE_PROJECT_REF` or `SUPABASE_SERVICE_ROLE_KEY` on that backup environment |
| `Could not connect to the … database through its pooler` | wrong `SUPABASE_DB_PASSWORD`, or the Supabase project is paused (Free projects pause after a quiet week) | resume the project in the Supabase dashboard (**Resume project**) or fix the password, run again |
| `A migration was applied while the database was being dumped, twice in a row` | a deploy ran during the backup | run **Backup** again once the deploy has finished |
| `table(s) hold rows but are not in the dump` | Supabase's dump left out a table that has data; the rest of the backup was stored | tell the developers: the backup is incomplete until `scripts/backup` handles that table |
| `Some uploaded files could not be copied` | the database copy was stored; one or more files were not | the step's log says why for each, without the file's name. `Storage has no bytes for a file the database still lists`: the file is lost at the source; look at Supabase Storage. `…do not match the database's size or MD5 for this version`: the file is damaged at the source or was cut short; run again, and if it repeats, look at Supabase Storage. `HTTP 400 (Bucket not found; check the service-role key…)`: the key is not this project's. `…neither copied nor recorded (a fault in the export)` or `The file export stopped`: run again; if it repeats, tell the developers |
| `Upload to the backup bucket failed` or `Cannot list the backup bucket` | wrong endpoint, bucket or key, or the key lacks permission | check steps 5 and 7 |
| `blob(s) this backup needs are not in blobs/…` | blobs that should be in this month's folder are not there | run again (they are uploaded again). If it repeats, check the lifecycle rule on `blobs/` is 70 days, not 35 (step 4) |
| `blob(s) in blobs/… do not have the encrypted size recorded when they were stored (damaged copies)` | a stored blob is damaged; the backup key cannot replace or delete it, so every night this month will fail until it is removed | in Oracle, **Buckets**, `qbbe-hub-backups`, **Objects**, open the folder the message names, and for each `<sha256>.age` it lists, the object's **⋮** menu, **Delete** (this needs an Oracle administrator, not the GitHub key). Then run **Backup** again; you should see it green. Do not just wait for next month |
| `The archive (database and manifest) is stored as …, but not its index` | the blobs failed (see the lines above it), but the database was still stored | fix the blob problem and run again. To restore that one night later (rarely needed), see [Restore](#restore-a-real-incident), "If the night you need has no index" |
| `does not match the local file` | the stored copy differs from what was uploaded | run again; if it repeats, contact the bucket provider |
| no failed run, but the monitor says the check-in is late | the schedule did not run | see [GitHub's 60-day rule](#keeping-it-running); also check GitHub's status page |

**Yellow warnings** do not fail the run, but read them:

| The warning says | What it means | What to do |
|---|---|---|
| `The custodians' keys (BACKUP_AGE_RECIPIENT) changed since the previous backup` | expected the first night after a key change | nothing, if you changed the keys; if nobody did, check who edited the secret |
| `The previous index … failed its signature check` | expected after an index key change; otherwise the newest index was not made by Backup | if nobody changed `BACKUP_INDEX_KEY`, treat it as a planted index: rotate the bucket key and the index key ([Keeping it running](#keeping-it-running)) and tell the developers |
| `blob(s) in blobs/… do not have the size or sha256 recorded when they were stored, so they were not copied` | last month's copies of those blobs are damaged; the files were downloaded again from Supabase instead | nothing urgent; if it recurs, tell the developers |
| `blob(s) could not be copied from blobs/… (a download or upload failed)` | a temporary bucket error during the monthly copy; the files were downloaded again instead | nothing, unless it recurs |
| `blob(s) the previous backup stored in … are no longer there` | something deleted objects from the bucket | check the lifecycle rules (step 4) and who has delete rights in Oracle |
| `Supabase traffic` | at this night's rate, this environment alone would read over 2 GB a month | on a first night or after a key change, nothing; otherwise do the monthly egress check now |

Close the issue once a run is green. Until then, the newest copy is older than
24 hours.

## Restore (a real incident)

> **Warning:** never restore over a working project. A restore goes into a
> **new, empty** Supabase project, and the app is switched to it only once
> the restore has passed its checks. The script refuses a project that
> already has the app's tables, refuses the projects you tell it to protect,
> and refuses a file target that is not the same project as the database
> target.

What the custodian's computer needs: a checkout of this repository, Node 22,
`psql` (PostgreSQL 16 or newer), `age`, the AWS CLI, and bash 4.4 or newer.
That is Linux, WSL (Ubuntu) on Windows, or a Mac with `brew install bash age
awscli node libpq`. On a Mac:

- start the scripts with `bash …`, so the newer bash is used;
- Homebrew does not put libpq's `psql` on the PATH. In the terminal you will
  use for the restore, first run:
  ```sh
  export PATH="$(brew --prefix libpq)/bin:$PATH"
  ```
  You should see `psql --version` print `psql (PostgreSQL) …` with a version
  of 16 or newer. If it still says `command not found`, run `brew install
  libpq` again and repeat the export. This lasts for this terminal only,
  which is what you want during an incident.

**Keeping secrets out of your shell history.** Every secret below is typed
with `read -rs NAME; export NAME`: you paste the value after pressing Enter,
nothing is shown, and nothing is saved in `~/.zsh_history` or
`~/.bash_history`. (An alternative: put the `export` lines in a file only you
can read, made with `umask 077`, load it with `set -a; source <file>; set
+a`, and delete it at the end.) If you typed a secret on a command line by
mistake, say so in step 9.

1. **Declare the incident** (SEV-1, [Incident severity](#incident-severity)).
   Decide which copy to restore: the newest green **Backup** run from before
   the problem started (GitHub, **Actions**, **Backup**). In its **Back up
   production** summary, write down two things:
   - the archive name from the **Stored as** line:
     `qbbe-production-<YYYYMMDDTHHMMSSZ>.tar.gz.age`;
   - its **sha256** (64 characters).
2. **Create a new Supabase project** in the QBBE organization, same region as
   before. Save its database password in the password manager. If the Free
   plan's two-project limit stops you, pause staging first (staging's
   **Project Settings**, **General**, **Pause project**). Paused projects do
   not count. In the new project, **Storage**, **Settings**: set the upload
   file size limit to at least the **largest** file in the backup (the run
   summary's *Stored files* line says how large). A file over 2 GiB cannot
   be restored by the script; it is listed, and you upload it by hand in the
   dashboard (**Storage**, the bucket, **Upload file**). If the error in
   step 4 later names `supabase_functions`, turn on database webhooks in the
   new project (**Database**, **Webhooks**, **Enable**).
3. **Download that backup** (the bucket key is in the password manager entry
   **QBBE backup bucket key**):
   ```sh
   export BACKUP_S3_ENDPOINT='<from setup step 3>' BACKUP_S3_BUCKET=qbbe-hub-backups BACKUP_S3_REGION=ca-montreal-1
   read -rs BACKUP_S3_ACCESS_KEY_ID; export BACKUP_S3_ACCESS_KEY_ID
   read -rs BACKUP_S3_SECRET_ACCESS_KEY; export BACKUP_S3_SECRET_ACCESS_KEY
   bash scripts/backup/bucket.sh fetch production qbbe-production-<YYYYMMDDTHHMMSSZ> ~/qbbe-restore
   ```
   Name the run exactly as in point 1. `fetch` also accepts the run's time
   alone (`20261022T071812Z`), the full key from the summary, `latest`, or a
   date (`2026-10-22`, which takes that day's newest run and lists the
   others). `~/qbbe-restore` must not exist yet, or be empty; the files are
   saved readable by you only.

   You should see `Fetched …`, `Archive sha256: …` and a reminder to compare
   it. **It must be identical to the sha256 from point 1.** If it is not,
   stop: the file in the bucket is not the one the backup made (anyone
   holding the bucket key could have uploaded a replacement). Choose another
   night's run, fetch it into a new folder, and report the difference.

   If it ends with `blob(s) could not be fetched, or did not have their
   recorded size and sha256`, the archive was still downloaded and its
   sha256 printed; the missing ones are listed by content hash in
   `~/qbbe-restore/blobs-missing.txt`. See "If some files are missing"
   below before going on.
4. **Restore and check.**
   - Save your private key from the password manager as
     `~/qbbe-backup-key.txt` and run `chmod 600 ~/qbbe-backup-key.txt`.
   - The new project's address is on its **Connect** button, *Session
     pooler*. Copy the host (`aws-0-<region>.pooler.supabase.com` or
     similar) and the user (`postgres.<new ref>`). Do **not** paste the
     address with the password in it: the script refuses that.
   - The old project's ref is the repository variable
     `PRODUCTION_SUPABASE_PROJECT_REF` (GitHub, **Settings**, **Secrets and
     variables**, **Actions**, **Variables**); it still holds the old ref
     until step 6. Its pooler host is the same as the new project's when
     both are in the same region.

   ```sh
   export AGE_IDENTITY_FILE=~/qbbe-backup-key.txt
   export EXPECTED_SHA256='<the sha256 from point 1>'
   export TARGET_DB_URL='postgresql://postgres.<new ref>@<pooler host>:5432/postgres'
   read -rs PGPASSWORD; export PGPASSWORD
   export TARGET_SUPABASE_URL='https://<new ref>.supabase.co'
   read -rs TARGET_SERVICE_ROLE_KEY; export TARGET_SERVICE_ROLE_KEY
   # The old project: never written to, so it stays as evidence.
   export PROTECT_DB_URL='postgresql://postgres.<old ref>@<pooler host>:5432/postgres'
   export PROTECT_SUPABASE_URL='https://<old ref>.supabase.co'
   bash scripts/backup/restore-drill.sh ~/qbbe-restore/qbbe-production-<YYYYMMDDTHHMMSSZ>.tar.gz.age
   ```
   `PGPASSWORD` is the new project's database password (point 2);
   `TARGET_SERVICE_ROLE_KEY` is the new project's secret key (**Project
   Settings**, **API Keys**).

   You should see `Archive sha256 matches EXPECTED_SHA256.`, then steps 1
   to 6, and a report ending `RESULT: PASS`. Each check is one line
   (`PASS`, `PARTIAL`, `FAIL` or `SKIP`).

   If it fails:
   - **Before the database step** (sha256, decrypt, file check, the target
     check): nothing was written. Fix the cause the last lines name and run
     the same command again. `The archive's sha256 is …, not
     EXPECTED_SHA256` means a different file than the run you chose: fetch
     that run again by its name (point 3).
   - **In the database step** (`The database restore stopped; it was rolled
     back`): roles, schema, data and the migration history load in one
     transaction, so the new project is still empty. Fix the cause and run
     the same command again, with no `RESUME`.
   - **In step 4 (files) or step 5 (platform.sql)**: the database is already
     in. Fix the cause and run the same command again with `RESUME=files` or
     `RESUME=platform` in front, as the message says (for example
     `RESUME=files bash scripts/backup/restore-drill.sh …`). A plain re-run
     would refuse, because the project is no longer empty. `RESUME=platform`
     is refused while an interrupted file restore is unfinished; use
     `RESUME=files` then. If the file step was interrupted (Ctrl-C, or the
     terminal closed), the buckets' size limits and file types may still be
     lifted; `RESUME=files` puts the backup's own settings back, and step 6
     checks them.
   - **At step 6** (`RESULT: FAIL` with lines such as `load incomplete`,
     `bucket settings differ`, or `in the backup N, restored M`): **do not
     switch the app.** Keep the report. Run the same command once more with
     `RESUME=platform` in front to re-check (re-applying platform.sql is
     safe; this was tested in the first rehearsal, not since the latest
     script changes). If it fails again, create another new project and
     restore the previous green night. If that fails too, give the report
     lines to the developers.

   **If some files are missing or damaged.** A file whose blob is missing
   from the bucket, or does not decrypt, stops the restore at step 2 with
   `files are missing or do not match the manifest` (nothing is restored).
   In order:
   1. Try a run from the month before: `fetch production <a date last
      month> ~/qbbe-restore-2`, with that run's sha256 as `EXPECTED_SHA256`.
      Its blobs are separate copies. (`fetch` already tries last month's
      folder for each missing blob.)
   2. If you need this night's data, run the same command with
      `ALLOW_MISSING_FILES=1` in front. The SQL files must still match
      their sha256 (that is never relaxed). The files that cannot be given
      back are listed on your screen only (bucket and path); the database
      and every other file are restored. The report ends `RESULT: PARTIAL`
      (exit status 2), never PASS.
   3. Copy the listed files into the incident register (it is internal; do
      not paste them into a GitHub issue, which is public), and ask their
      owners for copies.

   **If the night you need has no index** (its run failed with `The
   archive … is stored as …, but not its index`): an Oracle administrator
   downloads the archive in the console (**Buckets**, `qbbe-hub-backups`,
   **Objects**, the archive's **⋮** menu, **Download**) into a new folder,
   then runs step 4 on it with `ALLOW_MISSING_FILES=1` and the sha256 from
   that run's summary. Its files come back only as far as their blobs are
   in that folder's `blobs/`; usually a neighbouring night is the better
   choice.

   Optional: `BACKUP_STORAGE_CONCURRENCY` sets how many files are uploaded at
   once (a whole number from 1 to 32; the default is 4).
5. **Put back what is not in the backup:**
   - Auth: **Authentication**, **URL Configuration** (site address and
     `/auth/callback`), email settings, Google provider
     ([google-sign-in.md](google-sign-in.md)), MFA settings, and asymmetric
     JWT signing keys ([deployment.md](deployment.md) step 9).
   - The job runner (Vault is not backed up), with a **new** secret so the
     old project's jobs can no longer call it: make one with `openssl rand
     -base64 48`, put it in production's `APP_ENV` as `CRON_JOB_SECRET`, and
     in the new project's SQL editor run
     `select app.configure_job_runner('https://<site>', '<the new secret>');`
     ([jobs.md](jobs.md)). You should see one row with an empty
     `configure_job_runner` value. If it says `job secret must be at least
     32 characters`, make the secret again and repeat. The Deploy in step 6
     checks this: its step **Background jobs reach this site** should print
     `Job runner: ready`.
6. **Point production at the new project.** In GitHub, environment
   **production**: `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, and in
   `APP_ENV` the `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   and `SUPABASE_SERVICE_ROLE_KEY`; environment **backup-production**:
   `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`,
   `SUPABASE_SERVICE_ROLE_KEY` (a new dedicated `backup` secret key of the
   new project); and the repository variable
   `PRODUCTION_SUPABASE_PROJECT_REF`. Then **Actions**, **Deploy**,
   environment `production`. Its migration step should say the database is
   up to date (the migration history was restored).

   The first nightly backup after this downloads every file from the new
   project once (restored files have a new version and date): expect the
   **Supabase traffic** warning that night.
7. **Stop the old project's background jobs.** The restored project runs the
   same 31 scheduled jobs. If the old project is still running, its jobs keep
   firing too, and digests, reminders, notifications and the Gmail, Google
   and Zeffy syncs would run twice. Once the app points at the new project:
   pause the old project (its **Project Settings**, **General**, **Pause
   project**). You should see it marked *Paused*. If it must stay running as
   evidence, instead run `select cron.unschedule(jobid) from cron.job;` in
   its SQL editor; you should see one row per job. The new `CRON_JOB_SECRET`
   from point 5 also makes any call it still sends fail.
8. **Tell people** they need to sign in again. Passwords still work. If an
   administrator's authenticator code is refused (see the MFA warning in
   [What is backed up](#what-is-backed-up-and-what-is-not)), follow **Lost
   administrator MFA factor** below for that person.
9. **Clean up the custodian's computer:**
   ```sh
   rm -rf ~/qbbe-restore ~/qbbe-backup-key.txt
   unset PGPASSWORD TARGET_SERVICE_ROLE_KEY BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY
   ```
   You should see no output. Then close the terminal. If any secret was
   typed on a command line instead of with `read -rs`, open
   `~/.zsh_history` (Mac) or `~/.bash_history` (Linux, WSL) in a text
   editor, delete those lines, and rotate that secret. Record the incident
   and the times in the incident register.

## Restore drill

A backup nobody has restored is a hope, not a backup. The drill restores a
real backup into a throwaway project and checks it.

**When:** before real data goes in (outstanding), then every three months,
after any change to `scripts/backup/` or a Supabase platform upgrade, and
after any change of custodian keys (run it with a key that was added in that
change).

**Hosted drill steps** (the owner's remaining action):

1. Create a scratch Supabase project named `qbbe-restore-drill` (pause
   staging first if the two-project limit stops you).
2. Run [Restore](#restore-a-real-incident) steps 1 to 4 against it, with
   `EXPECTED_SHA256` from the chosen run's summary, `PROTECT_DB_URL` set to
   **production's** database address (no password needed in it) and
   `PROTECT_SUPABASE_URL` to production's address. The script refuses to
   touch either. Expect Supabase traffic of about the total size of the
   files (the restore downloads each one again to check it).
3. Check by hand, with the app on your computer pointed at the scratch
   project (in `.env.local`: its `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; leave
   `EMAIL_PROVIDER_API_KEY` out so no email is sent):
   - **sign in as an administrator who uses MFA, with their password and a
     code from their authenticator app.** You should reach the Home
     dashboard. Write the result in the drill record: this is the check that
     proves MFA survives a restore. If the code is refused, the drill fails
     on that point: record it, and plan to re-enroll administrators after a
     real restore (Lost administrator MFA factor);
   - the Home dashboard, a channel's messages, a project's detail, a report,
     and open one uploaded document.

   Do not use *Forgot password* or invitations on the scratch project:
   Supabase would email real people.
4. Delete the scratch project (**Project Settings**, **General**, **Delete
   project**), resume staging if you paused it, and do Restore step 9 (delete
   the downloaded files and the key file).
5. Add a row to the drill record below with the times the script printed.

**Local rehearsal** (no hosted project needed, for checking changes to the
scripts): with the local Supabase stack running, an S3-compatible store to
stand in for the bucket, and throwaway key pairs (`age-keygen`, never a
custodian's). The local database password is the stack's default,
`postgres`.

```sh
# Settings for the commands below:
#   BACKUP_DB_URL=postgresql://postgres@127.0.0.1:54322/postgres
#   PGPASSWORD=postgres
#   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from: npx supabase status -o env
#   BACKUP_AGE_RECIPIENT=<the throwaway public keys>
#   BACKUP_INDEX_KEY=<output of: openssl rand -base64 48>
#   SUPABASE_BIN="npx supabase", the BACKUP_S3_* settings of the stand-in store,
#   BACKUP_GENERATION=YYYY-MM and BACKUP_STATE_DIR=/tmp/qbbe-state
scripts/backup/bucket.sh state local "$BACKUP_GENERATION" "$BACKUP_STATE_DIR"
scripts/backup/create-backup.sh /tmp/qbbe-backup local      # prints "Backup: … sha256 <sha>"
scripts/backup/bucket.sh push /tmp/qbbe-backup local
scripts/backup/bucket.sh fetch local latest /tmp/qbbe-fetched  # prints "Archive sha256: <sha>"
scripts/backup/local-scratch-db.sh create restore_drill
AGE_IDENTITY_FILE=<throwaway key file> \
EXPECTED_SHA256=<the sha256 printed above> \
TARGET_DB_URL=postgresql://postgres@127.0.0.1:54322/restore_drill \
PGPASSWORD=postgres \
PROTECT_DB_URL=postgresql://postgres@127.0.0.1:54322/postgres \
DRILL_LOCAL_CLUSTER=1 bash scripts/backup/restore-drill.sh /tmp/qbbe-fetched/qbbe-local-<time>.tar.gz.age
scripts/backup/local-scratch-db.sh drop restore_drill
```

The local restore goes into a second database on the same Postgres server.
That cannot hold the job schedule (`pg_cron` lives only in the server's own
database), and the stack's Storage serves only its own database, so the
drill's file step is run separately with `restore-storage.mjs --bucket
documents=<a temporary bucket>`. Do not use a bucket inside the local stack as
the stand-in store: the backup would then back up its own blobs.

### Drill record

| Date | Kind | Backup | Made in | Restored in | Result | What was checked, and what was not |
|---|---|---|---|---|---|---|
| 2026-10-22 | **Local rehearsal, not the hosted drill** | local stack (demo data: 270 tables, 54,529 rows, 43 sign-in accounts, 30 files of 75.1 MB), five nights in a row with `create-backup.sh` and `bucket.sh push` into a local S3-compatible store (moto 5.1.4, AWS CLI 2.27.50), encrypted with age 1.2.1 (the pinned release) to two throwaway keys | First night 31 s: bucket check 2.4 s; dump and checks 20 s; 30 files read and encrypted into 18 blobs (25.1 MB; identical files stored once) 1.2 s; archive 4.5 MB; upload and full read-back 5.9 s. Read from Supabase: 112.0 MB (dump files and files only; the catalog reads were not counted then). Next night with no changes: 0 files read (36.9 MB, the dump). Night with 3 new files: 3 read, 2 new blobs. First night of a new month: 0 read, 20 blobs carried inside the store (upload step 13.5 s) | About 16 s: fetch of archive and 20 blobs 7.1 s, scratch database 1.5 s, drill 7.1 s (decrypt and unpack 0.6 s, database 5.3 s, checks 0.5 s) | PASS | **Checked:** decrypted with the second custodian's key using age 1.1.1 (Ubuntu's); 6 SQL files and 33 files match their sha256; load complete in all 270 tables, and a fresh dump of the restored database is row-for-row identical to the backup's `data.sql` in all 270; 43 `auth.users`, 43 `auth.identities`, 2 `auth.mfa_factors`; 18 storage policies, 7 auth/storage triggers, 3 queues; every restored file row has its file. File restore into a temporary bucket limited to 1 KB and PDF only: 20 of 20 files (one of 25 MB, several not PDF) uploaded, downloaded again and matching, and the bucket's limits put back afterwards (1.4 s). Refusals: production as target; a second run into the now non-empty database (with the RESUME hint); `RESUME=files` after platform.sql; bash 3.2. `RESUME=platform` re-run passed. A changed file was caught. A file deleted mid-backup was recorded, not failed; a file whose bytes were missing failed the night (exit 3) with the database still stored. **Not checked:** the 31 scheduled jobs (pg_cron cannot run in a second local database); restoring files into a second Supabase project (none exists locally); MFA sign-in after a hosted restore; the hosted pooler connection, a hosted `roles.sql`, Oracle Object Storage, and GitHub Actions itself. |
| 2026-10-22 (second) | **Local rehearsal after the second round of review fixes, not the hosted drill** | local stack as it then was (271 tables, 17 sign-in accounts, 1 file), reached at a non-local address with the password in `PGPASSWORD` only (Supabase CLI 2.121.0, the pinned version); a moto S3 stand-in, AWS CLI 1.46; nights across three months and two key sets | Nights 1 and 2: first download, then nothing read again. Database reads, measured with a byte-counting proxy: 5.47 MB more than the files written (the basis of the catalog estimate). The CLI's three dumps took about 220 s at the non-local address (not investigated) | drill 6.9 s (decrypt 0.2 s, database 5.4 s, checks 0.6 s) | PASS; PARTIAL and FAIL where intended | **Checked:** new month: 1 blob carried and checked by size and sha256; a damaged carry source refused, its file downloaded again, with the warning; a key change: every file downloaded again, with the warning; a planted unsigned index: signature warning, every file downloaded again; fetch by archive name, then the drill: `RESULT: PASS`, including the migration history in the single transaction (same table definition, same 216 rows as before) and bucket settings. Refusals held: wrong `EXPECTED_SHA256`, missing `EXPECTED_SHA256`, a password in the address, a planted index for fetch, a non-empty fetch folder, another environment's name. `ALLOW_MISSING_FILES=1` with a damaged blob: `RESULT: PARTIAL`, exit 2; without it: FAIL with the hint. File restore into a temporary bucket: the backup's settings put back, settings left lifted by an earlier run repaired, Ctrl-C put back (exit 130), unreachable Storage reported in one line, a bad `BACKUP_STORAGE_CONCURRENCY` refused. **Not checked:** a `RESUME` run; `push` with failing blobs against a real store; everything hosted (as in the row above). |
| _pending_ | Hosted drill into a scratch Supabase project | | | | | required before real data; include the MFA sign-in result |

## Losing access scenarios

- **Bad deploy**: run the **Rollback** workflow with the previous release's
  commit; verify schema compatibility.
- **QBBE server lost** (Oracle reclaim, outage, deleted instance): rebuild it
  as hosting.md "Rebuilding the server" describes and deploy both
  environments again. The server holds no data, so nothing is restored.
- **Supabase project unavailable or damaged**: follow
  [Restore](#restore-a-real-incident) into a new project.
- **Backup custodian unavailable or key lost**: the other custodian's key
  opens every backup. Replace the lost one at once.

  > **Warning — before point 3:** changing the keys makes the next night of
  > each environment download every stored file from Supabase once (about
  > the total size of that environment's files), on top of the usual dump.
  > Check the month's egress first (monthly check in
  > [Keeping it running](#keeping-it-running)); if it is tight, change
  > production now and staging (run by hand) next month.

  1. The new custodian makes a key pair (setup step 2) and sends the public
     key.
  2. Write the new name in [provider-custody.md](provider-custody.md).
  3. In both `backup-staging` and `backup-production`, replace
     `BACKUP_AGE_RECIPIENT` with the two current public keys (the remaining
     custodian's and the new one's).
  4. **Actions**, **Backup**, **Run workflow**, `production` (and
     `staging`). You should see the warning `The custodians' keys
     (BACKUP_AGE_RECIPIENT) changed since the previous backup` and a green
     run; the blobs go into a new folder `blobs/<environment>/<YYYY-MM>-<new
     tag>/`.
  5. Both custodians do setup step 9 against that run. You should see every
     blob open.
  6. If the custodian left (rather than lost the key), rotate the bucket key
     ([Keeping it running](#keeping-it-running)).

  What changes and what does not: backups made after point 4 open with the
  new keys. Archives made before it still open only with the keys of that
  time, until they are deleted 35 days later, so keep the remaining old key
  until then. A departed custodian's key can open the blobs made before the
  change until their folders are deleted, 70 days after they were stored;
  the bucket key rotation in point 6 is what keeps them from reaching those
  blobs.
- **Admin lockout**: a second Workspace Admin or the Primary Owner restores
  access; follow the documented provider recovery process. Use two named
  administrators where the free plan supports them, otherwise designate a
  separate recovery custodian (ENV-002).
- **Lost administrator MFA factor**: verify the person's identity out of band
  and require approval from a second named administrator or the recovery
  custodian. From a server-only recovery tool or the Supabase dashboard, use
  the Auth admin factor-deletion operation for the exact user and factor; never
  expose or copy the service-role key into a browser. Removing a verified factor
  invalidates the user's Auth sessions. Have the person sign in again, enroll a
  replacement, add a separately stored backup factor, and confirm privileged
  access. Preserve the provider `factor_unenrolled` log, the approval and the
  application's new enrollment/challenge audit events in the incident record.
  Never remove a factor without the identity check, second approval and evidence.

## Incident severity

Use the SEV-1..4 ladder from the master spec (§14.3). SEV-1 (data exposure,
sign-in outage, corruption) requires immediate leadership notification and
an entry in the incident register.

## Files

| File | What it does |
|---|---|
| `.github/workflows/backup.yml` | the nightly run (staging only with `BACKUP_STAGING_NIGHTLY=on`), upload, outside check-in and failure issue |
| `scripts/backup/check-backup-environment.sh` | refuses missing settings, the wrong project, another project's key, a private key among the public ones, and a short index key |
| `scripts/backup/create-backup.sh` | dumps, checks the dump, copies changed files, writes the manifest, encrypts, prints the traffic line |
| `scripts/backup/migration-history.sql` | writes the migration history files with one `psql` query |
| `scripts/backup/platform-extras.sql` | writes `platform.sql` (what the standard dump leaves out) |
| `scripts/backup/export-storage.mjs` | downloads new or changed files, encrypting each into a blob |
| `scripts/backup/bucket.sh` | the bucket: what is there and the monthly copy (`state`), upload with full read-back (`push`), download of one run for a restore (`fetch`) |
| `scripts/backup/restore-drill.sh` | checks the archive against `EXPECTED_SHA256`, decrypts, restores, checks, reports; `RESUME` to finish a stopped run; `ALLOW_MISSING_FILES=1` for a partial restore |
| `scripts/backup/restore-storage.mjs` | uploads files to the target (lifting bucket limits meanwhile and always putting the backup's settings back) and downloads them again to compare |
| `scripts/backup/manifest.mjs`, `lib.mjs`, `storage-api.mjs` | the manifest, the signed index, the checks, the guard, the Storage calls |
| `scripts/backup/local-scratch-db.sh` | local rehearsal only: an empty database shaped like a new project |
