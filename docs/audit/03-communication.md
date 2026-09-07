# Domain audit — communication: channels, announcements, messages, DMs, inbox

<!-- progress: 16 of 48 assessed — IN PROGRESS -->

Requirement families in scope: `ANN-001..006`, `MSG-001..010`, `P0-ANN-01..05`,
`P1-ANN-06..08`, `P0-COMM-01..05`, `P1-COMM-06`, `P0-MSG-01..06`,
`P1-MSG-07..09`, `P0-DM-01`, `P1-DM-02/03`, `P2-DM-04`, `P0-INB-01..04`,
`P1-INB-05` — 48 IDs total.

All paths are relative to `/home/user/QBBE-HUB`.

---

### ANN-001 — Announcement attributes
**Verdict:** Partial
**Requirement:** Announcements carry target audience, priority, publish time, expiration,
pinning, an acknowledgment requirement and an acknowledgment deadline.
**Evidence:** `supabase/migrations/0002_communication.sql:145-158` — `announcement` has
`priority` (`normal|important|critical` enum at `:12`), `publish_at`, `expires_at`,
`pinned_until`, `requires_ack`, `ack_deadline`. `publishAnnouncement`
(`src/features/announcements/services/announcement.commands.ts:49-125`) writes `priority`,
`publish_at`, `requires_ack` and `ack_deadline`, the last two converted from wall-clock time
in the organization's zone (`:67-78`, `src/lib/time.ts`).
**Gap:** Three of the seven attributes have no writer. **No target audience exists at all** —
there is no audience/scope column on `announcement` and no program/team/project reference
(see P1-ANN-06). **`expires_at` and `pinned_until` are never written by any code path**:
`grep -rn "expires_at" src/features/announcements/` returns nothing, `pinned_until` appears
nowhere in `src/`, and the compose dialog offers only title, body, priority, ack checkbox,
ack deadline and publish time
(`src/features/announcements/components/announcement-compose-dialog.tsx:52-98`). Both
columns are *read* — the announcements page sorts expired items into History
(`src/app/(workspace)/announcements/page.tsx:87-91`) and the nudge job skips expired ones
(`src/features/jobs/services/handlers/announcement-nudge.ts:34`) — so the read side is built
against a value nothing can ever set.

### ANN-002 — Posting permission separate from reading permission
**Verdict:** Complete
**Requirement:** Announcement posting permissions are distinct from reading permissions;
ordinary members may be required to read and acknowledge without being able to post.
**Evidence:** Two independent policies. Reading:
`announcement_read ... using (app.is_org_member(organization_id))`
(`supabase/migrations/20260902002148_scope_remaining_policies_to_organization.sql:27-30`).
Posting: `announcement_admin_insert ... with check (app.is_org_admin(organization_id) and
created_by = auth.uid())` (`:32-35`). The underlying message is separately gated — the
seeded announcements channel is created with `posting_policy = 'admins'`
(`supabase/migrations/20260902220712_enforce_invite_only_signup_in_the_database.sql:89-93`)
and `app.can_post_in_channel` resolves that to `app.is_org_admin`
(`supabase/migrations/20260902002201_scope_membership_join_policies.sql:51-69`), so a
non-admin's `message` insert fails before the announcement row is ever attempted.
Acknowledging is open to every member (`ack_insert ... with check (user_id = auth.uid())`,
`0002_communication.sql:398-400`). The composer is admin-only in the UI too
(`src/app/(workspace)/announcements/page.tsx:201`,
`src/app/(workspace)/channels/[id]/page.tsx:148`).

