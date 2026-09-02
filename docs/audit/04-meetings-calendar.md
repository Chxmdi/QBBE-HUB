# Domain audit — meetings, agendas, decisions, calendar, events, scheduling

<!-- progress: 20 of 20 assessed -->

Requirement families in scope: `CAL-001..006`, `P0-CAL-01/02`, `P1-CAL-03`,
`P0-MTG-01..04`, `P1-MTG-05`, `P0-AGD-01/02`, `P1-AGD-03`, `P0-EVT-01/02`,
`P1-EVT-03` — 20 IDs total (enumerated by grepping the spec for each prefix).

All paths are relative to `/home/user/QBBE-HUB`.

---

### P0-CAL-01 — Unified calendar (week/month)
**Verdict:** Partial
**Requirement:** Week and month views combine authorized meetings, events, task due
dates, milestones, report dates, CRM follow-ups, and optional connected-calendar overlays.
**Evidence:** `src/app/(workspace)/calendar/page.tsx:43` selects week/month;
`:65-113` runs six parallel range-bounded queries over `task`, `milestone`, `meeting`,
`event`, `crm_follow_up` and `calendar_event_link` (the Google overlay), merged into one
`CalendarItem[]` at `:115-164`. Week grid at `src/features/calendar/components/week-view.tsx:45`,
month grid at `calendar/page.tsx:263-333`, mobile agenda fallback at `week-view.tsx:150`.
Authorization is by RLS on each source table, not by a filter in the page.
**Gap:** **Report dates are not on the calendar.** `report_instance`
(`supabase/migrations/0003_operations.sql:187`) has `period_start`/`period_end` but no due
date column, and the calendar page never queries it. Six of the seven required sources are
present; the seventh has no data model to draw from.

### P0-CAL-02 — Create / reschedule schedule items
**Verdict:** Partial
**Requirement:** Authorized users can create or move schedule items while preserving
source-record rules and permissions.
**Evidence:** Source records do support it with permissions intact:
`src/features/meetings/services/meeting.commands.ts:89` `updateMeeting` re-validates staff
role, refuses completed/cancelled meetings (`:104`), restricts to organizer-or-admin (`:107`)
and mirrors the move to Google (`:113-127`); `createMeeting` at `:25`; `cancelMeeting` at
`:138`. Events likewise: `src/features/events/services/event.commands.ts:56` create, `:141`
update (rejects cancelled at `:157`), `:268` status change with Calendar deletion on cancel.
The meeting Edit dialog is wired at `src/app/(workspace)/meetings/[id]/page.tsx:112-126`.
**Gap:** **The calendar itself is read-only.** `src/app/(workspace)/calendar/page.tsx` has no
create action, no drag-to-move and no reschedule affordance — its only interactive elements
are view/date `Link`s (`:198-235`) and per-item links to the source record; `grep -rn "use
server" src/features/calendar` returns nothing and the directory holds only `week-view.tsx`
and the Google write client. `src/app/(workspace)/schedule/page.tsx` is equally read-only.
Also, only meetings and events are movable — task due dates, milestones and CRM follow-ups
are calendar-visible but have no reschedule path from any schedule surface.

### CAL-006 — Bounded, server-prepared Master Schedule
**Verdict:** Complete
**Requirement:** Master Schedule uses server-prepared date ranges and pagination rather than
an unbounded multi-year DOM timeline.
**Evidence:** `src/app/(workspace)/schedule/page.tsx:21` fixes `WINDOW_MONTHS = 6`;
`:44-46` computes the window server-side (`startOfMonth(addMonths(now, -1))` → +6 months);
`:48-57` queries `project` with `.limit(60)` and a stage filter; bars are positioned by
percentage offset within that window (`:119-128`) and anything outside renders as a text
stub, not DOM (`:167`). The calendar page is likewise bounded — `:50-63` derives the range and
every query carries `.gte/.lte` plus a `.limit()`.

