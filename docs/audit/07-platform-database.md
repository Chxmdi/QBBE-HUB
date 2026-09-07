# Requirement coverage audit — 07 platform, database, jobs, CI, environment, tests

**Complete — 58 of 58 assessed.**

| Verdict | Count |
|---|---|
| Complete | 26 |
| Partial | 21 |
| Missing | 9 |
| Unverifiable here | 1 |
| Not applicable | 1 |

**The shape of this family in one sentence:** verification is strong up to the
moment code merges and stops almost entirely at the boundary where it reaches
production.

Everything inside the repository is in good order — strict TypeScript with zero
`any`, RLS on all 75 tables, 191 authorization assertions of which 133 are
negatives, two structural gates that catch what a hand audit cannot, ADRs
recording the decisions that matter. Nine of the ten `Missing` verdicts sit
outside that boundary: no staging environment, no migration pipeline, no deploy
workflow, no release identifier, no post-deploy smoke suite, no preview
isolation, no feature flags in use.

Three findings deserve to be read before the rest:

1. **`main` requires no status check** (CICD-001). It is protected, but with
   enforcement off, zero contexts and zero rulesets, so a pull request with CI
   fully red can be merged, and three merges have landed without review. This is
   the larger half of the admin-bypass question that has been open in this
   project, and it has been hidden behind it — disabling the bypass would change
   nothing, because zero required contexts stays zero.
2. **A preview deployment writes to production** (ENV-006). Only one Supabase
   project exists, so any Vercel preview resolves to the live database and the
   two real user accounts in it.
3. **Migrations reach production by hand** (CICD-002, ENV-005, ENG-004). The DDL
   is version-controlled and the catalogue now agrees with the repository
   exactly; the *act of applying* is manual and ungated, which is where this
   project's three filename-drift incidents came from — each caught by a person
   looking, not by a gate.

Scope: CICD-001..005, DB-001..010, DEV-001..010, ENG-001..008, ENV-001..007,
JOB-001..005, PERF-001..006, TST-001..008.

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

## DEV — engineering practice in the code

### DEV-001 (P0) — TypeScript strict mode; avoid `any`; document intentional escapes — **Complete**

