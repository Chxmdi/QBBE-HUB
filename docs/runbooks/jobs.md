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
| `purge-job-history` | 06:00 | Trims `job_run` and `email_delivery` past retention. |

The digest runs hourly rather than at a fixed time on purpose: each recipient's
`notification_preference.timezone` and `digest_hour` decide whether this tick is
theirs, so 8am stays 8am across a daylight-saving change and across zones.

## Delivery guarantees

pgmq is **at-least-once**. Exactly-once *effects* come from the handlers:

- Every message resolves to a `dedupe_key`. `email_delivery` has a unique index
  on it, so a re-delivered message finds the existing row and continues it
  rather than sending a second copy.
- Nothing is acknowledged before its outcome is written. A worker killed
  mid-send leaves the message on the queue with the ledger row still `sending`;
  the visibility timeout re-delivers it and the attempt resumes.
- A retryable failure (network, 429, 5xx) is left on the queue — the visibility
  timeout is the backoff. A permanent one (bad address, 4xx) is archived
  immediately rather than burning attempts.
- After `max_attempts`, the message is archived to the dead-letter table and
  the ledger row is marked `failed`. Both are visible in Admin → Jobs.

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

`google-sync`, `gmail-watch-renew` and `vms-sync` reach outside the Hub. Two
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

**Admin → Email** is the delivery ledger — every attempt including suppressions,
filterable by status, with the provider's own reason on anything that bounced.

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
| Five failures dead-letter and mark the row failed | `tests/unit/drain-notifications.test.ts` |
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
