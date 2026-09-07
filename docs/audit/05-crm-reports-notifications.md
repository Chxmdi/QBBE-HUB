# Domain audit — CRM, reports, notifications, workflow, repository structure

**Complete — 50 of 50 assessed.**

**The shape of this family:** notifications are the best-engineered subsystem in
the project; reports are close behind; CRM is solid; workflow is a small safe
library that does less than the requirements describe; and repository structure
is the weakest area, with a rule that is stated in the specification and observed
nowhere.

The standout is `decideDelivery` — a pure, tested function that resolves
mandatory-notice overrides, per-category preferences, digest routing, urgency and
quiet hours in one place, and **defers** rather than drops during quiet hours.
That is the correct behaviour and the one a naive implementation gets wrong.

Three findings lead:

1. **No feature exports a public surface** (REP-001). 23 feature directories,
   **zero `index.ts` files**, and 54 imports that reach across a feature boundary
   into another feature's `components/` or `services/`. The requirement's
   boundary does not exist, so nothing distinguishes a feature's API from its
   internals.
2. **Route files carry the application's largest bodies of logic** (REP-002,
   REP-006). `src/app/(workspace)/page.tsx` is **738 lines**; the admin route is
   600. The requirement asks routes to route, gate, compose and render.
3. **Scheduled report distribution does not exist** (P1-RPT-06), and neither do
   report templates (P1-RPT-03, RPT-005) — so the presentation/calculation
   separation the spec asks for has not been made.

Evidence conventions follow the shared briefing. Where a verdict rests on a
column, the report states which code writes it — three verdicts elsewhere in this
audit were corrected for assuming a column implied a feature.

## Notifications

### NTF-001 (P0) — Every notification carries category, source_type/source_id, recipient, reason, urgency, dedupe_key, created_at, read_at and delivery state — **Partial**

`notification` carries `category`, `source_type`, `source_id`, `user_id`
(recipient), `urgency`, `dedupe_key`, `created_at`, `read_at`, plus `title`,
`body` and `link`. Eight of the ten named fields.

**`reason` has no column.** The requirement separates *category* (what kind of
thing happened) from *reason* (why this user is receiving it — mentioned,
assigned, following), and that second field is what makes a notification
explainable to its recipient and what P0-NOT-04's deduplication logically keys
on. Its absence is why dedupe is implemented as a single opaque `dedupe_key`
string rather than as a set of reasons collapsed into one alert.

*Delivery state* is deliberately not on this table — it lives on `email_delivery`
(`status`, `attempt`, `last_error`, `suppressed_reason`, `sent_at`). That is the
correct design and is what NTF-002 requires, so it should not be read as a gap.

### NTF-002 (P0) — Notification creation and external delivery decoupled — **Complete**

Fully decoupled, in the strong sense. A business action writes a `notification`
row; a separate queue drains it (`drain-notifications`, on a one-minute cron,
verified active in production) and writes `email_delivery`. A provider failure
therefore cannot roll back the business action, because they are not in the same
transaction — the row is already committed before delivery is attempted.

`email_delivery` records the failure (`last_error`, `attempt`,
`suppressed_reason`) instead of propagating it, and this session wired
`reportError` into the paths that previously swallowed it.

### NTF-003 (P0) — Users control categories, digests, channel mute level and quiet hours, within organizational minimums for mandatory critical notices — **Complete**

Every clause has a mechanism, and they meet in one tested function.

`notification_preference` holds the per-category switches
(`email_assignments`, `email_mentions`, `email_announcements`,
`email_due_dates`), the digest controls (`email_digest`, `digest_hour`,
`timezone`), the urgent opt-in (`email_critical`) and `quiet_hours_start`/`_end`.
Channel mute level is `channel_member.muted_level`.

The organizational minimum is enforced first and unconditionally:
`decideDelivery` returns `{ action: "send" }` for `isMandatory(notification)`
**before** consulting any preference
(`src/features/notifications/services/delivery-rules.ts:170`). A user therefore
cannot suppress a mandatory critical notice by any combination of settings —
which is the clause most likely to be lost when preferences are added later, and
here it is the second thing the function does.

### NTF-004 (P0) — Retries idempotent and bounded; dead-letter jobs visible to admins — **Complete**

