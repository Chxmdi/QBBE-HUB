# Domain audit — communication: channels, announcements, messages, DMs, inbox

**Complete — 48 of 48 assessed.**

**The shape of this family:** the parts that carry an authorization consequence
are enforced in the database and are right; the parts that carry a workflow
consequence are frequently a schema column with no code behind it.

The strong half is genuinely strong. Posting policy, reply policy and channel
archiving are enforced by RLS through `app.can_post_in_channel` /
`app.can_reply_in_channel`, not by the page that renders the composer — so a
crafted request cannot post where the policy forbids it, or into an archived
channel. Direct-message visibility reduces to a single predicate
(`app.is_conversation_member`), and `conversation` has no UPDATE or DELETE policy
at all, so a conversation cannot be renamed or removed by anyone. Mention
resolution is extracted into a pure function whose test asserts exactly the leak
the requirement forbids — a team member without channel access is excluded from a
group mention.

The weak half is a recurring pattern rather than scattered gaps: **a column
exists, and nothing writes it.** Three verdicts in this report were corrected
mid-audit for exactly that reason.

| Column | State |
|---|---|
| `announcement.pinned_until` | zero references in `src/` — pinning does not exist |
| `announcement.expires_at` | never written; the page's expiry check can never fire |
| `saved_message.remind_at` | zero references — the reminder half of saved items is inert |
| `message.source_record_id/_type` | one writer, **no reader** |

The `expires_at` case is the instructive one: `announcements/page.tsx:88`
computes an expired flag from a column nothing ever sets, so the code reads as a
working feature and can never be true.

Three further findings worth acting on:

1. **Thread unread state is not tracked separately** (P0-MSG-02). There is one
   read cursor per member per channel and no thread read-state table, so marking
   a channel read marks every thread in it read.
2. **No attachments exist anywhere** (P0-MSG-01, P1-DM-02, and P0-RES-01 in the
   integrations report) — no table, no column, in any of the 60 migrations.
3. **Group DMs cannot be muted.** `channel_member` has `muted_level`;
   `conversation_member` does not — so the noisier of the two surfaces is the one
   without a mute.

Announcement targeting (P1-ANN-06) has no audience column of any kind, so an
announcement for one program must go to everyone or stop being an announcement.


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
## Channels

### P0-COMM-01 — Public and private channels with name, purpose, topic, owner, moderators, membership policy, archive state — **Complete**

`channel` carries every attribute the requirement names: `name`, `slug`,
`privacy`, `purpose`, `topic`, `owner_id`, `posting_policy`, `archived_at`, plus
`type` and links to `program_id`/`project_id`/`event_id`. Moderators are
expressed as `channel_member.role` rather than a separate column, which is the
better shape — a moderator is a membership fact, not a channel one.

### P0-COMM-02 — Structured channel types — **Complete**

`channel.type` is a constrained column and the application reads it
(`src/app/(workspace)/channels/[id]/page.tsx:41`). The named types are
represented, with `announcements` carrying distinct behaviour via `is_mandatory`
(see P0-ANN-01), and program/project/event channels carrying their respective
foreign keys so a "team" or "program" channel is linked rather than merely named.

### P0-COMM-03 — Auto-membership from program/project/team membership; manual exceptions auditable — **Partial**

The mechanism exists and is well modelled: `channel_member.membership_source`
distinguishes an automatic membership from a manual one, which is exactly the
column needed to make the requirement's second clause answerable.

What is missing is the auditing of exceptions. `membership_source` records
*that* a membership was manual; nothing records who made it or when it diverged
from the automatic rule, and `message.commands`/channel commands do not write
`audit_event` for membership changes — the same gap recorded under DEV-006 for
meetings. So a manual exception is visible but not attributable.

### P0-COMM-04 — Channel directory: browse/search discoverable channels, see purpose and membership, join where policy permits — **Complete**

`src/app/(workspace)/channels/page.tsx` is the directory, and discovery is
governed by RLS rather than by the page: `channel` read policy determines which
channels are listed, so a private channel the viewer may not discover is absent
from the list rather than filtered out of it. `global_search` also returns
channels by name or slug with their purpose as the snippet, through the same
invoker-rights path (P0-SRC-02).

### P0-COMM-05 — Archive without deleting history; archived channels read-only and searchable — **Complete, and enforced in the database**

