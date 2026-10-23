# Integrations runbook

Integrations are **staged deliberately** (spec Phases 4+). The UI shows
honest "Not connected" states until each is configured — no misleading
stubs (P0 §7.1).

## Transactional email (Unit 9)

Local Mailpit from `supabase start` (UI `:54324`, SMTP `:54325`) is enough to
complete the pipeline. Call:

```
POST /api/jobs/drain-notifications
x-job-secret: $CRON_JOB_SECRET
```

The header is `x-job-secret`, not `Authorization: Bearer` — the route reads
only the former, so a bearer request is refused before the job name is even
looked at. Set `CRON_JOB_SECRET`; there is no second secret. Job routes skip
login middleware.
Invitation emails go out through the same transport as every other email
(`activeTransport()`): the provider when `EMAIL_PROVIDER_API_KEY` is set,
otherwise SMTP when `SMTP_HOST` is set. With neither, nothing is sent: Admin,
Invitations says so, and the administrator gets the invitation link to pass
on themselves.

## Gmail (gated)

Target design per GML-001..008. Do not mark done on stubs.

1. Create a Google Cloud project (QBBE-owned). Configure the OAuth consent
   screen (internal) and credentials with the **narrowest scopes**
   (`gmail.readonly` + `gmail.send`; Hub does not request `gmail.modify`).
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_OAUTH_REDIRECT_URI` (`/api/integrations/google/callback`).
3. Connect from Inbox or Admin. Tokens live in `integration_secret`,
   encrypted with `GOOGLE_TOKEN_KEY` (see "Google token key" below); no API
   role can read them. Disconnecting deletes them and asks Google to revoke
   them.
4. Sync is idempotent on Gmail message ids; metadata only (SEC-006).
5. For push synchronization, create a Pub/Sub topic in the **same Google Cloud
   project** as the OAuth client, grant Gmail publisher access as required by
   Google, and configure a push subscription to
   `https://<host>/api/integrations/gmail/push`, enable **authenticated push**,
   and configure a dedicated push service account and this exact endpoint as
   its OIDC audience. Set `GOOGLE_GMAIL_PUBSUB_TOPIC`,
   `GOOGLE_GMAIL_PUBSUB_AUDIENCE`, and
   `GOOGLE_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL` in the deployment's secret
   manager. The endpoint verifies Google's OIDC issuer, token integrity through
   tokeninfo, exact audience, service-account identity, verified email and expiry
   before accepting a notification. Accepted pushes persist the pending Gmail
   history id, enqueue durable work on the integrations queue and trigger the
   `gmail-push-sync` worker after the response. A one-minute scheduled run is
   the recovery path if the web process ends before that immediate worker starts.
   The daily `gmail-watch-renew` job renews watches before expiry; the
   15-minute `google-sync` job remains periodic reconciliation for pushes that
   Google delays or drops. Both paths share the same durable history-cursor
   reconciliation. If Google expires that cursor, Hub first fetches a complete
   Inbox mirror and then removes stale local metadata, so a transient provider
   failure cannot erase the last known good state. Do not put any value in
   browser-visible environment variables.

## Google token key

Gmail, Calendar and Drive tokens are encrypted before they are stored, with a
key only the server holds: the `GOOGLE_TOKEN_KEY` setting in each
environment's `APP_ENV` secret (32 random bytes in base64). The key is never
in the database or the repository, so a database copy alone opens no Google
account. A deployed server refuses to start without a valid key, and the
deploy refuses an `APP_ENV` without one. When a token is deleted
(disconnect, a member deactivated, a connection removed), the
`google-token-upkeep` job (every 5 minutes) asks Google to revoke it and
records the outcome in the audit log (`google_token_revoked` or
`google_token_revoke_failed`).

**Make a key** (owner step, once per environment; never reuse one between
staging and production):

1. On a trusted computer run:
   ```bash
   openssl rand -base64 32
   ```
   **You should see** one line of 44 characters ending in `=`.
2. In GitHub, open **Settings → Environments → staging** (or **production**)
   → **APP_ENV** → **Update secret**, and add a line
   `GOOGLE_TOKEN_KEY=` followed by that value. Save, and store the value in
   the password manager entry for that environment.