### P0-MTG-01 — Meeting creation
**Verdict:** Partial
**Requirement:** A meeting links to program/project/event/relationship and stores organizer,
attendees, time, timezone, location/link, purpose and channel.
**Evidence:** `supabase/migrations/0003_operations.sql:14-33` — `meeting` has
`program_id`, `project_id`, `channel_id`, `organizer_id`, `starts_at`/`ends_at`,
`location`, `meeting_link`, `purpose`; `meeting_attendee` at `:35`. Create action
`src/features/meetings/services/meeting.commands.ts:25-77` (staff-gated, zod-validated,
derives `ends_at` from `durationMinutes`). Form at
`src/app/(workspace)/meetings/page.tsx:108-133`.
**Gap:** Three of the four context links do not exist: `meeting` has **no `event_id`** and
**no CRM relationship column** (`grep -n "meeting_id" supabase/migrations/*.sql` finds a
link only from `document` and `calendar_event_link`), and the create form exposes only
`projectId` — `program_id` and `channel_id` are never written by any code path
(`meeting.commands.ts:42-53`). **No timezone column** on `meeting`; times are UTC
`timestamptz` only (see CAL-002). **Attendees cannot be managed at all**: the only
`meeting_attendee` write in the whole of `src/` is the organizer self-insert at
`meeting.commands.ts:60`, and neither the list nor the detail page renders attendees.

### P0-AGD-01 — Agenda builder
**Verdict:** Partial
**Requirement:** Authorized users add, order and time-box agenda items; each item is
information / discussion / decision and carries an owner and a desired outcome.
**Evidence:** Schema is complete — `supabase/migrations/0003_operations.sql:43-57` has
`kind agenda_kind` (`information|discussion|decision`, enum at `0003:5`), `owner_id`,
`desired_outcome`, `time_box_minutes`, `sort_key`, `status`. `addAgendaItem`
(`src/features/meetings/services/meeting.commands.ts:193-231`) inserts kind + time box;
items render numbered in `sort_key` order with kind badge and time box at
`src/app/(workspace)/meetings/[id]/page.tsx:215-242`.
**Gap:** Three of the required attributes have no path from the UI. (a) **No ordering** —
`sort_key` is only ever set to `count + 1` at insert (`meeting.commands.ts:221`,
`message.commands.ts:291`); no server action anywhere updates it, so agenda order is
append-only and the spec's "drag reorder with button alternatives"
(spec §10.11) has neither. (b) **Owner is not selectable** — always forced to the creator
(`meeting.commands.ts:225`). (c) **`desired_outcome` is never written and never
displayed** — it is selected at `meetings/[id]/page.tsx:73` and then unused.

### P0-AGD-02 — Agenda submissions and triage
**Verdict:** Partial
**Requirement:** Invitees can propose agenda items; the organizer can accept, merge,
defer, reorder or decline them.
**Evidence:** The proposal half works. RLS lets any user who can read the meeting insert
an item (`supabase/migrations/20260818081647_scope_meeting_event_policies_to_organization.sql:26`,
`agenda_member_insert ... with check (app.can_read_meeting(meeting_id))`), and
`meeting.commands.ts:222-223` marks non-staff items `proposed` and staff items `accepted`;
the detail page shows a "Proposed" badge (`meetings/[id]/page.tsx:236-238`). Items can also
be proposed from a message (`src/features/channels/services/message.commands.ts:263-296`,
wired at `src/features/channels/components/message-item.tsx:133`).
**Gap:** **The organizer has no triage action of any kind.** The `status` column
(`proposed|accepted|deferred|declined|done`) is written only at insert; no command in
`src/` ever updates `agenda_item.status`, and there is no accept/merge/defer/decline
control on the detail page. Reorder is likewise absent (see P0-AGD-01). The
`agenda_staff_update` policy exists to permit this, so the database is ready and only the
command and UI are missing.

