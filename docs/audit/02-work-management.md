# Audit 02 — Work management (tasks, projects, programs, milestones, dashboards, Gantt)

<!-- progress: 35 of 35 assessed -->

Families assessed: `P0-TSK-*` (5), `P1-TSK-*` (4), `P0-PRJ-*` (5), `P1-PRJ-*` (3),
`P0-DASH-*` (4), `P1-DASH-*` (3), `P0-GNT-*` (1), `P1-GNT-*` (2), `WORK-*` (8) — **35 requirement IDs**.

## Tasks — board, list, My Work

### P0-TSK-01 — Rich task model
**Verdict:** Partial
**Requirement:** Task stores context, completion criteria, owner, requester, contributors, reviewer/approver, status, priority, start/due, estimate, labels, milestone, attachments, dependencies and activity history.
**Evidence:** `supabase/migrations/0001_core.sql:163-201` — `task` has `description`, `assignee_id`, `requester_id`, `reviewer_id`, `status`, `priority`, `start_at`, `due_at`, `estimate_hours`, `milestone_id`, plus `task_dependency` (195), `checklist_item` (203), `label`/`task_label` (212-224), `task_comment` (226). Activity history via `activity_event` inserts in `src/features/tasks/services/task.commands.ts:74,162,232,292`.
**Gap:** Several modelled fields are dead in the application layer:
- `estimate_hours` — no read or write anywhere in `src/` (grep returns only unrelated `estimated_effort` on intake requests).
- `label` / `task_label` — tables exist, but no query, command, schema or component references them; labels cannot be created or attached.
- `reviewer_id` — selected in `task.queries.ts:6` and `task-drawer.tsx:24` but never rendered or settable.
- `start_at` — selected but never editable in the drawer (`task-drawer.tsx:213-266` exposes only assignee, priority, due date).
- **Contributors:** no table, column or code — entirely absent.
- **Attachments:** no task-attachment table or column; `document` is not linked to `task`.
- **Completion criteria** is only free text in `description`.

### P0-TSK-02 — Expanded statuses
**Verdict:** Partial
**Requirement:** Eight canonical statuses; admins can map display columns without corrupting canonical state.
**Evidence:** `supabase/migrations/0001_core.sql:171` uses a `task_status` enum; `src/features/tasks/schemas.ts:6-15` defines exactly the eight required values and `:17` exports `BOARD_COLUMNS = [...TASK_STATUSES]`. `updateTaskStatus` re-validates against the list (`task.commands.ts:111`).
**Gap:** No admin display-column mapping exists. `BOARD_COLUMNS` is a hard-coded copy of the canonical list; grep for column configuration under `src/features/admin` and `src/app/(workspace)/admin` returns nothing. The board always renders all eight canonical columns.

### P0-TSK-03 — Board + list parity
**Verdict:** Complete
**Requirement:** Board and list mutate the same records; drag/drop has a keyboard alternative; changes persist and are audited.
**Evidence:** Both `src/features/tasks/components/board.tsx:9` and `src/features/tasks/components/task-list.tsx:15` drive status through the same server action `updateTaskStatus` (`task.commands.ts:105`), which writes to `task` and inserts an `activity_event` (`task.commands.ts:162-174`). The keyboard alternative is `StatusSelect` (`status-select.tsx:47-60`), rendered on every board card (`board.tsx:153`) and every list row (`task-list.tsx:210`). Drag handlers are pointer-only (`board.tsx:77-87`) but are not the sole path.

### P0-TSK-04 — My Work command center
**Verdict:** Partial
**Requirement:** Owned work grouped by overdue/today/this week/later, plus reviews, approvals, mentions, saved items, blockers and upcoming meetings.
**Evidence:** `src/app/(workspace)/my-work/page.tsx:25-67` defines exactly the four buckets and groups via `myWorkBucket` (`src/lib/utils.ts:91-101`). Tasks come from `getMyTasksFiltered` (`task.queries.ts:50`).
**Gap:** Only the assignee-owned task list is present. The page has no reviews queue, no approvals queue, no mentions, no saved items, no blocker roll-up and no upcoming meetings — those live on other routes (`/inbox`, `/saved`, `/meetings`) and are not surfaced here. Blocked tasks appear only inline as a red label on a row (`task-list.tsx:181`).

### P0-TSK-05 — Bulk actions
**Verdict:** Complete
**Requirement:** Authorized users can bulk reassign, reprioritize, reschedule, label, archive or move selected tasks with confirmation.
**Evidence:** `src/features/tasks/components/task-list.tsx:87-121` renders the selection bar (Status, Reassign, Priority, Reschedule, Archive); a confirmation `Dialog` at `:221-301` gates every action. Server side: `bulkUpdateTasks` (`task.commands.ts:252-325`) validated by `bulkSchema` (`schemas.ts:53-60`, capped at 200 ids), writes one `activity_event` per row and dedupes assignment notifications. Authorization is delegated to RLS on the `update`. Note: "label" is not offered (see P0-TSK-01) and "move" is achieved through the drawer's project select rather than in bulk — I read the requirement's verb list as illustrative, but flag it.