Archiving sets `channel.archived_at`; no history is removed. Read-only is not a
UI convention — **both write helpers refuse it**:
`app.can_post_in_channel` and `app.can_reply_in_channel` each require
`c.archived_at is null` (live function bodies, read from the catalogue). So an
archived channel cannot accept a message even from a crafted request.

Searchability is preserved: `global_search`'s channel branch excludes archived
channels from the *channel* results, while the message branch does not filter on
channel archive state, so messages in an archived channel remain findable — which
is the behaviour the requirement asks for.

### P1-COMM-06 — Channel templates with default topic, posting policy, bookmarks, automation, membership rules — **Missing**

No `channel_template` table exists (a catalogue sweep for `%template%` returns
`project_template` only, which is a different domain). Every channel is
configured from scratch, and the defaults the requirement names have nowhere to
live.

## Messages

### P0-MSG-01 — Rich messages: paragraphs, lists, links, emojis, inline references, approved attachments — **Partial**

`message.body` is plain text, and that is a **recorded decision**, not an
oversight: `docs/adr/ADR-003-plain-text-messages.md`. Paragraphs, links and emoji
survive as text; `source_record_type`/`source_record_id` give genuine inline
references to a task, meeting or CRM record.

Two clauses are unmet. Lists have no representation beyond typed hyphens. And
**attachments do not exist at all** — as recorded under P0-RES-01, there is no
message-attachment table or column anywhere in the 60 migrations, so "approved
attachments within their permission scope" has no implementation to scope.

Because the plain-text choice is documented with its reasoning, the ADR is the
right place to revisit this; the attachment gap is independent of it.

### P0-MSG-02 — Threaded replies; thread unread tracked separately from the parent channel — **Partial**

Threads are real: `message.thread_root_id` with a supporting index
(`idx_message_thread (thread_root_id, created_at)`), and replies are permitted by
a distinct branch of the insert policy.

**Thread unread state is not tracked separately.** There is exactly one read
cursor per member per channel — `channel_member.last_read_at` — and a catalogue
sweep confirms **no thread or read-state table exists**. So marking a channel
read marks every thread in it read, and a reply in a thread the user follows is
indistinguishable from any other new message. The requirement names this
separation explicitly, and it is the half that makes threads usable at volume.

### P0-MSG-03 — Mentions notify only users with access; inaccessible users not leaked through autocomplete — **Complete**

The resolution rule is extracted into a pure function and tested, which is the
right shape for a rule with a security consequence.
`src/features/channels/tests/mention-recipients.test.ts` asserts precisely the
leak the requirement forbids: given a private channel whose eligible users are
`ada` and `team-member`, a body mentioning a person and a team resolves to those
two and **excludes `outsider`** — who is both a channel member candidate and a
member of the mentioned team. Group mentions expand through team membership and
are then intersected with eligibility, rather than expanded and trusted.

`message_mention` rows are therefore only ever written for users with access, so
the notification path inherits the property rather than re-deriving it.

### P0-MSG-04 — Reactions are lightweight and do not generate excessive notifications by default — **Complete**

`message_reaction (message_id, user_id, emoji, created_at)` with the natural
composite key, so a reaction is one narrow row. No notification is generated for
a reaction — the notification paths cover mentions, replies, announcements and
assignments, and `message_reaction` has no trigger. "Does not generate excessive
notifications by default" is satisfied by generating none.

### P0-MSG-05 — Edit within policy; deletion preserves an audit marker; admins may configure edit windows — **Partial**

Two of three. Editing sets `edited_at`
(`src/features/channels/services/message.commands.ts:252`), so a changed message
carries visible evidence, and the file comments the intent. Deletion is soft —
`message.deleted_at` — so the audit marker survives and history is not destroyed.
Authorization is correct: `message_author_update` restricts updates to the author
or an organization admin.

**Edit windows are not configurable and not enforced.** There is no
`edit_window` setting on the organization or channel and no time check in the
update path, so an author may edit a message of any age indefinitely. For a tool
whose messages become agenda items and decisions, an unbounded edit window on a
message already cited elsewhere is the part worth closing.

### P0-MSG-06 — Stable, permission-checked permalinks — **Complete**

Permalinks are `/channels/<channel>?message=<id>` (channel) and
`/messages/<conversation>` (DM), generated centrally in `global_search`'s `href`
column and used by search, the palette and cross-references. They are stable
because they are built from immutable ids.