### P0-MTG-02 — Notes, decisions, actions
**Verdict:** Complete
**Requirement:** Notes are captured in context, decisions enter a decision log, and actions
become assigned tasks with due dates.
**Evidence:** Notes — `saveMeetingNotes` (`src/features/meetings/services/meeting.commands.ts:351-373`)
writes `meeting.notes`, edited inline on the detail page via
`src/features/meetings/components/meeting-notes-form.tsx:18-23` (`meetings/[id]/page.tsx:250`).
Decisions — `recordDecision` (`meeting.commands.ts:312-344`) inserts into the shared
`decision` table with `organization_id`, the meeting's `project_id`, `meeting_id` and
`decided_by`, so the row is a log entry, not meeting-local text; the same table is read by
report snapshots (`src/features/reports/services/report.snapshot.ts:78`) and exports
(`src/features/exports/services/export-builders.ts:70`). Actions — `addMeetingAction`
(`meeting.commands.ts:242-303`) creates a real `task` with `assignee_id`, `due_at`,
`project_id` inherited from the meeting and a description naming the source meeting, then a
`meeting_action` row (`:279-287`) linking `task_id`, `owner_id`, `due_at`, and finally a deduped
assignment notification (`:289-300`).
**Gap:** Minor deviations from the spec's data model, not from the requirement: notes are a
single `meeting.notes` text column rather than the `meeting_note` table the spec's
appendix lists, so notes are not per-agenda-item, and note/decision/action capture is
staff-only (`meeting.commands.ts:353`, `:314`, `:244`) — an attendee who is not staff can
read but not capture.

### CAL-004 — Meeting actions create tasks with source links
**Verdict:** Partial
**Requirement:** A meeting action can create a task carrying assignee, due date, source
meeting and source agenda item.
**Evidence:** `src/features/meetings/services/meeting.commands.ts:263-287` — task insert
with `assignee_id`, `due_at`, then `meeting_action` insert holding `meeting_id`, `task_id`,
`owner_id`, `due_at`. Columns `meeting_action.agenda_item_id` and `.task_id` exist at
`supabase/migrations/0003_operations.sql:73-82`.
**Gap:** `agenda_item_id` is available but never populated — `addMeetingAction` takes no
agenda item and there is no "create action from this agenda item" control on
`src/app/(workspace)/meetings/[id]/page.tsx:306-333`, so the *source agenda item* half of
the link is always null in practice. The source-meeting link is real.

### P0-MTG-03 — Meeting summary
**Verdict:** Partial
**Requirement:** A completed meeting produces a summary covering attendees, agenda,
decisions, actions with owners and due dates, unresolved items, and source links.
**Evidence:** `completeMeeting` (`src/features/meetings/services/meeting.commands.ts:380-474`)
gathers decisions and actions (`:394-401`) and composes a summary body listing decisions,
and actions with owner name and due date (`:426-441`); it is posted as a system message
carrying `source_record_type: "meeting"` / `source_record_id` (`:443-452`), which is the
source link. The completed detail page also renders agenda, decisions and actions
(`src/app/(workspace)/meetings/[id]/page.tsx:177-359`).
**Gap:** The summary covers three of the seven listed elements. It omits **attendees**
(nothing reads `meeting_attendee` outside the organizer self-insert), the **agenda**
(`agenda_item` is not queried by `completeMeeting`), and **unresolved items** — there is no
notion of an unresolved agenda item or open action anywhere, since `agenda_item.status` is
never updated after insert (see P0-AGD-02). There is also no durable summary record: the
summary exists only as the channel message body, so a meeting with no linked channel
produces no summary artifact at all.