### P1-TSK-06 — Dependencies
**Verdict:** Partial
**Requirement:** Tasks/milestones can block one another; circular dependencies are rejected; impacted due dates are visibly flagged.
**Evidence:** `task_dependency` exists (`supabase/migrations/0001_core.sql:195-201`, with a `no_self_dependency` check). It is genuinely wired up — contrary to a "schema only" reading: `src/features/tasks/services/checklist.commands.ts:48-92` implements `addTaskDependency`/`removeTaskDependency`, the drawer loads blockers (`src/features/tasks/components/task-drawer.tsx:70-73`), and `TaskExtras` both lists "Blocked by …" and offers a staff-only picker to add one (`src/features/tasks/components/task-extras.tsx:80-118`).
**Gap:** Three real defects.
1. **Cycle detection is only one hop deep.** `circularDependencyError` (`src/features/tasks/schemas.ts:84-100`) rejects self-dependency and the exact reverse pair only. A→B, B→C, C→A is accepted. The pre-check query (`checklist.commands.ts:54-61`) fetches only rows touching the two tasks involved, so it *cannot* see a longer chain, and there is no DB trigger or recursive CTE guarding it. The unit test only covers the two-node case.
2. **Milestones cannot block anything.** There is no `milestone_dependency` table and no milestone-to-task blocking column; `milestone` (`0001_core.sql:151`) has no dependency edge at all.
3. **No due-date impact flagging.** Nothing compares a blocker's `due_at` against the blocked task's; `blocked_reason` is free text typed by a human, and adding a dependency does not set status `blocked` or surface a date conflict anywhere.
Also note `removeTaskDependency` exists as a server action but no component calls it — dependencies cannot be removed from the UI.

### P1-TSK-07 — Recurring work
**Verdict:** Partial
**Requirement:** Recurring operational tasks support series ownership and safe edit-this / edit-series behaviour.
**Evidence:** Columns `recurrence_rule` and `recurrence_anchor` were added in `supabase/migrations/0008_spec_delivery.sql:12-13`. A user picks "Weekly"/"Monthly" in `src/features/tasks/components/task-extras.tsx:121-135` → `setTaskRecurrence` (`src/features/tasks/services/checklist.commands.ts:99-115`). The next instance is spawned inline when a task is completed (`src/features/tasks/services/task.commands.ts:133-159`), date maths in `src/features/tasks/recurrence.ts:2-11` with unit tests at `src/features/tasks/tests/recurrence.test.ts`.
**Gap:** Neither acceptance condition is met.
- **No series entity.** There is no `recurring_series` table and no `series_id` on `task`; each occurrence is an unlinked copy. Nothing "owns" the series, so there is nothing to scope an edit to and no way to list or stop a series other than editing whichever instance happens to be open.
- **No edit-this / edit-series choice.** Every edit is an edit-this; the rule is copied forward blindly at completion time, so a change made after the next instance was spawned silently applies from the following cycle.
- **Spawn is not idempotent** (see WORK-006): `updateTaskStatus` does not check the prior status, so setting an already-completed task to "completed" again inserts a second occurrence. Only two rules (`weekly`, `monthly`) are supported — no daily, no interval, no end date.

### P1-TSK-08 — Checklists / sub-items
**Verdict:** Complete
**Requirement:** Lightweight checklist items can be completed without creating full tasks.
**Evidence:** `checklist_item` table at `supabase/migrations/0001_core.sql:203-211`, RLS narrowed to the parent task's visibility in `supabase/migrations/20260818074603_secure_task_child_visibility.sql:11-13` with separate insert/update/delete policies in `supabase/migrations/20260818074753_separate_task_child_write_policies.sql:5-14`. Server actions `addChecklistItem` / `toggleChecklistItem` at `src/features/tasks/services/checklist.commands.ts:14-46`; the drawer loads them (`src/features/tasks/components/task-drawer.tsx:65-69`) and renders add + tick UI at `src/features/tasks/components/task-extras.tsx:32-79`.
**Gap:** Minor, below the requirement's bar: there is no delete-item control (the RLS delete policy exists but no action or button calls it), `sort_key` is ordered by but never set or reorderable, and no "3/5" progress roll-up appears on the board card or list row.

### P1-TSK-09 — Filters and views
**Verdict:** Partial
**Requirement:** Filter tasks by program, project, owner, status, priority, dates, milestone, label, blocked state, reviewer, and channel-linked activity.
**Evidence:** `TaskFilterBar` (`src/features/tasks/components/task-list.tsx:307-390`) offers four controls — free-text search, status, priority, project — held in the URL, and `getMyTasksFiltered` (`src/features/tasks/services/task.queries.ts:50-71`) applies exactly those four. Views can be saved (`src/features/tasks/components/save-view-button.tsx:22`).
**Gap:** Seven of the eleven named dimensions have no filter at all: **program, owner, dates/date range, milestone, label, blocked state, reviewer, and channel-linked activity**. (Owner is structurally impossible here — `getMyTasksFiltered` hard-codes `.eq("assignee_id", userId)` at line 58, so My Work can only ever show your own tasks.) The filter bar is also only mounted on `/my-work`; the board (`src/app/(workspace)/board/page.tsx:21`) accepts only a `project` search param with no UI control to set it, so the board is unfilterable in the product.

## Master Schedule / Gantt

### P0-GNT-01 — Master Schedule
**Verdict:** Partial
**Requirement:** Multi-month portfolio timeline showing program and project bars, milestones, health, dependencies, and a today marker.
**Evidence:** `src/app/(workspace)/schedule/page.tsx` is a genuinely working timeline, not a stub — worth saying plainly, since a route-name check would undersell it. A six-month window is computed server-side (`:21,44-46`), projects are fetched with a server-side date filter and `limit(60)` (`:48-57`), bars are positioned by percentage offset from the window start (`:119-127`), health drives the bar colour (`:23-29,153`) with a text legend (`:179-185`), and there is a real today marker (`:106-113`). Staff-only via `requireStaff()` (`:41`).
**Gap:** Three of the five named contents are absent. **Milestones are not plotted** — `milestone` is never queried on this page. **Dependencies are not drawn** — `task_dependency` is not queried either. **There are no program bars**: a program appears only as truncated text under the project name (`:141-144`); there is no program row, grouping or roll-up bar. Projects with no `target_date` are excluded entirely (`:55`), and projects outside the window render the text "Outside this window" rather than being filtered out.

