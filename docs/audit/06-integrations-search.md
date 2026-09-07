# Domain audit — integrations (Gmail/Google), deep links, resources, search, resilience

<!-- progress: 18 of 26 assessed — IN PROGRESS -->

Requirement families in scope: `GML-001..008`, `P0-GML-01`, `P1-GML-02/03`,
`P0-LINK-01..05`, `P1-LINK-06/07`, `P0-RES-01/02`, `P1-RES-03/04`,
`P0-SRC-01/02`, `P1-SRC-03/04` — 26 IDs total.

All paths are relative to `/home/user/QBBE-HUB`. Nothing here was executed
against Google, Supabase Cloud or a browser: egress to `*.supabase.co` and to
Google APIs is blocked in this container, so every verdict is a code read
unless it names a test.

---

### GML-001 — Narrowest Google OAuth scopes, server-side tokens
**Verdict:** Partial
**Requirement:** OAuth requests the narrowest scopes that support the enabled Gmail
features; tokens are stored server-side and encrypted/protected; the browser never
receives a refresh token.
**Evidence:** Scopes are declared per provider in one place —
`src/app/api/integrations/google/start/route.ts:15-22`: Gmail gets
`gmail.modify gmail.send`, Calendar `calendar.events`, Drive
`drive.metadata.readonly`. The token exchange happens entirely in the server route
handler (`src/app/api/integrations/google/callback/route.ts:38-57`) and the response
is written straight to `integration_secret`
(`:82-90`); the browser only ever receives a 302 to `/inbox`, `/calendar` or
`/documents` (`:206-207`). `integration_secret` has RLS enabled with **INSERT and
UPDATE policies only and no SELECT policy**
(`supabase/migrations/0008_spec_delivery.sql:62-80`), so an `authenticated` client
cannot read a refresh token back; every server-side reader uses the service client
(`src/features/inbox/services/gmail.commands.ts:34`,
`src/features/jobs/services/handlers/google-sync.ts:45-49`). State is bound to the
signed-in user via an httpOnly cookie and re-checked on return
(`start/route.ts:40-48`, `callback/route.ts:22-33`).
**Gap:** Two. (a) **Tokens are stored in plaintext columns.** `access_token` /
`refresh_token` are bare `text` (`0008_spec_delivery.sql:53-60`) with no encryption
at rest beyond Postgres' own — while this same repository already uses Supabase Vault
for its job secrets (`supabase/migrations/20260819165607_jobs.sql:258-264, 336-346`),
so the pattern exists and was not applied here. "Protected" is satisfied by RLS;
"encrypted" is not. (b) **`gmail.modify` is wider than the enabled features need.**
Nothing in `src/` modifies a Gmail label, trashes, or marks read at Google —
`grep -rn "users/me/messages" src/` finds only `?format=full` reads
(`gmail.commands.ts:65`), the list/metadata reads (`gmail-sync.ts:174-210`) and
`/send` (`gmail.commands.ts:88`). `gmail.readonly` + `gmail.send` would cover
everything implemented; `gmail.modify` additionally grants write access to the whole
mailbox. There are also no RLS assertions for `integration_connection` or
`integration_secret` anywhere in `supabase/tests/rls.sql` (grep for `integration`
returns nothing), so the no-SELECT property is asserted only by reading the migration.

### GML-002 — integration_connection stores connection metadata
**Verdict:** Partial
**Requirement:** `integration_connection` records account identity, granted scopes,
status, last successful sync, last error, token metadata, and disconnect/revocation state.
**Evidence:** The table carries `external_account_id`, `scopes text[]`, `status`,
`last_sync_at`, `last_error`, `updated_at` and a `unique (organization_id, provider,
user_id)` (`supabase/migrations/0003_operations.sql:208-221`); status is constrained to
seven finite health states
(`supabase/migrations/20260818053213_integration_health_states.sql:3-13`) and set by a
shared classifier (`src/features/admin/services/integration-health.ts` via
`src/features/jobs/services/handlers/google-sync.ts:233`). Account identity is written
for Gmail from the Google profile (`callback/route.ts:102-106`). Token metadata lives
one table over: `token_expires_at`, `sync_cursor`, `gmail_history_id`,
`gmail_watch_expiration_at`, `gmail_last_push_at`
(`0008_spec_delivery.sql:53-60`, `20260818054754_gmail_push_watch_state.sql:3-7`).
**Gap:** (a) **`scopes` is never written.** `grep -rn "scopes" src/` returns nothing at
all — the column is dead, so the Hub cannot tell which grant a connection actually
holds, and cannot detect that a pre-`calendar.events` Calendar connection needs
re-consent (a case `start/route.ts:17-19` explicitly anticipates in a comment).
(b) **Account identity is Gmail-only** — `external_account_id` is set in the `gmail`
branch (`callback/route.ts:104`) and never for `google_calendar` or `google_drive`.
(c) There is no separate revocation state: disconnect reuses `status='disconnected'`
(see GML-006), so "revoked at Google" and "disconnected locally" are indistinguishable.

