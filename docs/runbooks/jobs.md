# Background jobs runbook

Everything the Hub does on a schedule — notification email, digests,
acknowledgement nudges, due-date reminders, the stale-project sweep, retention
— runs through one mechanism. This is how it works and how to operate it.

## Shape of the system

```
pg_cron (in the database)
   └─ app.dispatch_job('<name>')
        ├─ reads endpoint + secret from Vault
        └─ pg_net POST https://<app>/api/jobs/<name>   x-job-secret: …
              └─ runJob(<name>)
                   ├─ opens a job_run row
                   ├─ runs the handler
                   │    └─ queue-backed handlers read/ack pgmq
                   └─ closes the job_run row
```

The database is both scheduler and queue, so there is no extra service to
operate and no separate place a schedule can be defined. `job_definition` is
the single registry: cron entries are generated from it, and the runner refuses
any name absent from it.

A migration that adds a `job_definition` row must also call `cron.schedule`
for it. Two once did not (`retry-workflow-executions` and
`decision-revisit-reminders`, REL-009), so they were listed as enabled and
never ran. `supabase/tests/job-schedules.sql` now fails `npm run test:db` when
an enabled job has no cron entry (or two), when a `dispatch_job` cron entry
names a job that is not registered, or when a cron schedule differs from the
one in `job_definition`. To check a live database by hand:

```sql
select d.name
from public.job_definition d
left join cron.job c on c.command = format('select app.dispatch_job(%L)', d.name)
where d.enabled and c.jobid is null;   -- must return no rows
```

## First-time setup, per environment

Migrations create the queues, the registry, and the cron entries. Two things
are environment-specific and are **not** in migrations, because they are a URL
and a secret:

```sql
-- Run once per environment, as an administrator, against that environment's
-- database. Both values are stored in Supabase Vault, never in the schema.
select app.configure_job_runner(
  'https://hub.qbbe.example.org',    -- no trailing slash needed
  '<the same value as CRON_JOB_SECRET>'
);
```

The secret must be at least 32 characters; the function refuses anything
shorter. Generate one with `openssl rand -base64 48`.

Set the matching value in the application environment:

| Variable | Purpose |
|---|---|
| `CRON_JOB_SECRET` | Compared, in constant time, against the `x-job-secret` header on every `/api/jobs/*` request. |
| `SUPABASE_SERVICE_ROLE_KEY` | The job runner's database access. Never a `NEXT_PUBLIC_*` variable. |
| `EMAIL_PROVIDER_API_KEY` | Resend API key. Absent means the log transport (see below). |
| `EMAIL_FROM_ADDRESS` | A verified sender on a QBBE-controlled domain. |
| `NEXT_PUBLIC_APP_URL` | The origin used to build absolute links inside email. |
| `CLAMAV_SOCKET`, or `CLAMAV_HOST` and `CLAMAV_PORT` | Where clamd listens for the three scanning jobs: a private Unix socket on the same host, or clamd over a private network (port 3310 by default). One of the two is required wherever the jobs run. |

To run one job now instead of waiting for its schedule (a file awaiting its
security check, say), run it the way pg_cron does:

```
CRON_JOB_SECRET=<the site's secret> NEXT_PUBLIC_APP_URL=<site> npm run jobs:run -- scan-documents
```

Locally this is the only way a job runs: the database container cannot reach
a server on the developer's loopback address, so its cron never arrives.

Until `configure_job_runner` has been run, every job records a `failed` run
saying so — at most once an hour, so the message stays visible without burying
real failures. Admin → Jobs shows this as a banner.

Rotating either value is a re-run of `configure_job_runner` plus an update to
the application environment. No re-scheduling is needed: the dispatcher reads
Vault at run time.

## The schedule

All times are UTC, because pg_cron evaluates in UTC.