3. Run the **Deploy** workflow for that environment. **You should see** the
   deploy pass its environment check and the site start. If the deploy stops
   with "APP_ENV ... needs a GOOGLE_TOKEN_KEY", the line is missing or the
   value is not 44 base64 characters: repeat step 2.
4. Tokens stored before encryption are sealed by the next upkeep run. **You
   should see** in the SQL editor that
   ```sql
   select count(*) from public.integration_secret
   where access_token !~ '^enc:v1:' or refresh_token !~ '^enc:v1:';
   ```
   returns `0` within ten minutes of the deploy.

**Rotate the key** (owner step; for example after someone who held it
leaves):

1. Make a new key as above.
2. In the environment's `APP_ENV`, rename the current line to
   `GOOGLE_TOKEN_KEY_PREVIOUS=` (same value) and add the new value as
   `GOOGLE_TOKEN_KEY=`. Deploy.
3. Wait for the upkeep job to reseal every token (one batch of 200 every five
   minutes). In the SQL editor, with the first 8 characters of the new key's
   SHA-256 (`printf '%s' '<new key>' | base64 -d | sha256sum | cut -c1-8`):
   ```sql
   select count(*) from public.integration_secret
   where access_token not like 'enc:v1:<those 8 characters>:%';
   ```
   **You should see** `0`.
4. Remove the `GOOGLE_TOKEN_KEY_PREVIOUS` line and deploy again. Delete the
   old value from the password manager.

**If the key is lost**, the stored tokens cannot be opened: everyone
reconnects Gmail, Calendar and Drive. Revocations still queued are recorded
as `unreadable`; revoke those grants from the Google Workspace admin console
if needed. A database restored into a new project keeps working only with
the same key.

## Google Calendar overlay and linked meetings (P1-CAL-03)

Same OAuth start URL with `?provider=google_calendar`. Overlay rows live in
`calendar_event_link`. QBBE-created meetings and events create, update and
delete only their own linked Google event; Hub does not overwrite
attendee-managed fields. Hub-owned events use a deterministic Google event id,
so a retry after Google accepted a create but before Hub persisted the link
converges on the same remote event instead of duplicating it. A 409 create
conflict is reconciled with PATCH, and an update that discovers a remotely
deleted event (404) clears the stale link and recreates it. Events without an
explicitly supplied end time default to one hour, so the Hub and Google records
have the same schedule.
The scheduled sync performs a paginated initial mirror, stores Google's
server-only sync token, and then requests only incremental changes. Cancelled
external overlays are removed without touching Hub-authored links. If Google
expires a token, the worker clears only generic overlays and rebuilds the
mirror before persisting a replacement token.
Existing connections must reauthenticate because the required scope is now the
narrow `https://www.googleapis.com/auth/calendar.events` write scope. If a
write or cancellation fails, Hub preserves the local record/link and records
the organizer's connection status by cause, with the error, in Admin →
Integrations: revoked or expired consent reads **Authentication expired**
(reconnect Calendar), a Google outage reads **Synchronization delayed** and
clears itself on the next successful `google-sync` run. A meeting or event
saved while Calendar was disconnected is pushed on its next edit after
reconnecting. Until credentials exist the calendar stays Hub-only.

## Google Drive metadata mirror

Use the OAuth start URL with `?provider=google_drive`. QBBE imports metadata
and private Google links only; it never copies Drive file bytes or changes
Google permissions. Imported rows are `visibility = private` and owned by the
connected Hub user, so merely connecting a personal/QBBE Drive account cannot
make its metadata visible to unrelated organization members. Wider QBBE access
must come from an explicit QBBE-owned document/link workflow and normal record
authorization, not from stale Google metadata.

An initial sync records a Drive start-page token before walking every page of
the current non-trashed file listing. Scheduled syncs consume every page of
Drive's change feed, update changed metadata, remove deleted/inaccessible links,
and retain the final page token. Full reconciliation is fail-safe: the provider
read and replacement upserts succeed before stale local rows are pruned, so a
provider/database failure cannot empty the last known mirror. If Google
invalidates a token, QBBE performs that same safe full reconciliation. Existing
Drive connections must reauthenticate to acquire the read-only Drive metadata
scope.

## Volunteer Management System (gated)