### P1-GNT-02 — Zoom and filters
**Verdict:** Missing
**Requirement:** Day/week/month scale switching, plus filters by program, owner, health, status, date range, and project.
**Evidence:** `src/app/(workspace)/schedule/page.tsx:40` — `SchedulePage()` takes **no props at all**, so it reads no `searchParams`. The scale is the module constant `WINDOW_MONTHS = 6` (`:21`) and the window is always "last month + 6" (`:44-45`). There is no filter control, no scale control, and no query on the page other than the fixed project fetch.
**Gap:** Everything. Neither zoom nor any of the six filters exists in any form.

### P1-GNT-03 — Dependency visibility on the schedule
**Verdict:** Missing
**Requirement:** Schedule shows predecessor/successor relationships, highlights conflicts, and never silently auto-changes dates without approval.
**Evidence:** `src/app/(workspace)/schedule/page.tsx:48-57` is the only data fetch on the page; it selects project fields only. `grep -rn "task_dependency" src/` returns three files, none of them the schedule.
**Gap:** No predecessor/successor rendering and no conflict highlighting. The one half of the requirement that is trivially satisfied is the negative clause — nothing auto-shifts dates because nothing computes dependent dates at all.

## Home / Operations dashboard

### P0-DASH-01 — Role-aware home
**Verdict:** Partial
**Requirement:** Each role sees relevant work, announcements, inbox items, meetings, deadlines, risks, and recent activity.
**Evidence:** `src/app/(workspace)/page.tsx` covers six of the seven: today's work (`:222-292`), required announcements (`:126-147`) plus a persistent announcements rail (`:619+`), today's meetings (`:231-254`), deadlines/overdue (`:270-286`, `:490-577`), risks (`:501-527`), recent activity (`:580-616`). Role-awareness is real, not cosmetic: `session.isStaff` gates the portfolio hero (`:150`), program health (`:297`), the activity/KPI charts (`:356`), and the at-risk-projects and unassigned-tasks columns of the attention queue (`:501,558`). All data is per-viewer and RLS-scoped via `getDashboardData` (`src/features/dashboard/services/dashboard.queries.ts:71`).
**Gap:** **Inbox items are absent** — `grep -n "inbox" src/app/(workspace)/page.tsx` returns nothing; unread count exists only as a sidebar badge (`src/app/(workspace)/layout.tsx:96`). Role-awareness is a single boolean: `isStaff` is `owner|admin|staff` (`src/lib/auth.ts:48`), so volunteer and guest share one view and there is **no executive/board read-only variant at all** — `org_role` (`supabase/migrations/0001_core.sql:11`) has no such role.

### P0-DASH-02 — Portfolio health
**Verdict:** Partial
**Requirement:** Authorized leaders see active / on-track / at-risk / off-track / paused / stale project counts, with drill-downs.
**Evidence:** `dashboard.queries.ts:125-129` fetches `health` for every active project and buckets it into `healthCounts` (`:179-182`); `src/app/(workspace)/page.tsx:150-217` renders active-program count, on-track / needs-attention / at-risk counts and an overall on-track percentage, staff-gated. The at-risk drill-down is the "Projects at risk" card (`:501-527`), each row linking to `/projects/{id}`.
**Gap:** Only three of the six named buckets are surfaced. **Paused is never displayed** (the health query filters `stage = 'active'` at `dashboard.queries.ts:128`, so paused projects are excluded from `healthCounts` entirely) and **stale is never surfaced on the dashboard** — staleness is computed, but only inside a weekly notification job (`src/features/jobs/services/handlers/stale-project-sweep.ts:39-100`, scheduled `0 10 * * 1` in `supabase/migrations/20260819165607_jobs.sql:381-383`), which emails the owner rather than producing a dashboard count. The counts in the hero are plain text, not links: the only drill-down is the separate at-risk card, so "on track" and "needs attention" cannot be clicked through.

### P0-DASH-03 — Attention queue
**Verdict:** Partial
**Requirement:** Overdue milestones, blocked work, unassigned tasks, pending decisions, unread critical announcements and stale updates are prioritized.
**Evidence:** The "Needs attention" section (`src/app/(workspace)/page.tsx:490-577`) renders four cards fed by `dashboard.queries.ts:130-156`: overdue tasks, blocked tasks, unassigned tasks (staff-only), and at-risk/off-track projects. Unacknowledged required announcements are pinned above the fold (`page.tsx:124-147`) with the critical priority called out (`:139`), sourced from `dashboard.queries.ts:157-165,395-404`. Non-staff correctly see a narrower set (`page.tsx:96-101`).
**Gap:** Three named inputs are absent from the queue. **Overdue milestones** — the `milestone` table is never queried by `dashboard.queries.ts` at all. **Pending decisions** — `decision` is never queried either. **Stale updates** — computed only by the weekly notification job (`src/features/jobs/services/handlers/stale-project-sweep.ts`), never shown here. There is also no prioritization: the four cards render in fixed source order with no severity ranking or interleaving, each capped at `limit(5)`.

### P0-DASH-04 — KPI cards
**Verdict:** Partial
**Requirement:** Active programs/projects, open tasks, due items, completion throughput and health signals display with comparison context and source drill-down.
**Evidence:** `dashboard.queries.ts:93-124` computes all six KPIs (`activePrograms`, `activeProjects`, `openTasks`, `dueThisWeek`, `overdue`, `completedLast30`) as live `count: "exact"` queries. Completion throughput has genuine comparison context — `completedLast30` vs `completedPrevious30` rendered as a signed percentage delta with a trend arrow (`page.tsx:88-95,372-385`) — plus an 8-week bar series (`:388`) and a status donut (`:391-415`).
**Gap:** **Four of the six KPIs are computed and then never rendered.** `grep -n "kpis\." src/app/(workspace)/page.tsx` returns only `activePrograms` (`:158,161`) and `completedLast30` (`:91,363`). `activeProjects`, `openTasks`, `dueThisWeek` and `overdue` are three wasted round-trips per page load with no UI — there is no KPI card row at all. Only completion throughput carries comparison context; the program count and health percentage have none. And nothing is a drill-down: every KPI figure is plain text, not a link to its source list.