### GML-003 — Gmail watch + Pub/Sub, then history cursor
**Verdict:** Partial
**Requirement:** When production sync is enabled, use a Gmail watch plus Google Cloud
Pub/Sub for change notification, then use the Gmail history cursor to fetch the changes.
**Evidence:** All three pieces exist. The watch is created on connect when Pub/Sub is
configured (`src/app/api/integrations/google/callback/route.ts:120-126` →
`createGmailInboxWatch`, `src/features/inbox/services/gmail-sync.ts:71-85`, which posts
to `users/me/watch` with `labelIds:["INBOX"]`). The push endpoint verifies the Pub/Sub
OIDC token against `tokeninfo` and checks audience, service-account email, verified flag
and expiry before parsing (`src/app/api/integrations/gmail/push/route.ts:7-26`,
`gmail-sync.ts:19-31`), and the envelope parser rejects malformed payloads
(`gmail-sync.ts:41-55`). The history cursor is real: `fetchGmailHistory`
(`gmail-sync.ts:87-112`) pages `users/me/history` from `startHistoryId`, dedupes ids
across all five history event variants (`gmailHistoryMessageIds`, `:129-144`), and
treats HTTP 404 as "cursor expired; a full synchronization is required"
(`:100`), which `google-sync.ts:100-110` catches and turns into a full re-fetch.
**Gap:** **The push notification drives nothing.** The endpoint writes
`gmail_pending_history_id` and `gmail_last_push_at`
(`push/route.ts:45-47`) and no code ever reads them as a trigger: `google-sync.ts:47`
selects `gmail_pending_history_id` and then only ever *clears* it (`:97`, `:107`,
`:116`); `grep -rn "gmail_pending_history_id" src/` shows no branch on its value. So
mailbox changes are still picked up by the 15-minute poll
(`supabase/migrations/20260820170000_register_integration_jobs.sql:19-21`) exactly as
they would be with no Pub/Sub at all — the notification arrives, is recorded, and is
discarded. The "efficient change notification" half of the requirement is wired but inert.

### GML-004 — Proactive watch renewal and reconciliation
**Verdict:** Complete
**Requirement:** Gmail watches are renewed proactively at least daily with expiration
tracked, and periodic reconciliation exists because pushes can be delayed or dropped.
**Evidence:** `src/features/jobs/services/handlers/gmail-watch-renew.ts:18-94` loads
every connected Gmail connection, renews when
`gmailWatchNeedsRenewal(gmail_watch_expiration_at)` is true — a full day of lead time
(`gmail-sync.ts:7, 34-38`, and a null/unparseable expiry returns `true`, so an unknown
state renews rather than silently lapsing) — refreshes the access token first if it is
within 60s of expiry (`:44-57`), and preserves the existing cursor across renewal
(`:62`, `gmail_history_id: secret.gmail_history_id ?? watch.historyId`) so renewal
cannot skip unprocessed changes. Expiration is persisted on both connect and renewal
(`callback/route.ts:131`, `gmail-watch-renew.ts:63`). Scheduled daily at 07:00 UTC via
pg_cron (`supabase/migrations/20260820170000_register_integration_jobs.sql:23-25, 32-45`).
Reconciliation is the `google-sync` job every 15 minutes (`:19-21`), which is
history-cursor driven and independent of any push. Failures classify the connection
status and record a `background_job_run` row (`gmail-watch-renew.ts:74-87`).
Renewal-window logic is unit-tested at
`src/features/inbox/tests/gmail-ingest.test.ts` (`gmailWatchNeedsRenewal` cases).
*Note:* the whole handler no-ops when the three Pub/Sub env vars are unset
(`gmail-watch-renew.ts:19-23`), which is correct — with no watch there is nothing to
renew — but it means the renewal path is only live in a deployment that configures Pub/Sub.