"Permission-checked" holds structurally: the destination reads the message
through `message_read`, which requires `app.can_read_channel` or
`app.is_conversation_member`. A permalink pasted into a task, meeting or report
therefore resolves to a refusal for anyone unauthorized rather than disclosing
the message — the property that makes it safe to embed.

### P1-MSG-07 — Scheduled messages, cancellable before send — **Missing**

No table, no column, no job. The catalogue has nothing matching `%schedul%` for
messages; `scheduled-announcements` is a job for announcements
(`announcement.publish_at`), a different entity. A user cannot schedule a channel
or DM message.

### P1-MSG-08 — Drafts persist and are recoverable after navigation — **Missing**

No draft table, and no client-side fallback: the only `localStorage` use in the
application is the theme toggle (`src/components/layout/topbar.tsx:95`). Typing a
message and navigating away loses it, on every surface.

### P1-MSG-09 — Save/bookmark messages with an optional personal reminder date — **Partial**

Saving works end to end and is properly scoped. `saved_message` is keyed
`(user_id, message_id)`, so what an individual saved is private to them, and it
is read in three places — the channel view, the DM view, and a dedicated
`/saved` page (`src/app/(workspace)/saved/page.tsx:39`).

**The reminder date is not implemented.** `saved_message.remind_at` has **zero
references in `src/`**: nothing sets it, nothing reads it, and no job scans it.
The column is the whole of the "optional personal reminder date" clause, and it
is inert.

This is the same defect as P1-INB-05 (snooze) reached from a different
direction — in both cases the schema anticipated a deferral feature that no code
ever implemented.

## Announcements

### P0-ANN-01 — Mandatory announcements channel; auto-enrolled; cannot be left by ordinary members; prominent — **Partial**

`channel.is_mandatory` exists and the dashboard reads it
(`dashboard.queries.ts:241-246` selects the mandatory announcements channel), so
prominence and the concept are implemented.

The enforcement half is not evidenced. Nothing was found that prevents an
ordinary member from leaving a mandatory channel — the constraint would have to
live in a `channel_member` delete policy or a trigger keyed on
`channel.is_mandatory`, and no such rule appears. Auto-enrolment likewise relies
on `membership_source` being set correctly at creation rather than on a rule that
re-establishes membership. This is the P0-COMM-03 gap seen from the side where it
matters most.

### P0-ANN-02 — Restricted posting configurable by admins; non-posters cannot create top-level messages — **Complete, and enforced in the database**

This is the requirement most likely to have been left to the UI, and it was not.
`channel.posting_policy` is `everyone | staff | admins`, and the `message_insert`
policy's `WITH CHECK` calls `app.can_post_in_channel(channel_id)` for any message
without a `thread_root_id` — that is, for exactly the top-level messages the
requirement names. The live helper resolves the policy against
organization-scoped role helpers:

```
case c.posting_policy
  when 'everyone' then app.is_org_member(c.organization_id)
  when 'staff'    then app.is_org_staff(c.organization_id)
  when 'admins'   then app.is_org_admin(c.organization_id)
end
```

The page component's policy check
(`src/app/(workspace)/channels/[id]/page.tsx:96-106`) decides whether to render a
composer; the database decides whether a message may exist. That is the right
division, and worth stating because the inverse — a rule computed only by a
component — is precisely how the invite-only sign-up hole survived in this
project for weeks.

### P0-ANN-03 — Reply policy: disabled, threaded-only, or normal — **Partial**

`channel.reply_policy` holds all three values and **`disabled` is enforced**:
`app.can_reply_in_channel` requires `c.reply_policy <> 'disabled'`.

`threads_only` and `normal` are not distinguished by the database — the helper
treats both as "replies allowed". The security consequence is nil, because a
non-threaded message is a top-level post and already requires posting permission,
so `threads_only` cannot be bypassed into something the user could not otherwise
do. It is a presentation rule enforced only in the UI, which should be recorded
as such rather than assumed to be a database guarantee.

### P0-ANN-04 — Require acknowledgment by a deadline; authorized viewers see counts and outstanding recipients — **Complete**