### P1-DASH-05 — Workload view
**Verdict:** Partial
**Requirement:** Authorized users see active ownership, due-soon work, estimated load and possible overload, by person and by team.
**Evidence:** `src/app/(workspace)/people/page.tsx:47-57` counts open, unarchived, assigned tasks per person (staff-only branch), aggregated at `:77-80` and rendered as an "Open tasks" column at `:134,174-177`. Teams are loaded (`:58-59`) so people can be grouped.
**Gap:** It is a single raw count, not a workload view. **No due-soon dimension** — the query has no date predicate, so an item due tomorrow and one due next quarter weigh the same. **No estimated load** — `task.estimate_hours` exists in the schema (`supabase/migrations/0001_core.sql:178`) but is read nowhere in `src/`. **No overload signal** — nothing defines a capacity threshold or flags anyone; `grep -rni "overload\|capacity" src/` returns nothing. **No per-team roll-up** — team membership is fetched but workload is never summed by team. There is no dedicated workload page; this is one column on the people directory.

### P1-DASH-06 — Configurable widgets
**Verdict:** Missing
**Requirement:** Users with permission can reorder/hide supported dashboard widgets; admins can define role defaults.
**Evidence:** `grep -rni "widget" src/ supabase/migrations/` returns **zero matches**. The home page is a fixed JSX layout (`src/app/(workspace)/page.tsx:106-618`); the only variability is the hard-coded `session.isStaff` branches. There is no preference table, no ordering column, no admin default screen.
**Gap:** Entirely unimplemented.

### P1-DASH-07 — Saved portfolio views
**Verdict:** Partial
**Requirement:** Filters can be saved and shared within the sharer's access scope.
**Evidence:** `saved_view` exists (`supabase/migrations/0008_spec_delivery.sql:147-156`) and `saveView` writes the current URL query to it (`src/features/admin/services/workflow.commands.ts:16-36`), driven by the "Save view" button on My Work (`src/features/tasks/components/save-view-button.tsx:9-48`).
**Gap:** **Saved views are write-only.** `grep -rn "saved_view" src/` matches exactly one file — `workflow.commands.ts`. Nothing ever lists, reads or applies a saved view: no picker, no menu, no page. `deleteSavedView` (`workflow.commands.ts:38-49`) is likewise never called. A user can name and store a view and then has no way to open it again. Sharing is also impossible by design: the RLS policy is `for all using (user_id = auth.uid())` (`0008_spec_delivery.sql:160-161`), so a saved view is strictly private to its creator. Finally the button is mounted only on `/my-work` (`src/app/(workspace)/my-work/page.tsx:82`), so there is nothing "portfolio" about it.

## Programs and projects

### P0-PRJ-01 — Program directory and detail
**Verdict:** Partial
**Requirement:** Programs show lead, team, projects, operations, events, channels, latest update, health roll-up, key links and results.
**Evidence:** The directory (`src/app/(workspace)/programs/page.tsx:36-45,84-113`) lists programs with lead and a real health roll-up computed from the worst health among active child projects (`:74-83`). Detail (`src/app/(workspace)/programs/[id]/page.tsx`) shows lead (`:83-92`), projects with stage and health (`:111-143`), upcoming events (`:146-171`), program activity (`:173-195`), and results via `OutcomesPanel` (`:97-108`) fed by `getProgramOutcomes`.
**Gap:** Four named elements are absent. **Team** — there is no program-membership table; `program` (`supabase/migrations/0001_core.sql:130-143`) has only `lead_id`. **Operations** — no recurring-operations concept exists at program level. **Channels** — `program` has no `channel_id` and the detail page never queries `channel`, so the linked channel the empty-state text promises ("group related projects, events, and channels", `programs/page.tsx:68`) is not actually shown. **Latest update** — `project_status_update` is program-agnostic and is not queried here; the detail page shows an activity feed instead. **Key links** — no such field or section. The detail page also shows no health roll-up of its own (only the directory card does), and it is `requireStaff()`-gated (`[id]/page.tsx:24`), so a volunteer cannot open a program at all.

### P0-PRJ-02 — Project lifecycle
**Verdict:** Complete
**Requirement:** Eight stages — proposed, approved, planning, active, paused, completed, cancelled, archived — with auditable transition history.
**Evidence:** `project_stage` enum lists exactly those eight (`supabase/migrations/0001_core.sql:14-17`); `stageSchema` re-validates the same eight server-side (`src/features/projects/services/project.commands.ts:189-195`). `updateProjectStage` (`:197-242`) is staff-gated, sets `completed_at`/`archived_at` on the terminal stages, and writes **two** records per transition: an `activity_event` for the feed (`:217-227`) and an `audit_event` with `action: "stage_changed"` and the new stage in metadata (`:229-238`). The UI control is `StageSelect` (`src/features/projects/components/stage-select.tsx:36-47`) with optimistic value and rollback on failure (`:21-32`).
**Gap:** None against the stated criterion. Worth noting for completeness that no transition *graph* is enforced — any stage can move to any other, including archived → proposed — but the requirement asks for the stage set and an audit trail, and both are there.

### P0-PRJ-03 — Project detail
**Verdict:** Partial
**Requirement:** Project detail shows outcome, owner/sponsor/manager, team, dates, health, progress signals, milestones, tasks, blockers, decisions, risks/issues, files, meetings, channel, activity and the latest status update.
**Evidence:** `src/app/(workspace)/projects/[id]/page.tsx` is a substantial tabbed page (Overview / Tasks / Updates / Risks & issues / Activity, `:176-207`). Present: outcome (`:127` as the header description), owner + health + health reason + start→target dates in the meta strip (`:150-175`), milestones with add and complete controls (`:318-366`), tasks (`:84-90,218-250`), status updates carrying blockers and `decisions_needed` (`:92-99,253-316`), risks/issues via `getRaidLog(id)` with an open count on the tab (`:109,195-200`), activity (`:101-107,370-395`).
**Gap:** Five named elements are missing. **Sponsor and manager** — only `owner_id` exists on `project`; `project_membership` carries a `role` and is written on creation (`src/features/projects/services/project.commands.ts:52-56`) but the detail page never queries it. **Team** — same reason, no member list is rendered. **Files** — `document` is never queried here. **Meetings** — `meeting` is never queried here, even though meetings carry `project_id`. **Channel** — a project channel is auto-created at `project.commands.ts:59-80`, but `grep -n "channel" src/app/(workspace)/projects/[id]/page.tsx` returns nothing, so the detail page never links to it. "Progress signals" amounts to an open-task count on the tab badge; there is no percent-complete or milestone-burn indicator.