### GML-005 — Idempotent sync processing
**Verdict:** Complete
**Requirement:** Repeated Pub/Sub delivery or retries must not create duplicate
external-message records.
**Evidence:** Duplicate suppression is enforced by the database, not by application
logic: `gmail_message` carries `unique (user_id, external_id)`
(`supabase/migrations/0008_spec_delivery.sql:105`) and every writer is an upsert on
exactly that constraint — `google-sync.ts:72-80`
(`{ onConflict: "user_id,external_id" }`) and `callback/route.ts:109-117`. The same
shape protects the other two providers: `calendar_event_link` has
`unique (user_id, external_id)` (`0008_spec_delivery.sql:131`) with matching
`onConflict` (`google-sync.ts:123-131`), and Drive documents have a unique index on
`(integration_connection_id, external_id)`
(`supabase/migrations/0013_drive_document_upsert_constraint.sql:7`) with matching
`onConflict` (`google-sync.ts:170-186`). Repeated push delivery is inherently harmless
because the push endpoint only writes a scalar cursor
(`push/route.ts:45-47`) — it does no ingestion. The Gmail history reader also dedupes
message ids across the five history event variants before fetching
(`gmail-sync.ts:129-144`), so one changed message produces one row per run, and
`fetchGmailChangedMetadata` separates removals from upserts (`gmail-sync.ts:161-172`).

### GML-006 — Disconnect removes/revokes credentials and stops sync
**Verdict:** Partial
**Requirement:** Disconnecting removes or revokes usable credentials and stops future
sync, while preserving only the linkage data QBBE is entitled to keep.
**Evidence:** `disconnectIntegration`
(`src/features/admin/services/integration.commands.ts:8-72`) sets
`status='disconnected'`, clears `last_error`/`last_sync_at`, then deletes the mirrored
data for the provider — `gmail_message` rows (`:34`), `calendar_event_link` rows
(`:37`), Drive-sourced `document` rows for that connection (`:40-49`) — and writes an
`audit_event` (`:58-65`). Sync genuinely stops: every background reader filters
`.eq("status", "connected")` — `google-sync.ts:33`, `gmail-watch-renew.ts:28`,
`push/route.ts:41` — as does the interactive path (`gmail.commands.ts:37`), so a
disconnected connection cannot be read, synced, or sent from.
**Gap:** **The credentials are not removed and not revoked.** Nothing deletes the
`integration_secret` row — `grep -rn "integration_secret" src/features/admin/` returns
nothing, and `disconnectIntegration` never touches it — so the access token and the
long-lived refresh token stay in the database indefinitely after the user disconnects,
and are re-armed by a single `status` flip. Nor is anything sent to Google:
`grep -rni "revoke" src/` finds only invitation revocation; there is no call to
`https://oauth2.googleapis.com/revoke`, so the Hub's grant remains live in the user's
Google account. The Gmail *watch* is also never stopped (`users/me/stop` is never
called), so Google keeps publishing to the Pub/Sub topic until the watch lapses.
The deletion half — dropping the mirror while keeping nothing — is done correctly;
the credential half is not done at all.

### GML-007 — Linking an email to a project/program/CRM record
**Verdict:** Missing
**Requirement:** Linking an email to a project, program or CRM record stores a stable
external reference plus selected metadata, rather than duplicating mailboxes.
**Evidence:** The metadata-not-bodies half is right: `gmail_message`
(`supabase/migrations/0008_spec_delivery.sql:92-105`) stores only
`external_id`, `thread_id`, `subject`, `snippet`, `from_address`, `received_at` —
explicitly "not full bodies — SEC-006" (`:90`) — and bodies are fetched on demand and
never persisted (`src/features/inbox/services/gmail.commands.ts:60-74`). But there is
**no link at all**: `gmail_message` has no `program_id`, `project_id`, `task_id`,
`crm_organization_id`, `crm_contact_id`, `meeting_id` or `event_id` column, no join
table references it (`grep -rn "gmail_message" supabase/migrations/*.sql` returns only
its own definition and one policy rewrite), and no command in `src/` writes any linkage
— the only `gmail_message` writers are the two sync upserts and the disconnect delete
(`google-sync.ts:72`, `callback/route.ts:109`, `integration.commands.ts:34`). The Inbox
mail pane offers read, select and reply only
(`src/app/(workspace)/inbox/page.tsx:150-195`); there is no "link to project" control.
**Gap:** Everything. This also means the sibling requirement P0-INB-03
(program/project linkage for an email) has no implementation for the Gmail source.
A migration is needed before any of it can be built.