### ANN-003 — Acknowledgment is an explicit durable record
**Verdict:** Complete
**Requirement:** Acknowledgment is an explicit durable record; reactions or opening the
message do not count.
**Evidence:** `announcement_acknowledgment` is its own table with
`primary key (announcement_id, user_id)`, `acknowledged_at` and a `method` column defaulting
to `'click'` (`supabase/migrations/0002_communication.sql:161-167`). It is written only by
`acknowledgeAnnouncement` (`src/features/announcements/services/announcement.commands.ts:12-33`),
which upserts with `ignoreDuplicates`, and that command is called only from an explicit
"Acknowledge" button (`src/features/announcements/components/acknowledge-button.tsx:24`).
`message_reaction` is a separate table (`0002_communication.sql:107-114`) and nothing reads
it when computing acknowledgment — `grep -rn "message_reaction" src/features/announcements`
is empty, and the ack sets on both surfaces come from `announcement_acknowledgment`
(`announcements/page.tsx:58-61,74-80`, `src/features/dashboard/services/dashboard.queries.ts:395-403`).
Opening the page does not write anything.

### ANN-004 — Acknowledgment progress and outstanding recipients
**Verdict:** Partial
**Requirement:** Admins can see acknowledgment progress and the outstanding recipients,
scoped to users they are authorized to manage.
**Evidence:** Progress exists and is correctly scoped. `ack_read` lets a user see their own
row, or an org admin see every row for announcements in their organization
(`supabase/migrations/20260902002148_scope_remaining_policies_to_organization.sql:39-48`).
`src/app/(workspace)/announcements/page.tsx:73-85` fetches all acks for admins only and
`:173-190` renders "N of M members acknowledged" with a progress bar; the home rail repeats
it (`src/app/(workspace)/page.tsx:675`).
**Gap:** **Outstanding recipients are never listed.** Only an aggregate count is rendered;
no screen names who has not acknowledged. The computation already exists server-side — the
nudge job builds exactly that set (`src/features/jobs/services/handlers/announcement-nudge.ts:63-73`)
— but it is used only to send notifications, never surfaced. The denominator is also the
count of *all* active memberships (`announcements/page.tsx:62-66`), not of the announcement's
audience, which is a consequence of ANN-001's missing audience model.

### ANN-005 — Reminder job for unacknowledged recipients
**Verdict:** Complete
**Requirement:** A reminder job notifies unacknowledged recipients before the deadline, with
deduplication and quiet-hour rules.
**Evidence:** `src/features/jobs/services/handlers/announcement-nudge.ts:22-102` loads
required announcements that are published and unexpired (`:29-42`, deadline filter at `:41`),
subtracts the acknowledged set (`:58-66`), and writes one notification per outstanding member.
Dedupe is per person per announcement per day —
`dedupe_key: ack-nudge:<announcementId>:<userId>:<yyyy-mm-dd>` (`:91`) — backed by the unique
index `uq_notification_dedupe (user_id, dedupe_key)`
(`supabase/migrations/0002_communication.sql:189-190`) and applied with `ignoreDuplicates`
(`src/features/jobs/services/notify.ts:41`). Registered and scheduled daily at 13:00 UTC
(`supabase/migrations/20260819165607_jobs.sql:373-375`, cron loop at `:390-395`; handler
wired at `src/features/jobs/services/handlers/index.ts:31`). Quiet hours are honoured at
email delivery by `inQuietWindow`/`decideDelivery`
(`src/features/notifications/services/delivery-rules.ts:126-137, 155-195`).
**Note:** the nudge is deliberately `urgency: "high"` (`announcement-nudge.ts:90`), which
`decideDelivery:181-184` sends through quiet hours when `email_critical` is on (default true,
`0002_communication.sql:194`). That is an explicit, commented exception rather than an
oversight, and it is consistent with NTF-003's carve-out for required announcements.

### ANN-006 — Secondary confirmation for critical announcements
**Verdict:** Partial
**Requirement:** Critical announcements may optionally require a confirmation phrase or
secondary confirmation *in future*, while normal notices stay one-click.
**Evidence:** The binding half holds: acknowledgment is exactly one click with no
intermediate step (`src/features/announcements/components/acknowledge-button.tsx:22-45`), and
`announcement_acknowledgment.method` (`supabase/migrations/0002_communication.sql:165`)
already exists as the discriminator a second method would use — it is hard-coded to
`"click"` at the only call site (`announcement.commands.ts:24`).
**Gap:** No secondary-confirmation path exists for `priority = 'critical'`; the ack button
and command are identical for all three priorities. The requirement itself defers this
("in future"), so this is a recorded absence rather than a defect, but it is not implemented.