### P0-PRJ-04 — Health discipline
**Verdict:** Partial
**Requirement:** Setting a project at-risk or off-track requires a reason and a next response; help requested is optional.
**Evidence:** Enforced on both sides. Server: `publishStatusUpdate` rejects `at_risk`/`off_track` with neither `healthReason` nor `blockers` (`src/features/projects/services/project.commands.ts:123-131`), and the accepted reason is persisted to `project.health_reason` (`:152`) so it is shown wherever health is (`projects/[id]/page.tsx:166-168`, dashboard `page.tsx:518-520`). Client: the reason input appears and is `required` only for those two values (`src/features/projects/components/status-update-form.tsx:20,70-80`). This server action is the **only** path that writes `project.health` after creation, so the rule cannot be bypassed through the UI. `helpRequested` is optional as specified (`project.commands.ts:107`, form `:98-101`).
**Gap:** **"Next response" is not required.** `nextSteps` is optional in the schema (`project.commands.ts:104`) and carries no `required` attribute on the form (`status-update-form.tsx:88-91`), so a project can be marked off-track with a reason and no stated response. Note also that `blockers` alone satisfies the reason check (`:126`), so `health_reason` can end up being the blocker text rather than an explanation of the health call.

### P0-PRJ-05 — Structured status updates
**Verdict:** Partial
**Requirement:** The project manager publishes structured updates covering progress, next steps, health, blockers, decisions needed and help requested.
**Evidence:** `project_status_update` stores all six columns (`health, progress_summary, next_steps, blockers, decisions_needed, help_requested`) — written at `src/features/projects/services/project.commands.ts:136-147`, schema at `:100-109`. The form renders a field for each (`src/features/projects/components/status-update-form.tsx:58-101`) with progress required (`:85`). Updates are read back and rendered newest-first on the project's Updates tab (`src/app/(workspace)/projects/[id]/page.tsx:92-99,253-316`), each publish writes an `activity_event` (`project.commands.ts:159-168`) and fires the `project_health_changed` workflow event (`:171-181`).
**Gap:** One of the six is captured but never shown. `help_requested` is written (`project.commands.ts:143`) and selected back (`projects/[id]/page.tsx:95`), but the render block (`:289-308`) prints only progress, next steps, blockers and decisions needed — a manager's request for help is invisible to every reader. The form is also staff-only (`projects/[id]/page.tsx:261`) rather than scoped to the project manager.

### P1-PRJ-06 — Project intake
**Verdict:** Partial
**Requirement:** Requests support review, approval, defer, reject and return-for-clarification; approval creates a draft project.
**Evidence:** Intake is a well-built slice: `project_request` (`supabase/migrations/20260828124912_intake_requests.sql:31-87`), a review queue at `src/app/(workspace)/requests/page.tsx`, and — better than a coverage doc that treats intake as thin — **approval is a single transactional RPC**, `approve_project_request` (`intake_requests.sql:222-283`), which creates the project, settles the request, and closes any still-pending `approval_request` in one statement, and is deliberately idempotent on double-click (`:239-242`). The server action calls it and notifies the requester (`src/features/requests/services/request.commands.ts:163-199`). Rejection requires a written reason, enforced both by a CHECK constraint and by the form (`src/features/requests/components/request-controls.tsx:175-183`).
**Gap:** Two of the five outcomes do not exist. `project_request_status` is `submitted, in_review, approved, declined, withdrawn` (`intake_requests.sql:27-29`) — there is **no defer** and **no return-for-clarification**; `grep -rni "defer|clarif|needs_info" src/features/requests/` returns nothing. A reviewer who needs more information can only decline. Minor: approval creates the project at stage `approved` (`intake_requests.sql:255`) rather than a `proposed`/draft stage, so an approved request immediately produces a live project row.

### P1-PRJ-07 — Project/program templates
**Verdict:** Partial
**Requirement:** Approved templates preconfigure milestones, standard tasks, channel structure, meeting cadence and reporting settings, without copying historical data.
**Evidence:** `project_template` exists (`supabase/migrations/0008_spec_delivery.sql:188-203`) with staff-only write RLS, `createProjectTemplate` / `createProjectFromTemplate` at `src/features/admin/services/workflow.commands.ts:128-165`, and a picker on the projects index (`src/features/projects/components/create-from-template.tsx`, wired at `src/app/(workspace)/projects/page.tsx:45`).
**Gap:** The template carries **three columns only** — `name`, `outcome`, `default_stage` (`0008_spec_delivery.sql:188-196`). None of the five things the requirement names is preconfigured: **no milestones, no standard tasks, no channel structure, no meeting cadence, no reporting settings.** `createProjectFromTemplate` (`workflow.commands.ts:150-165`) just calls `createProject` with those three fields; the only structure the new project gets is the project channel that `createProject` always creates for every project (`src/features/projects/services/project.commands.ts:59-80`), which is not template-driven. **Program templates do not exist at all.** The "no historical data" clause is satisfied trivially, since there is nothing to copy. There is also no "approved" state on a template — any staff member can create one and it is immediately usable.