### GML-008 — Send/reply added with separate permission, confirmation, logging
**Verdict:** Partial
**Requirement:** If send/reply is enabled, it comes with separate permission/scopes,
draft confirmation, delivery logging and failure handling — not a silent widening of
the original read permissions.
**Evidence:** Send *is* enabled (`sendGmailMessage`,
`src/features/inbox/services/gmail.commands.ts:79-97`). Of the four required
safeguards, two are present. *Separate scope:* `gmail.send` is requested as a distinct
scope alongside `gmail.modify` (`src/app/api/integrations/google/start/route.ts:16`),
and both the connection check and the Gmail 4xx path tell the user to "reconnect Gmail
and grant send permission" (`gmail.commands.ts:38`, `:92`). *Delivery logging:* every
successful send writes an `audit_event` with
`action: "gmail_message_sent"` and a `reply` flag (`:94`). *Failure handling:* a
non-OK Gmail response becomes a returned `ActionResult` error surfaced as a toast
(`:92, :97`, `src/features/inbox/components/gmail-reply-form.tsx:18`), and input is
zod-validated before any network call (`:76, :80-81`).
**Gap:** (a) **No separate permission.** Any signed-in user with a connected Gmail
account can send; there is no role check, no feature flag and no admin toggle in
`sendGmailMessage` — it is gated only by `requireSession()` (`gmail.commands.ts:33`).
Since the scope is granted per-user at connect time, the OAuth consent is the *only*
gate, which is exactly the "silently expanding" shape the requirement warns against.
(b) **No draft confirmation.** `gmail-reply-form.tsx:14-20` sends on submit with no
review, preview or confirm step, and no draft is persisted — a mis-click sends.
(c) Only *reply* exists; forward and new-compose do not (see P1-GML-02). (d) The audit
row records that a send happened but not to whom or with what subject
(`gmail.commands.ts:94`), so "delivery logging" cannot answer what was sent.

### P0-GML-01 — Secure Gmail connection
**Verdict:** Partial
**Requirement:** Scoped OAuth, server-side token storage, visible account/sync status,
and a disconnect/revoke path.
**Evidence:** Scoped OAuth and server-side storage as under GML-001
(`src/app/api/integrations/google/start/route.ts:15-22`,
`callback/route.ts:82-97`, `supabase/migrations/0008_spec_delivery.sql:62-80`). Sync
status is genuinely surfaced and honest: the Inbox mail pane shows last sync time and
`last_error` with a "Reconnect required" line
(`src/app/(workspace)/inbox/page.tsx:211-224`) and, when Google is not configured at
all, says so rather than rendering a fake inbox (`:110-114`); the Admin integration
card shows a classified health badge, last-sync time and last error
(`src/app/(workspace)/admin/page.tsx:346-388`). A disconnect control exists
(`src/features/admin/components/integration-actions.tsx` →
`disconnectIntegration`). Connect is refused with a 503 and an actionable message when
the three env vars are unset (`start/route.ts:26-34`).
**Gap:** (a) **Account identity is never shown.** `external_account_id` is stored
(`callback/route.ts:104`) but neither the Inbox query
(`inbox/page.tsx:49-54`, selects `status, last_sync_at, last_error`) nor the Admin
query (`admin/page.tsx:137-138`, same three columns) asks for it, so a user cannot see
*which* Google account is connected — the requirement asks for "account/sync status"
and only the sync half is displayed. (b) The revoke half of "disconnect/revoke" is
absent (see GML-006): no token deletion, no Google revoke call, no watch stop.
(c) Minor: the Admin card keys connections by provider alone
(`admin/page.tsx:162-164`) while Gmail connections are per-user, so an org admin —
whose `integration_admin` policy returns every user's row
(`supabase/migrations/20260818081500_scope_crm_reporting_integration_policies_to_organization.sql:31-35`)
— sees an arbitrary colleague's Gmail status on their own admin card.

### P1-GML-02 — Threading and send
**Verdict:** Partial
**Requirement:** Reply/forward/send are functional with clear account identity, thread
context, attachment controls and failure handling; no misleading stubs.
**Evidence:** Reply works and is genuinely threaded: `sendGmailMessage` passes Gmail's
`threadId` and sets both `In-Reply-To` and `References` from the source message's
`Message-ID` header (`src/features/inbox/services/gmail.commands.ts:86, 90`), which the
detail fetch extracts (`:69`) and the form forwards (`gmail-reply-form.tsx:16`,
`src/app/(workspace)/inbox/page.tsx:193`). Subject is prefixed `Re:` once, not
repeatedly (`gmail-reply-form.tsx:16`). Failure handling is real (see GML-008), and
there are no misleading stubs — a disconnected or unconfigured Gmail renders an
explicit empty state (`inbox/page.tsx:106-120`) rather than a fake mailbox.
**Gap:** Three of the five named capabilities are absent. **Forward** does not exist
(no code path constructs a forwarded message; `sendGmailMessage` takes a single `to`).
**Compose/new send** does not exist in the UI — `GmailReplyForm` is the only caller and
it is always seeded from a selected message (`inbox/page.tsx:193`). **Attachment
controls** do not exist: the MIME body is hard-coded single-part
`Content-Type: text/plain` (`gmail.commands.ts:85`), there is no multipart branch and
no attachment input; incoming attachments are neither listed nor downloadable
(`getGmailMessageDetail` returns plain text only, `:71`). **Account identity is not
shown** in the compose surface (see P0-GML-01) — the reply form displays no "from"
address, so a user with several Google accounts cannot tell which one will send.
There is also no `Cc`/`Bcc` and no thread view: the Inbox lists flat messages ordered
by `received_at` (`inbox/page.tsx:57-61`) despite `thread_id` being stored.