Bounded by `job_definition.max_attempts`, configured per job rather than
hard-coded, and enforced at `drain-notifications.ts:538` — past the limit the
message is archived and logged as `job.notification.poisoned`. Visibility is
real: `job_queue_dead_letters` is queried by the admin Jobs panel
(`src/features/jobs/services/jobs.queries.ts:113`).

Idempotency holds for this queue specifically because
`uq_notification_user_dedupe (user_id, dedupe_key)` makes a duplicate
notification unrecordable rather than merely unlikely. Note the narrower scope
recorded under JOB-003: that guarantee is the notification domain's, not the
queue's, so other queues do not inherit it.

### NTF-005 (P1) — Digests group repeated updates rather than one email per event — **Complete**

`daily-digest` runs hourly and selects only users with `email_digest` set
(`daily-digest.ts:45`), honouring each user's `digest_hour` and `timezone` so the
digest arrives at their morning rather than the server's. The routing decision
sits in `decideDelivery`: a low-urgency notification for a digest subscriber is
suppressed from immediate send with reason `low-urgency-digest-only`
(`delivery-rules.ts:177-179`), so it is diverted into the digest rather than
duplicated across both paths.

### NTF-006 (P1) — Delivery-failure and opt-out analytics without storing unnecessary message content in telemetry — **Partial**

The data exists: `email_delivery.status`, `attempt`, `last_error` and
`suppressed_reason` record every failure and every opt-out with its cause, and
the admin Email deliveries screen reads them. The privacy clause is respected —
`sanitizeJobError` keeps provider payloads out of the job ledger, and
`reportError` receives a digest and a context bag rather than message bodies.

What is missing is *analytics*: nothing aggregates these rows into failure rates
or opt-out patterns over time. An operator can inspect individual deliveries and
cannot see a trend, which is the same absence recorded under ENG-008 (no
performance metrics or product analytics anywhere).

### P0-NOT-01 (P0) — Unread state across channels, threads, DMs, mentions, announcements and inbox items, persisted across sessions — **Partial**

Durable and server-side where it exists: `channel_member.last_read_at`,
`conversation_member.last_read_at`, `notification.read_at` with a supporting
index, and `announcement_acknowledgment` for announcements. All survive sessions
and devices because none is browser state.

**Threads are the exception**, and it is the same finding as P0-MSG-02: there is
one cursor per member per channel and no thread read-state table anywhere in the
catalogue, so thread unread is not tracked at all.

### P0-NOT-02 (P0) — Per-channel all/mentions/muted; security notices and required announcements cannot be fully suppressed — **Complete**

`channel_member.muted_level` provides the per-channel setting. The
non-suppressible half is enforced in `decideDelivery` by the `isMandatory` check
described under NTF-003, which precedes every preference lookup — so a required
announcement reaches its recipient regardless of channel mute level or category
switch.

### P0-NOT-03 (P0) — Immediate in-app and browser notifications; email for selected critical categories with deep links — **Partial**

In-app is present (the `notification` table drives the inbox and bell), and email
is well developed: category selection through `notification_preference`, and
`notification.link` carries the deep link, which resolves through RLS at the
destination and so is safe to email (P0-UX-06).

**Browser notifications are absent.** There is no Notification API usage, no
service worker and no push subscription table. The requirement names browser
notifications alongside in-app as the immediate channel; only one of the two
exists.

### P0-NOT-04 (P0) — One event does not create duplicate alerts when a user is mentioned, assigned and following the same record — **Partial**

The enforcement mechanism is strong: `uq_notification_user_dedupe (user_id,
dedupe_key)` makes a second alert for the same key unrecordable, so where callers
agree on a key, duplication is impossible rather than merely avoided.

The weakness is that correctness depends on every producer computing the same
`dedupe_key` for the same underlying event. With no `reason` column (NTF-001) the
key must encode the event identity by convention, and nothing validates the
convention — no test asserts that the mention path and the assignment path for
one record produce an equal key. So the requirement's exact scenario is
guaranteed by discipline at the call sites, not by the schema.

### P1-NOT-05 (P1) — Digest mode groups general activity; urgent assignments, mentions and critical announcements stay immediate — **Complete**