### P1-PRJ-08 — Project closure
**Verdict:** Partial
**Requirement:** Closing captures results, unresolved follow-ups, lessons learned, evidence, archive behaviour and final communication.
**Evidence:** Strong on most of it. `getUnresolvedWork` (`src/features/projects/services/project.commands.ts:257-290`) counts open tasks, blocked tasks, open milestones and whether any status update exists, and the dialog loads and shows them *before* the decision (`src/features/projects/components/close-project-dialog.tsx:37-39,74`). `closeProject` (`:309-379`) requires a `results` narrative (`:299`), records it plus optional lessons as a final `project_status_update` (`:320-332`), optionally archives leftover open tasks (`:334-343`), moves the project to `completed` with `completed_at`, and writes both an `activity_event` and an `audit_event` with `archived_open_tasks` in metadata (`:356-375`).
**Gap:** Two elements missing. **Evidence** — nothing attaches documents, links or artefacts to the closure; `document` is never touched by `closeProject`. **Final communication** — no announcement, notification or channel message is sent on closure (`notify`/`createNotifications` are not called), so the project's members are never told it closed; contrast with request approval, which does notify. Also `UnresolvedWork.openFollowUps` is hard-coded to `0` (`project.commands.ts:288`), so the "unresolved follow-ups" figure the dialog shows is always zero regardless of reality.

## Cross-cutting engineering standards (WORK-*)

### WORK-001 — Dashboard metrics live, permission-scoped, documented and testable
**Verdict:** Partial
**Requirement:** Dashboard metrics are computed from live data, permission-scoped to the viewer, with documented and testable metric definitions.
**Evidence:** Every figure is a live query in `src/features/dashboard/services/dashboard.queries.ts:93-258` — no cached or denormalised counters anywhere. Scoping is genuine: the queries run through `createSupabaseServerClient()` (`:72`) under the caller's JWT, so RLS filters every count, and the leadership figures are additionally gated on `session.isStaff` in the page (`src/app/(workspace)/page.tsx:150,297,356,501,558`). Two of the trickier definitions are documented in-code: the mutually-exclusive donut buckets (`dashboard.queries.ts:260-269`) and the program-health formula (`:271-305`).
**Gap:** **The metric definitions are not testable and are not tested.** They are inlined inside one 370-line async function that opens a Supabase client, so none of them can be exercised without a database; `grep -rn "dashboard" tests/ src/**/tests/` finds no dashboard test — the only related unit test is `myWorkBucket` (`tests/unit/utils.test.ts:12-27`), which the dashboard does not use. Nor are the definitions documented outside the code: no metric dictionary exists in `docs/`. Extracting the bucket and health functions to pure helpers (as was done for `nextOccurrence`) would make this testable.

### WORK-002 — Durable server mutations with optimistic rollback
**Verdict:** Partial
**Requirement:** Status movement, assignment, due dates, dependencies, milestones and completion are durable server mutations, with optimistic UI rolled back on failure.
**Evidence:** All six are `"use server"` actions writing directly to Postgres under RLS — `updateTaskStatus`, `updateTask`, `bulkUpdateTasks` (`src/features/tasks/services/task.commands.ts:104,189,252`), `addTaskDependency` (`src/features/tasks/services/checklist.commands.ts:48`), `createMilestone`/`completeMilestone` (`src/features/projects/services/milestone.commands.ts:12,51`). Status movement has correct optimistic rollback in both views: `StatusSelect` restores the previous value explicitly on `!result.ok` (`src/features/tasks/components/status-select.tsx:35-44`), and the board uses `useOptimistic` inside a transition (`src/features/tasks/components/board.tsx:20-24,38-57`).
**Gap:** **Assignment and due date have optimistic display with no rollback.** The drawer's assignee and due-date controls are *uncontrolled* (`defaultValue`, `src/features/tasks/components/task-drawer.tsx:218,249`); `handleFieldSave` (`:111-123`) only toasts on failure and returns early — it never calls `load()` or resets the input. After a rejected save the field keeps showing the new value while the database holds the old one, which is precisely the divergence this requirement exists to prevent. Dependencies, milestones (`src/features/projects/components/complete-milestone-button.tsx:15-18`) and bulk actions are not optimistic at all — acceptable, but they gain no rollback either.

### WORK-003 — Board and list are two views over the same records
**Verdict:** Complete
**Requirement:** Board and list are projections of the same task records; a status change in one is immediately reflected in the others.
**Evidence:** Both views call the identical server action `updateTaskStatus` (`src/features/tasks/components/board.tsx:9,47,54` and `src/features/tasks/components/task-list.tsx:210` via `StatusSelect`), which writes one `task` row (`src/features/tasks/services/task.commands.ts:119-128`). Cross-view propagation is real rather than assumed: that action ends with `revalidatePath("/", "layout")` (`:187`), which invalidates the whole App Router layout tree, and both pages are `export const dynamic = "force-dynamic"` (`src/app/(workspace)/board/page.tsx:16`, `src/app/(workspace)/my-work/page.tsx:23`) fetching through the shared `TASK_SELECT` (`src/features/tasks/services/task.queries.ts:4-9`). There is no board-local store or duplicate table.

### WORK-004 — My Work queries assignments across programs/projects and groups by urgency
**Verdict:** Complete *(closed 2026-09-05 — see the follow-up at the end)*
**Requirement:** My Work queries assignments across all programs/projects and groups by urgency; overdue logic uses the workspace/user time zone consistently.
**Evidence:** The first half holds. `getMyTasksFiltered` (`src/features/tasks/services/task.queries.ts:50-71`) filters only on `assignee_id`, archived state and open status — no program or project scope — so it genuinely spans the portfolio, and the page buckets into overdue / today / this week / later via `myWorkBucket` (`src/app/(workspace)/my-work/page.tsx:25-30,57-67`), which is unit-tested (`tests/unit/utils.test.ts:12-27`).
**Gap:** **The time-zone half is not met, and the inconsistency is observable.** `myWorkBucket` (`src/lib/utils.ts:91-101`) calls `differenceInCalendarDays(date, new Date())` with no time zone, and it runs in a **server** component, so "today" is the deploy host's clock — UTC in production. `dueLabel` (`src/lib/utils.ts:61-78`) does the same arithmetic but runs in the **client** component `task-list.tsx`, so it uses the viewer's browser zone. For a Montreal user (UTC−4/−5) after 19:00 local, the server is already on the next UTC day: the same task is filed under "Overdue" by the server grouping while its own row label reads "Due today". `user_profile.timezone` exists and is loaded into the session, but is used only for the dashboard greeting (`src/app/(workspace)/page.tsx:36-46,76`) — never for due-date logic. The dashboard's own boundaries are UTC too (`src/features/dashboard/services/dashboard.queries.ts:73-74`). There is no workspace-default time zone setting.