| Job | Schedule | What it does |
|---|---|---|
| `drain-notifications` | every minute | Delivers queued notification email; records every attempt. |
| `retry-failed-emails` | every 15 min | Recovers deliveries stranded by a crash, releases holds whose re-queue was lost, and rescues notifications the trigger could not enqueue. |
| `daily-digest` | hourly | Builds each subscriber's digest **at their own local digest hour**. |
| `announcement-nudge` | 13:00 | Reminds anyone who has not acknowledged a required announcement. |
| `due-date-reminders` | 12:00 | Notifies assignees of work — tasks and CRM follow-ups — due today, tomorrow, or overdue. |
| `stale-project-sweep` | Mondays 10:00 | Flags active projects with no activity in 14 days to their lead. |
| `scheduled-announcements` | every 5 min | Fans out notifications for announcements whose publish time has arrived. |
| `google-sync` | every 15 min | Pulls Gmail metadata, Calendar overlay and Drive links for every connected account. |
| `gmail-watch-renew` | 07:00 | Renews Gmail push subscriptions a day before they lapse. |
| `vms-sync` | 08:00 | Refreshes volunteer availability from the Volunteer Management System. |
| `zeffy-sync` | every 15 min | Pulls payments, supporters and campaigns from Zeffy into the CRM; skipped without `ZEFFY_API_KEY`. |
| `zeffy-events` | every minute | Applies the payment and supporter changes Zeffy reported by webhook. |
| `gmail-push-sync` | every minute | Reconciles Gmail history right after an authenticated Pub/Sub push notification. |
| `google-token-upkeep` | every 5 min | Seals Google tokens stored in the clear or under an old key, and revokes deleted tokens at Google. |
| `scan-documents` | every minute | Scans pending private uploads; only a clean ClamAV verdict releases a download. |
| `scan-receipts` | every minute | Scans pending receipt uploads; a blocked file records ClamAV's verdict name and an audit event (see document-scanning.md). |
| `scan-form-files` | every minute | Scans form attachments and documents sent for signature, and records each file's SHA-256. |
| `purge-unregistered-uploads` | hourly at :23 | Reports uploads nobody registered (a closed tab, a failed save) older than 24 hours in the four upload buckets. Deletes them only once an owner has turned its switch on; see [Turning on the upload cleanup](#turning-on-the-upload-cleanup). |
| `purge-job-history` | 06:00 | Trims `job_run`, `background_job_run`, `email_delivery` and `rate_limit_counter` past retention (see [Retention](#retention)). |
| `run-exports` | every 5 min | Builds queued data exports into the private exports bucket (see [Data exports](#data-exports)). |
| `expire-exports` | 03:17 | Expires exports past their date and deletes the files behind them. |
| `apply-retention` | 02:40 | Applies enabled retention policies; records each run in `retention_run` and stops if that record cannot be written. |
| `report-record-retention` | 02:50 | Reports classified records whose retention period has ended. Deletes nothing. |
| `purge-cron-history` | 05:47 | Not an app job: plain SQL inside the database that deletes pg_cron's own run log (`cron.job_run_details`) older than 7 days. Not shown in Admin → Jobs. |
| `retry-workflow-executions` | every 15 min | Retries workflow-rule notifications that failed to record, without sending a second copy. |
| `decision-revisit-reminders` | 11:10 | Reminds the decider and participants when a decision reaches its revisit date (only does anything with decisions v2 on). |
| `grant-report-reminders` | 12:10 | Reminds the people responsible for a grant report before, on and after its due date. |
| `follow-events` | every 5 min | Tells followers about changes to what they follow (only does anything with wos_objects on). |
| `workflow-events` | every minute | Runs step-graph workflows for new events (only does anything with wos_workflows_v2 on). |
| `workflow-resume` | every minute | Resumes waiting step-graph workflow runs whose time has come, and stops those of stopped workflows (wos_workflows_v2). |
| `team-signal-reminders` | 13:20 | Where Admin, Team signals has reminders on: records each person's open work signals and sends one gentle notification per new signal (#136). |
| `team-signal-digest` | Mondays 12:40 | Where Admin, Team signals has the digest on: emails owners and admins the people with open work signals; no email when there are none (#136). |
| `ops-watchdog` | every 15 min | Alerts owners and admins (in the app and by email, once per condition per day) when a job is overdue or fails three times in a row, a queue message waits over 15 minutes, webhooks are refused ten times in an hour, or the database reaches 70% of its limit. See [Alerts](#alerts). |
| `job-dispatch-watchdog` | every 5 min | Not an app job: plain SQL that records a failed run ("Dispatch failed: HTTP 403", "timed out", "no answer") when the database's call to a job was refused or never answered. |

The digest runs hourly rather than at a fixed time on purpose: each recipient's
`notification_preference.timezone` and `digest_hour` decide whether this tick is
theirs, so 8am stays 8am across a daylight-saving change and across zones.

## Retention

Production runs on Supabase's Free plan, which makes the database read-only at
500 MB. Job bookkeeping is the fastest-growing thing in it (about 12,700 job
runs a day), so it is trimmed daily (OPS-001):

| What | Kept for | Trimmed by |
|---|---|---|
| `cron.job_run_details` (pg_cron's log of every run) | 7 days | `purge-cron-history` (SQL in the database) |
| `job_run`, successful runs that processed or dropped something | 7 days | `purge-job-history` |
| `job_run`, successful runs that did nothing (most per-minute ticks) | 1 day | `purge-job-history` |
| `job_run`, failed runs | 180 days | `purge-job-history` |
| `job_run`, the latest run of each job | always | never purged, so Admin → Jobs can show it |
| `background_job_run`, successful | 30 days | `purge-job-history` |
| `background_job_run`, failed | 180 days | `purge-job-history` |
| `email_delivery`, sent or suppressed | 180 days | `purge-job-history` |
| `rate_limit_counter` | 1 day | `purge-job-history` |

`scheduled-announcements` writes a `background_job_run` row only for a pass
that notified someone; its repeat passes over the two-day window used to write
one row per announcement every five minutes.

To check cron history is being trimmed on a live database:

```sql
select count(*) from cron.job_run_details
where end_time < now() - interval '8 days';   -- should be 0
select pg_size_pretty(pg_database_size(current_database()));
```

## Delivery guarantees

pgmq is **at-least-once**. Handlers suppress completed duplicates and make
provider retries as safe as their transports allow:

- Every message resolves to a `dedupe_key`. `email_delivery` has a unique index
  on it, so completed deliveries are not sent again and concurrent workers
  cannot both claim the same pending row.
- Resend receives the stable delivery id as its idempotency key, covering the
  ambiguous case where the provider accepted mail but the ledger update was
  lost. Resend retains those keys for 24 hours. SMTP has no equivalent
  guarantee and may duplicate mail after an ambiguous transport failure.
- Nothing is acknowledged before its outcome is written. A worker killed
  mid-send leaves the message on the queue with the ledger row still `sending`;
  the visibility timeout re-delivers it and the attempt resumes.
- A retryable failure (network, 429, 5xx) is queued again by delivery id with
  a growing delay: 1, 4 and 16 minutes, then hourly. The ledger row stays
  `queued` with `scheduled_for` set to when the next attempt is due; the
  `retry-failed-emails` sweep leaves it alone until ten minutes after that.
  A notification email's retry goes back through the notification path, so
  quiet hours, the person's email settings and a deleted notification are
  checked again. A permanent failure
  (bad address, 4xx) is archived immediately rather than burning attempts.
- After `max_attempts` (8, about four hours of retries), the message is
  archived to the dead-letter table and the ledger row is marked `failed`.
  Both are visible in Admin → Jobs.
- After an outage longer than that, an administrator clicks **Send failed
  email again** in Admin → Jobs. It re-queues the organization's `failed`
  email from the last seven days (up to 500 at a time; click again for more),
  each with a fresh set of attempts, and records an audit event. Bounced and
  suppressed email is never re-queued, nor email the sweep gave up on
  ("Gave up after N attempts", which may have gone out before a worker died),
  nor a notification email whose notification was deleted or already read. The delivery id is the provider's
  idempotency key, so an email the provider did accept in the last 24 hours
  is not sent twice.

## Transports

Three, picked by what the environment provides:

| Transport | When | Ledger records |
|---|---|---|
| `resend` | `EMAIL_PROVIDER_API_KEY` is set | `provider = 'resend'` plus the provider's message id |
| `smtp` | `SMTP_HOST` is set and no provider key is — local Mailpit | `provider = 'smtp'` |
| `log` | neither | `provider = 'log'` |

The pipeline runs end to end in all three, so queue → rules → template → ledger
is exercisable in development and CI without an account. A development run can
never be mistaken for a real one: the ledger says which transport ran, and Admin
→ Email shows a banner whenever mail is not really going out.

## Integration jobs

`google-sync`, `gmail-watch-renew`, `vms-sync`, `zeffy-sync` and `zeffy-events` reach outside the Hub. Two
behaviours are worth knowing:

- **Cursors.** Each connection stores its own cursor — a Gmail history id, a
  Calendar sync token, a Drive page token — so a run asks the provider only for
  what changed. When a provider reports a cursor as too old, the handler fetches
  a full snapshot *before* clearing the existing mirror, so a transient failure
  cannot leave the workspace with nothing.
- **Health.** A failure writes a classified status onto
  `integration_connection`, so Admin → Integrations shows what is wrong rather
  than a silently stale panel. Per-organization detail (which connection, how
  many records changed) goes to `background_job_run`; the runtime-level outcome
  goes to `job_run`.

A job whose credentials are absent reports itself skipped rather than failed —
an integration that is switched off is not a fault.

## Operating it

**Admin → Jobs** answers, in order: is anything broken (recent failures with
their error), is anything stuck (queue depth, oldest pending, dead letters), and
is every job still on its schedule (last run, next run, failures in 24h).

A job reads **Overdue** when it has not started for three of its schedule
intervals, and **Failed** with "Dispatch failed: ..." when the database could
not reach the app at all (wrong secret, app down, timeout). A database size bar
shows how close the database is to its limit.

**Admin → Integrations** reads "Synchronization delayed" when a connection's
last successful sync is older than three sync intervals.

**Admin → Email** is the delivery ledger — every attempt including suppressions,
filterable by status, with the provider's own reason on anything that bounced.

### Alerts

`ops-watchdog` notifies the organization's active owners and admins. It
cannot report a dead server, a broken network or an expired certificate,
because it runs on that server: an external uptime monitor must watch
`/api/health/version` and `/api/health/ready`, and the certificate's expiry
(an owner step; see [incident-response.md](incident-response.md)). On a paid
Supabase plan set `OPS_DATABASE_LIMIT_MB` to the plan's database size so the
70% alert and the size bar use it.

### Running a job by hand

```bash
curl -X POST https://<app>/api/jobs/drain-notifications \
  -H "x-job-secret: $CRON_JOB_SECRET"
```

Safe at any time: every handler is idempotent.

### Pausing a job

```sql
update job_definition set enabled = false where name = 'daily-digest';
```

The dispatcher and the runner both check `enabled`, so this stops the work
without touching cron.

### Turning on the upload cleanup

`purge-unregistered-uploads` starts in **report mode**: every hour it counts,
per bucket (`documents`, `receipts`, `form-files`, `signing-documents`), the
files nobody registered that are over 24 hours old, their total size and the
oldest date, and the multipart uploads (`unfinished_multipart`) left
unfinished for over 24 hours. It logs and audits that count and **deletes
nothing**. Deleting
needs the owner's OK, given once per environment through an operator switch.

**This is hard to undo.** Files it deletes are gone from storage; only a
storage backup brings them back. Do the steps in order.

1. **Take a storage backup.** In GitHub, open **Actions**, **Backup**,
   **Run workflow**, branch `main`, the environment you are turning this on
   for, then **Run workflow** (see [the backup runbook](backup-recovery.md)).
   *Worked:* the **Back up <environment>** job turns green and its summary
   shows where the archive is stored. *Failed:* a red job; stop here and fix
   the backup first.
2. **Wait for one report.** The job runs at 23 minutes past each hour.
3. **Read the report.** In the Supabase dashboard of that project, open
   **SQL Editor**, **New query**, and run:

   ```sql
   select created_at, metadata
   from audit_event
   where action = 'unregistered_uploads_reported'
   order by created_at desc
   limit 1;
   ```

   *Worked:* one row whose `metadata.buckets` lists each bucket with `files`,
   `bytes` and `oldest`, and whose `metadata.unfinished_multipart` counts
   unfinished multipart uploads over a day old (normally `0`). *Failed:* no row; open **Admin**, **Jobs** in the Hub
   and check `purge-unregistered-uploads` ran.
   Check the numbers make sense: a few files or a few megabytes is normal. If
   a bucket shows thousands of files or an `oldest` date from before the Hub
   went live, stop and ask before going on.
4. **Turn deletion on.** In the same **SQL Editor**, run:

   ```sql
   select public.set_operator_switch('purge-unregistered-uploads', true);
   ```

   *Worked:* the query returns one empty row, and
   `select enabled, changed_via, changed_at from operator_switch;` shows
   `true`, `database` and the time. The change is audited as
   `operator_switch_changed`, with the database login it came from. *Failed:* an error saying only an owner can
   change it means the query did not run in the dashboard's SQL editor.
5. **Check the first deleting run.** After the next :23, run:

   ```sql
   select created_at, metadata from audit_event
   where action = 'unregistered_uploads_deleted'
   order by created_at desc limit 1;
   ```

   *Worked:* `metadata.deleted` lists a count per bucket,
   `metadata.expired_multipart` the unfinished uploads removed, and
   `metadata.failed` is `0`. Each run deletes at most 200 files and 200
   unfinished uploads, so a larger count from step 3 takes several hourly
   runs to clear.
   *Failed:* `metadata.failed` is above `0`, or there is no row at all. Open
   **Admin**, **Jobs** in the Hub, select `purge-unregistered-uploads`, and
   read the latest run's error; the server log has a
   `storage.purge_unregistered_failed` entry per bucket that could not be
   cleaned. Files that were not deleted are tried again next run.

To go back to report mode at any time, run the step 4 query with `false`.

Separately, the documents bucket refuses a new upload from a person who
already has 50 uploads from the last day waiting (not yet filed, or not yet
scanned; captures count too). Someone who sees "The file
could not be uploaded. Try again." after a large batch can try again the
next day, or once the scanner has caught up; see
[document scanning](document-scanning.md).

**Required, once per environment: turn off the storage S3 protocol.** The
Hub never uses it, and uploads through it are only partly held to the
limits above. In the Supabase dashboard of the project, open **Storage**,
then **Settings** (on some dashboards: **Project Settings**, **Storage**),
find **S3 Connection**, turn off **Enable connection via S3 protocol**, and
**Save**. *Worked:* after a page reload the toggle is still off, and the
page no longer lists S3 access keys as usable. *Failed:* the setting is not
there or will not save; note it on the owner list and ask Supabase support.
The Hub's own uploads do not use it, so nothing in the app changes.

### Changing a schedule

```sql
update job_definition set schedule = '0 14 * * *' where name = 'due-date-reminders';
select cron.unschedule('due-date-reminders');
select cron.schedule('due-date-reminders', '0 14 * * *',
  $$select app.dispatch_job('due-date-reminders')$$);
```

Keep the two in step — Admin → Jobs reads its next-run time from
`job_definition`, so a drifted cron entry would make the panel lie.

### Inspecting the queues

```sql
select * from public.job_queue_health();          -- depth, oldest, dead letters
select * from public.job_queue_dead_letters(50);  -- archived payloads
```

Service-role only; there is deliberately no PostgREST route for either.

## Verification

| Guarantee | How it is checked |
|---|---|
| Trigger enqueues on notification insert | Hand-run SQL, once — **not repeated** |
| Duplicate dedupe key rejected | Hand-run SQL, once — **not repeated** |
| Unacknowledged message returns after the visibility timeout | Hand-run SQL, once — **not repeated** |
| Archive moves a message to the dead-letter table | Hand-run SQL, once — **not repeated** |
| Crash mid-send delivers exactly once on recovery | `tests/unit/drain-notifications.test.ts` |
| Retries wait longer each time; the last failure dead-letters and marks the row failed | `tests/unit/drain-notifications.test.ts` |
| Quiet hours defer and later release | `tests/unit/drain-notifications.test.ts` |
| Required announcements ignore quiet hours and opt-outs | `tests/unit/delivery-rules.test.ts` |
| One digest per person per local day; none when empty | `tests/unit/job-handlers.test.ts` |
| Next-run times shown in Admin | `tests/unit/cron.test.ts` |

The handler tests run the real handlers against an in-memory double
(`tests/support/fake-supabase.ts`) that reproduces unique-index violations,
visibility timeouts, and archiving. Those rows run in CI on every push.

The first four do not. They were checked by hand against Postgres once, and
nothing re-runs them: `supabase/tests/` holds only the fixture and the RLS
matrix, and neither touches pgmq. They are listed here in the same table and
the same voice as the automated rows, which is misleading, so they are marked.

This distinction is not pedantry. The RLS matrix carried an unqualified
"passes" in the audit for weeks while its fixture aborted before the first
assertion; the claim survived because nothing re-ran it and nobody expected to
have to. A one-time hand check ages into a belief. Treat these four as
statements about 2026-08-19, not about the code as it stands, until they are
written as assertions that run.

## Data exports

Two jobs back Admin → Exports:

| Job | Schedule | What it does |
|---|---|---|
| `run-exports` | every 5 minutes | Claims queued exports, builds them, writes them to the private `exports` bucket. |
| `expire-exports` | 03:17 daily | Deletes the file behind any export past its date and marks the row expired. |

`run-exports` claims a row by updating `queued` → `running` with `.eq("status",
"queued")`, so two overlapping runs cannot build the same export twice — the
second update matches nothing. A run killed mid-build leaves a row in
`running`; anything there for more than 30 minutes is put back on the next
pass.

`expire-exports` deletes the file **before** marking the row, so a failure
between the two leaves a row that is retried next pass against an object that
is already gone — which Storage treats as success. The other order would leave
files nothing points at.

The record outlives the file deliberately. After an incident the question is
who took a copy and how often it was fetched, and that answer has to survive
the copy being deleted.