Exactly this split, in one readable place. `decideDelivery` diverts only
`urgency === "low"` into the digest (`:177`), and returns `send` for
critical/high urgency where the user has opted in to being reached (`:181-185`),
with mandatory notices already handled above. Covered by
`tests/unit/delivery-rules.test.ts`.

### P1-NOT-06 (P1) — Quiet hours with defined urgent/security exceptions — **Complete**

`inQuietWindow(prefs, now)` returns `{ action: "defer", delaySeconds:
secondsUntilQuietEnds(prefs, now) }` (`:187-190`) — **deferred, not dropped**,
which is the distinction that decides whether quiet hours are a feature or a way
to lose mail. The window is evaluated against the user's own `timezone` column.

The exceptions are explicit and commented rather than incidental: urgent work
where the user opted in returns `send` before the quiet-hours check is reached,
with the reasoning stated in the code — "Explicitly opted in to being reached for
urgent work, quiet hours or not" (`:183`).

## CRM

### CRM-001 (P0) — Organizations and contacts separate; contacts belong to an organization and retain history when ownership changes — **Complete**

`crm_organization` and `crm_contact` are separate tables, joined by
`crm_contact.crm_organization_id`. History survives ownership change
structurally: `crm_interaction` references `contact_id` and
`crm_organization_id`, and carries its own `owner_id` recording who conducted the
interaction — so changing `crm_contact.owner_id` re-points the relationship
without touching any interaction row.

### CRM-002 (P0) — Interactions record channel/type, date, owner, summary, next action, linked message where permitted, and follow-up date — **Partial**

`crm_interaction` covers most of it: `interaction_type` (channel/type),
`occurred_at`, `owner_id`, `summary`, `next_steps`. The follow-up date lives on
`crm_follow_up.due_at` as a separate record, which is a reasonable normalisation.

**The linked email/message is missing.** `crm_interaction` has no
`message_id`, `gmail_message_id` or source reference of any kind, so an
interaction cannot cite the mail or message it records. This is the CRM instance
of the P0-INB-03 gap: message-to-record links exist for tasks, agenda items and
decisions, and not for CRM.

### CRM-003 (P0) — Opportunities use configurable stages, not hard-coded visual columns — **Partial**

`opportunity.stage` is a data column, not a UI construct, and the pipeline is
driven from it — with `is_open`, `amount_requested`, `amount_awarded`,
`decision_expected_at` and `decided_at` alongside, so a stage carries real
semantics rather than a column position.

"Configurable" is the unmet half: the stage set is fixed in the schema and in
`src/types/entities.ts`, and there is no admin surface for defining stages. An
organization wanting a different pipeline needs a migration and a deploy.

### CRM-004 (P1) — Private/internal notes support more restrictive permissions than general contact metadata — **Missing**

`crm_contact.notes` and `crm_organization.notes` are ordinary text columns on the
main record, and **RLS grants rows, not columns**. Any policy that lets a user
read the contact necessarily lets them read the notes, so the requirement is not
merely unimplemented — it is not expressible in the current shape.

This is the same structural fact behind two authorization holes already fixed in
this project (agenda self-approval, the storage bucket). Making it expressible
needs the notes moved to their own table with their own policy, or a
column-privilege scheme; a flag on the existing row cannot do it, and a check in
the query layer would be the kind of application-side authorization ADR-002
rules out.

### CRM-005 (P1) — Duplicate detection warns on matching email/domain/name while allowing deliberate duplicates — **Complete**

Implemented with the right interaction shape:
`src/features/crm/components/crm-organization-dialog.tsx` surfaces possible
matches before creation, blocks the first submit while duplicates are unresolved,
and proceeds once acknowledged (`:50-51`). That is precisely "warn ... while
allowing deliberate duplicates when justified" — a warning that can be overridden
deliberately, rather than a block or a silent accept.

### P1-CRM-01 (P1) — Manage funders, sponsors, schools, universities, community organizations, government bodies, vendors, media, donors, associations — **Complete**

`crm_organization.category` types the relationship and is used as the search
snippet, with `status`, `website` and `owner_id` completing the record. The named
kinds are category values rather than separate tables, which is the right
modelling choice — a school and a funder differ in category, not in structure.

### P1-CRM-02 (P1) — Contacts store role, approved contact details, relationship owner, status, preferred channel, and visibility-controlled notes — **Partial**