### MSG-001 — Durable persistence before "sent"
**Verdict:** Complete
**Requirement:** Every channel/DM message is persisted in Postgres before it is treated as
sent; realtime is an acceleration layer, not the only copy.
**Evidence:** `sendMessage` (`src/features/channels/services/message.commands.ts:25-132`)
inserts into `message` and returns `{ok:false}` if the insert errors (`:53-59`) — nothing is
optimistic. The composer refuses to clear the textarea and shows a retry affordance on a
failed send (`src/features/channels/components/channel-view.tsx:52-57, 72-76`). Reads on both
initial render and refresh come from Postgres, not from a realtime buffer
(`src/app/(workspace)/channels/[id]/page.tsx:67-72`,
`src/features/channels/components/channel-view.tsx:156-166`); the realtime handler only
triggers a refetch (`:203-207`). Reconnection re-runs the same durable query so nothing
missed during a gap stays missing (`:211-216`).

### MSG-002 — Threads via `message.thread_root_id`
**Verdict:** Complete
**Requirement:** Thread relationships use `message.thread_root_id`; replies remain queryable
and searchable without a separate thread store.
**Evidence:** `message.thread_root_id uuid references message (id)` with a supporting index
(`supabase/migrations/0002_communication.sql:85, 99`). There is no other thread table in the
schema. Replies are written through the same insert path
(`src/features/channels/services/message.commands.ts:46`) and grouped client-side by
`thread_root_id` (`src/features/channels/components/channel-view.tsx:255-263`). Replies are
searchable because `global_search` matches on `message.body` with no thread filter and links
each hit to its container (`supabase/migrations/20260827164411_search_raid_and_documents.sql:80-93`),
and RLS scopes it (`security invoker`, `supabase/migrations/0005_search_deeplink_fix.sql:5-7`).

### MSG-003 — Sanitized portable content plus a search representation
**Verdict:** Partial
**Requirement:** Store message content in a sanitized portable rich-text representation plus
a plain-text/search representation; never persist unsanitized browser HTML.
**Evidence:** The prohibition half holds. `message.body` is a plain `text` column
(`supabase/migrations/0002_communication.sql:87`), the composer is a `<textarea>` with no
rich-text editor (`src/features/channels/components/channel-view.tsx:80-95`), the server
action validates it only as bounded text (`message.commands.ts:16`), and it is rendered as a
React text child with `whitespace-pre-wrap`
(`src/features/channels/components/message-item.tsx:338-345`) — so it is escaped, never
`dangerouslySetInnerHTML`. `grep -rn "dangerouslySetInnerHTML" src/` returns nothing.
**Gap:** There is no rich-text representation and no separate search representation — one
plain-text column serves both, so the "paragraphs, lists, links" of P0-MSG-01 have nowhere to
live. Also, the search *representation* that does exist is not the one used: the schema
creates `idx_message_search ... using gin (to_tsvector('english', body))`
(`0002_communication.sql:100`) but `global_search` matches with `m.body ilike '%…%'`
(`20260827164411_search_raid_and_documents.sql:90`), which cannot use a tsvector GIN index —
so message search is an unindexed sequential scan and the index is dead weight.