`tsconfig.json:11` sets `"strict": true`, and the codebase contains **zero `any`
types**. A grep for `: any` and `as any` across `src/` returns exactly one line,
and it is prose inside a comment ("any message newer than the member's
last-read", `src/app/(workspace)/layout.tsx:65`), not a type annotation.

There are therefore no intentional escapes to document, which satisfies the
requirement's third clause by leaving it empty rather than by ignoring it.
`npm run typecheck` passes in CI on every pull request (ci.yml step 6).

### DEV-002 (P0) — Validated command inputs at trust boundaries — **Complete**

24 feature directories import `zod`, and validation lives in dedicated
`schemas.ts` modules per domain (`src/features/tasks/schemas.ts`,
`projects/`, `risks/`, `requests/`, `outcomes/`, `retention/`, `exports/` among
them) rather than being scattered through handlers.

The deeper half of the requirement — "never trust values because they came from a
typed client" — is satisfied structurally rather than by discipline, and that is
the stronger form. Authorization is enforced by RLS in the database, so a command
that skipped its Zod schema still could not write a row the caller is not
permitted to write. Zod is the layer that produces a readable message; the
database is the layer that decides. This is recorded as a deliberate architecture
choice in `docs/adr/ADR-002-rls-as-authorization-boundary.md`.

### DEV-003 (P0) — Business logic in services or database functions, not in components — **Complete**

The `src/features/<domain>/services/*.commands.ts` and `*.queries.ts` split is
followed consistently across all domains. Components in
`src/features/*/components/` call these and render results — `agenda-triage.tsx`
is representative: it decides which buttons to offer for a given status and
delegates every state change to `triageAgendaItem`/`moveAgendaItem`.

The rule extends into the database where it matters most: agenda triage
authorization is a trigger (`20260903030426`), not a TypeScript check, and the
one-successor rule is an index (`20260905062624`), not a guard.

### DEV-004 (P0) — No service-role or privileged database calls from client components — **Complete**

Service-role access appears in exactly two files, `src/lib/env.ts` (which reads
the variable) and `src/features/jobs/services/jobs.queries.ts` (which uses it for
the queue-health RPCs). **Neither carries a `"use client"` directive**, and a
sweep of every file referencing `createServiceClient` or `SERVICE_ROLE` for that
directive returns nothing.

The one `NEXT_PUBLIC_` variable outside the Supabase URL and anon key is
`NEXT_PUBLIC_APP_URL` (`src/lib/env.ts:48`), which is a public base URL and not a
credential.

### DEV-005 (P0) — Consistent error model; unexpected errors logged with a correlation ID — **Partial**

The model exists and is used. `reportError` (`src/lib/observability.ts:8-16`)
takes an unknown error plus a context object, logs a prefixed line, and forwards
to an error-monitoring DSN when one is configured. This session wired it into
three job failure paths that previously swallowed errors, and
`sanitizeJobError` keeps provider payloads out of the ledger. Expected business
errors are returned as readable strings through the `{ ok, error }` result shape
the commands use.

**There is no correlation ID.** `grep -rn "correlationId\|correlation_id\|requestId"`
across `src/lib/` returns nothing. `reportError` records a message and a context
bag with no identifier tying the log line to the request that produced it, to the
user who saw the generic message, or — per CICD-004 — to the commit that was
running.

The practical consequence is the one the requirement exists to prevent: when
somebody reports "it failed", there is no token they can quote and no field to
search on. Closing this is small — generate an ID per request, return it with the
generic message, and pass it in every `reportError` context — and it pairs
naturally with the release identifier CICD-004 also wants.

### DEV-006 (P0) — Destructive actions define authorization, confirmation, audit event, and recovery — **Partial**

Three of the four are in place, unevenly.

*Authorization* is consistent, because it is RLS rather than per-button checks.
*Confirmation* is present at 13 call sites, and the messages are specific rather
than generic — `member-controls.tsx:82`,
`transfer-ownership-button.tsx:19`, `cancel-meeting-button.tsx:15`,
`policy-editor.tsx:68`. *Recovery* is served by soft deletes where the schema
provides them (DB-007).

*Audit* is where the coverage breaks, and it breaks by domain rather than by
oversight in one place. `admin.commands.ts` writes `audit_event` four times and
`message.commands.ts` twice, but `meeting.commands.ts` writes it **zero** times —
cancelling a meeting, removing an attendee and declining an agenda item all leave
no security-evidence record, only whatever `activity_event` captures. Meeting
cancellation is exactly the kind of act somebody later disputes.

The requirement asks that every destructive action *define* all four. Nothing in
the repository enumerates them, so the answer is per-file archaeology rather than
a list anyone can check — which is why the meetings gap survived three audits of
adjacent code.

### DEV-007 (P1) — Conventional, searchable naming — **Complete**

Names are explicit and domain-shaped throughout: `createProjectRequest`,
`updateTaskStatus`, `addMeetingAttendee`, `triageAgendaItem`, `moveAgendaItem`,
`composeMeetingSummary`, `zonedDueInfo`, `wallTimeToInstant`,
`calendarDateInZone`. The file convention (`*.commands.ts` for writes,
`*.queries.ts` for reads, `schemas.ts` for validation) makes the location
predictable from the name. No `handleSubmit2` or `dataUtils` equivalents exist.

### DEV-008 (P1) — Comments explain why, constraints, and tradeoffs — **Complete**

This is a genuine strength and unusually consistent. Comments carry the reasoning
rather than the mechanics: the round-robin ordering in `global_search` explains
*why* messages rank last within a round; `src/lib/time.ts:1-19` explains why two
cancelling bugs made the timezone defect invisible; `calendarDateInZone`'s
comment names the `date`-versus-`timestamptz` distinction that a reader would
otherwise have to rediscover; migration headers state what the rule is and why it
lives in the database rather than the command.

The one place comments are load-bearing in a way that has already failed is
recorded under TST below: reasoning that lives only in a migration comment cannot
be read by an assertion, which is how the `job_run` exemption came to be written
into a gate stricter than the fix it guarded.

### DEV-009 (P1) — Dependency additions intentional — **Complete**

`npm audit --audit-level=high` runs in CI (ci.yml step 11) and passes. The
project consistently prefers platform capability over a package, and this session
produced the clearest example: the timezone work needed DST-correct conversion
for a named zone and used `Intl.DateTimeFormat`, which already knows every zone's
offset history, rather than adding `date-fns-tz` or `luxon` — no dependency, and
the hard part delegated to the platform.

### DEV-010 (P1) — Feature documentation and runbooks updated in the same pull request — **Complete**

Measured rather than assumed: over the last 40 commits, **7 touched both `src/`
and `docs/`, and only 2 touched `src/` without docs**. Seven runbooks are
maintained (`docs/runbooks/`: deployment, jobs, integrations, backup-recovery,
privacy, qa, launch-gate) alongside `docs/spec-coverage.md` and the ADRs.

A narrower sample would have produced a false negative here — the six most recent
commits are audit reports and migration renames, which touch one tree or the
other by their nature.

## ENG — architecture

### ENG-001 (P0) — Modular monolith; one web application and one primary data platform — **Complete**

One Next.js application, one Supabase project (`list_projects` shows exactly one
`ACTIVE_HEALTHY` project for this product), no services split out. The decision
is recorded rather than merely observed:
`docs/adr/ADR-001-modular-monolith-supabase.md`.

### ENG-002 (P0) — Feature-first organization; domains own their UI, services, validation, types and tests — **Complete**

`src/features/<domain>/` holds `components/`, `services/`, `schemas.ts` and
`tests/` together — `src/features/reports/tests/pdf.test.ts` and
`src/features/channels/tests/mention-recipients.test.ts` are domain-owned tests
sitting beside the code they cover, which is the clause most projects drop.

### ENG-003 (P0) — Schema, migrations, policies, design tokens, environment config and tests treated as product code — **Complete**

All six are in the repository and under CI. Migrations and RLS policies are 60
versioned files with a filename gate (`tests/unit/migration-filenames.test.ts`)
and a 191-assertion allow/deny suite that runs on every pull request. Design
tokens live in `src/design-system/styles/globals.css`. Environment configuration
is a typed module (`src/lib/env.ts`). Tests are 350 unit specs plus a Playwright
suite.

The strongest evidence is behavioural: this session's authorization changes were
made as migrations with assertions, and the assertions twice rejected a fix that
had already been written and believed correct.

### ENG-004 (P0) — No dependence on demo records, browser-only state, hand-edited production tables, or secrets in client code — **Partial**

Three of the four hold. No demo or mock data reaches `src/` (a sweep for
`seedDemo`, `DEMO_`, `mockData`, `fixtures` outside tests returns nothing); the
only browser-only state is the theme toggle in `localStorage`
(`src/components/layout/topbar.tsx:95`), which no behaviour depends on; no secret
is exposed to the client (DEV-004).

**Hand-edited production tables is not satisfied, and this is the same finding as
CICD-002 seen from the other end.** Every migration in this project has been
applied to production by hand through a management API, not by a pipeline. The
DDL is version-controlled, so it is reproducible — but the act of applying it is
manual, unreviewed, and evidenced only in a conversation transcript. The schema
drift this produced is documented: three migrations have had to be renamed after
the fact because the applying tool stamped a version that disagreed with the
repository filename.

### ENG-005 (P0) — Prefer boring, well-supported primitives over custom infrastructure — **Complete**

Next.js, Supabase/Postgres, Zod, vitest, Playwright — all mainstream, all
load-bearing. Where custom infrastructure was a real option the project declined
it: the job runtime uses pgmq through RPCs rather than a bespoke queue, and the
timezone work used `Intl` rather than a date library or hand-rolled offset
tables. The UI primitives in `src/components/ui/` are locally owned rather than
pulled from a component framework, which is the one deliberate exception and is a
reasonable one for a design system with its own tokens.

### ENG-006 (P0) — Every P0 workflow designed end to end across empty, loading, success, permission-denied, partial failure, retry and confirmation states — **Partial**

The states exist as primitives and are used in places — `loading` and `disabled`
on buttons, `role="alert"` error text, confirmation dialogs at 13 sites,
empty-state rendering on the search page (`:131`).

What is missing is the *end to end* part: there is no artefact anywhere that
enumerates a P0 workflow's states and says which are handled. Coverage is
therefore per-component and uneven, and the unevenness is real rather than
theoretical. Partial failure is the clearest gap — the job runner now reports
partial-success runs (this session), but a user-facing multi-step command such as
completing a recurring task has no partial-failure state at all: as recorded
under DB-005, the status update and the successor insert are separate statements,
and a failure between them leaves the user with a success message and a missing
successor.

Offline/reconnect is not handled anywhere; the requirement scopes that to "where
relevant", and for an internal management tool it is defensible to call it not
relevant, but the decision is not recorded.

### ENG-007 (P1) — Architectural decisions recorded in short ADR files — **Complete**

Three ADRs exist and cover the choices that actually shaped the system:
`ADR-001-modular-monolith-supabase.md`, `ADR-002-rls-as-authorization-boundary.md`,
`ADR-003-plain-text-messages.md`. ADR-002 is the one doing the most work — the
"RLS is the authorization boundary" decision is what makes DEV-002's structural
claim true and what the whole 191-assertion suite is testing.

### ENG-008 (P1) — Measure quality in production through structured logs, error monitoring, performance metrics and product analytics — **Partial**

Two of the four. Error monitoring is real and now wired into the paths that
previously swallowed failures (`src/lib/observability.ts`,
`src/lib/job-observability.ts`), forwarding to a DSN when configured. Logs are
semi-structured: `console.error("[qbbe]", digest, context)` gives a stable prefix
and a context object, which is greppable but not machine-parseable, and carries
no correlation ID (DEV-005) and no release identifier (CICD-004) — so a log line
cannot be tied to a request or to a build.

Performance metrics and product analytics do not exist. Nothing measures page
timing, query duration or feature usage, so the PERF requirements below have no
production evidence to be judged against — which is why several of them are
recorded as unverifiable rather than met.

## ENV — environments and secrets

### ENV-001 (P0) — Separate local, preview/test, staging and production environments; production data never required for development — **Partial**

Local and CI/test are real and isolated: `supabase start` builds a throwaway
migrated database per CI run, and the 191-assertion suite creates its own
fixtures rather than reading anything real. No development task in this
repository requires production data.

**Staging does not exist**, and neither does a preview database. There is exactly
one Supabase project for this product, and it is production. Two of the four
environments the requirement names are absent, which is the same fact recorded
under CICD-003 and is the root of several findings in this family: with no
staging, no migration has ever been rehearsed before being applied to the live
database, and "verify against production inside a transaction that always rolls
back" — the technique this project has had to invent and use repeatedly — is a
workaround for its absence.

### ENV-003 (P0) — Secrets in environment-specific secret management; only public values use NEXT_PUBLIC — **Complete**

No secret is committed. `NEXT_PUBLIC_` appears on exactly three variables: the
Supabase URL, the anon key, and `NEXT_PUBLIC_APP_URL` — all three genuinely
public. The service-role key is read only in `src/lib/env.ts` and used only in
server modules (DEV-004).

CI reinforces this rather than relying on it: the build step passes deliberate
placeholders (`https://placeholder.supabase.co`, `placeholder-anon-key`,
ci.yml:33-35) with a comment recording why, so a real credential entering the
workflow file would be a visible change rather than a quiet one.

### ENV-004 (P0) — Complete `.env.example` with names and descriptions but no secret values — **Complete**

`.env.example` documents 18 variables in commented sections, opening with the
rule it exists to enforce ("Every secret lives in environment-specific secret
management (Vercel/Supabase), only NEXT_PUBLIC_* values may reach the browser").

The only variables carrying values are local development defaults —
`NEXT_PUBLIC_APP_URL=http://localhost:3000`, `SMTP_HOST=127.0.0.1`,
`SMTP_PORT=54325`, the Google callback on localhost. None is a secret; all are
the values a developer would otherwise have to guess.

### ENV-005 (P0) — Production schema and policy changes go through migrations in CI/CD; no undocumented dashboard-only edits — **Partial**

The first half is met in substance and the second in full: every schema and
policy change is a migration file in the repository, and the catalogue agrees
with the repository exactly — all 60 recorded versions match the 60 filenames,
verified this session. There are no dashboard-only edits, and nothing
undocumented.

**"In CI/CD" is not met.** No pipeline applies migrations (CICD-002); every one
has been applied by hand. The distinction matters because the manual step is
where this project's schema drift has come from: the applying tool stamps its own
version, so three migrations have needed a follow-up rename to reconcile the
filename with the recorded version. Each was caught, but by a person looking, not
by a gate.

### ENV-006 (P1) — Preview deployments use isolated or non-production data and never write to production — **Missing**

There is no preview database to be isolated. Any Vercel preview deployment
resolves `NEXT_PUBLIC_SUPABASE_URL` to whatever the project's environment
provides, and only one Supabase project exists — so a preview deployment reads
and writes **production**. Nothing in the repository prevents this or records it
as a known risk.

This is the highest-consequence finding in the ENV group. A preview build of a
branch with a destructive migration or a bad command would act on live data, and
the two real user accounts in production are the ones it would act on.

### ENV-007 (P1) — Feature flags for risky integrations, navigation changes, experimental workflows and staged rollout — **Missing**

Same evidence as CICD-005: the `feature_flag` table exists and no code reads it,
so none of the integrations, navigation changes or workflows shipped behind a
flag. Additionally, as recorded there, the table's `key text primary key` cannot
express a per-organization or per-role value, which is precisely the "staged
rollout to specific roles or users" this requirement asks for. The schema would
need `(key, organization_id)` before the requirement is expressible, let alone
met.

## JOB — background work

### JOB-001 (P0) — Scheduled jobs for the named recurring work — **Partial**

The scheduler is real, and — worth stating plainly, because a cron entry that
could never fire is one of this project's documented past failures — it is
**verified live**: 14 job definitions, all enabled; 14 `cron.job` entries, all
`active`; and every schedule matching its definition one for one. The design
claim that the cron entries are generated from `job_definition` so the two cannot
drift is true in production, not just in the migration comment.

Six of the seven named jobs exist: notification digests (`daily-digest`),
announcement reminders (`announcement-nudge`, `scheduled-announcements`),
stale-project detection (`stale-project-sweep`), Gmail watch renewal
(`gmail-watch-renew`), data retention (`apply-retention`), and periodic
reconciliation (`google-sync`, `vms-sync`). Five more run beyond the list.

**Recurring task generation — the first item the requirement names — has no
job.** Occurrence generation is still a side effect of a user completing a task,
so a recurring task nobody completes produces nothing, and a series cannot run
ahead of its last completion. This is the known WORK-006 gap, and this session's
one-successor index constrained it without moving it: the index guarantees a
completion spawns at most one successor, which is a different question from
whether anything spawns occurrences on a schedule.

### JOB-002 (P0) — Durable queue for retryable fan-out work — **Complete**

pgmq, reached through RPCs rather than direct table access
(`job_queue_send`, `job_queue_read`, `job_queue_delete`, `job_queue_archive` —
`src/features/jobs/services/queue.ts:43-90`). Durability is the database's, not
the application's: a message survives a worker crash because it was never removed
from the queue, only made invisible.

All four named workloads run on it — email notifications
(`drain-notifications`, `retry-failed-emails`), report exports (`run-exports`,
`expire-exports`), integration processing (`google-sync`, `vms-sync`,
`gmail-watch-renew`), and the workflow/retention sweeps.

### JOB-003 (P0) — Every queued job has an idempotency key, attempt count, last error, next retry, and terminal failure handling — **Partial**

Four of the five, with the fifth uneven.

*Attempt count* and *next retry* are pgmq's own `read_ct` and visibility timeout
— surfaced to handlers as `message.readCount`
(`drain-notifications.ts:538`) — so they are per-message and durable rather than
reconstructed. *Last error* is recorded on `job_run.error`,
`background_job_run.error` and `export_job.error`. *Terminal failure handling*
is explicit: `readCount > definition.max_attempts` archives the message and logs
`job.notification.poisoned` (`:538-545`), with `max_attempts` configured per job
on `job_definition` rather than hard-coded.

*Idempotency* is the gap, and it is partial rather than absent. Notifications
have a real key — `uq_notification_user_dedupe (user_id, dedupe_key)` makes a
duplicate notification unrecordable, which is the same guarantee-by-constraint
pattern used for task successors. But that key belongs to the notification
domain, not to the queue: `queue.ts` has no idempotency parameter, so exports,
integration sync and workflow messages have no equivalent. Re-delivery of one of
those after a worker crash mid-run repeats its effects.

### JOB-004 (P0) — Workers call privileged operations server-side only, and revalidate that the source record still exists and is eligible — **Partial**

The first half is solid: the service-role client is confined to
`src/features/jobs/services/jobs.queries.ts` and `src/lib/env.ts`, neither a
client component (DEV-004), and the worker runs as a server route.

Revalidation is inconsistent. `retry-failed-emails` explicitly looks for orphans
before acting (`:75`), which is the requirement done properly. Others act on the
message payload without re-reading the source row, so a job queued against a
record that has since been archived, cancelled or made ineligible will still
process it — the window is small for a five-minute schedule and real for
`announcement-nudge` at daily cadence, where a cancelled announcement can still
be nudged.

### JOB-005 (P1) — Long-running work exposes status through job/export records rather than holding HTTP open — **Complete**

`export_job` is the clearest instance and carries a complete lifecycle:
`status`, `started_at`, `completed_at`, `storage_path`, `byte_size`,
`row_count`, `error`, `expires_at`, `downloaded_at`, `download_count`. The
request that asks for an export returns immediately; `run-exports` does the work
on a five-minute tick and `expire-exports` cleans up. `job_run` and
`background_job_run` give the same treatment to scheduled work, and the admin
Jobs panel reads them.

## PERF — performance

### PERF-001 (P0) — Core Web Vitals in the good range at p75 on production traffic — **Unverifiable here**

Nothing measures them. There is no analytics or RUM integration (ENG-008), so no
p75 for LCP, INP or CLS exists for this application — the requirement is not
failed, it is unmeasured, and cannot be settled from this container.

What would settle it: enable Vercel Speed Insights (or any RUM) on the production
deployment and read the p75 after a week of real traffic. Until something
reports, any claim about this requirement in either direction is a guess.

### PERF-002 (P0) — Avoid loading entire histories; use cursor pagination and virtualization — **Partial**

Message history is bounded, and deliberately: `CHANNEL_HISTORY_PAGE_SIZE` caps
the initial load and both realtime paths
(`src/features/channels/components/channel-view.tsx:163,180`;
`src/app/(workspace)/channels/[id]/page.tsx:72`). So the worst case the
requirement names — loading an entire message history — does not happen.

But it is a **cap, not pagination**. There is no `.range()` anywhere in the
feature queries and no cursor for the UI to advance (the `cursor` matches in the
codebase are Gmail history/sync tokens, a different thing entirely). A reader
reaching the top of a channel cannot load older messages; the history simply
stops. The same shape appears in the dashboard's `limit(1000)` (DB-009) and the
search RPC's `p_limit` (P1-SRC-03) — three places where a bound protects the
server and silently truncates what the reader is told.

No list virtualization exists, which is defensible at these page sizes and is not
the gap; the missing cursor is.

### PERF-003 (P0) — Image sizing/optimization and explicit dimensions to prevent layout shift — **Partial**

`next/image` is used **zero** times; there are 2 raw `<img>` elements. Next.js's
optimization, lazy loading and intrinsic-size reservation are therefore all
unused.

The exposure is small, because this application is text and data rather than
imagery — two images, both avatars by context. But the requirement's mechanism is
absent rather than deliberately traded away, and avatars in a list are a classic
CLS source precisely because they load late. Swapping two elements for
`next/image` with explicit `width`/`height` would close it.

### PERF-004 (P0) — Realtime subscriptions scoped to the active view, unsubscribed on navigation, never one per row — **Complete**

Exactly one realtime subscription exists in the entire application
(`channel-view.tsx:194`), scoped to a per-channel topic, established when a
channel is open, and torn down in the effect's cleanup
(`supabase.removeChannel(subscription)`, `:222`). One subscription per active
view, none per row, and no leak on navigation. The requirement's failure mode —
a subscription per card — is structurally impossible here because there is only
one subscription site.

### PERF-005 (P1) — Query performance budgets for high-traffic endpoints; inspect slow queries and index usage in staging load tests — **Missing**

No budgets are defined anywhere, and no load test exists. The requirement also
presumes a staging environment to run them in, which does not exist (ENV-001), so
this is blocked on CICD-003 rather than merely undone.

The related evidence is under DB-004: 125 of 217 foreign keys have no leading
index. Whether any of them matters is exactly the question a load test would
answer, and nothing has asked it — no query in this application has been
profiled.

### PERF-006 (P1) — Cache expensive read-only aggregates safely; never cache permission-sensitive results without scope-aware keys — **Not applicable, trending to Complete**

There is no caching layer, so there is nothing to have got wrong. The second and
more dangerous clause — caching permission-sensitive results under a key that
does not include the viewer — cannot be violated by code that does not exist.

Recording this as "not applicable" rather than "missing" is deliberate: the
requirement is conditional ("cache ... where safe"), and the aggregates it would
apply to are the dashboard counts, which DB-009 says should become views or RPCs
first. Caching them before that would be optimising the wrong layer. Whoever
implements DB-009 should read this requirement's second clause before adding a
cache in front of it.

## TST — testing

### TST-001 (P0) — Lint, type-check, unit tests, database tests and build verification on every pull request — **Complete**

All five run on `pull_request` (`.github/workflows/ci.yml`): Lint (step 5),
Type-check (6), Unit tests (7), Production build (8), and the `database-security`
job's migrated-database RLS matrix (step 7) plus `supabase db advisors`. Verified
green on this branch: 350 unit tests, 191 RLS assertions, advisor clean.

One caveat that belongs to CICD-001, not here: these run on every pull request
but **gate nothing**, because no status check is required to merge.

### TST-002 (P0) — Playwright across Chromium plus targeted WebKit/Firefox for critical flows — **Partial**

Playwright is configured and running, but `playwright.config` declares a single
project: `{ name: "chromium", use: { ...devices["Desktop Chrome"] } }` (`:26-27`).
There is **no WebKit or Firefox project at all**, so the targeted cross-browser
coverage the requirement asks for is absent.

WebKit is the more consequential omission: it is Safari and every iOS browser,
and this application has a mobile bottom nav, so the mobile experience is
untested on the engine most mobile users will run it in.

### TST-003 (P0) — RLS tested with positive and negative cases across the named scenarios — **Complete**

This is the best-tested area of the project by a wide margin: 191 assertions with
**133 phrased as negatives** ("cannot", "must not"), which is the right ratio for
an authorization suite — the interesting claim is almost always what someone is
refused.

Every scenario the requirement names is covered: authorized member, wrong
project, wrong private channel, anonymous (`tests.clear_auth`), and admin without
implied private access (the suite asserts an admin cannot read another
organization's messages, and cannot read the job queue directly).

Two structural gates go beyond per-table assertions and are worth naming, because
both were added after a hand audit missed what they now catch: one asserts no
policy tests membership in *any* organization rather than *this* one, across
`public` and `storage`; the other asserts the same of every `SECURITY DEFINER`
helper body — the surface the first gate structurally cannot see, and where two
real holes were hiding.

The suite has also proven itself by failing correctly. This session it rejected a
storage-policy fix that would have created a second permissive policy beside an
unscoped one (no net effect), and rejected the recurrence migration's test for a
reason that turned out to be a defect in the test's own role handling — which in
turn exposed that the invite-only assertion had been passing without exercising
the trigger.

### TST-004 (P0) — End-to-end coverage of the named critical P0 flows — **Partial**

Three spec files exist. `public-routes.spec.ts` runs in CI (ci.yml:53) and covers
unauthenticated routes with axe accessibility checks. `qa-matrix.spec.ts` has 10
tests covering themes, widths, content stress, keyboard and data states against a
seeded QA database — and its own header states it is "Not part of the CI unit
suite". It does not run in CI, and cannot in this container, because it needs
authenticated Supabase access that the egress policy blocks.

So of the nine named flows — sign-in/onboarding, create/assign/complete task,
create project, post/reply message, announcement acknowledgment, meeting action
to task, CRM follow-up, report generation/export, admin permission changes —
**none has end-to-end coverage that executes anywhere on a schedule**. The
authenticated suite that would cover several of them exists but is unrun, which
by this project's own standard ("a check recorded as passing that had never run")
is the failure mode to name loudly rather than count as coverage.

Unblocking it needs a QA Supabase project reachable from CI — the same missing
environment as ENV-001 and CICD-003.

### TST-005 (P0) — Webhook and queue tests cover duplicate delivery, retry, timeout, invalid payload and terminal failure — **Partial**

Queue behaviour is genuinely tested, and at the right level.
`tests/unit/drain-notifications.test.ts` covers a message the database refuses
without failing the batch ("one message's trouble is not the whole batch's") and
covers terminal failure directly — "a message that fails every time is taken out
of circulation ... archives it once it has been delivered past the attempt
limit", asserting the `job.notification.poisoned` path at `readCount 6`. Retry
and terminal failure are therefore covered by execution, not by claim.

Missing from the named list: **duplicate delivery**, **out-of-order delivery**,
**timeout**, and **invalid signature/payload**. The duplicate-delivery gap is the
one that matters most, because JOB-003 records that idempotency exists only for
notifications — so for exports and integration sync there is neither a key
preventing double effects nor a test that would reveal them.

There is no webhook signature verification test because there is no inbound
webhook with a signature to verify; the Google integrations poll on a cursor
rather than receiving signed callbacks. That part is better recorded as not
applicable than as missing.

### TST-006 (P0) — Deterministic synthetic test data; no dependence on production records or personal accounts — **Complete**

The RLS suite builds its own fixtures inside the transaction it runs in, using
fixed synthetic identities (`gatecrasher@example.com`, `qa-owner@example.com`)
and deterministic UUIDs. `supabase/tests/qa-users.sql` seeds those users; nothing
reads a production row or a personal mailbox.

This session tightened it further: a fixture cleanup that deleted a row a later
assertion depended on was removed, so the suite no longer has an order dependency
between blocks.

### TST-007 (P1) — Visual regression testing for design-system components and key layouts — **Missing**

No snapshot or visual-diff testing of any kind: no `toHaveScreenshot`, no
Percy/Chromatic/Argos integration, no committed baseline images. `qa-matrix`
exercises themes and widths but asserts accessibility and behaviour, not
appearance, so a purely visual regression would pass it.

The requirement scopes this to "after the redesign stabilizes", which is a
reasonable defer — but the deferral is not recorded anywhere, so it reads as
overlooked rather than chosen.

### TST-008 (P1) — Staging smoke suite runs automatically after deployment and blocks promotion if core flows fail — **Missing**

Blocked at every layer: there is no staging environment (ENV-001), no deployment
workflow to hang a post-deploy step from (CICD-002/003), no authenticated smoke
suite that runs anywhere (TST-004), and no required status check that could block
anything even if one existed (CICD-001).

This requirement is best read as the summary of the family's central gap rather
than as an independent item: the project's verification is excellent up to the
moment code merges, and stops entirely at the boundary where it reaches
production.