### P1-GML-03 — Label awareness
**Verdict:** Missing
**Requirement:** Optional read-only or managed Gmail label synchronization, where
scopes and policy allow.
**Evidence:** No label is ever stored or shown. `gmail_message`
(`supabase/migrations/0008_spec_delivery.sql:92-105`) has no `labels` column, and
`GmailHubRow` (`src/features/inbox/services/gmail-ingest.ts`) carries no label field —
`fetchGmailMessageMetadata` reads `labelIds` from Google solely to *discard* non-INBOX
messages (`src/features/inbox/services/gmail-sync.ts:154-155`) and then drops the
array. The other three `label` matches in the inbox feature are the INBOX filter on
watch/history (`gmail-sync.ts:75, 98`) and the `labelsAdded`/`labelsRemoved` history
variants, which are used only as change *signals* (`:118-119, 136-137`), never read for
their content. Nothing writes labels back to Google.
**Gap:** Entirely absent, and it needs schema (a labels column or table) first. Note
the granted scope already permits both directions — `gmail.modify`
(`src/app/api/integrations/google/start/route.ts:16`) allows managed label writes — so
the Hub is currently holding a wider scope than the features it actually ships (see
GML-001), and this is the requirement that would have justified it.

### P0-LINK-01 — Project/program channels with a back-link
**Verdict:** Complete
**Requirement:** A program or project may have a linked primary channel, and the channel
header visibly links back to the source record.
**Evidence:** `channel` carries `program_id`, `project_id` and `event_id`
(`supabase/migrations/0002_communication.sql:28-30`), and the link is established
automatically rather than left to a form: creating a project inserts a
`type: "project"` channel with `project_id` and the inherited `program_id`, plus a
manager membership with `membership_source: "project"`
(`src/features/projects/services/project.commands.ts:59-82`); creating a program does
the same with `type: "program"` (`:420-441`). The channel header renders the back-links
under an explicit comment — "P0-LINK-01: links back to source record" —
`src/app/(workspace)/channels/[id]/page.tsx:112, 128-143` ("View linked project →",
"View linked program →"), reading the ids selected at `:41`.
*Caveat, not a gap against the wording:* the manual **Create channel** dialog never
sends `projectId`/`programId` — `createChannel` accepts both
(`src/features/channels/services/channel.commands.ts:18-19, 44-45`) but
`src/features/channels/components/channel-create-dialog.tsx:22-28` posts only name,
purpose, privacy, type and posting policy — so a hand-made channel cannot be attached
to a record after the fact, and nothing marks one channel as *primary* when a project
has several. The requirement's "done when" is met by the auto-created channel.

### P0-LINK-02 — Message → task with source link and quoted context
**Verdict:** Partial
**Requirement:** An authorized user can convert a message/thread into a task, preserving
a source link and quoted context, without duplicating content the reader cannot access.
**Evidence:** `convertMessageToTask`
(`src/features/channels/services/message.commands.ts:414-463`) reads the message through
RLS so an inaccessible message cannot be converted (`:420-427`), inherits
`project_id`/`program_id` from the channel, stores the durable source link
`source_message_id` — a real FK (`supabase/migrations/0002_communication.sql:102-105`) —
quotes the body into the description (`:439`) and records an `activity_event` (`:451-459`).
Wired to the message overflow menu at
`src/features/channels/components/message-item.tsx:226-233`.
**Gap:** **The quoted context escapes the message's audience, which is the one thing the
requirement names.** Message visibility is channel-scoped —
`message_read` requires `app.can_read_channel(channel_id)` or conversation membership
(`supabase/migrations/0002_communication.sql:348-351`) — but task visibility is
organization-wide for staff: `task_read` is
`app.is_org_staff(organization_id) or (member and assignee_id = auth.uid())`
(`supabase/migrations/20260818081240_scope_task_and_activity_policies_to_organization.sql:5-9`).
So converting a message from a **private** channel copies its full body into a row every
staff member can read. Worse, the guard against converting a **direct message** exists
only in the UI and only on root messages: `canConvert={Boolean(channelId)}` is passed at
`src/features/channels/components/channel-view.tsx:345`, but the two thread-panel
`MessageItem`s (`:376-383`, `:388-395`) omit the prop, and it defaults to `true`
(`message-item.tsx:56`) — so inside a DM thread the "Create task" item is shown, and
`convertMessageToTask` has **no server-side check that the message belongs to a channel
at all** (`message.commands.ts:421-427` tolerates a null `channel_id`). A private DM
reply can therefore be turned into a task whose description quotes it verbatim, readable
by every staff user. The same defaulting exposes "Add to meeting agenda" in DM threads.