### MSG-004 — Edit/delete preserve audit evidence
**Verdict:** Partial — **and see the authorization finding below**
**Requirement:** Edit and delete preserve audit evidence; user-facing deletion may hide the
body while retaining required metadata.
**Evidence:** Deletion is soft: `deleteMessage`
(`src/features/channels/services/message.commands.ts:389-408`) sets `deleted_at` and writes an
`audit_event` row (`action: "message_deleted"`); the row itself, its author, timestamps,
reactions and mentions survive. There is no DELETE policy on `message` at all
(`supabase/migrations/0002_communication.sql:348-363` defines only select/insert/update), so
a hard delete is impossible through PostgREST. Edits stamp `edited_at`
(`message.commands.ts:250-253`) and the UI shows "(edited)"
(`src/features/channels/components/message-item.tsx:294`).
**Gap:** Three problems, in ascending severity.
(a) The deleted body is still sent to every reader. `deleted_at` only changes rendering
(`message-item.tsx:298-301`); the row-level select list includes `body` with no deletion
filter (`src/app/(workspace)/channels/[id]/page.tsx:25-27`, `channel-view.tsx:18-20`), so the
text of a "deleted" message is in the JSON payload delivered to every channel member and to
anyone who queries the table directly.
(b) No prior version is retained on edit — `body` is overwritten in place, so the audit
evidence is the existence of a flag, not the content that changed.
(c) **The audit marker is a column its subject can rewrite.** `message_author_update`
(`supabase/migrations/20260902002148_scope_remaining_policies_to_organization.sql:184-188`)
is `using (author_id = auth.uid() or app.is_org_admin(organization_id))` with the same
`with check`, and — unlike `channel_member`, which has `revoke update … grant update
(muted_level, last_read_at)` (`supabase/migrations/0011_channel_member_update_columns.sql:3-4`)
— **no column privileges are applied to `message` and no trigger guards it**. RLS grants the
row, not the column, so an author calling PostgREST directly can `PATCH` `edited_at` back to
`null` (erasing the only evidence of the edit), reset `deleted_at`, or set `is_system = true`
to earn the "System" badge (`message-item.tsx:295`). See P0-ANN-02 and P0-GOV-01 for the
worse consequence of the same hole: `channel_id` is writable too.

### MSG-005 — Server-side mention parsing
**Verdict:** Complete
**Requirement:** Mentions are parsed and persisted server-side so a client cannot bypass
notification delivery.
**Evidence:** Parsing happens only in the `"use server"` action:
`src/features/channels/services/message.commands.ts:62-107` reads the body it just stored,
resolves `@Full Name` and `@Team` tokens through `mentionRecipientIds`
(`src/features/channels/mention-recipients.ts:8-27`), then writes a `message_mention` row and
one deduped `notification` per recipient (`:91-105`, `dedupe_key: mention:<msg>:<user>`). The
client sends only `{channelId, conversationId, threadRootId, body}`
(`channel-view.tsx:268-279`) — there is no mention field in the payload or in the zod schema
(`message.commands.ts:12-17`), so a modified client cannot suppress or forge a mention.
Covered by unit tests at `src/features/channels/tests/mention-recipients.test.ts`.

### MSG-006 — Unique constraint on reactions
**Verdict:** Complete
**Requirement:** Reactions use a unique constraint on `message_id + user_id + emoji` to
prevent duplicate toggles.
**Evidence:** `message_reaction` declares
`primary key (message_id, user_id, emoji)` (`supabase/migrations/0002_communication.sql:107-114`)
— a primary key, so the uniqueness is enforced by the database rather than by the toggle
logic. `toggleReaction` (`src/features/channels/services/message.commands.ts:134-168`) reads
the existing row and deletes or inserts accordingly, so the constraint is the backstop for a
double-click race rather than the primary mechanism.
**Gap:** none for this requirement; but see P0-MSG-04 for a separate authorization defect in
`reaction_write`.

