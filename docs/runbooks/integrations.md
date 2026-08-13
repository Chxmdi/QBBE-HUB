# Integrations runbook

Integrations are **staged deliberately** (spec Phases 4+). The UI shows
honest "Not connected" states until each is configured — no misleading
stubs (P0 §7.1).

## Gmail (Phase 4)

Target design per GML-001..008:

1. Create a Google Cloud project (QBBE-owned). Configure the OAuth consent
   screen (internal) and credentials with the **narrowest scopes**
   (`gmail.readonly` initially).
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_OAUTH_REDIRECT_URI` in the server environment.
3. Implement the OAuth flow server-side; store refresh tokens encrypted in
   `integration_connection` (never sent to the browser).
4. Use Gmail `watch` + Pub/Sub for change notification, the history cursor
   for deltas, daily watch renewal, and idempotent sync keyed on message
   IDs.
5. Disconnect must revoke tokens and stop sync while retaining allowed
   linkage records.

## Google Calendar (Phase 4)

Same OAuth infrastructure; overlay events read-only first. Store
`calendar_event_link` references, not copies.

## Volunteer Management System (Phase 4)

Server-to-server only. Store external volunteer IDs and minimal display
data. The volunteer system stays the source of truth for identity,
availability, and attendance (§10.4).

## Transactional email (Phase 4)

Choose a provider (e.g. Resend/Postmark) with a verified QBBE sender
domain. Set `EMAIL_PROVIDER_API_KEY` and `EMAIL_FROM_ADDRESS`. Deliver only
critical categories initially (assignments, critical announcements) with
the notification record as the source and `notification_delivery` for
retry metadata (NTF-002).

## Health visibility

Admin → Integrations shows each provider's connection status and last sync
from `integration_connection`. Failures must set `status='error'` and
`last_error` so admins can see and act (P0-ADM-04).
