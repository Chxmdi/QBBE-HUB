# Requirement coverage audit — 07 platform, database, jobs, CI, environment, tests

**In progress.** Verdicts are appended as each requirement is settled; a summary
table follows once all 58 are done.

Scope: CICD-001..005, DB-001..010, DEV-001..010, ENG-001..008, ENV-001..007,
JOB-001..005, PERF-001..006, TST-001..008.

Method note: this family is the one where a claim is cheapest to make and
hardest to check, so the standing rule in the briefing applies with particular
force here. Three separate things in this project were recorded as working and
were not: an RLS suite that had never once executed, a cron entry that could
never fire, and a required CI check whose name did not exist. Where a
requirement is satisfied only by a file existing, that is Partial, and the
report says what would make it Complete.

## CICD — continuous integration and delivery

### CICD-001 (P0) — Protect main; require passing checks and review before merge — **Partial**

`main` is protected (`GET /repos/Chxmdi/QBBE-HUB/branches/main` returns
`protected: true`), and short-lived feature branches are the working pattern, so
the second sentence of the requirement holds.

The first does not. The same response reports
`required_status_checks.enforcement_level: "off"` with `contexts: []` and
`checks: []`, and `GET /rules/branches/main` returns zero rulesets. **No status
check is required to merge into main.** CI is advisory: a pull request with
`Verify` and `Database security` both red can be merged, and nothing stops it.

Review is not enforced either. Pull requests #4 and #5 were both merged into
`main` during this session with `get_reviews` returning `[]` — zero reviews, no
override flag passed. Three merges have now landed on `main` without a second
pair of eyes.

This is worth separating from the admin-bypass question that has been open in
this project, because it is the larger half and it has been masked by it. The
bypass explains how an administrator gets around a rule; here **there is no rule
to get around**. Turning the bypass off would change nothing about CI: zero
required contexts stays zero.

`docs/production-readiness-audit.md` and the W11 work record branch protection
as done. That record is what the protection *should* be, not what it is — the
same failure mode as the required check whose name did not exist.

To close: add `Verify` and `Database security` to the required-status-check
contexts, set enforcement to include administrators, and require one approving
review. Note that the exact `required_pull_request_reviews` block is not
readable unauthenticated; the zero-review merges are the behavioural proof, and
an authenticated `GET /branches/main/protection` would confirm the setting
itself.

### CICD-002 (P0) — Migrations deployed in a controlled sequence compatible with the application release — **Missing**

There is no migration deployment at all. `.github/workflows/ci.yml` is the only
workflow, and its single `supabase` invocation is
`supabase db advisors --local` (ci.yml:87) against the throwaway CI database.
Nothing in the repository, in CI, or in the Vercel configuration applies a
migration to production. Every migration in this project has been applied by
hand.

The consequence is not hypothetical; it happened in this session. Pull request #4
merged the code that writes `task.recurrence_parent_id` while the migration
creating that column was still unapplied, so between the merge and the manual
apply, completing a recurring task in production would have failed on a column
that did not exist. That window is precisely what "compatible with the
application release" exists to prevent, and only the fact that `task` holds zero
rows kept it harmless.

Ordering *within* the migration set is sound — timestamped filenames, uniqueness
and lexicographic/chronological agreement asserted in
`tests/unit/migration-filenames.test.ts:33-49`. So the sequence is controlled;
its relationship to the release is not.

Expand/migrate/contract is not evidenced anywhere. No migration in the 60 splits
a risky change into phases; the closest is
`20260905062624_one_successor_per_recurring_task.sql`, which adds a nullable
column and is naturally backward-compatible rather than deliberately staged.

### CICD-003 (P0) — Staging deploys automatically from main; production promotion is explicit and auditable — **Missing**

No staging environment exists. `mcp__Supabase__list_projects` shows one active
project (`qbbe-hub`, `ACTIVE_HEALTHY`); every other project on the account is
`INACTIVE` and unrelated. There is no second Supabase project, no preview-scoped
database, and no deploy workflow of any kind. Production is the only environment,
which also means no migration has ever been rehearsed anywhere before being
applied to the live database.

Promotion is "explicit" only in the sense that a human runs it manually, and
auditable only through this conversation's record.

### CICD-004 (P0) — Commit/release identifier visible in monitoring, and a rollback path — **Missing**

No release identifier reaches the running application. `VERCEL_GIT_COMMIT_SHA`
appears nowhere in `src/`, `next.config.*`, or the CI workflow, and the
observability module does not stamp one — a report from production cannot be
tied to the commit that produced it.

Vercel's own dashboard retains previous deployments, so an operator does have a
redeploy path in practice; that is the platform's default, not something this
project established, and the requirement's first clause is unmet regardless.

