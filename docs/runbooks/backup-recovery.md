# Backup & recovery runbook

## Where things stand (2026-10-22)

- **Built and rehearsed locally:** a nightly GitHub Actions workflow
  (`.github/workflows/backup.yml`, named **Backup**) that copies each
  environment's database and every uploaded file, encrypts the copy, and
  stores it in a bucket outside Supabase. After the first night it downloads
  only files that are new or changed, to stay inside Supabase's free traffic
  allowance. A restore script puts a copy back into an empty project and
  checks that nothing is missing. Both were run end to end against the local
  Supabase stack on 2026-10-22, three times: first, then after each of two
  rounds of review fixes (the [drill record](#drill-record)).
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
  under the sha256 of its contents (`<sha256>.age`), so each file is stored
  once however many nights refer to it. When that name is already taken by
  an object the backup cannot vouch for, the blob is stored as
  `<sha256>.2.age` (then `.3`, …) instead, and the index and the manifest
  record which name it has (see
  [Objects the backup did not make](#objects-the-backup-did-not-make)).
- **Key tag**: 16 characters worked out from the custodians' public keys
  (the first 16 hex characters of the sha256 of the sorted list of keys). It
  is part of each blob folder's name, so blobs encrypted to different keys
  never mix.
- **Index**: a small unencrypted file stored next to each archive. It lists
  the blobs the archive needs and lets the next night tell which files have
  not changed. It names no file.
- **Index key** (`BACKUP_INDEX_KEY`): a random secret that GitHub uses to
  *sign* each index (an HMAC-SHA256, a checksum that only someone holding
  the key can make). A night only trusts an index whose signature is right.
  It is made with `openssl rand -base64 32` (one line of 44 characters);
  the scripts refuse a shorter key, or one that repeats a few byte values
  (all zeros, a pattern typed by hand).
- **Egress**: data leaving Supabase. The free plan allows 5 GB a month for all
  of an organization's projects together.
- **`PGPASSWORD`**: the environment variable that `psql`, `pg_dump` and the
  Supabase CLI read a database password from. Every database address in this
  runbook and in the scripts is written **without** a password, and the
  password goes in `PGPASSWORD`. The scripts refuse an address that contains
  one (as `user:password@`, as `?password=`, or as `password=` in the
  `host=… user=…` form), so the password never shows in a process list or
  in a log.
- **TLS**: the encryption that `https` uses, here for database connections.
  For every database that is not on the same computer, the scripts set
  `PGSSLMODE=require` (the setting `psql` reads) unless the address already
  says `sslmode=require` or `sslmode=verify-full`, and they refuse
  `disable`, `allow` and `prefer` (if `sslmode` appears more than once in
  the address, every value must be `require` or `verify-full`). So every `psql` connection
  (the row counts, the migration history, the platform extras, and all of
  the restore drill) **requires** TLS: it fails rather than run without
  it. The three database dumps of the nightly run are made by the Supabase
  CLI (`supabase db dump`), which does not obey that setting: it uses TLS
  whenever the server offers it, and Supabase's hosted database always
  does, but it does not refuse a connection that has been downgraded to
  plain text. Only the computer's own addresses (`127.0.0.1`, `localhost`,
  `::1`, or a `host=` parameter naming one of them or a Unix socket
  folder: the local Supabase stack, which has no TLS) are exempt; a `host=`
  parameter naming any other computer counts as not local.
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
| Background job schedule (31 `pg_cron` jobs) and queue definitions (3 `pgmq` queues) | Yes | `platform.sql`. Every job comes back **paused**, so nothing runs in a restored project until [Restore](#restore-a-real-incident) step 5 starts them; its last line, `-- start-schedule: …`, is the statement that starts the jobs that were running in the backup. |
| Messages waiting in the queues at backup time (unsent notification emails) | **No** | Short-lived; at most one night's pending emails are lost. |
| Migration history (`supabase_migrations`) | Yes | `history_schema.sql`, `history_data.sql` (one `psql` query, `scripts/backup/migration-history.sql`), restored in the same transaction as the data, so `supabase db push` on a restored project says "up to date". Tables, keys and indexes are each created only if the new project lacks them, so a project that already has this table does not stop the restore. |
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
  - `blobs/<environment>/<YYYY-MM>-<key tag>/<sha256>.age` (or
    `<sha256>.<n>.age`, see *Terms* at the top): one
    encrypted blob per uploaded file, in a folder per month and per set of
    custodian keys.
- **Only changes are downloaded.** Each night compares every file's version
  with the newest index whose signature is right. A file that has not
  changed, and whose blob is in this month's folder under the name and at
  the encrypted size that index recorded, is not downloaded again. Any other
  object in the folder is never relied on, whatever its name.
- **The first night of a month** copies the blobs still in use from last
  month's folder to the new one, inside the bucket, without touching
  Supabase. Each copy goes through a private temporary file and is checked
  against the encrypted size and sha256 recorded when the blob was first
  stored; a blob that fails that check is not copied, and its file is
  downloaded again from Supabase instead. If an object is already at a
  blob's name in the new folder (left by a first night that failed after
  copying, or put there by someone else), it is downloaded and kept only if
  it holds exactly the recorded bytes; otherwise the blob is copied under
  the next free name (`<sha256>.2.age`). So a first night that fails after
  copying costs nothing extra: the next night checks those copies in place.
  That way the lifecycle rule can delete a whole old month folder (and with
  it files that were deleted from the app) without breaking any archive
  that is still kept.
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
  - the night uses the newest index of the last 40 days whose signature is
    right and that records the run its name gives (its archive name and
    time). Indexes dated more than an hour ahead are ignored, and newer ones
    that fail the signature or format check, or a real older index copied to
    a newer name, are skipped, with one warning giving their number. A
    planted, copied or old-key index therefore never makes a night download
    every file, or use an old run's record, while a good index exists;
  - the `psql` connections to the database must use TLS; the Supabase
    CLI's dumps use TLS because Supabase's hosted database offers it, but
    the CLI does not refuse a downgrade (see *Terms* at the top);
  - the SQL files are checked against the manifest before encrypting;
  - every blob the archive needs must be in the bucket, under the name its
    index records, at the encrypted size recorded when it was stored;
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
- **When it fails:** a separate job, **Report a failed backup or high
  traffic**, opens a GitHub issue titled **Backup failed: staging** (or
  **production**), or comments on the one already open, with a link to the
  run. It is assigned to the GitHub user in the repository variable
  `BACKUP_ALERT_ASSIGNEE`, which sends that person an email. The outside
  monitor also emails both custodians straight away, also when the run was
  cancelled or stopped by its 90-minute time limit.
- **When traffic runs high:** the same job adds up the environments backed
  up in that run. If together they are on course to read more than 2 GB a
  month from Supabase, it opens (or comments on) one issue, **Backup traffic
  high**, assigned the same way. See [Supabase traffic](#supabase-traffic-egress).
- **When it stops running at all:** the outside monitor
  (`BACKUP_HEALTHCHECK_URL`, setup step 6) expects a check-in every day from
  production. If none arrives within 26 hours, it emails both custodians.
  This is the only alarm for a schedule that silently stopped, which GitHub
  does in a public repository after 60 days without activity (see
  [Keeping it running](#keeping-it-running)).
- **A record outside GitHub:** each successful check-in carries a short
  text naming the archive, its sha256, its size and when it was made:
  `Backup of production: production/<YYYY-MM-DD>/qbbe-production-<time>.tar.gz.age,
  sha256 <64 characters>, <size> bytes, made <YYYY-MM-DDTHH:MM:SSZ>. Run:
  <link to the run>`. healthchecks.io keeps it in the check's log, so the
  sha256 a restore needs can still be found if GitHub is unavailable
  ([Restore](#restore-a-real-incident) step 1).
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
  have, or any file name. The run logs and summaries on GitHub (public, as
  the repository is) show counts only, never a blob's name or a file's
  sha256.
- **What someone holding the bucket key could do:** read the encrypted
  objects, and add new ones (the key cannot delete or overwrite). Three
  kinds of planted object matter. None of them can change what a restore
  puts back, and none makes a night read every file from Supabase again:
  - *A planted archive.* A restore refuses to decrypt any archive whose
    sha256 differs from the one in the green Backup run's summary
    (`EXPECTED_SHA256`, [Restore](#restore-a-real-incident) step 4).
  - *A planted index.* An index tells later nights which stored copy belongs
    to which unchanged file, so a forged one would make every later backup
    record some files with another file's contents, until each affected
    file changes. The index is signed with `BACKUP_INDEX_KEY`, which is only
    in GitHub, so a forged index fails the signature check. Each night uses
    the newest index whose signature is right and skips the others with a
    warning. `fetch` cannot check signatures (custodians do not hold the
    index key), so for a restore it lists the runs it considered, each with
    its archive's sha256, and `EXPECTED_SHA256` decides.
  - *A planted blob* (an object named like a blob, filled with something
    else). A night relies only on blobs a signed index recorded with their
    encrypted size and sha256, under the recorded name. A planted object at
    a name the backup needs is never trusted: the blob is stored under
    another name (`<sha256>.2.age`) instead, with a warning. (In the monthly
    copy, an object of the right size is first compared byte for byte, and
    kept if it is in fact the right blob.) At restore, each decrypted file
    must have its own sha256, so a planted copy is never put back.
  - Both environments use the same bucket key. This was accepted because
    both backup environments have the same protection (the `main` rule), so
    separate keys would add little, while the protections above do not
    depend on the bucket key. Give each environment its **own**
    `BACKUP_INDEX_KEY`, so a leak of staging's settings cannot sign a
    production index. Keep the bucket key as closely as the backups
    themselves, and rotate it, and the index keys, when in doubt.

  What the warnings look like and what to do:
  [Objects the backup did not make](#objects-the-backup-did-not-make). As
  a last line, the restore checks every restored file against the size and
  MD5 that the database itself recorded.
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
The run stays green, and GitHub sends no email for a warning. So the job
**Report a failed backup or high traffic** also adds up the environments
backed up in that run: when together they are over 2 GB a month, it opens
an issue **Backup traffic high** (or comments on the one already open),
assigned to `BACKUP_ALERT_ASSIGNEE`, which emails that person. The issue
lists each environment's figure and links to the run. While staging's
nightly run is off, the nightly total is production's alone; the
[monthly egress check](#keeping-it-running) covers everything else.

When the warning or the issue appears:

1. Open the run and look at the **Read from Supabase by this run** line of
   each environment.
2. If the night is one of the [nights that read every file
   again](#nights-that-read-every-file-again) below, nothing needs doing:
   the next ordinary night's figure drops back. Close the issue after that
   night (it is not closed by itself).
3. Otherwise do the [monthly egress check](#keeping-it-running) now.
   You should see the projection under 4 GB; if not, follow what that check
   says.

(The summary counts 1 GB as 1,073,741,824 bytes, so its "2 GB" is
2,147,483,648 bytes.)

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

#### Nights that read every file again

Each of these reads all of an environment's stored files from Supabase
once, on top of the dump, and usually opens the **Backup traffic high**
issue. Plan for them. This is the complete list:

- the very first night;
- the night after `BACKUP_AGE_RECIPIENT` changes (new key tag), with the
  warning `The custodians' keys (BACKUP_AGE_RECIPIENT) changed since the
  previous backup: tonight N file(s) are downloaded again`;
- the night after `BACKUP_INDEX_KEY` changes or is lost (once: that night's
  index is signed with the new key and records every blob in full, so the
  following nights, including the next first of the month, read only
  changes). It comes with the warning `N backup index(es) failed their
  signature or format check … were ignored`, and, in the middle of a
  month, `N new blob(s) stored under another name`;
- the first run with no good index from the last 40 days. Because the
  lifecycle rule deletes indexes after 35 days, that means **more than 35
  days without a successful backup** of that environment (the log says
  `previous index: none trusted (every file will be downloaded)`). This
  includes turning the schedule back on late after
  [GitHub's 60-day rule](#keeping-it-running), and a manual staging run more
  than 35 days after the last one;
- the first night after a real restore into a new project: restored files
  get a new version and date, so every file looks changed once;
- the hosted [restore drill](#restore-drill): not a night, but the restore
  downloads every restored file again from the scratch project (in the same
  organization) to check it, so it costs about the total size of the files.

These **no longer** cause a full read: a first night of a month that fails
after copying blobs (the next night checks those copies in place), and
indexes or blobs planted by someone holding the bucket key (they are
skipped, or the blob is stored under another name).

Smaller extra reads: a run of failed nights downloads again every file
changed since the last good night, and a damaged blob (warning `no longer
have the encrypted size recorded`) has its files downloaded again.

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

Each successful backup's check-in carries the archive's name and sha256 in
its body, and the check's log keeps it. That log is the second place,
besides GitHub, where a custodian finds the sha256 a restore needs, so both
custodians must be able to sign in to this account during an incident
(record how in [provider-custody.md](provider-custody.md)). Setup step 8
checks that the body arrives.

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
   openssl rand -base64 32
   ```
   You should see one line of 44 characters ending in `=`. It goes in the
   table below as `BACKUP_INDEX_KEY`. Do not keep a copy anywhere else: if
   it is ever lost or replaced, the only cost is that the next night
   downloads every file once (see
   [Nights that read every file again](#nights-that-read-every-file-again)).
   Make a **different** one for `backup-production` in point 6. Do not type
   a key by hand: a key that repeats a few characters is refused (`does
   not look random`).
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
   index key from `openssl rand -base64 32`. The bucket values and public
   keys are the same.
7. Repository **Settings**, **Secrets and variables**, **Actions**,
   **Variables**: check that `STAGING_SUPABASE_PROJECT_REF` and
   `PRODUCTION_SUPABASE_PROJECT_REF` exist (the Deploy workflow set them up),
   and add **`BACKUP_ALERT_ASSIGNEE`** = the GitHub user name of the person
   who should get the **Backup failed** and **Backup traffic high** issues
   (a person, not an organization). You should see all three in the list.

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
   turn green, then a third, **Report a failed backup or high traffic**,
   also green. The first run downloads every file, so it takes longest (the
   local rehearsal took 31 seconds for demo data; the hosted connection and
   setup add a few minutes). Each run's summary shows where the archive is
   stored (`Stored as s3://qbbe-hub-backups/production/<date>/qbbe-production-<time>.tar.gz.age`),
   its size and sha256, the blob folder (`Files are in blobs/production/<YYYY-MM>-<key tag>/`),
   and a table of what was backed up, including **Read from Supabase by
   this run**. A **Supabase traffic** warning, and an issue **Backup traffic
   high**, on this first run are expected (it reads every file); leave the
   issue open until point 5.
3. In Oracle, open the bucket: you should see folders `staging/`,
   `production/` and `blobs/`, with today's date under the first two.
4. In healthchecks.io, both checks should now say **up**. Open the
   production check and click the newest **OK** entry in its log. You
   should see a body like `Backup of production:
   production/<date>/qbbe-production-<time>.tar.gz.age, sha256 <64
   characters>, <size> bytes, made <time>. Run: https://github.com/…`, with
   the same sha256 as the run's summary. If the entry has no body, tell the
   developers: the restore's second source for the sha256 is missing.
5. The next morning, open production's nightly run and do the traffic check
   in [Supabase traffic](#supabase-traffic-egress). If that ordinary night
   added no comment to the **Backup traffic high** issue, close it.

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
   You should see:
   - `Runs of staging considered for latest, newest first: N.`, then up to
     10 lines, one per run: its time (`20261022T071812Z`) and `archive
     sha256 <64 characters>` (or `not a valid backup index`);
   - `Fetching <time>.`, `Fetched … blob(s) …`, and `Archive sha256: …`.

   Compare that last sha256 with the one in the summary of the newest green
   Backup run of staging (GitHub, **Actions**, **Backup**, the run, **Back
   up staging**'s summary). They must be identical. If they differ, look
   for the run's time in the list above: fetch that run by its time into a
   new folder (`bash scripts/backup/bucket.sh fetch staging <time>
   ~/qbbe-backup-check-2`) and compare again; if no run in the list has the
   summary's sha256, stop and tell the owner (someone may have planted an
   archive).
4. Open the archive and every blob with your key:
   ```sh
   mkdir ~/qbbe-backup-check/work
   age -d -i ~/qbbe-backup-key.txt ~/qbbe-backup-check/qbbe-staging-*.tar.gz.age | tar -xzf - -C ~/qbbe-backup-check/work
   AGE_IDENTITY_FILE=~/qbbe-backup-key.txt node scripts/backup/manifest.mjs unpack-blobs ~/qbbe-backup-check/work ~/qbbe-backup-check/blobs
   node scripts/backup/manifest.mjs check-files ~/qbbe-backup-check/work
   ```
   You should see `Files: N of N unpacked from … blob(s); 0 blob(s) missing
   from …, 0 could not be decrypted to the file's sha256.`, then an `ok`
   line for each of the six `db/` files and a line `ok    files: N checked
   against their sha256 and the database's size and MD5, 0 missing, 0
   changed, …`. Empty (0-byte) files count like any other.

   Any count other than 0 there, or a `FAIL` line, means the check failed.

   > **Warning — before you send the output to anyone:** when the check
   > fails, the lines under `FAIL  files: …` (`missing: …`, `changed: …`)
   > name files by bucket and path, and paths can hold people's names. Send
   > only the summary lines (the `Files:` line and the `ok`/`FAIL` lines
   > that start at the left margin) to the other custodian and the owner,
   > never the indented lines under them, and never in a GitHub issue
   > (issues are public).

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
     see one green run per day, and, under the repository's **Issues** tab,
     no open **Backup failed** or **Backup traffic high** issue.
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
  environments' secrets leaves, or if a leak is suspected):
  1. On your own computer, run `openssl rand -base64 32`. You should see one
     line of 44 characters.
  2. GitHub, **Settings**, **Environments**, the environment
     (`backup-staging` or `backup-production`), `BACKUP_INDEX_KEY`'s pencil
     icon: paste the new line, **Update secret**.
  3. The next run of that environment is expected to show the warning `N
     backup index(es) failed their signature or format check … were
     ignored`, and, if it is not the first of a month, `N new blob(s)
     stored under another name`. It downloads every file once (expect the
     **Backup traffic high** issue that night). You should see it green;
     the night after reads only changes again, with no such warning.

  Restores never need this key.

## When a backup fails

The issue **Backup failed: <environment>** links to the run (the outside
monitor's email says only that a check-in failed or is late). Open the run,
and read the first red `Error:` line. Remember: 35 days after the last good
backup, there is none left.

| The error says | What it means | What to do |
|---|---|---|
| `Missing <NAME>` | a setting is not in GitHub | add it where the message says, run **Backup** again |
| `BACKUP_INDEX_KEY holds N bytes`, `BACKUP_INDEX_KEY is neither hex nor base64` or `BACKUP_INDEX_KEY does not look random` | the index key is too short, mistyped, or typed by hand | make a new one with `openssl rand -base64 32` and replace the secret ([Rotating an index key](#keeping-it-running)), run again (that night downloads every file once) |
| `Refusing: …registered project` or `…belongs to another Supabase project` | the environment points at the wrong Supabase project, or holds another project's key | fix `SUPABASE_PROJECT_REF` or `SUPABASE_SERVICE_ROLE_KEY` on that backup environment |
| `Could not connect to the … database through its pooler` | wrong `SUPABASE_DB_PASSWORD`, or the Supabase project is paused (Free projects pause after a quiet week) | resume the project in the Supabase dashboard (**Resume project**) or fix the password, run again |
| `asks for sslmode=…` or `PGSSLMODE is …; a database that is not on this computer is reached over TLS only` | someone set a weaker TLS setting (`disable`, `allow` or `prefer`) for the database connection | remove that setting (the workflow itself asks for `sslmode=require`); run again |
| `A migration was applied while the database was being dumped, twice in a row` | a deploy ran during the backup | run **Backup** again once the deploy has finished |
| `table(s) hold rows but are not in the dump` | Supabase's dump left out a table that has data; the rest of the backup was stored | tell the developers: the backup is incomplete until `scripts/backup` handles that table |
| `Some uploaded files could not be copied` | the database copy was stored; one or more files were not | the step's log says why for each, without the file's name. `Storage has no bytes for a file the database still lists`: the file is lost at the source; look at Supabase Storage. `…do not match the database's size or MD5 for this version`: the file is damaged at the source or was cut short; run again, and if it repeats, look at Supabase Storage. `HTTP 400 (Bucket not found; check the service-role key…)`: the key is not this project's. `…neither copied nor recorded (a fault in the export)` or `The file export stopped`: run again; if it repeats, tell the developers |
| `Upload to the backup bucket failed`, `Uploading new blobs to … failed` or `Cannot list the backup bucket` | wrong endpoint, bucket or key, or the key lacks permission | check steps 5 and 7. If it happens once after green nights, run again: an object added at a blob's name meanwhile is avoided the next night (another name is used) |
| `N blob(s) this backup needs are not in blobs/…` | blobs that should be in this month's folder are not there. Their names are written to a file on the runner only (`blob-check.txt`), never to the public log, and the runner is discarded after the job | run again (they are uploaded again). If it repeats, check the lifecycle rule on `blobs/` is 70 days, not 35 (step 4) |
| `N blob(s) in blobs/… do not have the encrypted size recorded when they were stored (damaged copies). The next run stores those files again under another name; nothing needs deleting.` | a stored blob is damaged. The next run notices, downloads those files again from Supabase and stores them as `<sha256>.2.age` | run **Backup** again (**Actions**, **Backup**, **Run workflow**). You should see it green, with the warning `no longer have the encrypted size recorded`. If the same night fails this way twice in a row, tell the developers |
| `The archive (database and manifest) is stored as …, but not its index` | the blobs failed (see the lines above it), but the database was still stored | fix the blob problem and run again. To restore that one night later (rarely needed), see [Restore](#restore-a-real-incident), "If the night you need has no index" |
| `does not match the local file` | the stored copy differs from what was uploaded | run again; if it repeats, contact the bucket provider |
| no failed run, but the monitor says the check-in is late | the schedule did not run | see [GitHub's 60-day rule](#keeping-it-running); also check GitHub's status page |

**Yellow warnings** do not fail the run, but read them:

| The warning says | What it means | What to do |
|---|---|---|
| `The custodians' keys (BACKUP_AGE_RECIPIENT) changed since the previous backup` | expected the first night after a key change; it gives how many files are read again | nothing, if you changed the keys; if nobody did, check who edited the secret |
| `N backup index(es) … failed their signature or format check … were ignored`, or `N dated more than an hour ahead were ignored` | expected the first night after an index key change (then the count is about the number of nights kept). Otherwise someone holding the bucket key added index files | if nobody changed `BACKUP_INDEX_KEY`: see [Objects the backup did not make](#objects-the-backup-did-not-make) |
| `N blob name(s) in blobs/… hold an object that does not match the record of the blob it is named after` | during the monthly copy, an object was already at a blob's name and was not the right bytes; the blob was copied under another name | nothing is lost; see [Objects the backup did not make](#objects-the-backup-did-not-make) |
| `N new blob(s) stored under another name (<sha256>.<n>.age)` | a new file's blob could not use its usual name, because an object no signed index vouches for is there | expected once after an index key change in the middle of a month; otherwise see [Objects the backup did not make](#objects-the-backup-did-not-make) |
| `N blob(s) in blobs/… no longer have the encrypted size recorded when they were stored (damaged copies)` | a stored blob changed size; its files were downloaded again from Supabase and stored under another name | nothing urgent; if it recurs, tell the developers |
| `blob(s) in blobs/… do not have the size or sha256 recorded when they were stored, so they were not copied` | last month's copies of those blobs are damaged; the files were downloaded again from Supabase instead | nothing urgent; if it recurs, tell the developers |
| `blob(s) could not be copied from blobs/… (a download or upload failed)` | a temporary bucket error during the monthly copy; the files were downloaded again instead | nothing, unless it recurs |
| `blob(s) the previous backup stored in … are no longer there` | something deleted objects from the bucket | check the lifecycle rules (step 4) and who has delete rights in Oracle |
| `Supabase traffic` | at this night's rate, this environment alone would read over 2 GB a month | on one of the [nights that read every file again](#nights-that-read-every-file-again), nothing; otherwise do the monthly egress check now |
| `The outside monitor did not answer` | the backup is stored, but the check-in did not reach healthchecks.io | nothing if it is once (the monitor may email that the check-in is late); if it repeats, check `BACKUP_HEALTHCHECK_URL` (setup step 6) |

**The issue Backup traffic high** is not a failure: see
[Supabase traffic](#supabase-traffic-egress) for what to do, and close it
yourself once an ordinary night stays under 2 GB.

Close the **Backup failed** issue once a run is green. Until then, the
newest copy is older than 24 hours.

## Objects the backup did not make

The bucket key (in GitHub, and with both custodians for restores) can add
objects to the bucket but cannot replace or delete them. So objects can
appear that no Backup run made: left halfway by a run that failed, or added
by someone holding the key. The scripts are built so that none of them can
change what a restore puts back, and none makes a night read every file
from Supabase again. Three yellow warnings report them. The public log
gives only their number, never their names.

| The warning says | What happened | Is anything lost? |
|---|---|---|
| `N backup index(es) … failed their signature or format check … were ignored` | index files the night could not trust: signed with another `BACKUP_INDEX_KEY` (expected once, after you change it), malformed, naming another environment, or a real older index copied to a newer run's name (its recorded archive name and time are not the ones its name gives). The night used the newest index whose signature is right | No |
| `N dated more than an hour ahead were ignored` (same warning) | index files whose name claims a time in the future, so that they would sort as the newest | No. `fetch latest` ignores them too |
| `N blob name(s) in blobs/… hold an object that does not match the record of the blob it is named after` | on the first night of a month, an object of the blob's size was already at its name in the new folder and did not hold the recorded bytes. (An object of another size there is passed over without a warning: it cannot be the blob.) | No. The blob was copied under the next free name (`<sha256>.2.age`), and the index records that name |
| `N new blob(s) stored under another name (<sha256>.<n>.age)` | a new file's blob could not use its usual name, because an object that no signed index vouches for is there | No. Same as above |

What to do when one appears:

1. **Decide whether it is expected.**
   - The first run after you changed `BACKUP_INDEX_KEY`: the index warning
     (its count is about the number of runs kept) and, in the middle of a
     month, the new-name warning. Nothing to do.
   - The first run after a red run: a blob-name or new-name warning about
     what that run left behind. Nothing to do.
   - Anything else, or the same warning again the next night: someone
     holding the bucket key may have added objects. Go on to point 2.
2. **Treat the bucket key as leaked.** Rotate it as
   [Keeping it running](#keeping-it-running), "Rotating the bucket key",
   says. You should see the run in its point 3 green. Tell the developers
   and the owner. If an index warning recurs after the rotation, someone can
   still write with a current key: check who can write to `main` and read
   the backup environments (the warning before [setup step 7](#7-put-the-settings-into-github)).
   You do not need to change `BACKUP_INDEX_KEY`: a planted index failed
   its signature check, which shows the planter does not have that key.
3. **Optional clean-up of planted index files** (an Oracle administrator:
   the backup key cannot delete). Nothing needs deleting: the lifecycle
   rules remove index files 35 days after they were added. Deleting a
   planted one sooner stops its warning, which an index dated in the
   future repeats every night, and keeps `fetch`'s list of runs clean.

   > **Warning:** never delete an index or archive that a Backup run made:
   > it is what a restore of that night needs. Never delete anything under
   > `blobs/`: telling a planted object from a needed blob takes the
   > signed index, and the 70-day rule removes them anyway.

   1. GitHub, **Actions**, **Backup**: for the environment in the warning,
      note the time on each recent run's **Stored as** line
      (`qbbe-production-<YYYYMMDDTHHMMSSZ>`).
   2. Oracle console, **Storage**, **Buckets**, `qbbe-hub-backups`,
      **Objects**, open `production/` (or `staging/`). You should see one
      folder per day, each holding a `.tar.gz.age` and a `.index.json` per
      Backup run with the times from point 1.
   3. A date folder later than today, or an `.index.json` whose time
      matches no Backup run, was not made by Backup. For each: its **⋮**
      menu, **Delete**, **Delete** again to confirm. The warning's count
      says how many to expect.

   You should see the next run without the warning. (In a rehearsal on a
   developer's computer, the state folder's `ignored-indexes.txt` lists the
   ignored index files by name; on GitHub that folder is discarded with the
   runner.)

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
mistake, say so in step 10.

1. **Declare the incident** (SEV-1, [Incident severity](#incident-severity)).
   Decide which copy to restore: the newest green **Backup** run from before
   the problem started (GitHub, **Actions**, **Backup**). In its **Back up
   production** summary, write down two things:
   - the archive name from the **Stored as** line:
     `qbbe-production-<YYYYMMDDTHHMMSSZ>.tar.gz.age`;
   - its **sha256** (64 characters).

   **If GitHub is unavailable** (the repository or its run history is gone,
   or the account is locked): take both from the outside monitor instead.
   Sign in to healthchecks.io (the account in
   [provider-custody.md](provider-custody.md), row **Backup check-in
   monitor**), open the check **QBBE backup production**, and click the
   **OK** entry of the night you chose in its log. Its body reads `Backup of
   production: production/<date>/qbbe-production-<time>.tar.gz.age, sha256
   <64 characters>, <size> bytes, made <time>. Run: …`. Use the entry that
   arrived at that night's run time (about 07:20 UTC). Anyone holding the
   ping address can add entries, so if two entries name the same archive
   with different sha256s, use neither: stop and report it. `fetch` (point
   3) also lists each run's sha256 as the bucket's index records it, but
   that list is not signed: it helps you choose a run, it is not a check.
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
   alone (`20261022T071812Z`) or the full key from the summary.
   `~/qbbe-restore` must not exist yet, or be empty; the files are saved
   readable by you only.

   `latest` or a date (`2026-10-22`) also work, for when you do not know
   the run: `fetch` then prints `Runs of production considered for …,
   newest first: N.` and up to 10 lines, each a run's time and its
   `archive sha256` (or `not a valid backup index`), and fetches the newest
   valid one whose archive is in the bucket (a run with a valid index but
   no archive is skipped with `Skipping <time>: its index is valid, but its
   archive … is not in the bucket.`). Runs dated more than an hour ahead are ignored (`N dated
   more than an hour ahead were ignored`): someone holding the bucket key
   could add a run named in the future so that it sorts as the newest. If
   the fetched archive's sha256 is not the one from point 1, pick the run
   with that sha256 from the list and fetch it by its time into a new
   folder.

   You should see `Fetching <time>.`, `Fetched … and N blob(s) into
   ~/qbbe-restore/blobs, each with its recorded size and sha256`,
   `Archive sha256: …` and a reminder to compare it. **It must be identical
   to the sha256 from point 1.** If it is not, stop: the file in the bucket
   is not the one the backup made (anyone holding the bucket key could have
   uploaded a replacement). Choose another night's run, fetch it into a new
   folder, and report the difference.

   Each blob is taken from the name its index records; if that copy is
   missing or damaged, from an identical copy in any other month folder of
   the same custodian keys (the line then says `(N from an identical copy
   in another month folder of the same keys)`). If a line says `N blob(s)
   have no recorded encrypted sha256 that any copy matched`, every copy
   found was saved (as `<sha256>.fallback-<k>.age`), and step 4 keeps only
   the copy that decrypts to the file's own sha256.

   If it ends with `N blob(s) were found in no month folder of these keys`,
   the archive was still downloaded and its sha256 printed; the missing ones
   are listed by content hash in `~/qbbe-restore/blobs-missing.txt`. See "If
   some files are missing" below before going on.
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

   The script reaches the new project over TLS by itself (it sets
   `PGSSLMODE=require`); you set nothing for that.

   You should see `Archive sha256 matches EXPECTED_SHA256.`, then steps 1
   to 6, and a report: one line per check (`PASS`, `PARTIAL`, `FAIL` or
   `SKIP`), a `Times:` line, then:

   ```
   Scheduled jobs: restored paused, so none of them runs in the target. A drill leaves them paused. In a real restore, once the job runner is wired (runbook, Restore), start the ones that ran in the backup with:
     psql "$TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -c "SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname IN (…);"
   ```

   and last `RESULT: PASS`. **Copy the `SELECT cron.alter_job(…);`
   statement** (the text between the inner double quotes) into the
   incident register: step 5 runs it. Every scheduled job is restored
   paused, so nothing runs in the new project before its job runner is
   wired.

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
     `RESUME=files` then.
   - **Ctrl-C during the file step** puts the buckets' size limits and
     file types back before the script stops (exit status 130). Press it
     once: a second press is ignored with `already putting the bucket
     settings back; … Do not stop it again.` If the terminal was closed or
     the computer stopped instead, the settings may still be lifted:
     `RESUME=files` puts the backup's own settings back, and step 6 checks
     them.
   - **At step 6** (`RESULT: FAIL` with lines such as `load incomplete`,
     `bucket settings differ`, or `in the backup N, restored M`): **do not
     switch the app.** Keep the report. Run the same command once more with
     `RESUME=platform` in front to re-check. Re-applying platform.sql is
     safe: it schedules every job again, paused, so no job writes to the
     database between the runs and the row check stays exact. (A
     `RESUME=platform` re-run passed in the first local rehearsal; it has
     not been run since the jobs were made to restore paused.) If it fails
     again, create another new project and restore the previous green
     night. If that fails too, give the report lines to the developers.
   - **`PGSSLMODE is …`** or **`asks for sslmode=…`**: your terminal or the
     address asks for a weaker connection than TLS. Run `unset PGSSLMODE`,
     remove any `?sslmode=…` from `TARGET_DB_URL`, and run the same command
     again.

   **If some files are missing or damaged.** A file whose blob is missing
   from the bucket, or does not decrypt to the file's own sha256, stops the
   restore at step 2 with `files are missing or do not match the manifest`
   (nothing is restored). `fetch` has already looked for every copy of
   those blobs in every month folder of the same custodian keys, so
   another night made with the same keys usually has no other copy. In
   order:
   1. If the custodians' keys changed in the last 35 days, a night from
      before the change has its own copies, in its own folders: `bash
      scripts/backup/bucket.sh fetch production <its time>
      ~/qbbe-restore-2`, with that run's sha256 as `EXPECTED_SHA256`. Its
      data is older.
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
   archive … is stored as …, but not its index`): `fetch` cannot find that
   run, because it starts from the index. Usually a neighbouring night is
   the better choice. If you need that night, download the archive and its
   whole blob folder yourself, in the terminal of point 3 (the bucket key is
   already set there):
   1. From that run's summary, note the archive key from **Stored as**
      (`production/<YYYY-MM-DD>/qbbe-production-<time>.tar.gz.age`), its
      sha256, and the folder from **Files are in**
      (`blobs/production/<YYYY-MM>-<key tag>/`).
   2. Run, with those values:
      ```sh
      mkdir -m 700 ~/qbbe-restore-noindex
      printf '[default]\ns3 =\n  addressing_style = path\n' > ~/qbbe-restore-noindex/aws-config
      export AWS_CONFIG_FILE=~/qbbe-restore-noindex/aws-config AWS_SHARED_CREDENTIALS_FILE=/dev/null
      export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="$BACKUP_S3_REGION"
      export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
      aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp --no-progress "s3://$BACKUP_S3_BUCKET/<the archive key>" ~/qbbe-restore-noindex/
      aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp --no-progress --recursive "s3://$BACKUP_S3_BUCKET/<the blob folder>" ~/qbbe-restore-noindex/blobs/
      ```
      You should see one `download:` line per object. The blob folder holds
      every blob of that month, so this can be more than the night needs.
   3. Run point 4's command on
      `~/qbbe-restore-noindex/qbbe-production-<time>.tar.gz.age`, with that
      run's sha256 as `EXPECTED_SHA256`. The restore follows the blob names
      the manifest records and keeps only a copy that decrypts to each
      file's own sha256. If it stops with `files are missing or do not
      match the manifest` (that night's new blobs may not have been
      stored), run it again with `ALLOW_MISSING_FILES=1` in front.
   4. At the end, delete the folder with the rest (step 10): `rm -rf
      ~/qbbe-restore-noindex`, and `unset AWS_CONFIG_FILE
      AWS_SHARED_CREDENTIALS_FILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY`.

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
   - **Start the scheduled jobs.** They were restored paused (step 4). In
     the new project's SQL editor, run the statement you copied in step 4:
     ```sql
     SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname IN (…);
     ```
     You should see one row per job (31 today), each with an empty
     `alter_job` value. Then check:
     ```sql
     select count(*) filter (where active) as running, count(*) as jobs from cron.job;
     ```
     You should see `running` equal to the number of jobs the statement
     named (31 and 31 today). If you no longer have the statement, it is
     the last line of `db/platform.sql` in the archive; print it with:
     ```sh
     age -d -i ~/qbbe-backup-key.txt ~/qbbe-restore/qbbe-production-<YYYYMMDDTHHMMSSZ>.tar.gz.age | tar -xzOf - db/platform.sql | sed -n 's/^-- start-schedule: //p'
     ```
     (While every job was running in the backup, as all 31 are today,
     `SELECT cron.alter_job(jobid, active := true) FROM cron.job;` does the
     same.) Until step 6's Deploy gives the site the new `CRON_JOB_SECRET`,
     the site refuses these jobs' calls, so nothing runs twice.
6. **Point production at the new project.** In GitHub, environment
   **production**: `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, and in
   `APP_ENV` the `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   and `SUPABASE_SERVICE_ROLE_KEY`; environment **backup-production**:
   `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`,
   `SUPABASE_SERVICE_ROLE_KEY` (a new dedicated `backup` secret key of the
   new project); and the repository variable
   `PRODUCTION_SUPABASE_PROJECT_REF`. Then **Actions**, **Deploy**,
   environment `production`. You should see:
   - the environment check pass. If it says `APP_ENV's ... belongs to
     Supabase project <old ref>`, a key was pasted from the old project:
     copy it again from the new project's **Project Settings**, **API Keys**;
   - the migration step say the database is up to date (the migration
     history was restored);
   - after the release, `https://<site>/api/health/ready` answer
     `"ready":true` and `https://<site>/api/health/jobs` answer
     `"jobRunner":"ready"`. A `"database":"failed"` means the service role
     key in `APP_ENV` is not the new project's.

   The first nightly backup after this downloads every file from the new
   project once (restored files have a new version and date): expect the
   **Supabase traffic** warning and the **Backup traffic high** issue that
   night.
7. **Stop the old project's background jobs.** The restored project runs
   the same 31 scheduled jobs once step 5 started them. If the old project
   is still running, its jobs keep firing too, and digests, reminders, notifications and the Gmail, Google
   and Zeffy syncs would run twice. Once the app points at the new project:
   pause the old project (its **Project Settings**, **General**, **Pause
   project**). You should see it marked *Paused*. If it must stay running as
   evidence, instead run `select cron.unschedule(jobid) from cron.job;` in
   its SQL editor; you should see one row per job. The new `CRON_JOB_SECRET`
   from point 5 also makes any call it still sends fail.
8. **Check the integrations.** Gmail, Calendar, Drive and Zeffy
   connections come back with the backup, including their stored access
   tokens. Open **Admin**, **Integrations** after the first 15-minute sync.
   You should see each connected integration marked *Connected* with a
   recent last sync. A connection marked *Authentication expired* (someone
   disconnected it or revoked Hub's access after the backup was made) must be
   reconnected by its owner from the same page. Changes made in Gmail,
   Calendar, Drive or Zeffy between the backup and the restore are picked up
   by the next sync; nothing has to be entered again.
9. **Tell people** they need to sign in again. Passwords still work. If an
   administrator's authenticator code is refused (see the MFA warning in
   [What is backed up](#what-is-backed-up-and-what-is-not)), follow **Lost
   administrator MFA factor** below for that person.
10. **Clean up the custodian's computer:**
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

   > **Warning:** do **not** run the `SELECT cron.alter_job(…)` statement
   > the drill prints, and do not do Restore steps 5 to 7. The scratch
   > project's 31 jobs stay paused, so it sends no digests, reminders or
   > syncs while it exists.
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
   project**), resume staging if you paused it, and do Restore step 10 (delete
   the downloaded files and the key file).
5. Add a row to the drill record below with the times the script printed.

**Local rehearsal** (no hosted project needed, for checking changes to the
scripts on a developer's computer). It uses the local Supabase stack
(`npx supabase start`), a stand-in for the bucket on the same computer, and
throwaway keys, never a custodian's. Everything goes in
`/tmp/qbbe-rehearsal`. Besides the restore's tools (age, the AWS CLI,
Node 22, `psql`), it needs moto's S3 server (`pip install 'moto[server]'`).

> **Warning — before you start:**
> - Use `127.0.0.1` (or `localhost`) in every database address below,
>   never the Docker bridge address (such as `172.17.0.1`). The stack has
>   no TLS, and the scripts require TLS for any other address: they would
>   stop with `server does not support SSL`.
> - Do not use a bucket inside the local stack as the stand-in store: the
>   backup would then back up its own blobs.
> - Step 3 adds a test bucket to the local stack, and step 8 deletes it.
>   Do not run this on a stack someone else is using for tests at the same
>   time.

1. **Start the stand-in store** in a second terminal:
   ```sh
   moto_server -p 59611
   ```
   You should see `Running on http://127.0.0.1:59611`. Leave it running.
2. **Settings**, in the first terminal, at the root of the repository:
   ```sh
   mkdir -m 700 /tmp/qbbe-rehearsal
   eval "$(npx supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
   export SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" SUPABASE_BIN="npx supabase"
   export BACKUP_DB_URL=postgresql://postgres@127.0.0.1:54322/postgres PGPASSWORD=postgres
   age-keygen -o /tmp/qbbe-rehearsal/key-a.txt
   age-keygen -o /tmp/qbbe-rehearsal/key-b.txt
   export BACKUP_AGE_RECIPIENT="$(age-keygen -y /tmp/qbbe-rehearsal/key-a.txt) $(age-keygen -y /tmp/qbbe-rehearsal/key-b.txt)"
   export BACKUP_INDEX_KEY="$(openssl rand -base64 32)"
   export BACKUP_S3_ENDPOINT=http://127.0.0.1:59611 BACKUP_S3_BUCKET=qbbe-rehearsal BACKUP_S3_REGION=us-east-1
   export BACKUP_S3_ACCESS_KEY_ID=test BACKUP_S3_SECRET_ACCESS_KEY=test
   export BACKUP_GENERATION=$(date -u +%Y-%m) BACKUP_STATE_DIR=/tmp/qbbe-rehearsal/state
   AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 \
     aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3api create-bucket --bucket qbbe-rehearsal
   ```
   You should see two `Public key: age1…` lines, and no error from the last
   command (it prints the new bucket's `Location`, or nothing, depending on
   the AWS CLI version). Lines from `npx supabase status` such as `Stopped
   services: …` are normal. If `echo "$API_URL"` prints nothing, the stack
   is not running: run `npx supabase start` and repeat this step. If the
   last command says it could not connect, the store from step 1 is not
   running.
3. **Files to rehearse with**: a test bucket with two identical files and
   an empty one (the cases a backup must store once, and restore as an
   empty file):
   ```sh
   api() { curl -sS -H "apikey: $SERVICE_ROLE_KEY" -H "authorization: Bearer $SERVICE_ROLE_KEY" "$@"; echo; }
   api -X POST "$API_URL/storage/v1/bucket" -H 'content-type: application/json' -d '{"id":"zz-rehearsal","name":"zz-rehearsal","public":false}'
   head -c 300000 /dev/urandom > /tmp/qbbe-rehearsal/same.bin
   : > /tmp/qbbe-rehearsal/empty.bin
   for name in same-1.bin same-2.bin; do
     api -X POST "$API_URL/storage/v1/object/zz-rehearsal/$name" -H 'content-type: application/octet-stream' --data-binary @/tmp/qbbe-rehearsal/same.bin
   done
   api -X POST "$API_URL/storage/v1/object/zz-rehearsal/folder/empty.bin" -H 'content-type: application/octet-stream' --data-binary @/tmp/qbbe-rehearsal/empty.bin
   ```
   You should see `{"name":"zz-rehearsal"}`, then three lines starting
   `{"Key":"zz-rehearsal/`.
4. **One night**: what the workflow does, in the same order:
   ```sh
   scripts/backup/bucket.sh state local "$BACKUP_GENERATION" "$BACKUP_STATE_DIR"
   scripts/backup/create-backup.sh /tmp/qbbe-rehearsal/night-1 local
   scripts/backup/bucket.sh push /tmp/qbbe-rehearsal/night-1 local
   ```
   You should see `Bucket: 0 blob(s) in blobs/local/…; previous index: none
   trusted (every file will be downloaded).`, then `Storage: 3 files … in
   this backup. Read from Supabase: 3 files …; 0 unchanged since the last
   backup, not downloaded. Blobs: 2 new.` (the two identical files share
   one blob), `Backup: … sha256 <64 characters>` and a `Read from Supabase:
   …` line, then `Blobs: 2 needed by this backup, 0 missing, 0 with the
   wrong size.` and two `Uploaded … read back in full and matching.` lines.
   Lines `pg_dump: warning: there are circular foreign-key constraints …`
   are expected: the restore loads the data with triggers off. (The counts
   are larger if the stack holds other uploaded files.)

   For another night, run the three commands again with `night-2` (and so
   on) in place of `night-1`. You should then see `N unchanged since the
   last backup, not downloaded` for the files that did not change. For a
   new month, first set `BACKUP_GENERATION` to the next month (for example
   `export BACKUP_GENERATION=2026-11`); `state` then prints `Carried N
   blob(s) from … into …`, and the night reads no unchanged file.
5. **Fetch it**, as a custodian would, and take the sha256 the last night
   printed:
   ```sh
   scripts/backup/bucket.sh fetch local latest /tmp/qbbe-rehearsal/fetched
   export EXPECTED_SHA256=$(sed -n 's/^BACKUP_SHA256=//p' /tmp/qbbe-rehearsal/night-1/backup.env)
   echo "$EXPECTED_SHA256"
   ```
   You should see the runs considered (one line per night, each with its
   `archive sha256`), `Archive sha256: <sha>`, and the `echo` printing the
   same sha256. (Use the last night's folder in the `sed` line. In a real
   restore, `EXPECTED_SHA256` comes from the run's summary, never from the
   bucket.)
6. **Restore the database** into a scratch database:
   ```sh
   scripts/backup/local-scratch-db.sh create restore_drill
   AGE_IDENTITY_FILE=/tmp/qbbe-rehearsal/key-b.txt \
   TARGET_DB_URL=postgresql://postgres@127.0.0.1:54322/restore_drill \
   PROTECT_DB_URL=postgresql://postgres@127.0.0.1:54322/postgres \
   DRILL_LOCAL_CLUSTER=1 bash scripts/backup/restore-drill.sh /tmp/qbbe-rehearsal/fetched/qbbe-local-*.tar.gz.age
   scripts/backup/local-scratch-db.sh drop restore_drill
   ```
   You should see `== LOCAL REHEARSAL MODE`, `SKIP  uploaded files: no
   TARGET_SUPABASE_URL …`, `PASS` on every other line and `RESULT: PASS`.
   The second database on the same Postgres server cannot hold the job
   schedule (`pg_cron` lives only in the server's own database), so the
   schedules are left out and not checked locally.
7. **Restore the files.** The stack's Storage serves only its own database,
   so the drill cannot restore files into the scratch database; this puts
   the test bucket's files into a new temporary bucket, `zz-restore-check`,
   and checks them:
   ```sh
   mkdir -m 700 /tmp/qbbe-rehearsal/files
   age -d -i /tmp/qbbe-rehearsal/key-b.txt /tmp/qbbe-rehearsal/fetched/qbbe-local-*.tar.gz.age | tar -xzf - -C /tmp/qbbe-rehearsal/files
   AGE_IDENTITY_FILE=/tmp/qbbe-rehearsal/key-b.txt node scripts/backup/manifest.mjs unpack-blobs /tmp/qbbe-rehearsal/files /tmp/qbbe-rehearsal/fetched/blobs
   TARGET_SUPABASE_URL="$API_URL" TARGET_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
   PROTECT_DB_URL=postgresql://postgres@127.0.0.1:54322/postgres \
     node scripts/backup/restore-storage.mjs /tmp/qbbe-rehearsal/files --bucket zz-rehearsal=zz-restore-check
   ```
   You should see `Files: 3 of 3 unpacked from 2 blob(s); 0 blob(s)
   missing from …, 0 could not be decrypted to the file's sha256.` (more if
   the stack holds other files), then `Created bucket zz-restore-check.`,
   `Uploaded 3 of 3 files …; bucket settings put back and checked.` and
   `ok    restored files: 3 of 3 downloaded again and compared …, 0
   missing, 0 different`. (Do not set `TARGET_DB_URL` for this command:
   with it, the script checks the database target instead.)
8. **Clean up** (this deletes both test buckets and their files):
   ```sh
   for bucket in zz-restore-check zz-rehearsal; do
     api -X POST "$API_URL/storage/v1/bucket/$bucket/empty"
     api -X DELETE "$API_URL/storage/v1/bucket/$bucket"
   done
   rm -rf /tmp/qbbe-rehearsal
   ```
   You should see, for each bucket, `{"message":"Empty bucket has been
   queued. …"}` and then `{"message":"Successfully deleted"}`. If a delete
   says the bucket is not empty, the emptying has not finished: wait a few
   seconds and run the loop again. Then stop the stand-in store with Ctrl-C
   in its terminal.

### Drill record

| Date | Kind | Backup | Made in | Restored in | Result | What was checked, and what was not |
|---|---|---|---|---|---|---|
| 2026-10-22 | **Local rehearsal, not the hosted drill** | local stack (demo data: 270 tables, 54,529 rows, 43 sign-in accounts, 30 files of 75.1 MB), five nights in a row with `create-backup.sh` and `bucket.sh push` into a local S3-compatible store (moto 5.1.4, AWS CLI 2.27.50), encrypted with age 1.2.1 (the pinned release) to two throwaway keys | First night 31 s: bucket check 2.4 s; dump and checks 20 s; 30 files read and encrypted into 18 blobs (25.1 MB; identical files stored once) 1.2 s; archive 4.5 MB; upload and full read-back 5.9 s. Read from Supabase: 112.0 MB (dump files and files only; the catalog reads were not counted then). Next night with no changes: 0 files read (36.9 MB, the dump). Night with 3 new files: 3 read, 2 new blobs. First night of a new month: 0 read, 20 blobs carried inside the store (upload step 13.5 s) | About 16 s: fetch of archive and 20 blobs 7.1 s, scratch database 1.5 s, drill 7.1 s (decrypt and unpack 0.6 s, database 5.3 s, checks 0.5 s) | PASS | **Checked:** decrypted with the second custodian's key using age 1.1.1 (Ubuntu's); 6 SQL files and 33 files match their sha256; load complete in all 270 tables, and a fresh dump of the restored database is row-for-row identical to the backup's `data.sql` in all 270; 43 `auth.users`, 43 `auth.identities`, 2 `auth.mfa_factors`; 18 storage policies, 7 auth/storage triggers, 3 queues; every restored file row has its file. File restore into a temporary bucket limited to 1 KB and PDF only: 20 of 20 files (one of 25 MB, several not PDF) uploaded, downloaded again and matching, and the bucket's limits put back afterwards (1.4 s). Refusals: production as target; a second run into the now non-empty database (with the RESUME hint); `RESUME=files` after platform.sql; bash 3.2. `RESUME=platform` re-run passed. A changed file was caught. A file deleted mid-backup was recorded, not failed; a file whose bytes were missing failed the night (exit 3) with the database still stored. **Not checked:** the 31 scheduled jobs (pg_cron cannot run in a second local database); restoring files into a second Supabase project (none exists locally); MFA sign-in after a hosted restore; the hosted pooler connection, a hosted `roles.sql`, Oracle Object Storage, and GitHub Actions itself. |
| 2026-10-22 (second) | **Local rehearsal after the second round of review fixes, not the hosted drill** | local stack as it then was (271 tables, 17 sign-in accounts, 1 file), reached at a non-local address with the password in `PGPASSWORD` only (Supabase CLI 2.121.0, the pinned version); a moto S3 stand-in, AWS CLI 1.46; nights across three months and two key sets | Nights 1 and 2: first download, then nothing read again. Database reads, measured with a byte-counting proxy: 5.47 MB more than the files written (the basis of the catalog estimate). The CLI's three dumps took about 220 s there. That came from the test machine, not the scripts: the run started the CLI with an emptied environment (`env -i`), which removed the machine's proxy settings, so the CLI waited on network timeouts. In the other local runs the whole dump takes 12 to 20 s | drill 6.9 s (decrypt 0.2 s, database 5.4 s, checks 0.6 s) | PASS; PARTIAL and FAIL where intended | **Checked:** new month: 1 blob carried and checked by size and sha256; a damaged carry source refused, its file downloaded again, with the warning; a key change: every file downloaded again, with the warning; a planted unsigned index: signature warning, every file downloaded again; fetch by archive name, then the drill: `RESULT: PASS`, including the migration history in the single transaction (same table definition, same 216 rows as before) and bucket settings. Refusals held: wrong `EXPECTED_SHA256`, missing `EXPECTED_SHA256`, a password in the address, a planted index for fetch, a non-empty fetch folder, another environment's name. `ALLOW_MISSING_FILES=1` with a damaged blob: `RESULT: PARTIAL`, exit 2; without it: FAIL with the hint. File restore into a temporary bucket: the backup's settings put back, settings left lifted by an earlier run repaired, Ctrl-C put back (exit 130), unreachable Storage reported in one line, a bad `BACKUP_STORAGE_CONCURRENCY` refused. **Not checked:** a `RESUME` run; `push` with failing blobs against a real store; everything hosted (as in the row above). |
| 2026-10-22 (third) | **Local rehearsals after the third round of review fixes, not the hosted drill** | local stack (271 tables, 904 rows) with a test bucket of 3 to 6 files (identical files, empty files); a moto S3 stand-in, AWS CLI 1.x; three nights over two months, run twice: by the developer (backups made with age 1.2.1, the pinned release, restored with Ubuntu's age 1.1.1), and by following this runbook's [local rehearsal](#restore-drill) as written (only the folder, port and scratch database name changed; age 1.1.1) | Each night 13 to 14 s (database 12 to 14 s); upload and read-back 2 to 4 s. New month: 3 blobs carried, 0 files read from Supabase | Drill 6.5 to 6.6 s (decrypt 0.2 s, database 5.0 to 5.1 s, checks 0.6 s); file restore into a temporary bucket 0.2 s | PASS | **Checked:** identical files stored once, every blob record complete (encrypted size and sha256); empty files unpacked and restored, also with age 1.1.1 (which writes no file for an empty plaintext); an index planted with a 2099 date ignored by the nightly `state` (one warning) and by `fetch latest`; an object planted at a new file's blob name: the blob stored as `<sha256>.2.age` with the warning, and restored from that name; an object of the right size planted at a carried blob's name in the next month: the blob copied under another name with the warning, and still 0 files read from Supabase; no blob hash in the logs; `fetch latest` listed the 3 runs with their sha256; drill `RESULT: PASS`; the file restore: every file downloaded again and matching, bucket settings put back; the no-index commands (archive and blob folder downloaded by hand), then `unpack-blobs` and `check-files`, all ok; every job in `platform.sql` restored paused, its `start-schedule` line naming the 31 jobs, and the command that prints it from the archive; `history_schema.sql` applied twice more to a target that already had the table. The stack was left as found (buckets, files, databases, cron jobs). **Not checked:** a `RESUME` run; the drill printing the start statement (it does so only for a hosted target); everything hosted (as in the first row). |
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

Use the SEV-1 to SEV-4 ladder in [incident-response.md](incident-response.md#severity).
A restore is SEV-1 (data loss, corruption or a sign-in outage): it requires
immediate leadership notification and an entry in the incident register
([incident-response.md](incident-response.md#the-incident-register)).

## Files

| File | What it does |
|---|---|
| `.github/workflows/backup.yml` | the nightly run (staging only with `BACKUP_STAGING_NIGHTLY=on`), upload, outside check-in (its body carries the archive's sha256), the **Backup failed** issues and the **Backup traffic high** issue |
| `scripts/backup/check-backup-environment.sh` | refuses missing settings, the wrong project, another project's key, a private key among the public ones, and an index key that is short or not random |
| `scripts/backup/create-backup.sh` | requires TLS for its `psql` connections to a non-local database (the CLI dumps use TLS when offered), dumps, checks the dump, copies changed files, writes the manifest, encrypts, prints the traffic line |
| `scripts/backup/migration-history.sql` | writes the migration history files with one `psql` query; each table, key and index is created only if the target lacks it |
| `scripts/backup/platform-extras.sql` | writes `platform.sql` (what the standard dump leaves out); every scheduled job is restored paused, and its last line, `-- start-schedule: …`, starts the ones that were running |
| `scripts/backup/export-storage.mjs` | downloads new or changed files, encrypting each into a blob (identical files share one); relies only on blobs a signed index recorded, and stores a new blob under another name when its usual one is taken |
| `scripts/backup/bucket.sh` | the bucket: the newest trusted index and the checked monthly copy (`state`), upload with full read-back (`push`), download of one run for a restore, listing the runs considered with their sha256 (`fetch`). The public log gets counts only; details go to `ignored-indexes.txt` in the state folder and `blob-check.txt` in the backup folder, on the machine that ran it |
| `scripts/backup/restore-drill.sh` | checks the archive against `EXPECTED_SHA256`, decrypts, restores, checks, reports, and prints the statement that starts the scheduled jobs; `RESUME` to finish a stopped run; `ALLOW_MISSING_FILES=1` for a partial restore |
| `scripts/backup/restore-storage.mjs` | uploads files to the target (lifting bucket limits meanwhile and always putting the backup's settings back, also on Ctrl-C) and downloads them again to compare |
| `scripts/backup/manifest.mjs`, `lib.mjs`, `storage-api.mjs` | the manifest, the signed index, the checks, the guard, the Storage calls; `unpack-blobs` keeps only a blob copy that decrypts to the file's own sha256 |
| `scripts/backup/local-scratch-db.sh` | local rehearsal only: an empty database shaped like a new project |