Server-to-server only. Set `VMS_API_URL` (and `VMS_API_KEY`). Connect from
Admin only after the endpoint returns a recognized identity/assignment envelope.
Admins explicitly link active Hub members to external VMS identities through the
Members table. Hub stores `user_profile.vms_id`, availability and sync timestamp,
plus minimal `vms_assignment_reference` rows for VMS-owned assignments.

The VMS remains authoritative: assignment references never create, update,
complete or delete QBBE Hub tasks. A full assignment snapshot reconciles removed
external references; an identity-only response does not wipe prior assignments.
Malformed payloads, provider outages and revoked credentials degrade the
integration visibly. Disconnect clears VMS identity/assignment references and
does **not** delete Hub tasks or historical work.


## Zeffy (read only)

QBBE's donations, event tickets, memberships and shop orders come in from
Zeffy's public API (`https://api.zeffy.com/api/v1`, reference at
<https://www.zeffy.com/api/docs>). The Hub only reads: nothing is written back
to Zeffy and nothing is posted to the ledger.

**What lands where.**

- Everyone with a completed payment becomes a CRM contact (`crm_contact`,
  `source = 'zeffy'`), or is linked to the existing contact with the same
  email when exactly one contact has it. When several contacts share the
  email, nothing is guessed: the supporter waits in `zeffy_contact_match` for
  staff to choose. A contact entered in the Hub keeps its own name and email;
  Zeffy updates only the contacts it created.
- `crm_contact.zeffy_kinds` says what each supporter did (donor, ticket,
  member, shop, recurring, ...), with no amounts; staff see it.
- Payments go to `zeffy_payment` (amounts in cents, refunds, disputes,
  recurring donations, fund, receipt link). Only finance readers (admins with
  MFA, named ledger readers, the accountant) read them, as with gifts.
- Campaigns go to `zeffy_campaign` (goal, amount raised, dates); staff read
  them, since Zeffy publishes them anyway.
- Not kept: postal addresses, answers to checkout and ticket questions, card
  details, discount codes and tribute names.