### P0-LINK-03 — Message → agenda item
**Verdict:** Complete
**Requirement:** A message or thread can become a meeting agenda item carrying source
context and a proposed owner.
**Evidence:** `convertMessageToAgendaItem`
(`src/features/channels/services/message.commands.ts:263-297`) reads the message through
RLS (`:271-277`), appends it in order (`sort_key: count + 1`, `:290`), sets
`kind: "discussion"`, stores `source_message_id` — an FK to `message`
(`supabase/migrations/0003_operations.sql:54`) — as the source context, sets
`owner_id`/`proposed_by` to the converting user as the proposed owner (`:286-287`), and
marks the item `proposed` for a non-staff proposer and `accepted` for staff (`:292`),
so triage still applies. The meeting picker offers only future, non-cancelled meetings
(`src/features/channels/components/message-item.tsx:115-126`), themselves RLS-filtered,
and the dialog is wired at `:235-238`.
*Caveat:* the same DM-thread defaulting described under P0-LINK-02 lets this run on a
direct message; here the leak is narrower (the first line of the body becomes the agenda
title, visible to meeting readers) but it is the same missing server-side check.

### P0-LINK-04 — Message → decision/issue with a link back
**Verdict:** Partial
**Requirement:** Authorized users can capture a decision request, issue or risk from a
conversation and link back to the originating thread.
**Evidence:** The decision half is implemented. `convertMessageToDecision`
(`src/features/channels/services/message.commands.ts:303-338`) is staff-gated (`:309`),
reads the message through RLS, inherits the channel's `project_id`, takes an optional
detail from a dialog (`src/features/channels/components/message-item.tsx:140-149,
244-247`) and stores `source_message_id`, an FK back to the originating message
(`supabase/migrations/0003_operations.sql:68`). The decision lands in the shared
`decision` log, so it is read by report snapshots and exports like any other.
**Gap:** (a) **Issues and risks cannot be captured from a conversation.** The RAID
tables exist — `risk` and `issue` in
`supabase/migrations/20260822231017_risks_and_issues.sql` — but neither has a
`source_message_id` column and no command converts a message into either;
`grep -rn "convertMessageTo" src/` returns only Task, AgendaItem and Decision. (b) The
link is one-way: nothing renders "captured from this message" on the decision, and no
surface shows a message's derived records. (c) The decision's link back to its thread is
stored but never used — `grep -rn "source_message_id" src/` shows only writes.

### P0-LINK-05 — Record sharing as structured cards
**Verdict:** Missing
**Requirement:** Tasks, projects, events and CRM records can be shared into a channel as
structured cards, and a viewer sees only the fields they are authorized to see.
**Evidence:** The data model anticipates it — `message.source_record_type` /
`source_record_id` (`supabase/migrations/0002_communication.sql:89-90`) — and nothing
uses it: the only writer in the entire codebase is the meeting summary post
(`src/features/meetings/services/meeting.commands.ts:647`), and no reader exists at all
(`grep -rn "source_record_type" src/` returns that one line). There is no share action on
any record page (`grep -rni "share" src/features/tasks src/features/channels` finds only
"shareable URL" comments), and `MessageItem` renders `body` as text with a "System" badge
(`src/features/channels/components/message-item.tsx:295, 341`) — there is no card
component and therefore no per-field authorization to speak of.
**Gap:** Everything but the two columns. Note the permission-aware half is the harder
part: because a card would have to be rendered from the *viewer's* authorization rather
than the sharer's, this cannot be implemented by embedding fields in the message body.

