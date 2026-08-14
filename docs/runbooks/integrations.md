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

## Google Calendar overlay (P1-CAL-03)

Same OAuth start URL with `?provider=google_calendar`. Overlay rows live in
`calendar_event_link`. Until credentials exist the calendar stays Hub-only.

## Volunteer Management System (gated)

Server-to-server only. Set `VMS_API_URL` (and `VMS_API_KEY`). Connect from
Admin. Store `user_profile.vms_id` — do not duplicate the volunteer database.
Disconnect clears VMS ids and does **not** delete Hub tasks.


## Health visibility

Admin → Integrations shows each provider's connection status and last sync
from `integration_connection`. Failures must set `status='error'` and
`last_error` so admins can see and act (P0-ADM-04).