Five of six: `role_title`, `email`/`phone`, `owner_id`, `status`,
`preferred_channel`. The sixth — **visibility-controlled notes** — is CRM-004
above, and fails for the same structural reason.

### P1-CRM-03 (P1) — Interaction history records meetings, calls, emails, notes, documents and shared messages, with outcomes and next steps — **Partial**

Outcomes and next steps are covered (`summary`, `next_steps`), and
`interaction_type` distinguishes meetings, calls, emails and notes.

Documents and shared messages are not linkable to an interaction: `document`
carries a `crm_organization_id` so a document can attach to the *organization*,
but nothing ties it to the interaction it belongs to, and messages have no CRM
link at all (CRM-002).

### P1-CRM-04 (P1) — Each active relationship and opportunity has one accountable owner and a next action/review date — **Complete**

Ownership is single-valued by construction: `crm_organization.owner_id`,
`crm_contact.owner_id`, `opportunity.owner_id` — one column each, so two
accountable owners cannot be recorded. The next action date is
`crm_follow_up.due_at` for relationships and `decision_expected_at` for
opportunities, and both are read by the surfaces that chase them
(`crm/page.tsx:45`, `calendar/page.tsx:96`).

### P1-CRM-05 (P1) — Organizations and contacts link to programs, projects, events, grants, agreements, tasks, meetings and channels — **Partial**

The strongest links run through `opportunity`, which carries both `program_id`
and `project_id` — so a grant conversation connects to the work it funds, which
is the most valuable link in the set. `document.crm_organization_id` attaches
files to a relationship.

Events, tasks, meetings and channels have no CRM reference. A meeting with a
funder cannot be recorded against that funder except as free text in an
interaction summary.

### P1-CRM-06 (P1) — Overdue and upcoming follow-ups appear in My Work/Inbox and can create tasks/reminders — **Partial**

The reminder path is real and running: `due-date-reminders` reads `crm_follow_up`
(`:129`) and writes notifications with `source_type: "crm_follow_up"` (`:159`),
so an overdue follow-up reaches the inbox as a notification. Follow-ups also
surface on the CRM pages and the calendar (`calendar/page.tsx:96`).

Two gaps: they do **not** appear in My Work, which the requirement names
specifically alongside Inbox, and there is no convert-to-task action from a
follow-up.

### P2-CRM-07 (P2) — Opportunity pipeline with configurable stages, expected value, probability, timing, purpose, restrictions and documents, labelled as estimates — **Partial**

Well covered on value and timing: `amount_requested` and `amount_awarded` as
separate columns (so the ask and the award never blur), `currency`,
`submitted_at`, `decision_expected_at`, `decided_at`, `outcome_note`, `kind` and
`is_open`. Search surfaces these deliberately, sorting open opportunities first
and by size within that.

Missing: **probability** has no column, so expected value cannot be weighted;
**restrictions** have none; documents attach to the organization rather than the
opportunity; and stage configurability is CRM-003. The "clearly labeled as
estimates" clause has no representation, though with no probability field there
is currently no estimate to label.

## Reports

### P0-RPT-01 (P0) / RPT-002 (P0) — Quarterly per-program report from live data, automatically including qualifying milestones, work, meetings, decisions, outcomes and approved status updates — **Complete**

`buildReportSnapshot` (`src/features/reports/services/report.snapshot.ts`,
invoked from `report.commands.ts:10,46`) composes the report from live data at
generation time. `report_instance` carries `report_type`, `program_id`,
`period_start`/`period_end`, so a quarterly per-program report is a first-class
row rather than a rendering choice, and the period bounds are what make
"qualifying" decidable.

### P0-RPT-02 (P0) — Project report with outcome, health, progress, milestones, blockers, decisions, next steps and recent activity — **Complete**