### P0-MTG-04 — Communication handoff
**Verdict:** Partial
**Requirement:** The summary can be posted to the linked channel and action owners are
notified without duplicate alerts.
**Evidence:** Posting is real and idempotent —
`src/features/meetings/services/meeting.commands.ts:408-418` resolves a channel (explicit
`meeting.channel_id`, else the linked project's non-archived channel), `:420` posts only
when `summary_posted_at` is null, and `:453-457` stamps `summary_posted_at` after a
successful insert, so re-completing cannot double-post. Owner notification with dedupe:
`:289-300` writes one `notification` per action owner with
`dedupe_key: assign:<taskId>:<assignee>`, backed by the unique constraint
`uq_notification_user_dedupe (user_id, dedupe_key)`
(`supabase/migrations/20260818054333_notification_dedupe_upsert_constraint.sql:7`).
**Gap:** Two real holes. (a) **`meeting.channel_id` can never be set** — no code path in
`src/` writes it (`grep -rn "channel_id" src/features/meetings` shows reads only), so the
"linked channel" is in practice only the project channel fallback and a meeting with no
project can never post its summary. (b) **Completion does not notify action owners** —
`completeMeeting` fires `fireWorkflows(..., eventType: "meeting_completed", assigneeId:
meeting.organizer_id)` (`:461-471`), and `workflowRecipients` resolves that to the
organizer, a team or admins (`src/features/admin/services/workflow.runtime.ts:80-88`);
action owners are notified when the action is created, not when the summary is published,
and only if a workflow rule happens to be configured.

### P1-MTG-05 — Recurring meetings
**Verdict:** Missing
**Requirement:** A meeting series creates future occurrences, and one occurrence can be
changed without corrupting the series.
**Evidence:** None. `meeting` (`supabase/migrations/0003_operations.sql:14-33`) has no
recurrence, series or parent column, and no later migration adds one — the only
recurrence columns in the schema are `task.recurrence_rule` / `task.recurrence_anchor`
(`supabase/migrations/0008_spec_delivery.sql:11-13`). `grep -rn "recurrence\|recurring"
src/` matches only `src/features/tasks/*`; the recurrence helper and its tests
(`src/features/tasks/services/task.commands.ts:141-158`,
`src/features/tasks/tests/recurrence.test.ts`) are task-only. `createMeeting` accepts no
recurrence input (`src/features/meetings/services/meeting.commands.ts:15-23`).
**Gap:** Entirely absent, and it is a **schema gap rather than a wiring gap** — a migration
is needed before any of this can be built. Note the task recurrence machinery
(`nextOccurrence`, edit-this-vs-series handling) is reusable, so the cost is a column plus
a series-aware edit path, not a new engine.

### P1-AGD-03 — Agenda templates and carry-forward
**Verdict:** Missing
**Requirement:** Approved agenda templates can be applied, and unresolved agenda items
carry forward to the next meeting while preserving history.
**Evidence:** No agenda template table exists — the only template table in the schema is
`project_template` (`supabase/migrations/0008_spec_delivery.sql:188-196`), and
`grep -rln "template" src/features src/app` returns nothing under `meetings/`. There is no
carry-forward command: `agenda_item` has no `carried_from_item_id` or previous-meeting
reference (`supabase/migrations/0003_operations.sql:43-57`) and nothing in `src/` copies
items between meetings.
**Gap:** Both halves absent, and both need schema first (a template table, and a
carry-forward provenance column). Carry-forward is additionally blocked by P0-AGD-02:
with `agenda_item.status` never updated, "unresolved" cannot be computed at all.

### P0-EVT-01 — Event record
**Verdict:** Partial
**Requirement:** An event stores program/project, owner, type, schedule, location/link,
status, description, logistics checklist, files, channel, and volunteer-need references.
**Evidence:** `supabase/migrations/0003_operations.sql:87-108` — `event` has
`program_id`, `project_id`, `owner_id`, `event_type`, `starts_at`/`ends_at`, `location`,
`status event_status` (`planning|confirmed|in_progress|completed|cancelled`, enum at
`0003:6`), `description`, `volunteer_need`, `channel_id`. `createEvent`
(`src/features/events/services/event.commands.ts:56-126`) writes all of those except
`channel_id`, plus an `activity_event` row; `updateEvent` at `:141`; `updateEventStatus`
at `:268`. Detail page renders owner, location, volunteer need, program and project
(`src/app/(workspace)/events/[id]/page.tsx:137-171`).
**Gap:** Four elements are absent from the schema, not just the UI. (a) **No online
link** — `event` has no `event_link`/`meeting_link` equivalent (`meeting` has one), so
"location/link" is location only. (b) **No logistics checklist** — no table or column;
`checklist_item` (`supabase/migrations/0001_core.sql`) is task-scoped. (c) **No files** —
`document` carries `program_id`, `project_id`, `channel_id`, `meeting_id` and
`crm_organization_id` but **no `event_id`** (`supabase/migrations/0006_documents.sql:20-25`),
so a file cannot be attached to an event at all. (d) **Channel is unreachable** —
`event.channel_id` is never written by any code path (`grep -rn "event_id" src/` and
`event.commands.ts:69-84`); only the reverse `channel.event_id` FK exists
(`0003_operations.sql:108-110`) and nothing sets that either. Volunteer *need* is a count;
there are no volunteer-record references.

### P0-EVT-02 — Event role assignments
**Verdict:** Complete
**Requirement:** An event has distinct owners for logistics, communications, volunteers,
venue, content, registration and follow-up.
**Evidence:** `supabase/migrations/0003_operations.sql:112-119` — `event_assignment` with
`role` and `unique (event_id, user_id, role)`. `assignEventRole`
(`src/features/events/services/event.commands.ts:207-260`) validates the role against the
exact seven-value enum (`:200-203`), tolerates the duplicate-key path (`:220`), sends one
deduped notification keyed `event-role:<eventId>:<userId>:<role>` (`:231-243`) and fires
the `event_assignment_created` workflow (`:245-257`). UI picker over the same seven roles
at `src/app/(workspace)/events/[id]/page.tsx:17-20, 178-206`; assignments listed at
`:214-231`. RLS: `event_assignment_staff_write` requires `app.can_manage_event`
(`supabase/migrations/20260818081647_scope_meeting_event_policies_to_organization.sql:44`).

### P1-EVT-03 — Event retrospective
**Verdict:** Missing
**Requirement:** Completing an event prompts a structured after-action review and captures
reusable lessons.
**Evidence:** None. `grep -rn "retro\|lesson\|after_action" supabase/migrations/ src/`
matches only the *project* closeout path (`src/features/projects/services/project.commands.ts:300-328`,
`close-project-dialog.tsx:120-124`); there is no event equivalent. Setting an event to
`completed` (`src/features/events/services/event.commands.ts:268-305`) updates the status
column and nothing else — no prompt, no review record, no lessons field on `event`
(`supabase/migrations/0003_operations.sql:87-108`).
**Gap:** Entirely absent; needs a schema addition (an event retrospective table or
closeout columns). The `project_closeout` pattern is the obvious model to copy.

### CAL-001 — Shared calendar read model, distinct entities
**Verdict:** Complete
**Requirement:** Meetings, deadlines, milestones and events share one calendar read model
while remaining distinct domain entities.
**Evidence:** The read model is a single projection type,
`CalendarItem { id, date, label, kind, href, timed }`
(`src/features/calendar/components/week-view.tsx:12-19`), built in the page from six
separate source queries and never denormalized into a calendar table
(`src/app/(workspace)/calendar/page.tsx:65-164`). Each item keeps its own `kind` and a
deep link back to its source record (`:121`, `:129`, `:137`, `:145`, `:153`), and the
tables stay separate in the schema (`meeting`, `event`, `task`, `milestone` —
`supabase/migrations/0003_operations.sql`, `0001_core.sql`). Kind is shown as a text
prefix as well as color (`week-view.tsx:31-38, 107-109, 126-128`), satisfying the §10.9
"distinguishable without color alone" criterion, and timed vs all-day items are separated
(`week-view.tsx:65-66`).

### CAL-002 — Explicit time zone / DST safety
**Verdict:** Partial
**Requirement:** Scheduled date/times store an explicit time zone or a workspace-default
interpretation, and DST changes must not silently move them.
**Evidence:** Storage is DST-safe: every schedule column is `timestamptz`
(`meeting.starts_at/ends_at` `supabase/migrations/0003_operations.sql:22-23`,
`event.starts_at/ends_at` `:96-97`), so a stored instant cannot drift across a DST
boundary. A workspace default exists (`organization.timezone` default `America/Toronto`,
`supabase/migrations/0001_core.sql:32`; `user_profile.timezone` `:43`) and *is* honoured by
the background jobs (`src/features/jobs/services/handlers/due-date-reminders.ts:37-68`)
and the home page (`src/app/(workspace)/page.tsx:36-41, 80`).
**Gap:** **The meeting/event scheduling path ignores both zones.** Input comes from a
`datetime-local` field with no offset (`src/app/(workspace)/meetings/page.tsx:118`,
`events/[id]/page.tsx:104-105`) and is parsed with a bare `new Date(startsAt)` in the
server action (`src/features/meetings/services/meeting.commands.ts:35`, `:95`;
`src/features/events/services/event.commands.ts:29-33`), which resolves an offset-less
string in the **server's** zone, not the organization's. Display is the mirror image:
`formatDateTime`/`formatDate` (`src/lib/utils.ts:33-49`) call date-fns `format` with no
`timeZone`, inside server components, so times render in the server's zone too. Entry and
display cancel out, but anything that leaves that loop does not: the ISO instant handed to
Google Calendar (`meeting.commands.ts:68`) and the day-bucketing on the calendar grid
(`src/app/(workspace)/calendar/page.tsx:118`, `week-view.tsx:63`) will disagree with what
the user typed by the server's UTC offset. Neither `meeting` nor `event` has a timezone
column, so the per-record "explicit time zone" option is not available either.

### CAL-003 — Agendas, notes, decisions, actions persisted and linked
**Verdict:** Partial
**Requirement:** Meeting agendas, notes, decisions and actions are persisted and linked to
programs, projects and people.
**Evidence:** All four are durable tables/columns, not UI state:
`agenda_item` (`supabase/migrations/0003_operations.sql:43-57`), `meeting.notes` (`:27`),
`decision` (`:59-71`), `meeting_action` (`:73-82`). People links are real —
`agenda_item.owner_id`/`proposed_by`, `decision.decided_by`, `meeting_action.owner_id`,
all FKs to `user_profile`. Project links are real — `decision.project_id` is inherited from
the meeting on insert (`src/features/meetings/services/meeting.commands.ts:334`) and the
action's task inherits `project_id` (`:267`); reports and exports read decisions by project
(`src/features/reports/services/report.snapshot.ts:78`,
`src/features/exports/services/export-builders.ts:70`).
**Gap:** **Program linkage is effectively absent.** `decision` has no `program_id` column at
all (`0003_operations.sql:59-71`), and while `meeting.program_id` exists it is never
written — the create form offers only a project (`src/app/(workspace)/meetings/page.tsx:111-117`)
and `createMeeting` inserts no `program_id` (`meeting.commands.ts:42-53`) — so nothing
downstream can resolve a meeting artefact to a program. Separately, decisions are not in
the global search projection (`supabase/migrations/20260827164411_search_raid_and_documents.sql:103-110`
indexes meetings and events but not `decision`), which breaks the §10.11 acceptance
criterion that decisions "remain searchable".

### CAL-005 — Provider-agnostic meeting links
**Verdict:** Partial
**Requirement:** External meeting links are provider-agnostic fields; the Hub must not
require a specific conferencing vendor.
**Evidence:** The field is agnostic by design — `meeting.meeting_link text` with the
comment `-- provider-agnostic (CAL-005)` (`supabase/migrations/0003_operations.sql:25`),
validated only as a URL (`src/features/meetings/services/meeting.commands.ts:22`), hinted
"Google Meet, Zoom, Teams — any provider"
(`src/app/(workspace)/meetings/page.tsx:127-132`), and rendered as a plain external anchor
(`src/app/(workspace)/meetings/[id]/page.tsx:162-171`). Nothing conferencing-specific is
parsed from it.
**Gap:** **The Google Calendar write path silently overwrites it.** `createMeeting`
(`meeting.commands.ts:68-69`) calls `createGoogleMeetingEvent` and then, if a link comes
back, does `update({ meeting_link: googleLink })` — and that value is Google's
`event.htmlLink` (`src/features/calendar/services/google-calendar-write.ts:110, 126`),
i.e. the Google Calendar *event page*, not a conferencing URL. So an organizer who pastes
a Zoom or Teams link and has Calendar connected loses it, and the "Join meeting" button
then points at a Google page. `updateMeeting` repeats the same overwrite (`:114-121`).
`cancelMeeting` also nulls `meeting_link` (`:159`), discarding a user-supplied
provider link that had nothing to do with Google.

### P1-CAL-03 — Google Calendar integration
**Verdict:** Unverifiable here (code paths verified present and wired; live behaviour cannot be exercised)
**Requirement:** A user can connect an approved Google Calendar account for overlay and
meeting sync, with scoped OAuth and clear sync status.
**Evidence:** Every part of the path exists and is wired, not stubbed.
*Scoped OAuth:* `src/app/api/integrations/google/start/route.ts:15-22` requests exactly
`https://www.googleapis.com/auth/calendar.events` for `google_calendar` (narrowest scope
that allows Hub-owned create/update/delete), with `state` bound to the signed-in user and
an httpOnly state cookie (`:40-48`); the callback re-checks state and user
(`src/app/api/integrations/google/callback/route.ts:22-33`) and stores tokens server-side
in `integration_secret` (`:83-90`), never in the client.
*Overlay + sync token:* `fetchCalendarOverlay`
(`src/features/inbox/services/gmail-sync.ts:254-298`) pages `singleEvents=true`,
`showDeleted=true`, passes `syncToken`, treats HTTP 410 as "full synchronization is
required" (`:269`), and returns `{rows, removedIds, syncToken}`; the token is persisted to
`integration_secret.google_calendar_sync_token`
(`supabase/migrations/20260818071502_google_calendar_sync_token.sql`) on both connect
(`callback/route.ts:157-160`) and each incremental run
(`src/features/jobs/services/handlers/google-sync.ts:142-146`).
*Cancellation reconciliation:* Google `status === "cancelled"` becomes `removedIds`
(`gmail-sync.ts:275-279`) and those overlay rows are deleted
(`google-sync.ts:133-141`), scoped with `.is("meeting_id", null).is("event_id", null)` so
Hub-owned records are never destroyed by an overlay pass; the 410 path re-fetches *before*
clearing the mirror (`google-sync.ts:151-165`).
*Linked Hub records:* `calendar_event_link.meeting_id`/`event_id` plus partial unique
indexes make Hub writes idempotent
(`supabase/migrations/0015_calendar_hub_links.sql:4-9`,
`20260818070312_calendar_event_link_event_user.sql`); create/update/delete against Google
live in `src/features/calendar/services/google-calendar-write.ts:84-187`, called from
`meeting.commands.ts:68,114,164` and `event.commands.ts:104,171,287`.
*Sync status:* `integration_connection.status`/`last_error`/`last_sync_at` are surfaced on
the admin integration card (`src/app/(workspace)/admin/page.tsx:350-384`) with a
disconnect control (`src/features/admin/components/integration-actions.tsx:28-32` →
`integration.commands.ts:8-31`); failures set `degraded`/`error` at every call site
(e.g. `meeting.commands.ts:70-72`, `event.commands.ts:38-54`). The job is scheduled every
15 minutes via pg_cron (`supabase/migrations/20260820170000_register_integration_jobs.sql:19-21,32-45`).
**Gap:** What cannot be settled here: no Google credentials or egress in this container, so
token exchange, refresh, scope acceptance and real 410/incremental behaviour are unexercised.
Unit coverage is thin — `src/features/calendar/tests/google-calendar-write.test.ts` only
tests `calendarEventDeleteSucceeded` and `calendarLinkRecordFields`; nothing fakes a
Calendar HTTP response. **What would settle it:** a connect-and-sync run against a real
Google account in a staging project, or fetch-level fakes for `fetchCalendarOverlay`
covering the initial sync, an incremental page, a cancelled event, and a 410.
Two code-level caveats stand regardless: the feature flag `google_calendar_overlay`
(`supabase/migrations/0008_spec_delivery.sql:210`, default `false`) is **never read
anywhere in `src/`**, so it gates nothing; and the overwrite of `meeting.meeting_link`
with Google's `htmlLink` described under CAL-005 is a real defect in this path.

---

## Summary

**Counts (20 of 20 assessed).** Complete 4 · Partial 12 · Missing 3 · Unverifiable 1.

| Verdict | IDs |
|---|---|
| Complete | CAL-001, CAL-006, P0-MTG-02, P0-EVT-02 |
| Partial | CAL-002, CAL-003, CAL-004, CAL-005, P0-CAL-01, P0-CAL-02, P0-MTG-01, P0-MTG-03, P0-MTG-04, P0-AGD-01, P0-AGD-02, P0-EVT-01 |
| Missing | P1-MTG-05, P1-AGD-03, P1-EVT-03 |
| Unverifiable | P1-CAL-03 |

### The three findings a maintainer should see first

**1. Attendees cannot be managed, and that quietly closes meetings to everyone but staff.**
`app.can_read_meeting` grants read to staff, the organizer, or a listed attendee
(`supabase/migrations/20260818081647_scope_meeting_event_policies_to_organization.sql:1-6`) —
correct, and properly tested (10 allow/deny assertions,
`supabase/tests/rls.sql:330-379`). But the only `meeting_attendee` write anywhere in `src/`
is the organizer's self-insert (`src/features/meetings/services/meeting.commands.ts:60`);
there is no invite UI, no attendee list on either meetings screen, and no command. So the
attendee branch of the policy is dead code in production: a non-staff invitee can never
see a meeting, which contradicts the spec's role table (volunteers receive
"meeting/event information") and blocks P0-AGD-02's "invitees can propose items" in
practice even though its RLS policy is ready. `app.can_read_event` has the same shape and
is at least reachable, since event roles *can* be assigned.