### P1-LINK-06 — Project activity posted to the linked channel
**Verdict:** Partial
**Requirement:** Selected project events — assignment, milestone completion, health
change, meeting summary — can post structured system messages to the linked channel.
**Evidence:** One of the four is implemented, and implemented well. `completeMeeting`
resolves the channel (explicit `meeting.channel_id`, else the linked project's
non-archived channel), posts the summary as `is_system: true` with
`source_record_type: "meeting"` / `source_record_id`, and stamps `summary_posted_at`
so re-completion cannot double-post
(`src/features/meetings/services/meeting.commands.ts:611-655`). System messages are
visually distinguished (`src/features/channels/components/message-item.tsx:295, 341`).
**Gap:** The other three do not post. `from("message").insert` appears in exactly two
places in `src/` — the meeting summary above and the announcement fan-out
(`src/features/announcements/services/announcement.commands.ts:91-94`) — so nothing
writes a message on task assignment, milestone completion or a project health change;
those raise `activity_event` rows and notifications instead
(`src/features/projects/services/project.commands.ts:84-95`). The workflow rule engine
cannot fill the gap either: its action vocabulary is notification-only
(`notify_assignee` / `notify_team`, `src/features/admin/services/workflow.runtime.ts:62,
83`) with no post-to-channel action. There is also no per-channel configuration of
*which* events post, which is what "selected" implies.

### P1-LINK-07 — Channel summary inside the project
**Verdict:** Missing
**Requirement:** The project activity page shows relevant linked conversations without
copying full message history into the project record.
**Evidence:** The project detail page queries milestones, tasks, status updates,
`activity_event` and the RAID log
(`src/app/(workspace)/projects/[id]/page.tsx:70-110`) and renders an Activity section and
an Activity tab from `activity_event` alone (`:369-395`, `:396-420`). `activity_event`
records Hub verbs, not conversation — it has no message reference
(`supabase/migrations/0001_core.sql:255-267`). Nothing on the page mentions the channel:
`grep -n "channel" "src/app/(workspace)/projects/[id]/page.tsx"` returns **no matches**,
so there is not even a link to the auto-created project channel, let alone a summary of
recent messages. The reverse direction works (channel → project, P0-LINK-01); this
direction does not exist.
**Gap:** All of it. The cheap version — a "Conversation" card listing the linked
channel's last few non-deleted root messages by reference — is already supported by the
schema (`channel.project_id`, `message.channel_id`) and would inherit correct
authorization from `message_read`, since the page runs under the viewer's RLS session.
### P0-SRC-02 — Search never reveals titles, snippets or existence of records the user cannot access — **Complete**

This is the requirement most likely to be quietly wrong, and it is right, for a
structural reason rather than a careful one.

The live `public.global_search` is **`SECURITY INVOKER`** — `prosecdef` is
`false` in `pg_proc`, read from the production catalogue rather than from any of
the four migrations that have redefined this function. It is `STABLE`, `LANGUAGE
sql`, with `search_path` pinned to `public`. Because it runs as the caller, every
one of its thirteen `union all` branches reads its table through that table's own
RLS policies. Search cannot return a row a direct `select` would refuse, because
it *is* a direct select.

That is the strong form of the guarantee. It does not depend on the search
function remembering to filter, on a `where` clause being kept in step with a
policy, or on the thirteen branches agreeing with each other — the property holds
for a branch nobody has looked at in months, and it holds for the fourteenth
branch whenever someone adds one.

Worth stating explicitly because the opposite mistake is the one this project has
already made twice: `SECURITY DEFINER` helpers (`app.can_read_channel`,
`app.can_post_in_channel`) each carried their own unscoped copy of a membership
test, which a policy survey structurally could not see. Had `global_search` been
written `SECURITY DEFINER` for speed — a plausible and common choice — it would
have become a single function returning every row in the database to anyone who
could call it, and no policy audit would have shown it.

The UI reinforces rather than substitutes for this: the results page tells the
reader the count is "results you have access to"
(`src/app/(workspace)/search/page.tsx:68`), which is an honest description of
what the RPC returns.

### P0-SRC-01 — Global search across the named record types — **Partial**

Thirteen types are searched in one round-robin query, and the ranking is
thoughtful rather than incidental: risks sort worst-first so a truncated list
keeps the ones somebody is worried about, opportunities sort open-and-largest
first, messages and documents fall back to recency because it is the only
relevance signal they have, and messages are ranked last within a round because a
short query is far more often a person or a task than a phrase in a message body.

Against the requirement's own list, **two named types are missing**:

- **Contacts.** `crm_organization` is searched; `crm_contact` is not. Searching a
  person's name at a funder finds the funder, not the person — and `crm_contact`
  is where the name actually lives.
- **Reports.** Neither `report_instance` nor `report_version` has a branch, so no
  report is findable by search at all.

"Threads" is covered in substance — thread replies are `message` rows and match
through the message branch — though a thread never surfaces as a thread, only as
whichever reply matched.

### P1-SRC-03 — Search filters (type, program, project, author/owner, channel, date, status, attachment, message/thread) — **Partial, and the one filter present does not do what it appears to**