Same generator, with `report_instance.project_id` selecting the project variant.
The inputs exist as first-class records rather than prose: `project.health` and
`health_reason` (read by the dashboard's program-health computation), `risk` and
`issue` for blockers, `decision`, `project_status_update`, and `activity_event`
for recent activity.

### P0-RPT-04 (P0) / RPT-003 (P0) — Authorized PDF and CSV export, permission-respecting, timestamped, generated server-side, stored privately, time-limited access — **Complete**

Every clause has a mechanism. Generation is a background job (`run-exports`, on a
five-minute cron, verified active) writing to `export_job`, so nothing is
produced in the request. Storage is private (`export_job.storage_path`).
Time-limiting is `expires_at` with a tested predicate — `isDownloadable` is
covered by `src/features/exports/tests/exports.test.ts:105-121` across statuses
and both sides of the expiry boundary, so this is verified by execution rather
than asserted.

Permissions hold because the export is generated by a job acting for a requesting
user and the download route re-checks; that route also writes `audit_event` and
increments `download_count` via `count_export_download`, giving the access trail
DEV-006 asks for. `expire-exports` cleans up on its own schedule.

### RPT-001 (P0) — Generation based on a versioned snapshot; approved or exported versions remain reproducible even if live records change — **Complete**

The requirement's exact mechanism, and the code says so:
`report.commands.ts:21-22` — "Report generation from a versioned snapshot of live
data (RPT-001): the snapshot is captured at generation time so approved reports
remain [reproducible]". `report_instance.snapshot` and `report_version.snapshot`
are both stored, with `report_version.version_number` ordering them, so an
approved version reproduces from its own captured data rather than by re-querying
records that have since moved.

### RPT-004 (P1) — Approval records include approver, timestamp, report version, status and optional comment — **Complete**

`report_approval (id, organization_id, report_version_id, decision, note,
decided_by, decided_at)` — all five named fields, with `note` optional and
`report_version_id` tying the decision to the exact version approved rather than
to the report. `report_instance` additionally denormalises `approved_by` and
`approved_at`.

An earlier migration in this project's history (`20260828160343`,
`approve_request_requires_an_actor`) shows the actor requirement was tightened
deliberately rather than assumed.

### P1-RPT-05 (P1) — Draft → review → approved, with edits creating versions and preserving who approved what — **Complete**

`report_instance.status` carries the workflow state and `report_version` records
each edit as a numbered version with its own snapshot, so "edits create versions"
is structural. `report_approval` preserves who approved which version — the
requirement's last clause — because it references `report_version_id` and not
just the report.

### P1-RPT-03 (P1) — Admin-defined approved report structures and visibility rules — **Missing**

No report-template table exists. `report_type` is a fixed column value, so the
structure of each report kind is compiled into `buildReportSnapshot` rather than
configured. An admin cannot define an approved structure for a board or funder
report without a code change.

### RPT-005 (P1) — Templates separate content structure from brand styling — **Missing**

Follows from P1-RPT-03: with no template layer, structure and presentation are
both inside the generator and the PDF writer (`src/lib/simple-pdf.ts`,
`src/features/reports/tests/pdf.test.ts`). QBBE cannot update presentation
without changing code that also computes content, which is the specific coupling
this requirement exists to prevent.

### P1-RPT-06 (P1) — Approved reports scheduled for secure email distribution to authorized recipients — **Missing**

No handler in `src/features/jobs/services/handlers/` touches reports — the only
files mentioning reports are the notification drain and the Google sync, neither
of which distributes one. There is no schedule, no recipient list, and no
distribution record. Reports are pull-only: an authorized user exports one.

### P1-RPT-07 (P1) — Reports may cite announcements, meeting summaries, status updates and decisions as evidence without exposing private channel content — **Partial**

The evidence types exist and are cited: the snapshot draws on `decision`,
`project_status_update` and meetings, so a report carries them as content.

The safety clause is where this is unproven. Because the snapshot is **captured
at generation time and stored**, evidence is frozen into `report_instance.snapshot`
— and a later reader of the report reads the snapshot, not the source records
through RLS. So the permission check happens once, for the generator, and never
again for the audience. That is the correct design for reproducibility (RPT-001)
and it means the two requirements pull against each other: whoever can read the
report can read whatever the generator could, including any private-channel
material that reached the snapshot.

Nothing currently pulls private channel messages into a snapshot, so there is no
live exposure. But no assertion prevents a future evidence type from doing so,
and the RLS suite cannot catch it, because by then the content is a JSON column
on a row the reader is entitled to. This is the one place in this family where a
structural guarantee is absent and the requirement depends on care.

## Workflow

### P1-WF-01 (P1) — Admins configure triggers and actions from a safe library rather than arbitrary code — **Complete**