**2. Four requirements fail on a missing schema affordance, not missing wiring** — these
are the expensive ones. `report_instance` has no due-date column, so report dates cannot
reach the calendar (P0-CAL-01, already recorded). `meeting` has **no recurrence/series
column** at all, so P1-MTG-05 is a migration away from even being buildable. `document`
has **no `event_id`**, so event files (P0-EVT-01) are impossible; `event` also lacks an
online-link column and any logistics-checklist structure. There is **no agenda template
table and no carry-forward provenance column** (P1-AGD-03). Everything else in this domain
is a command-and-UI gap over a schema that is already right.

**3. Google Calendar sync destroys the provider-agnostic meeting link.**
`createMeeting`/`updateMeeting` overwrite `meeting.meeting_link` with whatever
`createGoogleMeetingEvent` returns (`meeting.commands.ts:68-69`, `:114-121`), and that
value is Google's `event.htmlLink` — the Calendar event page, not a conferencing URL
(`src/features/calendar/services/google-calendar-write.ts:110,126`). An organizer who
pastes a Zoom or Teams link and has Calendar connected loses it, and "Join meeting" then
opens Google. This breaks CAL-005 explicitly ("QBBE Hub should not require a specific
conferencing vendor") and is a two-line fix.

### Also worth a maintainer's attention

- **A timezone correctness bug in scheduling (CAL-002).** `datetime-local` input is parsed
  with a bare `new Date(...)` server-side and rendered with date-fns `format` with no
  `timeZone`, so meeting times live in the *server's* zone. Entry and display cancel out,
  but the instant sent to Google Calendar and the calendar grid's day-bucketing do not.
  `organization.timezone` exists and is already used correctly by the job handlers
  (`src/features/jobs/services/handlers/due-date-reminders.ts:37-68`) — the scheduling
  path simply never asks for it.
- **Agenda items are write-once.** Nothing in `src/` ever updates `agenda_item.status` or
  `sort_key`, so no reorder, no accept/defer/decline, and "unresolved items" cannot be
  computed — which is why P0-AGD-01, P0-AGD-02, P0-MTG-03 and P1-AGD-03 all degrade
  together. One `updateAgendaItem` command unblocks three and a half requirements.
- **`meeting.channel_id` and `event.channel_id` are unwritable**, so the summary handoff
  (P0-MTG-04) only works for meetings that happen to have a project with a channel.

### Where the code is better than `docs/spec-coverage.md` claims

- The coverage matrix records nothing at all for `CAL-001/002/003/004/005/006`,
  `P0-MTG-*`, `P0-AGD-*` or `P0-EVT-*` — 19 of my 20 IDs are simply absent from it, yet
  four of them are fully implemented with citable evidence (CAL-001, CAL-006, P0-MTG-02,
  P0-EVT-02). Meeting-child RLS in particular is stronger than any document claims: 10
  allow/deny assertions in `supabase/tests/rls.sql:330-379` covering meeting, attendee,
  agenda, decision and action in both directions.
- The Google Calendar sync handler is more careful than a filename would suggest: it
  distinguishes Hub-owned links from imported overlay rows on every destructive path
  (`.is("meeting_id", null).is("event_id", null)`), and on a 410 it re-fetches *before*
  clearing the mirror so a transient failure cannot lose the overlay
  (`src/features/jobs/services/handlers/google-sync.ts:151-165`).
- Conversely, one row is **overstated**: `docs/spec-coverage.md:48` lists `P1-CAL-03` under
  "Implemented in-product" with no gating note, while the comparable Gmail row (`:41`) is
  honestly marked "**Gated** on Google credentials". Calendar is gated on exactly the same
  credentials and deserves the same qualifier.

### Method note

Verdicts resting on signed-in UI behaviour are code-read, not executed: per
`docs/audit/09-definition-of-complete.md` (DONE-001) the authenticated Playwright matrix
`tests/e2e/qa-matrix.spec.ts` is not in CI, so no screen in this domain has a recorded
passing run against a live database. Nothing here was verified against Google, Supabase
Cloud or a browser.