One of the nine is implemented: type. The RPC's only parameters are `p_query` and
`p_limit`; there is no program, project, author, channel, date, status,
attachment or thread filter at any layer.

The type filter is worth a closer look, because it reads as working and does not.
It is applied **client-side, after truncation**:

```
const { data } = await supabase.rpc("global_search", ...)   // :37
const filtered = typeFilter
  ? results.filter((r) => r.result_type === typeFilter)      // :44-45
```

`global_search` has already cut the result set to `p_limit` across all thirteen
types by the time this runs. So filtering to "Tasks" does not fetch the top tasks
— it hides everything that is not a task from a list that had already kept only a
couple of tasks. A reader who filters expecting to see more of one type sees
fewer results in total and no indication that any were dropped upstream, which is
the same failure shape as the dashboard donut's silent `limit(1000)`.

The counts beside each filter (`:106`) are computed from the same truncated set,
so they under-report by the same amount and give the mistake a number to be
trusted by.

Making this real means pushing the filter into the RPC as a parameter, so the
limit applies after the filter rather than before it.

### P1-SRC-04 — Palette prioritizes recent/frequent authorized destinations per user — **Missing**

No recency or frequency signal exists anywhere. The command palette calls
`global_search` with the typed query and nothing else
(`src/components/layout/command-palette.tsx:114`); there is no per-user history
table, and the only `localStorage` use in the application is the theme toggle
(`src/components/layout/topbar.tsx:95`). An empty palette offers static
navigation, not the destinations this user actually returns to.

The privacy half of the requirement — not exposing organization-wide behavioural
analytics — is satisfied trivially, by there being nothing to expose.

### P0-RES-01 — Messages can attach approved files or QBBE-controlled Drive links with permission-aware previews — **Missing**

There is no attachment on a message. `grep -rn "attachment"` across
`src/features/channels/` and all 60 migrations returns nothing: no
`message_attachment` table, no attachment column, no upload affordance in the
composer.

Documents exist as their own module with Drive links (`document.kind` of `file`
or `link`), but nothing connects a document to a message, so the requirement's
actual subject — attaching to a message — has no implementation. A `document`
row can reference a `channel_id`, which is the nearest thing present and is a
channel association rather than a message attachment.

### P0-RES-02 — Channel managers can pin messages, documents, meeting and project links, SOPs and forms in a durable resource panel — **Partial**

The table and the panel exist. `pinned_resource` is a real table with its own
policies, written from `src/features/channels/services/message.commands.ts` and
rendered on `src/app/(workspace)/channels/[id]/page.tsx`.

Its reach is narrower than the requirement. `pinned_resource` carries
`message_id` and `channel_id` foreign keys — so a pinned resource is a pinned
*message*. There is no column by which to pin a document, a meeting link, a
project link, an SOP or a form, which is five of the six things the requirement
names. Pinning a document today means finding a message that links to it and
pinning that.

### P1-RES-03 — Internal Hub links display a safe preview, only when the viewer is authorized — **Missing**

No unfurling of any kind: `grep -rln "unfurl\|linkPreview\|LinkPreview"` across
`src/` returns nothing. An internal link pasted into a message renders as a URL.

The authorization half of the requirement is therefore also unmet, but vacuously
— there is no preview that could leak. Worth noting for whoever implements it
that this is exactly the surface where a preview built the obvious way (fetch the
title server-side with elevated rights) reintroduces the disclosure P0-SRC-02
avoids; the preview must be read as the viewer, the way `global_search` is.

### P1-RES-04 — Size/type restrictions, malware scanning, retention, download permissions and audit centrally configurable — **Partial**

Retention and audit are real and are the stronger half. `retention_policy` and
`retention_run` are tables with an admin surface
(`src/features/retention/services/retention.commands.ts`,
`retention.queries.ts`) and a job that applies them
(`src/features/jobs/services/handlers/apply-retention.ts`). Download is audited:
the export download route writes `audit_event`, and `count_export_download` is
the one aggregate RPC in the schema.

The file-handling half is not. MIME type is *recorded* at upload
(`src/features/documents/components/document-upload-dialog.tsx:81`) and used only
to choose an icon (`document-list.tsx:51-55`) — nothing rejects a type. There is
no size limit in application code, no allow-list, and no malware scanning
strategy documented or implemented. Nothing here is centrally configurable: the
retention side is configurable and the file side does not exist to configure.

This compounds a known gap recorded under DB-003: the storage upload policy is
not organization-scoped, because no `document` row exists at upload time to scope
against. So an authenticated member may upload a file of any type and any size to
the bucket, and neither a policy nor an application check constrains it.