### CICD-005 (P1) — Feature flags for gradual release — **Partial**

The table exists (`supabase/migrations/0003_operations.sql:223-229`) and **no
application code reads it**: `grep -rn "feature_flag" src/` returns nothing. So
none of the modules the requirement names — native messaging, Gmail sync,
workflow automation, data migrations — is behind a flag. Every one of them
shipped to all users at merge.

Separately, the table cannot do what the requirement asks even once something
consults it. `key text primary key` makes the key unique across the whole table
while `organization_id` sits beside it as an ordinary nullable column, so two
organizations cannot hold different values for the same flag — the first row
written owns that key globally. A gradual rollout by organization, which is the
normal use of this table, is not expressible. The primary key needs to be
`(key, organization_id)`, with the null organization meaning the default.

## DB — data model

Catalogue figures below are from the live production database, not from reading
migrations, per the standing rule in this project that the repository says what
was intended and the catalogue says what is deployed.

### DB-001 (P0) — UUID keys, timestamptz, explicit FKs, constraints, UTC stored and formatted in the workspace zone — **Complete**

Across 75 `public` tables: every `id` column is `uuid` (0 exceptions), there are
**no** `timestamp without time zone` columns anywhere (0 of all columns), and 217
explicit foreign-key constraints are declared. Check constraints are used for
domain rules rather than left to the application — `agenda_item.status`
(`20260903030426`) and `task_is_not_its_own_successor` (`20260905062624`) are two
added in this session.

The formatting half is satisfied as of this session's timezone work:
`organization.timezone` is carried on the session (`src/lib/auth.ts`), and
`src/lib/time.ts` converts against it rather than the runtime's zone. See DB-004
and the note under DEV below for a place this is not yet applied.

### DB-002 (P0) — snake_case identifiers; TypeScript-friendly generated types — **Partial**

snake_case is clean: 0 of 75 table names deviate.

Types are **not generated**. `package.json:21` defines
`"db:types": "supabase gen types typescript --local > src/types/database.ts"`,
but `src/types/database.ts` does not exist — `src/types/` contains only
`entities.ts`, hand-written on 14 August and not regenerated since. Nothing in
the codebase imports a generated `Database` type; `grep -rn "types/database" src/`
returns nothing.

So application types are hand-maintained and can drift from the schema silently,
which is the precise condition DB-010 exists to prevent. The script is a
documented intention that has never run.

### DB-003 (P0) — RLS on every user-facing table and storage path; deny by default — **Complete**

All 75 `public` tables have `relrowsecurity` set; zero exceptions. One table has
RLS enabled and no policy at all (`rate_limit_counter`), which is deny-by-default
working as intended — the guarantee-by-absence pattern used elsewhere in this
schema, and correct for a table only the server writes.

Storage is covered too, and this is the one worth stating explicitly because it
was wrong twice: `storage.objects` now carries exactly one SELECT policy, scoped
to the organization. An earlier fix created a second permissive policy beside the
unscoped original, which would have OR'd together to no effect.

The known exception is documented rather than hidden: the documents **upload**
policy is not organization-scoped, because no `document` row exists at upload
time to scope against. It is exempted by name in the standing RLS gate
(`supabase/tests/rls.sql`), so a third exemption cannot appear by accident.

### DB-004 (P0) — Index foreign keys and high-frequency filter/order columns — **Partial**

The second clause is well served, and by deliberate composites rather than
single-column afterthoughts:

- `task`: `(organization_id, status, due_at)`, `(organization_id, assignee_id, status, due_at)`, `(project_id, status, sort_key)`
- `message`: `(channel_id, created_at DESC)`, `(conversation_id, created_at DESC)`, `(thread_root_id, created_at)`
- `notification`: `(user_id, read_at, created_at DESC)` — the unread cursor the requirement names
- `channel`: `(organization_id, archived_at)`; `meeting`: `(organization_id, starts_at)`

`assignee_id` has no index leading with it, but sits second in
`idx_task_org_assignee`; since RLS means every task query also filters
`organization_id`, that composite serves the "my work" path properly. Counting it
as uncovered would be a false negative.

The first clause is not met. **125 of 217 foreign keys have no index leading with
the referencing column.** Two consequences, of unequal weight:

- Cascade cost. `on delete cascade` and `on delete set null` scan the referencing
  table once per parent row deleted. Deleting an organization or a user currently
  triggers sequential scans across those 125 relationships.
