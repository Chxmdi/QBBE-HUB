# Audit 02 — Work management (tasks, projects, programs, milestones, dashboards, Gantt)

<!-- progress: 6 of 35 assessed -->

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