### WORK-005 — Projects maintain the full record
**Verdict:** Partial
**Requirement:** Projects maintain health, owners, milestones, tasks, risks, issues, decisions, status updates, activity, channel linkage, meetings and closeout records.
**Evidence:** Most of the model exists. `project` carries `health`, `health_reason`, `owner_id`, dates and stage (`supabase/migrations/0001_core.sql:126-141`); `project_membership` (`:143`), `milestone` (`:151`), `task.project_id` (`:167`), `project_status_update` (`:237`), `risk` and `issue` (`supabase/migrations/20260822231017_risks_and_issues.sql:25,62` with a full command/query layer in `src/features/risks/`), `activity_event` keyed by `project_id`, and channel linkage created automatically with every project (`src/features/projects/services/project.commands.ts:59-80` sets `channel.project_id`). `meeting.project_id` exists in the schema.
**Gap:** Three are effectively not maintained at the project. **Decisions** — the `decision` table has a `project_id` column (`supabase/migrations/0003_operations.sql:59-70`) but every writer sets it from a meeting or a channel message (`src/features/meetings/services/meeting.commands.ts:332`, `src/features/channels/components/message-item.tsx:244`); the project never queries or creates decisions. **Meetings** and **channel linkage** are stored but never read back on the project (see P0-PRJ-03). **Closeout records** have no representation of their own: `closeProject` writes the results into a normal `project_status_update` with the string prefix `"Project closed. Results: "` and stuffs lessons into `next_steps` (`project.commands.ts:320-332`), so closure data is only recoverable by parsing prose out of a general-purpose field.

### WORK-006 — Recurring tasks generated by scheduled jobs with idempotency keys
**Verdict:** Missing
**Requirement:** Recurring task instances are generated by scheduled jobs using idempotency keys, so retries never duplicate work.
**Evidence:** The job framework this requirement asks for exists and is used well elsewhere — a registry cross-checked against `job_definition` (`src/features/jobs/services/handlers/index.ts:17-48`), cron schedules seeded in `supabase/migrations/20260819165607_jobs.sql:360-388`, and `dedupe_key` idempotency in the notification path (e.g. `src/features/jobs/services/handlers/stale-project-sweep.ts:92`). **None of it is used for recurring tasks.** There is no recurring-task handler in the registry (`handlers/index.ts:24-48`) and no matching `job_definition` row.
**Gap:** Generation is a side effect of a user action, not a job: the next occurrence is inserted inline inside `updateTaskStatus` when a task is set to completed (`src/features/tasks/services/task.commands.ts:133-159`). There is **no idempotency key** — the insert carries no dedupe column and the code does not check the task's prior status, so setting an already-completed task to "completed" again creates a duplicate occurrence, and any client retry of the action does the same. A task whose recurrence is set but which is never completed generates nothing at all.

### WORK-007 — Explainable composite project health
**Verdict:** Partial
**Requirement:** Project health should combine the manager's explicit status with measurable signals (overdue milestones, stale updates), while keeping the displayed state explainable.
**Evidence:** The explicit half is solid and explainable: health is only ever set through `publishStatusUpdate`, which stores the manager's reason on the row (`src/features/projects/services/project.commands.ts:149-153`) and displays it beside the badge (`src/app/(workspace)/projects/[id]/page.tsx:164-168`, dashboard `page.tsx:518-520`). A composite signal does exist one level up: **program** health on the dashboard is computed from child-task completion and blocked count with the formula documented in-code (`src/features/dashboard/services/dashboard.queries.ts:271-305`), and the program directory derives a roll-up from worst child-project health (`src/app/(workspace)/programs/page.tsx:74-83`).
**Gap:** **Project** health is purely the manager's declaration — no measurable signal is mixed in. Nothing compares `milestone.due_date` against `now()` to detect overdue milestones, and update staleness affects only the weekly notification sweep (`src/features/jobs/services/handlers/stale-project-sweep.ts`), never the displayed health. A project whose milestones are months overdue and whose last update was in the spring still reads "On track" until a human changes it.

### WORK-008 — Drawers preserve list context and deep-link
**Verdict:** Complete
**Requirement:** Task/project drawers preserve list context and support deep linking, so a shared URL opens the same record directly.
**Evidence:** The task drawer is keyed entirely off the `task` URL parameter (`src/features/tasks/components/task-drawer.tsx:38`) and loads on mount, so pasting `…?task=<id>` opens that record cold (`:95-99,51-93`). Closing deletes **only** the `task` param and keeps every other filter (`:101-109`), and opening does the same in reverse from both views (`task-list.tsx:53-57`, `board.tsx:32-35`) using `router.replace(..., { scroll: false })` so list position and filter state survive. There is an explicit "copy link" affordance (`task-drawer.tsx:139-143,154-162`), the drawer is mounted on all three list surfaces (`board/page.tsx:62`, `my-work/page.tsx:118`, `projects/[id]/page.tsx:448`), and notification links use the same shape (`src/features/tasks/services/task.commands.ts:182`). Access is re-checked on open rather than assumed — an RLS-filtered record renders a neutral "isn't available to you" state (`task-drawer.tsx:77-82,168-177`). Projects are full routes (`/projects/<id>`) rather than drawers, which deep-link directly by construction.