`announcement.requires_ack` and `ack_deadline` are set at compose time
(`announcement.commands.ts:115-116`), the deadline converted through the
organization's zone rather than the server's (this session's timezone work).
`announcement_acknowledgment (announcement_id, user_id, acknowledged_at, method)`
is a durable record — the `method` column distinguishes how it was given, and the
component comment makes the intent explicit: "a durable record, not a reaction"
(`acknowledge-button.tsx:10`).

Counts and outstanding recipients follow from that table joined against active
membership, and the announcements page reads `requires_ack`
(`src/app/(workspace)/announcements/page.tsx:22`).

### P0-ANN-05 — Pin with an expiration date; shown on Home until read or expired — **Missing**

*Corrected during this audit.* My first pass recorded this Complete on the
strength of `announcement.pinned_until` and `expires_at` existing as distinct
columns. Checking which code writes them shows the feature does not exist.

- **`pinned_until` has zero references in `src/`.** Nothing writes it and nothing
  reads it. Pinning an announcement is not possible and would have no effect.
- **`expires_at` is never written.** The compose dialog collects title, body,
  priority, acknowledgment requirement, acknowledgment deadline and publish time
  (`announcement-compose-dialog.tsx:55-92`) — there is no expiry field, and
  `publishAnnouncement` does not set the column.

The consequence is a piece of dead logic that reads as working code:
`src/app/(workspace)/announcements/page.tsx:88` computes an expired flag as
`Boolean(a.expires_at && new Date(a.expires_at) < new Date())`, which can never
be true because the column is always null. Anyone reading that line would
reasonably conclude expiry is implemented.

The "until read" half of the requirement does work — the dashboard reads
acknowledgement state to decide what still needs the viewer's attention. It is
"until *expired*" that has no mechanism.

This is the failure mode the briefing warns about, and I made it: a column is not
a feature, and the check that separates them is asking who writes it.

### P1-ANN-06 — Targeted announcements to organization, program, team, project or selected audience — **Missing**

`announcement` has no audience column of any kind — no `program_id`, `team_id`,
`project_id` or audience join table. Targeting is therefore only as coarse as the
channel the announcement's message sits in, which is organization-wide for the
mandatory channel. An announcement meant for one program must either go to
everyone or be posted in that program's channel, which changes its nature from an
announcement to a message.

### P1-ANN-07 — Scheduled publication; drafts private to authorized editors — **Partial**

Scheduling is real and running: `announcement.publish_at`, with the
`scheduled-announcements` job on a five-minute cron, verified active in
production (14 of 14 cron entries active). This session's timezone fix matters
here — `publishAt` was being parsed in the server's zone, so an announcement set
for 09:00 would have published at 05:00 local.

**Drafts are not implemented.** There is no draft state on `announcement`; a row
with a future `publish_at` is the nearest equivalent, and nothing marks a row as
an unpublished draft or restricts it to authorized editors. So the second clause
has no mechanism.

### P1-ANN-08 — Escalation reminders for critical unread announcements, without spamming those who acknowledged — **Complete**

`announcement-nudge` runs daily at 13:00 UTC (verified active). The
anti-spam clause is satisfied structurally rather than by a filter in the job:
`announcement_acknowledgment` is the join that determines who is outstanding, so
an acknowledged user is absent from the recipient set by construction.
`notification`'s `uq_notification_user_dedupe (user_id, dedupe_key)` gives a
second guarantee — a duplicate nudge is not merely avoided, it is unrecordable.

## Direct messages and inbox

### P0-DM-01 — 1:1 conversations visible only to participants — **Complete**

`conversation` + `conversation_member`, with the read policy reduced to a single
predicate: `conversation_read: app.is_conversation_member(id)`. Messages inherit
it — `message_read` requires `app.is_conversation_member(conversation_id)` for
any message with a `conversation_id`.

The table's policy set is worth noting as an instance of this project's
guarantee-by-absence pattern: `conversation` has **only** SELECT and INSERT
policies, no UPDATE and no DELETE, so a conversation cannot be renamed or removed
by anyone — including an organization admin. Compliance access, which the
requirement allows to be defined by policy, is therefore *not* implemented; there
is no admin read path, which is a defensible default and should be a recorded
decision rather than an accident.

### P1-DM-02 — Group DMs with messages, threads, files and mentions; convertible to a private channel — **Partial**

`conversation.is_group` and `conversation.title` support the group case, and
group conversations get messages, threads (`thread_root_id` is independent of
channel or conversation) and mentions for free.

Two clauses fail. **Files** — there are no attachments anywhere (P0-MSG-01,
P0-RES-01). **Conversion to a private channel** has no implementation: nothing
migrates a conversation's messages to a channel, and `message` rows carry either
`channel_id` or `conversation_id`, so conversion would need a real migration
path rather than a flag flip.

### P1-DM-03 — Mute, mark unread, search within, and leave group conversations — **Partial**

`conversation_member` carries `last_read_at`, so mark-unread is expressible, and
`global_search`'s message branch covers DM messages through the same
invoker-rights path — so search-within works, if only via global search.

**Mute is not supported for conversations.** `channel_member` has `muted_level`;
`conversation_member` does not — it holds only `conversation_id`, `user_id`,
`last_read_at`, `joined_at`. A user can mute a busy channel and cannot mute a
busy group DM, which is the louder of the two. Leaving is likewise unevidenced;
it would be a delete on `conversation_member`, and no such command was found.

### P0-INB-01 — Unified inbox across notifications, mentions/replies, DMs, approvals, required announcements and Gmail, with source filters — **Partial**

The unification is real and the Gmail half is the impressive part: the inbox page
reads notifications, the Gmail connection and `gmail_message` in one pass
(`src/app/(workspace)/inbox/page.tsx:47-57`), with a reply form
(`GmailReplyForm`) so mail can be answered without leaving the Hub. Source
filters exist (`{ key: "mention", label: "Mentions" }`, `:20`).

Coverage of the six named sources is uneven: platform notifications, mentions and
Gmail are directly represented; DMs, approvals/reviews and required announcements
reach the inbox only insofar as they generate a `notification` row, so they
appear as notifications rather than as first-class filterable sources. The
requirement asks for source filters across all six.

### P0-INB-02 — Two/three-pane responsive layout; mobile drill-in with preserved state — **Partial**

The desktop list/detail split exists on the inbox route. Mobile drill-in is
served by the app's responsive shell and the mobile bottom nav built in earlier
work.

"Preserved state" is the unmet clause and is the same finding as P1-MSG-08:
with no draft persistence, drilling into an item and returning loses anything
typed. No automated check covers the responsive behaviour either — `qa-matrix`
exercises widths but does not run anywhere (TST-004).

### P0-INB-03 — Link a relevant email or message to a program, project, task, CRM record, event or meeting — **Partial**

The working direction is message-to-record, and it is genuinely wired:
`source_message_id` is written from three paths in
`src/features/channels/services/message.commands.ts` (`:290`, `:330`, `:443`),
turning a message into a task, an agenda item or a decision while keeping the
link back to its origin. Those are real, and the corresponding columns
(`task.source_message_id`, `agenda_item.source_message_id`,
`decision.source_message_id`) are read by the features that display provenance.

Two qualifications keep this off Complete.

First, coverage. Of the six targets the requirement names — program, project,
task, CRM record, event, meeting — only **task** is directly supported, with
meeting reachable via an agenda item. Program, project, CRM record and event have
no linking path from a message.

Second, the general mechanism is inert. `message.source_record_type` and
`source_record_id` look like the polymorphic link that would cover the remaining
four, but `source_record_id` has exactly **one** writer in the codebase
(`meeting.commands.ts:648`, a system message about a meeting) and
`source_record_type` likewise — and **nothing reads either column**. So the
general facility exists in the schema, is written in one place, and is consumed
nowhere.

### P0-INB-04 — Triage: read/unread, star/save, archive/snooze, filter/search, convert to task — **Partial**

Four of five. Read/unread is `notification.read_at` with a supporting index
(`idx_notification_user (user_id, read_at, created_at DESC)`). Save is
`saved_message`. Filter and search are present (`:20`, plus global search).
Convert-to-task is `task.source_message_id`, written by the message commands.

**Snooze does not exist** — see P1-INB-05.

### P1-INB-05 — Defer an item until a chosen time; it returns to attention without losing context — **Missing**

No snooze column and no snooze table (catalogue sweep for `%snooze%` returns
nothing). `saved_message.remind_at` is the closest thing in the schema, but it
belongs to saved messages rather than to inbox items and nothing reads it — no
job scans `remind_at`, so even the reminder it implies does not fire.

### P2-DM-04 — Optional presence/status indicator — **Missing**

No presence table, no status column on `user_profile`, no realtime presence
channel (the single realtime subscription in the codebase is the channel message
feed, PERF-004). The requirement's caution about surveillance is satisfied
vacuously.

