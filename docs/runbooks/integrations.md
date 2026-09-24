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
Admin invitations always say **Invite recorded — email not sent** until a
production mail client is actually wired (`transactionalEmailIsLive()`).

## Gmail (gated)

Target design per GML-001..008. Do not mark done on stubs.

1. Create a Google Cloud project (QBBE-owned). Configure the OAuth consent
   screen (internal) and credentials with the **narrowest scopes**
   (`gmail.readonly` + `gmail.send`; Hub does not request `gmail.modify`).
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_OAUTH_REDIRECT_URI` (`/api/integrations/google/callback`).
3. Connect from Inbox or Admin. Tokens live in `integration_secret` (no
   authenticated SELECT). Disconnect removes list ability.
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
write or cancellation fails, Hub preserves the local record/link and marks the
organizer's connection `degraded` with an actionable error in Admin →
Integrations. Until credentials exist the calendar stays Hub-only.

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

## Workstream 6 live gate

`scripts/verify-integrations.sh` refuses to run until QBBE-owned
`QBBE_SENDER_DOMAIN`, `QBBE_GOOGLE_CLIENT_ID`, `QBBE_VMS_BASE_URL` and
`QBBE_TEST_RECIPIENT` are set. Do not substitute personal accounts. When those
values exist, prove INT-EMAIL, INT-GMAIL, INT-CALENDAR, INT-DRIVE and INT-VMS
against authorized recipients and record the dated run in
`docs/acceptance-matrix.md`.