---

## Summary

**35 of 35 requirements assessed.**

| Verdict | Count | IDs |
|---|---|---|
| Complete | 6 | P0-TSK-03, P0-TSK-05, P1-TSK-08, P0-PRJ-02, WORK-003, WORK-008 |
| Partial | 25 | P0-TSK-01, P0-TSK-02, P0-TSK-04, P1-TSK-06, P1-TSK-07, P1-TSK-09, P0-DASH-01, P0-DASH-02, P0-DASH-03, P0-DASH-04, P1-DASH-05, P1-DASH-07, P0-GNT-01, P0-PRJ-01, P0-PRJ-03, P0-PRJ-04, P0-PRJ-05, P1-PRJ-06, P1-PRJ-07, P1-PRJ-08, WORK-001, WORK-002, WORK-004, WORK-005, WORK-007 |
| Missing | 4 | P1-DASH-06, P1-GNT-02, P1-GNT-03, WORK-006 |
| Not applicable | 0 | — |
| Unverifiable | 0 | — |

Nothing in this domain needed a live browser to settle; every verdict rests on code
that could be read here. The cross-cutting caveat from
`docs/audit/09-definition-of-complete.md` still applies to the six Completes —
none of them is exercised by a CI-run end-to-end test, since the authenticated
Playwright matrix does not run in CI, so "Complete" here means the code
demonstrably does the thing, not that a pipeline proves it every commit.

### The three findings I would put in front of a maintainer first

1. **Saved views are write-only, and the four biggest KPIs are computed and thrown
   away.** `saved_view` can be written but is read by nothing — `grep -rn
   "saved_view" src/` matches only `workflow.commands.ts`, so a user names a view
   and can never open it again (P1-DASH-07). Separately, `dashboard.queries.ts`
   runs three `count: "exact"` queries for `activeProjects`, `openTasks`,
   `dueThisWeek` and `overdue` on every home-page load and the page renders none
   of them (P0-DASH-04). Both are small fixes with visible payoff.
2. **Overdue is computed in two different time zones on the same screen.**
   `myWorkBucket` runs server-side against the host clock (UTC in production)
   while `dueLabel` runs client-side against the browser's zone
   (`src/lib/utils.ts:61-101`). For a Montreal user after 19:00 local, My Work
   files a task under "Overdue" whose own row reads "Due today". `user_profile.timezone`
   exists and is used only for the dashboard greeting (WORK-004).
3. **Dependency cycle detection is one hop deep, and recurrence can duplicate
   work.** `circularDependencyError` only rejects self-links and the exact reverse
   pair, and its pre-check query cannot see a longer chain, so A→B→C→A is accepted
   with no database guard behind it (P1-TSK-06). Recurrence spawns the next
   occurrence inline on completion with no idempotency key and no prior-status
   check, so re-completing a completed task creates a duplicate (P1-TSK-07,
   WORK-006).

### Where the code is better than `docs/spec-coverage.md` would suggest

- **The Master Schedule is a real timeline, not a placeholder.** Server-prepared
  bounded window, percentage-positioned health-coloured bars, working today
  marker, staff-gated (`src/app/(workspace)/schedule/page.tsx`). Its gaps are
  milestones, dependencies and program bars — not existence.
- **Task dependencies are wired end-to-end**, not schema-only: server actions, a
  staff-gated picker in the drawer, and a "Blocked by …" list
  (`checklist.commands.ts:48-92`, `task-extras.tsx:80-118`). The defect is the
  depth of cycle detection, not absence of the feature.
- **Project approval is a single idempotent transaction.** `approve_project_request`
  creates the project, settles the request and closes any pending approval in one
  RPC, deliberately safe against a double-click
  (`supabase/migrations/20260828124912_intake_requests.sql:222-283`).
- **Health discipline genuinely cannot be bypassed** through the UI:
  `publishStatusUpdate` is the only writer of `project.health` after creation, and
  it enforces the reason rule server-side as well as in the form.

### One note on `task_read`

`task_read` is `app.is_org_staff(organization_id) or (app.is_org_member(...) and
assignee_id = auth.uid())` (`supabase/migrations/20260818081240_scope_task_and_activity_policies_to_organization.sql:5-9`),
so a volunteer sees only tasks assigned to them. Checked against the spec, that is
**correct, not a finding** — the spec repeatedly scopes volunteers to "assigned
work" (§ role matrix, and P0-VOL-02 "volunteer sees assigned tasks/events …
portfolio complexity is hidden"). The asymmetry that *is* worth a look runs the
other way: staff get org-wide task read, whereas the spec's staff role is
"create and execute work **within granted programs/projects/channels**". Nothing
narrows a staff member's task visibility to their memberships.


## Follow-up: overdue is one answer again, 2026-09-05

WORK-004 closed. `myWorkBucket` and `dueLabel` both call `zonedDueInfo`
(`src/lib/time.ts`), so the grouping in a server component and the row label in
a client component reach the same verdict instead of asking two different
clocks. A Montreal user after 19:00 no longer sees a task filed under "Overdue"
whose own label reads "Due today".

**Correcting this exposed something the audit had not noticed, and my first
attempt got it wrong.** `task.due_at` is a `date` column, not `timestamptz`. A
bare "2026-09-05" is already a calendar date with no zone attached, so passing
it through `new Date()` reads it as UTC midnight — the evening of the 4th in
Toronto — and every task due date would have moved a day earlier. Three
existing tests failed on exactly that, which is the only reason it was caught
before the commit.

`calendarDateInZone` now returns a bare date unchanged and converts only real
instants. The distinction is the point: `task.due_at` (a date) and
`meeting.starts_at` (a timestamptz) are both `string` in TypeScript and want
opposite treatment. Five tests pin it, including a due date on its own day
viewed from an evening where the server's UTC clock has already rolled over.