**Settings** (in the environment's `APP_ENV`): `ZEFFY_API_KEY` (Zeffy,
Settings, Integrations, API; organization owner only) and
`ZEFFY_WEBHOOK_SECRET` (the webhook's signing secret, `whsec_...`). Point the
Zeffy webhook at `https://<site>/api/integrations/zeffy/webhook`. Then Admin,
Integrations, Zeffy, **Connect**: the key is checked with one read and the
first copy starts at once. One Zeffy account connects to one Hub organization.

**Staging holds no real supporters.** Connect staging to a separate, free test
Zeffy organization, and the real QBBE account to production only.

**How it stays current.**

- `zeffy-sync` (every 15 minutes) reads payments created since its last
  complete pass (with a day of overlap), changed contacts, campaigns hourly,
  and once a day re-reads the last 120 days of payments, because a refund or
  dispute changes an old payment. Each run stays under 60 requests (Zeffy
  allows 100 a minute per organization) and saves its place after every page,
  so the first copy of a large account takes several runs and a 429 only
  pauses it.
- The webhook verifies `Zeffy-Signature` (HMAC-SHA256 over `"{t}.{body}"`,
  five-minute tolerance) before reading anything, records each event once by
  Zeffy's event id (Zeffy retries for up to three days with the same id), saves
  a completed payment at once and leaves id-only events to `zeffy-events`,
  which reads the current state from Zeffy.
- **Disconnect** stops both jobs and keeps what was copied. **Sync now**
  runs the sync at once (12 an hour).

**CRM screens** (Relationships, staff only; volunteers are turned away):

- **Supporters** (`/crm/supporters`) lists every CRM contact, from Zeffy or
  entered in the Hub, with search and filters by activity (donor, ticket
  buyer, member, ...) and source. Finance readers also see each supporter's
  net giving and an **Export giving (CSV)** link.
- **A supporter** (`/crm/contacts/<id>`) shows their Zeffy activity
  (campaign, date, what they did, refunds and disputes), the CRM
  interactions recorded with them, and a link to a CRM organization. Finance
  readers also see each amount, the Zeffy tax receipt and a giving summary.
- **Zeffy** (`/crm/zeffy`) shows the connection and last copy, campaigns
  against their goals with a link to each in Zeffy, ticket counts per event
  for 30 days, 90 days or 12 months, and **Needs matching**: Zeffy supporters
  whose email several contacts share, for staff to place (one of those
  contacts, or a new one). Finance readers also see money raised in the
  period and this year, by kind of campaign, active recurring donors and
  their monthly total, lapsed donors (last gift 12 to 24 months ago),
  refunds, and disputes waiting for a response.
- Amounts come only through the database functions
  `zeffy_supporter_totals`, `zeffy_supporter_activity` and `zeffy_overview`,
  which return them to finance readers only. Every view of a supporter's
  giving and every export is recorded in the audit log
  (`supporter_list_viewed`, `supporter_giving_viewed`,
  `supporter_list_exported`), and so is each placement (`supporter_matched`).

**Trying it locally** without a Zeffy account: `node scripts/qa/zeffy-mock.mjs
serve`, run the Hub with `ZEFFY_API_KEY=mock-key
ZEFFY_API_BASE_URL=http://127.0.0.1:4010`, connect in Admin, and send signed
webhooks with `node scripts/qa/zeffy-mock.mjs send payment.completed pay-new`.

## Health visibility

Admin → Integrations shows each provider's connection status and last sync
from `integration_connection`. Failures must set an actionable non-connected status and
`last_error` so admins can see and act (P0-ADM-04).

## Scheduled reminders

The daily `/api/jobs/due-date-reminders` job (12:00 UTC) uses the same
`CRON_JOB_SECRET` as the other workers. It creates idempotent in-app/email-eligible notifications for
assigned tasks and CRM follow-ups due today or overdue, plus daily reminders
for past-deadline announcements that still require acknowledgement. Keys are
scoped to the record, recipient, and day where repeat reminders are intended,
so retries and overlapping cron invocations cannot duplicate alerts. Execution
results are recorded in Admin → background jobs.

## Keeping test mail away from real people

Every non-production environment must set `EMAIL_RECIPIENT_ALLOWLIST` to the
authorized test addresses and/or `@domain` entries (for example
`tester@qbbe.org,@qbbe.org`). With it set, the notification worker records any
other recipient as `suppressed` with reason `recipient_not_allowlisted`, visible
in Admin → Email, and `sendEmail` refuses them as a backstop. Admin → Email
shows a notice while the allowlist is active. Leave it unset only in production.

It covers notification mail and digests, which go through the Hub's email
worker. Password-recovery mail is sent by Supabase Auth itself, so on staging
point Supabase Auth's SMTP at a sandbox or restrict its recipients separately.

## Bounces and spam complaints

Resend reports hard bounces and complaints after a send has succeeded. To
receive them:

1. In Resend, open **Webhooks**, click **Add Endpoint**, enter
   `https://<domain>/api/integrations/email/webhook`, and subscribe to
   `email.bounced` and `email.complained`.
2. Copy the endpoint's signing secret (it starts with `whsec_`) into the
   hosting environment as `EMAIL_WEBHOOK_SECRET`, then redeploy.
3. Use Resend's **Send test event**. The endpoint should answer 200. A 401
   means the secret does not match; a 503 means it is not set.

A hard bounce or complaint marks the delivery `bounced` in Admin → Email and
adds the address to `email_suppression`; the worker then records any later
mail to it as suppressed (`provider_bounced` / `provider_complained`). A
transient (soft) bounce is recorded on the delivery but does not suppress the
address. Lifting a suppression is a deliberate database change by an operator.

## Workstream 6 live gate

`scripts/verify-integrations.sh` refuses to run until QBBE-owned
`QBBE_SENDER_DOMAIN`, `QBBE_GOOGLE_CLIENT_ID`, `QBBE_VMS_BASE_URL` and
`QBBE_TEST_RECIPIENT` are set. Do not substitute personal accounts. When those
values exist, prove INT-EMAIL, INT-GMAIL, INT-CALENDAR, INT-DRIVE and INT-VMS
against authorized recipients and record the dated run in
`docs/acceptance-matrix.md`.

The step-by-step procedure, with the result to expect at each step and the
evidence to record, is in `docs/runbooks/epic-06-live-verification.md`.