The library is a closed set, enforced by validation rather than convention:
`actionCategory: z.enum(["notify_assignee", "notify_admins", "notify_event_owner",
"notify_team"])` (`src/features/admin/services/workflow.commands.ts:62`), with a
refinement requiring `actionTeamId` when the action is `notify_team` (`:65-66`)
and a lookup confirming the team exists (`:76-80`).

So an admin composes a rule from four named actions; there is no expression
language, no code, and no template string to inject into. `workflow_rule` stores
`trigger_event`, `condition` and `action`, and `workflow_execution` logs every
firing with `outcome`, `recipient_count` and `detail` — an audit trail for
automated actions, which is more than most of the destructive manual actions get
(DEV-006).

### P1-WF-02 (P1) — Task rules: new assignment → notify owner; overdue critical → owner plus project channel; health off-track → leadership channel — **Partial**

The first example is served — `notify_assignee` is one of the four actions, and
assignment notifications are a live category (`email_assignments`).

The other two are not expressible. Every action in the library notifies **people**
(assignee, admins, event owner, team); **none posts to a channel**. "Alert owner
*and project channel*" and "notify *leadership channel*" both require a
channel-posting action that does not exist, so two of the three examples the
requirement gives cannot be configured.

### P1-WF-03 (P1) — Meeting workflows: agenda deadline reminder, meeting-start reminder, completed meeting → summary posted and action owners notified — **Partial**

Meeting summary composition exists and is testable
(`src/features/meetings/services/meeting.summary.ts`, extracted this session), and
meeting actions carry owners (`meeting_action.owner_id`) who can be notified.

But none of the three is wired as a *workflow rule*: `trigger_event` has no
meeting-start or agenda-deadline trigger, and no scheduled job sends either
reminder — the 14 live cron entries contain nothing meeting-related. Summary
posting is a manual action rather than a completion trigger. So the capabilities
are partly present and the automation the requirement describes is not.

### P1-WF-04 (P1) — Event workflows: create/link event channel, logistics checklist changes notify owners, completed event prompts retrospective — **Partial**

`channel.event_id` makes an event channel linkable, and `notify_event_owner` is
one of the four actions — so the second clause has an action available.

Automatic channel creation on event creation is not implemented, and there is no
retrospective prompt on completion (no trigger, no job, no record type).

### P1-WF-05 (P1) — Volunteer request/assignment changes notify the relevant channel, with the VMS remaining the source of volunteer records — **Partial**

The source-of-truth half is respected and visible in the schema:
`user_profile.vms_id`, `vms_availability` and `vms_synced_at` mirror VMS data
with a sync timestamp, and `vms-sync` runs daily (verified active), so the Hub
reads volunteer records rather than owning them.

The notification half fails for the same reason as P1-WF-02: notifying "the
relevant staff/volunteer channel" needs a channel-posting action, and the library
has none.

### P1-WF-06 (P1) — Critical announcements trigger acknowledgment reminders and an admin follow-up list — **Complete**

`announcement-nudge` runs daily at 13:00 UTC (verified active), and the
outstanding set is computed by the absence of an `announcement_acknowledgment`
row — so acknowledged users are excluded structurally rather than filtered, and
`uq_notification_user_dedupe` makes a repeat nudge unrecordable. The same join
produces the admin follow-up list of outstanding recipients (P0-ANN-04).

### P2-WF-07 (P2) — Admins create simple intake forms that create a task/project/request and notify a chosen channel — **Partial**

The intake side exists as a real subsystem: `intake_requests`
(`20260828124912`), `project_request` with `sponsor_id`, `decided_by` and an
approval path whose migration name records a deliberate tightening
(`approve_request_requires_an_actor`), plus `src/features/requests/schemas.ts`.
So a request can be filed and can become a project.

Two clauses fail. The forms are **not admin-definable** — the intake shape is
coded, with no form-builder. And "notify a chosen channel" is again the missing
channel-posting action.

## Repository structure

### REP-001 (P0) — Each feature exports a small public surface through an index file; no deep cross-feature imports — **Missing**

Neither half holds. Across **23 feature directories there are zero `index.ts`
files**, so no feature declares a public surface at all. And **54 imports reach
across a feature boundary** directly into another feature's `components/` or
`services/`.