### MSG-007 — Read state on membership, not per message
**Verdict:** Complete
**Requirement:** Channel read state is a last-read cursor on membership; no per-user
per-message read row for ordinary channel messages.
**Evidence:** `channel_member.last_read_at timestamptz not null default now()`
(`supabase/migrations/0002_communication.sql:48`) and the same on
`conversation_member.last_read_at` (`:69`). No per-message read table exists in the schema.
The cursor is advanced by `markChannelRead` / `markConversationRead`
(`src/features/channels/services/channel.commands.ts:231-239`,
`src/features/channels/services/message.commands.ts:508-518`), called on view and on each
realtime arrival (`src/features/channels/components/channel-view.tsx:204-206, 227-230`).
Unread is derived by comparing the newest message against the cursor
(`src/app/(workspace)/messages/page.tsx:73-77`). Column privileges deliberately restrict what
a member may update on their own membership row to `muted_level` and `last_read_at`
(`supabase/migrations/0011_channel_member_update_columns.sql:3-4`), asserted in the RLS suite
(`supabase/tests/rls.sql:590-613`).

### MSG-008 — Typing/presence are ephemeral, never durable history
**Verdict:** Complete (vacuously — see the gap)
**Requirement:** Typing indicators and presence are ephemeral realtime signals and are not
stored as durable message history.
**Evidence:** The constraint holds because nothing writes them: there is no presence or
typing table in any of the 60 migrations, and `grep -rni "presence|typing" src/` returns no
match. The only realtime subscription in the codebase is the message refetch signal
(`src/features/channels/components/channel-view.tsx:190-224`), which carries no presence
payload and calls neither `channel.track()` nor `.on("presence", …)`.
**Gap:** The capability does not exist at all, so the requirement is satisfied only by
absence. See P2-DM-04.

### MSG-009 — Realtime honours the same membership boundaries
**Verdict:** Partial
**Requirement:** Use private realtime topics and authorization for private channels/DMs; the
realtime layer must honour the same membership boundaries as durable queries.
**Evidence:** The boundary itself is shared, which is the substantive half. `message` is in
the realtime publication (`supabase/migrations/0002_communication.sql:415`) with RLS enabled
(`:283`), and the subscription is a `postgres_changes` listener on that table
(`src/features/channels/components/channel-view.tsx:195-208`) — so Supabase evaluates the
same `message_read` policy (`0002_communication.sql:348-351`, delegating to
`app.can_read_channel` / `app.is_conversation_member`) that governs the durable query. The
payload is never trusted either: the callback ignores it and refetches through the ordinary
RLS-filtered query (`:203-204`).
**Gap:** The topic is **not** private. `supabase.channel("messages:<id>")` (`:192`) is a
default public topic with no `{ config: { private: true } }` and no `realtime.messages`
authorization policy anywhere in the migrations (`grep -rn "realtime.messages"
supabase/migrations/` is empty), so the spec's literal mechanism — private topics with their
own authorization — is not in use. Security today rests entirely on Realtime applying RLS to
`postgres_changes`, which is one layer, not two, and which this container cannot exercise
(no Supabase egress). What would settle the residual risk: a subscription test against a
live project confirming a non-member receives no events for a private channel.

### MSG-010 — Broadcast a signal, refetch by cursor
**Verdict:** Partial
**Requirement:** For higher fan-out, use Realtime Broadcast / private topics to signal new
durable messages and refetch by cursor, rather than relying on the browser receiving every
database change.
**Evidence:** The refetch half is exactly as specified: the realtime callback discards the
change payload and re-runs a bounded, ordered durable query
(`src/features/channels/components/channel-view.tsx:156-166, 203-207`), and history paging
uses a `created_at` cursor (`loadOlder`, `:168-187`), with a fixed page size
(`src/features/channels/history.ts`). Merge is id-keyed and re-sorted so duplicates from an
overlapping refetch collapse (`:22-26`).
**Gap:** The signal is still `postgres_changes` with `event: "*"` — that is precisely
"the browser receiving every database change" for the container, which the requirement asks
to move away from. Nothing in `src/` calls `.send({ type: "broadcast" })` or subscribes to a
broadcast topic (`grep -rn "broadcast" src/` is empty), and there is no database trigger
emitting `realtime.broadcast_changes`. The refactor is the cheap half; the transport is
unchanged.