- Coverage gaps on named columns. `organization_id` is indexed on most core
  tables but **not** on `message`, `notification`, `conversation`, `issue`,
  `risk`, `team`, `saved_view`, `workflow_rule`, `email_delivery`, `invitation`,
  `project_template`, `report_version`, `outcome_measurement`, `crm_follow_up`,
  `crm_interaction`, `gmail_message`, `calendar_event_link` or `feature_flag`.
  `program_id` is indexed on 6 of its 13 referencing tables (`document`,
  `opportunity`, `outcome_metric`, `program_membership`, `program_operation`,
  `project`) and absent on the other 7 including `task`, `meeting`, `event` and
  `channel`.

`message.organization_id` is the least alarming of these — message reads go
through `channel_id`/`conversation_id`, both indexed — and the most alarming is
whichever table first grows large, since none of these is a query anyone has
profiled.

### DB-005 (P0) — Transaction-safe database functions for multi-record commands — **Partial**

The mechanism exists and is used where it was thought about: 16 functions in
`public` and 30 in `app`, with the job queue operating entirely through RPCs
(`job_queue_send`, `job_queue_read`, `job_queue_delete`, `job_queue_archive`,
`src/features/jobs/services/queue.ts:43-90`).

It is not applied to the business commands the requirement is aimed at. The
recurring-task successor is the clearest case: `updateTaskStatus` performs the
status update and the successor insert as two separate statements from the
application, so a failure between them leaves a task completed with no successor.
This session made that safe against *duplication* with a unique index, which is a
different guarantee from atomicity — the index prevents two successors, not zero.
Meeting-summary composition and agenda triage have the same shape.

### DB-006 (P0) — activity_event and audit_event maintained separately — **Complete**

Both tables exist, and the separation is respected in use rather than nominal.
`audit_event` is written from administrative and evidentiary paths
(`src/features/admin/services/admin.commands.ts`, the export-download route, the
report CSV/PDF routes); `activity_event` is written from ordinary domain commands
(`src/features/projects/services/project.commands.ts`,
`milestone.commands.ts`, the stale-project sweep) and read on the program and
project pages. No file writes both for the same event.

### DB-007 (P1) — Archive/soft-delete metadata where history must be preserved — **Complete**

7 `archived_at`/`deleted_at` columns across the schema, and they are honoured in
queries rather than merely present — `.is("archived_at", null)` filters appear
throughout the dashboard and task queries. `channel` pairs `archived_at` with an
index (`idx_channel_org (organization_id, archived_at)`), so archiving is a
first-class filter, not an afterthought.

### DB-008 (P1) — Sortable fractional key for reorderable lists — **Complete**

`task.sort_key` is `double precision`, so a drag-and-drop writes one row by
choosing a value between its neighbours rather than renumbering the list.
`agenda_item` uses the same column and is indexed for it
(`idx_agenda_meeting on agenda_item (meeting_id, sort_key)`,
`0003_operations.sql:57`), and `idx_task_project (project_id, status, sort_key)`
makes the board's ordering an index scan.

A double runs out of precision after roughly 50 consecutive insertions between
the same two neighbours, so a rebalancing path will eventually be needed; that is
a known property of the technique, not a defect against this requirement.

### DB-009 (P1) — Views/materialized views or designed RPCs for expensive aggregations, not raw rows aggregated in the browser — **Partial, with a correctness bug**

There are **0 views and 0 materialized views** in `public`, and the only
aggregate-shaped RPC is `count_export_download`.

Much of the dashboard is nonetheless done correctly, and the audit should say so:
six of its counts use PostgREST's `count: "exact", head: true`
(`src/features/dashboard/services/dashboard.queries.ts:95-122`), which aggregates
in the database and transfers no rows.

Three do not, and one of those is wrong rather than merely slow:

```
.from("task").select("status, due_at").in("status", OPEN_STATUSES)
  .is("archived_at", null).limit(1000)          // :253-258
```

followed by a JavaScript loop that buckets the donut chart (`:262-269`). The
`limit(1000)` is silent: at 1,001 open tasks the chart stops being a picture of
the organization and becomes a picture of an arbitrary thousand of its tasks,
with nothing on screen saying so. Program health (`:232-235`) and the 60-day
completion trend (`:236-240`) pull raw rows the same way.

These three belong in a view or an RPC — which is exactly what the requirement
asks for, and would remove the cap as a side effect.

### DB-010 (P1) — Generate types from the live schema in CI and fail on drift — **Missing**

No generation and no gate. `.github/workflows/ci.yml` has no type-generation step
and no drift check; the `db:types` script exists (`package.json:21`) but its
output file has never been committed. Application types are hand-written
(`src/types/entities.ts`) and nothing compares them to the schema, so a column
renamed in a migration produces no build failure — it produces a runtime error in
whichever page reads it.

