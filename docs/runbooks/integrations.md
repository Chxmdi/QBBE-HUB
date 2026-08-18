# Integrations runbook

Integrations are **staged deliberately** (spec Phases 4+). The UI shows
honest "Not connected" states until each is configured — no misleading
stubs (P0 §7.1).

## Transactional email (Unit 9)

Local Mailpit from `supabase start` (UI `:54324`, SMTP `:54325`) is enough to
complete the pipeline. Call:

```
POST /api/jobs/notification-email
Authorization: Bearer $CRON_JOB_SECRET
```

Set `CRON_JOB_SECRET` (and `CRON_SECRET` to the same value on Vercel so
platform cron sends the bearer header). Job routes skip login middleware.
Admin invitations always say **Invite recorded — email not sent** until a
production mail client is actually wired (`transactionalEmailIsLive()`).

## Gmail (gated)

Target design per GML-001..008. Do not mark done on stubs.

1. Create a Google Cloud project (QBBE-owned). Configure the OAuth consent
   screen (internal) and credentials with the **narrowest scopes**
   (`gmail.readonly` initially).
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
   manager. The endpoint verifies Google token integrity through tokeninfo plus
   its audience, account identity, and expiry before accepting a notification.
   The daily `gmail-watch-renew` job renews watches before expiry; the
   15-minute Gmail job walks every page of the stored Gmail history cursor.
   If Google expires that cursor, the job rebuilds the metadata mirror by
   walking every paginated Inbox listing before setting a new cursor. Do not
   put any value in browser-visible environment variables.

## Google Calendar overlay and linked meetings (P1-CAL-03)

Same OAuth start URL with `?provider=google_calendar`. Overlay rows live in
`calendar_event_link`. QBBE-created meetings and events create, update and
delete only their own linked Google event; Hub does not overwrite
attendee-managed fields. Events without an explicitly supplied end time default
to one hour, so the Hub and Google records have the same schedule.
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
and private Google links only; it never copies Drive file bytes. An initial
sync records a Drive start-page token before walking every page of the current
non-trashed file listing. Scheduled syncs consume every page of Drive's change
feed, update changed metadata, remove deleted/inaccessible links, and retain
the final page token. If Google invalidates a token, QBBE fetches a successful
full mirror before replacing the old one. Existing Drive connections must
reauthenticate to acquire the read-only Drive metadata scope.

## Volunteer Management System (gated)

Server-to-server only. Set `VMS_API_URL` (and `VMS_API_KEY`). Connect from
Admin. Store `user_profile.vms_id` — do not duplicate the volunteer database.
Disconnect clears VMS ids and does **not** delete Hub tasks.


## Health visibility

Admin → Integrations shows each provider's connection status and last sync
from `integration_connection`. Failures must set an actionable non-connected status and
`last_error` so admins can see and act (P0-ADM-04).

## Scheduled reminders

The hourly `/api/jobs/reminders` cron uses the same `CRON_JOB_SECRET` as the
other workers. It creates idempotent in-app/email-eligible notifications for
assigned tasks and CRM follow-ups due today or overdue, plus daily reminders
for past-deadline announcements that still require acknowledgement. Keys are
scoped to the record, recipient, and day where repeat reminders are intended,
so retries and overlapping cron invocations cannot duplicate alerts. Execution
results are recorded in Admin → background jobs.