The absence of the index files is the more consequential fact: with no declared
surface, the second rule is unenforceable in principle — there is no way to tell
a feature's API from its internals, so "deep private implementation file" has no
definition to violate. Closing this is mechanical (add the index files, then make
the boundary a lint rule) but it is 23 files plus 54 import rewrites, and the
count grows with every feature added meanwhile.

### REP-002 (P0) — Route files primarily route, gate, compose data and render a feature page component — **Partial**

The pattern is followed for most routes, and the permission-gate-plus-compose
shape is visible throughout `src/app/(workspace)/`.

It breaks down badly at the largest routes. `src/app/(workspace)/page.tsx` is
**738 lines** — the largest file in the application — and
`src/app/(workspace)/admin/page.tsx` is **600**. Neither is routing and
composing; both contain substantial logic that belongs in a feature. The
dashboard route is also where the JavaScript aggregation and the UTC `today` bug
recorded under DB-009 live, which is the concrete cost of the rule not being
followed: logic that would have been tested had it been in a service is untested
in a route.

### REP-003 (P0) — Visual primitives in `components/ui`; domain-aware shared components in `components/shared` only when genuinely reused — **Complete**

`src/components/ui/` holds only visual primitives (the 12 listed under UI-004),
and the layout/shell components sit in `src/components/layout/`. Domain-aware
components live with their features in `src/features/*/components/`, and the
restraint the requirement asks for is evident: nothing has been promoted to a
shared location speculatively.

### REP-004 (P0) — Migrations append-only after reaching shared environments; fix forward rather than rewriting history — **Complete**

The discipline is followed and has been tested repeatedly this session. No
applied migration's SQL has been edited; corrections are new migrations —
`20260902220712` fixing sign-up, `20260903030426` fixing agenda triage.

One nuance worth recording rather than glossing: three migration **files have
been renamed** after being applied, to reconcile the filename with the version
`apply_migration` stamped. That touches released migration history in the
repository, but not its content — the SQL is byte-identical and the recorded
version is unchanged, so the reconciliation moves the filename toward the shared
environment's truth rather than away from it. The underlying problem is CICD-002
(no migration pipeline), not a lapse in this discipline.

### REP-005 (P1) — Path aliases for stable imports; no long relative chains — **Complete**

`@/*` is configured in `tsconfig.json:26` and used consistently, and a sweep for
`../../../` returns **zero** matches anywhere in `src/`.

### REP-006 (P1) — Files above roughly 300–350 lines reviewed for extraction; giant page components are a failure — **Partial**

Eight files exceed 350 lines. The requirement explicitly forgives size alone and
explicitly does not forgive giant page components, so the two categories separate
cleanly:

| File | Lines | Reading |
|---|---|---|
| `src/app/(workspace)/page.tsx` | 738 | **Giant page component** — the failure the rule names |
| `src/app/(workspace)/admin/page.tsx` | 600 | **Giant page component** |
| `src/features/meetings/services/meeting.commands.ts` | 673 | Service module, cohesive — size alone |
| `src/features/jobs/services/handlers/drain-notifications.ts` | 614 | Handler with genuine branching — size alone |
| `src/features/channels/components/message-item.tsx` | 524 | Borderline; one component doing much |
| `src/features/channels/services/message.commands.ts` | 519 | Service module — size alone |
| `src/app/(workspace)/projects/[id]/page.tsx` | 452 | Route, above the line |
| `src/app/(workspace)/meetings/[id]/page.tsx` | 451 | Route, above the line |

The two at the top are the ones to act on, and they are the same two REP-002
names.

### REP-007 (P1) — READMEs at the repository root and for unusually complex domains — **Partial**

The root `README.md` exists and is the only one: `find . -name 'README*'` outside
`node_modules` returns a single file. None of the five domains the requirement
names as unusually complex — messaging, permissions, Gmail sync, reporting,
notifications — has one.

The gap is smaller than it looks, because `docs/runbooks/` covers the operational
half for four of them (jobs, integrations, privacy, deployment) and the ADRs
cover permissions rationale. What is missing is the developer-facing orientation
for someone opening `src/features/channels/` for the first time — which, given
that messaging carries the subtlest authorization logic in the project, is where
it would be worth most.
