# Execution journal

## Active objective

Complete the approved seven workstreams and all PRD v2 P0/P1 criteria on
verified staging. Preserve existing features. Production publishing requires
a separate release decision. Free plans only; do not substitute personal accounts.

## Standing execution prompt

Read acceptance-matrix.md, this journal and readiness-report.md. Inspect the
branch before editing. Choose the earliest dependency-ready unverified feature.
Reproduce its gap; implement UI, authorization, persistence, errors and migration
together. Verify allowed/denied use, invalid input, retry, refresh persistence,
and relevant concurrency/accessibility behavior through browser, server and data.
Fix failed checks before advancing dependent work. Save the exact evidence and
next action. External blockers leave affected features blocked while independent
work continues. Never infer verification from code, mocks or written runbooks.

## Resume prompt

Resume the next action below. Confirm existing changes and verification before
editing. Reconcile intervening work; repeat only invalidated checks. Do not
restart the audit or treat an earlier summary as evidence of completion.

## Current feature: integrating #27, #28 and #76 onto `main`

One pull request from `76-task-core-follow-ups` to `main`, carrying projects
(#27), milestones (#28) and the task-core follow-ups (#76) together.

### What was wrong before

The Epic 02 stack was merged bottom-up instead of top-down, and stranded its own
top commit. On 2026-09-21 PR #74 merged
`28-milestones-owner-status-evidence-order` into the epic branch at 12:00:45.
PR #77 then merged `76-task-core-follow-ups` into that same milestones branch
twenty-eight seconds later, at 12:01:13 — after its contents had already been
taken forward. Nothing carried the task work on. A second gap followed:
`396aa11`, which records the CI result for #76, was committed at 12:13, twelve
minutes after PR #77 merged, so it belonged to no merged branch at all.

The effect was that the nine task-core defect fixes sat on a branch that had
already been merged out, absent from both the epic branch and `main`, while
issues #27, #28 and #76 stayed open because `Closes #` only fires on a merge
into the default branch.

### Why one pull request rather than two

The obvious repair is two merges — the task branch into the epic branch, then
the epic branch into `main`. It is not necessary. `76-task-core-follow-ups`
already contains the whole #27 and #28 history in its ancestry; the only commits
the epic branch holds that it lacks are two merge commits and `e403fd5`, whose
content — deleting `.github/workflows/project-sync.yml` — is already on `main`
through PR #75.

That was checked rather than assumed. `git merge-tree --write-tree` produces
tree `ecc1571d` for the task branch merged into the epic branch, and the same
tree `ecc1571d` for the task branch merged straight into `main`: identical
content, no conflicts, one CI cycle instead of two. The merged tree also keeps
`project-sync.yml` deleted, because a deletion on the `main` side against an
untouched file on the branch side resolves to deleted. The `configuration-guard`
job that failed on PR #77 therefore does not run here at all.

### Evidence

There is no product code change in this pull request. It moves work already
verified on its own branches, and adds this entry.

`docs/acceptance-matrix.md` is deliberately untouched. Its rows already record
acceptance against the exact commits that produced it, and no acceptance claim
changes by moving those commits onto `main`. Duplicating them here would add
volume, not evidence.

The evidence of record for the merged content is the CI run on this pull
request. Relying on it rather than re-running the suite locally is a deliberate
choice, not a shortcut: at `c748713` CI passed all 38 authenticated Chromium
checks in 3.7 minutes with no crashes, while this machine crashed `next start`
four times in roughly thirty-five minutes and never produced two consecutive
clean full passes. **The standing bar of two clean passes through the browser
suite is still not met locally, and this entry does not claim otherwise.** The
reasoning is in the #76 entry below and in the readiness report's Browsers row.

### Not done

- Issue #71 duplicates #76 and stays open. Closing it is a separate decision.
- The `next start` crash (exit `0xC0000409`) and the Firefox-only flake in
  `public-routes.spec.ts:27` are recorded here and in the readiness report, and
  neither is fixed. Both want their own issues before #31 builds on this code,
  because the first corrupted #76's evidence and will corrupt #31's the same
  way.
- #31 — task dependencies, checklists, recurrence and calendar rescheduling —
  remains the last open issue of Epic 02.

## Current feature: task core follow-ups — the defects #29 and #30 left

Issue #76, on `76-task-core-follow-ups` at `c748713`, stacked on #28.

### What was wrong before

Nine defects in merged work. They are grouped here by what kind of wrong they
were, because the kind is what let them survive review.

**Three were wrong data, produced quietly.**

1. The review queue excluded a task with `assignee_id <> me`, meaning "work I
   judge, not work I do". `assignee_id` is null on an unassigned task, and in
   SQL `null <> '<uuid>'` is null rather than true, so the row was dropped. A
   task somebody had been named reviewer of was invisible to them for exactly
   as long as nobody owned it. Measured against the seeded database: 54 tasks,
   41 owned by that person, so 13 are not theirs — the old predicate returned
   **7**, silently losing all six unassigned ones.
2. `bulkUpdateTasks` never cleared `blocked_reason`. `updateTaskStatus` always
   did. So a task bulk-moved off `blocked` kept rendering "Blocked: waiting on
   the venue" above a status that said `in_progress` — text describing a
   blockage that had been declared over.
3. `createTask` accepted `status: 'completed'` and wrote no `completed_at`.
   That is the same split-fact defect #28 had just repaired on `milestone`,
   reappearing on `task` because the two were written by different hands.

**Two were controls that could not work.**

4. `label` and `task_label` shipped in `0001_core.sql` with correct policies —
   `task_label` insert and delete are gated on `has_task_capability(task_id,
   'manage' or 'collaborate')` — the filter bar has offered a label picker
   since #30, and **nothing in the product ever wrote a row to either table**.
   The picker was always empty and the filter always matched nothing.
5. `approver_id` had a column, a command and an RLS grant since
   `20260912040000` and no control anywhere in the product; `reviewer_id` could
   be set once at creation and never changed. The drawer selected both columns
   and rendered neither.

**Two were the page refusing to explain itself.**

6. `status=ready&blocked=yes` returned nothing. That answer is correct — no
   task holds two statuses. The defect was that the page then said "No tasks",
   which reads as "there is no work" rather than "you asked a question with no
   possible answer". The same for `?owner=<someone else>` pasted into My Work,
   which is scoped to one person by definition.
7. Task history diffed five fields, so changing the milestone, reviewer,
   approver, completion criteria or blocked reason recorded a bare "updated"
   with empty metadata. P0-TSK-05 is about material changes being answerable
   afterwards, and the approver column is read by `app.has_task_capability`.

**Two were accessibility and correctness slips.**

8. `window.prompt` collected the blocked reason on the board and in the status
   control. It cannot be labelled, is announced inconsistently, is suppressed
   by some browsers, and discards what was typed if dismissed.
9. `task-row.tsx` called `dueLabel` with no time zone while the board and the
   list both passed the viewer's, so the same task read "Overdue 1d" in the
   project view and "Due today" everywhere else for anyone outside
   America/Toronto — the WORK-004 defect surviving in the component that was
   missed. And `Task` in `src/types/entities.ts` declared 18 of the table's 29
   columns, omitting the two that carry authorization and the three #31 needs.

### What was implemented

No migration. Every fix is application-side, because in every case the database
was already right and the code was not.

The blocked-reason dialog is shared by the board and the status control. The
drawer gained reviewer, approver and a labels section, and asks
`has_task_capability(task, 'collaborate')` rather than assuming staff — the
policy lets a task's own assignee tag it, and guessing would have hidden a
control the server allows. `TaskRow` now requires a `timeZone` prop rather than
defaulting one, which is what found both of its callers.

### Defects found in a browser rather than by inspection

- **The new dialog had no accessible name.** Every `StatusSelect` on the page
  renders one, so a fixed `id="blocked-reason"` appeared many times over. The
  browser binds `<label for>` to the first match, so the visible label belonged
  to a closed copy and the open field had no name at all — the exact failure
  the component was written to remove. The id now comes from `useId`. A
  Playwright accessibility snapshot showed it; reading the component did not.
- **A denial test from #28 was proving nothing.** "A volunteer sees a project's
  milestones without any way to change them" asserted only that the manage
  buttons were absent. They were absent — but because `has_project_capability`
  denied the volunteer read on that project entirely, so the page was blank.
  The test would have passed against a 404. It now builds its own project,
  grants `read_only`, and fails if the milestone is not visible. Checked
  directly: `has_project_capability(<that project>, 'read')` returns false for
  the volunteer.
- **A test of mine asserted the wrong contract.** I first wrote the blocked
  filter to drop the conflicting condition, which would have shown a list of
  Ready tasks underneath a notice saying nothing could match. Both conditions
  are emitted on purpose: zero rows is the true answer, and the notice is what
  was missing.

### Evidence

Commit `c748713`. Environment: local Supabase over the full migration chain
through `20260919120000`, `npm run db:seed`, production build on
127.0.0.1:3000, Chromium.

```
npm run lint          # clean apart from the pre-existing no-img-element warning
npm run typecheck     # clean
npm test              # 504 passed across 54 files (from 480)
npm run build         # passed
npm run test:db       # 395 assertions, exit 0, across 15 files (from 381/14)
npx supabase db advisors --local --type security --fail-on error   # no issues
npx playwright test task-core --project=chromium        # 4 passed
npx playwright test milestones --project=chromium       # 4 passed
```

The review-queue defect was also measured directly against PostgREST rather
than argued from the code: `assignee_id=neq.<uuid>` returned 7 rows where
`or=(assignee_id.is.null,assignee_id.neq.<uuid>)` returned 13, against 54 total
with 41 assigned to that person. That two `or` parameters are ANDed was
confirmed by the same route before relying on it.

Artifacts: `supabase/tests/task-core-followups.sql` (17 assertions, registered
in `scripts/test-db.mjs`), `tests/e2e/task-core.spec.ts` (4 checks, registered
in `.github/workflows/ci.yml`).

The full authenticated suite is 38 Chromium checks with `task-core` added. **On
CI it passed 38 of 38 in 3.7 minutes with no crashes.** Locally it did not pass
twice cleanly, and nothing here claims it did: the best local run was 37 of 38
and a second was 34 of 38.

The gap between those two records is the point. No failure in any local run was
an assertion about product behaviour — each was a transport failure matching a
logged server exit or a network suspension, and every one of the 38 passed
locally when re-run. The `next start` crash (exit `0xC0000409`) fired four times
in about thirty-five minutes on 2026-09-21 against once the day before;
separately, Windows suspended the browser's network stack three times, and an
earlier run was discarded outright when the machine slept mid-suite. CI has never
reproduced the crash, and runs the same suite in 3.7 minutes against 17 locally.

So the local machine, not the product, is what the failures measured. That is
worth recording rather than quietly re-running until green, because the same
instability will sit underneath #31's evidence, and because a suite that fails
differently every run is a poor instrument for proving anything. The readiness
report's Browsers row carries the detail, including a genuinely flaky Firefox
check in `public-routes.spec.ts` that is unrelated to this work.

### Not done

- The `estimate_hours` column is still read by nothing, saved views are still
  write-only, and dashboard KPIs are still computed and not rendered. Those
  belong to Epic #14 / #37 and were left alone deliberately.
- The two reviewer mechanisms — the `reviewer_id` column and the
  `task_assignment` reviewer role — are both now reachable and both still
  exist. The database reconciles them (each grants `review`); the product does
  not explain which one somebody was named through. Collapsing them is a model
  decision, not a defect fix, and is not made here.
- Hosted staging certification remains outstanding under #55.

## Current feature: milestones — owner, status, evidence and order

Issue #28, on `28-milestones-owner-status-evidence-order` at `37dc714`, stacked
on #27.

### What was wrong before

`owner_id`, `description`, `status` and `evidence` have been columns on
`milestone` since `20260912040000`. **Not one line of application code read or
wrote any of them.** That is not a missing form; it left two problems in the
data:

1. **Completion had two representations that could disagree.**
   `completeMilestone` set `completed_at` and never touched `status`, so a
   completed milestone still reported `status = 'planned'`. Every completed
   milestone in the database was already inconsistent. Whichever spelling a
   future reader picked — a report, a roll-up, a filter — half the product
   would have disagreed with it.
2. **A milestone could be completed with nothing to show for it.** The issue's
   definition of done is that completion evidence persists and is visible after
   a refresh, which is only meaningful if completing requires some.

`sort_key` was a third: stored, selected, ordered by nothing and settable by
nobody. Every milestone created through the application landed on the default
`0`, so "ordered milestones" was ordered by `due_date` alone.

### Decisions worth stating

**The trigger, not the application, keeps `status` and `completed_at` in step.**
Whichever side a caller writes, the other follows. A caller that only knows
about `completed_at` — every existing one — still leaves the row consistent,
which is what makes this a repair of the data rather than a new convention that
the old code quietly violates.

**The evidence constraint is `NOT VALID`.** Rows completed before this are
grandfathered rather than retro-fitted with invented evidence. `NOT VALID` only
skips the initial table scan; every insert and update from here on is checked.

**Reopening clears the evidence.** Evidence for a completion that was undone is
evidence for nothing, and leaving it would satisfy the next completion without
anybody having looked at it.

**`missed` is checked in the command and deliberately not in the database.**
The only clock a trigger has is the server's, and `current_date` is UTC. A
milestone due today in Toronto is already "yesterday" in UTC after 20:00, so a
database rule would let it be marked missed while it was still due — the exact
off-by-one recorded against #30 and reproduced once already in this epic.

**Reorder is move-up/move-down, not drag.** The board shipped a drag-only
reorder in #30 that no keyboard could operate. That is a recorded precedent,
not a hypothetical.

### A defect in the local server, not in this work

Three browser runs failed part-way through with `ERR_CONNECTION_REFUSED`. The
cause is not the application: **the local `next start` process crashes**, exit
code `-1073740791` (`0xC0000409`, Windows fast-fail), after a run of
`Error: The destination stream closed early` — Playwright aborting streaming
navigations. Putting the server under a supervisor that records every exit made
the correlation exact: 3 crashes produced 3 failures, then 1 crash produced 1
failure, then two runs with 0 crashes passed 34 of 34.

It predates this branch and is not caused by it, but it is worth its own
investigation: a production server that hard-crashes when clients disconnect
mid-stream is an availability problem that a process manager would hide rather
than fix. Nothing here works around it in product code.

One earlier full-suite run took 1.4 hours instead of the usual 4 minutes and
timed out one identity check; the same spec then passed 4 of 4 in 48 seconds.
That one was the machine, not the code, and is recorded so the slow run is not
mistaken for a flake in the suite.

### Evidence

Commit `37dc714`. Clean `supabase db reset` over the full chain through
`20260919120000`, then `npm run db:seed`, against the production build on
127.0.0.1:3000, Chromium.

- Database chain: **381 assertions, exit 0**, across 14 files — 363 before.
- `supabase db advisors --local --type security --fail-on error`: no issues.
- Unit: 480 passed across 54 files, from 467.
- Chromium: `milestones` 4 passed; the whole authenticated set — `mfa`,
  `realtime-revocation`, `hello-hub`, `access-impact`, `my-work`,
  `identity-lifecycle`, `programs`, `projects`, `milestones` — **34 passed,
  twice consecutively with zero server crashes**, with the server confirmed
  answering after each run.
- Lint clean apart from the pre-existing `no-img-element` warning; typecheck clean.

Three defects in the new spec were found in a browser and fixed: two labels
matched hidden `<option>` elements rather than the visible value, and adding
three milestones in a row raced the page refresh, so the third was asserted
before it rendered.

### Not done

The closing status update still quotes a project's results narrative into the
updates feed, unchanged from #27. Milestone dependencies belong to #31, not
here. Hosted staging evidence stays with #55. The remaining Epic 02 issues are
#71 task-core defects and #31 advanced task planning, after which
`docs/audit/02-work-management.md` needs correcting.

## Current feature: projects — editing, archive, intake decisions, closure, duplication

Issue #27, on `12-epic-02-programs-projects-milestones-tasks` at `bc0ba39`.

### What was wrong before

Almost all of this was application work against schema that already existed.
`updateProject` accepted thirteen fields and **nothing in `src/` called it** —
a project could be created and never edited. The create form sent seven of the
thirteen, so `description`, `sponsor`, `priority` and `reporting cadence` were
unreachable by any route. The directory applied `archived_at is null`
unconditionally, so archiving a project hid it from the only page that could
restore it. `StageSelect` offered `completed`, which `updateProjectStage`
refuses, so choosing it produced an inline failure and nothing else.
`publishStatusUpdate` never wrote `last_status_update_at`, so the stale-project
sweep fell back to `updated_at` and read any edit as a report. `deferred` and
`returned` had been in the intake enum since `20260912040000` with no path to
them. Closure recorded a paragraph and attached no evidence, told nobody, and
reported `openFollowUps: 0` as a literal. `createProjectFromTemplate` copied
three columns.

### Four defects, three of them only visible in a browser or a database

1. **Deferring or returning a request could not work at all.** The command set
   `decided_by` and `decided_at` to null for every status except `declined` and
   `withdrawn`, and `decided_requests_are_attributable` requires both for
   anything outside `submitted` and `in_review`. A reviewer choosing "Deferred"
   got "that decision could not be recorded" and no way to find out why.
2. **The intake edit policy was wrong in both directions.** Its `USING` froze a
   request at `status = 'submitted'`, so a returned request could not be
   clarified — "Returned for clarification" was a label on a dead end. Its
   `WITH CHECK` tested only ownership, so an author could move their own
   request to `in_review` and misrepresent where it stood.
3. **A test fixture could take the whole browser suite down.**
   `tests.authenticate` synthesizes a verified `auth.mfa_factors` row and left
   `secret` null. GoTrue scans that column into a non-nullable Go string, so one
   such row makes every password sign-in for that person fail with "Database
   error querying schema". One outlived its transaction after an aborted
   `test:db` run and the volunteer could not sign in until it was deleted. The
   fixture now writes a dummy base32 secret, which removes the failure mode
   rather than the symptom.
4. **`StageSelect` reports success before the server answers.** It sets its own
   value optimistically and reverts on failure, so a test asserting the select's
   value proves only that the click landed. The archive check now waits for the
   close control to disappear, which only happens after the refreshed page comes
   back from the server.

### A boundary deliberately moved, and one deliberately not

Moved: the intake queue's **write** policy narrows from `app.is_org_staff` to
`manage` on the program a request names. Approving a request creates a real
project inside that program, and until now any staff member could do that for a
program they held nothing on — the last intake surface still on the broad staff
predicate every sibling moved off in the scoped-access cutover. Reading stays
with all staff: a request that silently vanishes from the queue is worse than
one that refuses a decision with a reason. One consequence worth stating:
`has_program_capability` requires AAL2 before granting an owner or administrator
anything past `read`, so deciding a program-scoped request now needs a second
factor — the same bar `createProject` already sets for that program.

Not moved: the project team panel is read-only, for the same reason the
programme one is. `setDirectProjectAccess` requires `authorizeAdminAction()`
and a project manager holds `manage`, not that.

### Evidence

Commit `bc0ba39`. Clean `supabase db reset` over the full chain through
`20260919010000`, then `npm run db:seed`, against the production build on
127.0.0.1:3000, Chromium.

- Database chain: **363 assertions, exit 0**, across 14 files — 334 across 13
  before, with `supabase/tests/project-lifecycle.sql` added to the runner by hand.
- `supabase db advisors --local --type security --fail-on error`: no issues.
- Unit: 467 passed across 54 files, from 463.
- Chromium: `projects` 5 passed; the whole authenticated set — `mfa`,
  `realtime-revocation`, `hello-hub`, `access-impact`, `my-work`,
  `identity-lifecycle`, `programs`, `projects` — **30 passed, twice
  consecutively**, with the server confirmed answering after each run.
- Lint clean apart from the pre-existing `no-img-element` warning; typecheck clean.

Five browser failures were real and were fixed before this was called done:
four locator or race defects in the new spec, and the null-secret factor above.

### Not done

Milestones keep their existing create/complete commands; `owner_id`,
`description`, `status`, `evidence` and `sort_key` are still untouched by
application code and belong to #28. The closing status update still quotes the
results narrative back into the updates feed, so the sentence appears twice on
a closed project — deliberate for now, because the feed is read as history.
Hosted staging evidence stays with #55. The remaining Epic 02 issues are #28
milestones, #71 task-core defects and #31 advanced task planning.

## Current feature: programs — lead, overview composition and approved templates

Issue #26, on `12-epic-02-programs-projects-milestones-tasks` off `698c52f`.

### What was wrong before

The programme schema was well ahead of the programme code. Migration
`20260912040000` added `program.color` and `program.important_links` in
September; both were editable in the dialog and rendered on no page at all. The
lead could be set once, at creation, and never handed over. The overview showed
projects, events and an activity feed, and none of the team, health roll-up or
latest updates that P0-PROG-02 names. Programme templates did not exist in any
form — only `project_template`, carrying three columns and copying no work.

`docs/audit/02-work-management.md` is not a safe guide to this area: it predates
that migration and reads as considerably more broken than the product is.

### Three defects, none of them found by inspection

1. **The important-links parser truncated URLs.** `split("|", 2)` keeps the
   first two fields and drops the rest, so `Report|https://example.org/r?a=1|b=2`
   stored the address without its tail. Visible only once the parser was pulled
   out of the command and could be given a case with a separator inside the URL.
2. **A new dialog broke an existing CI test.** Adding "Save template" to
   `/programs` put a second `Name` field on the page, and `hello-hub` had a
   page-wide `getByLabel("Name")`. It would have failed the authenticated CI job
   rather than the new spec. Both locators are now scoped to their dialog.
3. **A new dated assertion asked the wrong clock.** It compared against Postgres
   `current_date`, which is UTC; the application had correctly used the
   organization's zone. At 01:00 UTC the two differ by a day. The application
   was right and the test was wrong — the same mistake recorded against #30,
   reproduced in a fresh test inside the very window that file warns about.

### A boundary deliberately not moved

The team panel is read-only. `setDirectProgramAccess` requires
`authorizeAdminAction()`, and a programme lead holds `manage`, not that. P0-PROG-02
asks the overview to show the team, so it shows the team; letting a lead grant
access to their own programme would be a real widening of authorization and
belongs in a decision of its own, not in a rendering task.

### Evidence

Commit `42c3232`. Clean `supabase db reset` over the full chain through
`20260918230000`, then `npm run db:seed`, against the production build on
127.0.0.1:3000, Chromium.

- Database chain: **334 assertions, exit 0**, across 13 files — 315 across 12
  before, with `supabase/tests/program-overview.sql` added to the runner by hand.
- `supabase db advisors --local --type security --fail-on error`: no issues.
- Unit: 463 passed across 53 files, from 446 across 51.
- Chromium: `programs` 5 passed; the whole authenticated set —
  `mfa`, `realtime-revocation`, `hello-hub`, `access-impact`, `my-work`,
  `identity-lifecycle`, `programs` — **25 passed, twice consecutively**, with
  the server confirmed answering after each run.
- Lint clean apart from the pre-existing `no-img-element` warning; typecheck clean.

### Not done

Programme operations are surfaced through `OutcomesPanel` and were not revisited.
Hosted staging evidence stays with #55. The remaining Epic 02 issues are #27
projects, #28 milestones, #71 task-core defects and #31 advanced task planning.

## Current feature: scoped-access cutover, MFA and team provenance

- Branch: `11-epic-01-identity-access-security-mfa`, frozen at `ce76227`.
  The implementation had sat uncommitted through the whole epic; the evidence
  below is the first that names a commit.
- Reproduced gap: program/project helpers still grant organization-wide reading
  and staff management. The cutover review surface and typed grant model now
  exist, but the narrower policies have not yet replaced the legacy policies.
- Implement an administrator-only preview of proposed grants from active owners,
  leads and explicit memberships. Show access reductions, unknown roles and
  unassigned active work. No automatic broad-staff backfill or cutover.
- Preview implemented at `/admin/access`: read-only, admin-gated, complete paged
  inventory, error state, proposed sources/reductions and owner/role warnings.
  Broader grants are explicitly outside this preview.
- New communication deactivation migration and regression reproduce the original
  channel/DM access leak and verify its fix in embedded Postgres. Added to test:db.
  Historical rows remain intact. Full Auth/realtime verification remains pending.
- Local Supabase reset applied the complete migration chain. `npm run test:db`
  passed, including export tampering, arbitrary dependency cycles, program audit,
  volunteer program-edit denial and communication deactivation. `supabase db
  advisors --local --type security --fail-on error` reported no errors.
- Authenticated Chromium verification passed for the owner access-impact page
  (real fixture inventory, keyboard details, light/dark axe scan) and volunteer
  denial. Program edit/archive/restore and project-plus-milestone smoke scenarios
  also passed after selectors were scoped to their dialogs.
- Added closed program/project role enums, per-source grant provenance,
  same-organization foreign keys, active-member validation, owner/lead and
  program-inheritance synchronization, safe generated-source handling and
  least-privilege capability RPCs. The clean local migration reset and complete
  database suite pass coexistence, revocation, deactivation, unknown-role,
  cross-organization and leadership read-only cases.
- Completed TOTP enrollment, challenge and multi-factor management for owners
  and administrators. Privileged server actions fail closed unless both the
  session and next refresh are AAL2 and a verified TOTP factor still exists.
  Migration `20260918214957_enforce_live_admin_mfa_factor.sql` applies the same
  live-factor rule to database helpers, so a stale AAL2 token cannot mutate
  after direct factor removal. Security events record enrollment, challenge and
  removal without secrets. Lost-factor recovery is documented. Focused unit,
  full database and real local Auth browser checks pass, including interrupted
  enrollment, expired/replayed codes, direct Data API denial, backup-factor
  removal and stale-session downgrade.
- Added a database-enforced membership lifecycle: at most one active owner per
  organization, immutable membership identity, no direct owner promotion or
  demotion, no self-deactivation, transactional audit events and an atomic,
  locked AAL2 ownership-transfer RPC. Server actions now use that RPC and fail
  if RLS updates zero rows. The complete database suite verifies success,
  rejection and rollback behavior.
- Remaining scoped surfaces now consume capability predicates
  (`20260912021000_cut_over_remaining_scoped_surfaces.sql`). Route gates for
  programs, projects, schedule and reports use `requireSession` plus RLS.
  `/admin/access` shows persisted grants. Export builders re-check the
  requester; notification drain suppresses revoked members.
- Workstreams 2–5 schema and commands are in
  `20260912040000_prd_workstream_completion.sql` plus comments, program colour
  and links, project edit/close rules, task review queue, document quarantine
  and cadence-aware stale sweep.
- A clean local reset now applies the entire migration chain. The full database
  suite passes, including scoped surfaces, MFA, document quarantine and atomic
  meeting failure/retry checks; the local security advisor reports no errors.
- Document uploads stay inaccessible until a server-owned ClamAV verdict is
  clean. Scanner outages leave them pending, registered bytes are immutable,
  and failed registration removes the caller's unregistered upload. A live
  QBBE-controlled scanner host remains a deployment dependency.
- Meeting completion now commits its status and channel summary together, and
  meeting action task/link creation is atomic. Notification and digest delivery
  recheck active membership; Resend retries carry a stable provider key.
- Next independent verification: repeat MFA and open-socket revocation checks
  against the hosted staging candidate at its exact SHA. Meeting completion and
  document pending/error checks remain separate release work. Workstreams 6–7
  wait on QBBE credentials and scanner hosting
  (`scripts/verify-integrations.sh`).
- Required environment: local Supabase is available with the storage services
  excluded because their health check timed out. Full Storage verification remains
  a Workstream 3 dependency; live Auth/MFA and realtime remain staging gates.

### Evidence

Commit `ce76227`. Clean `supabase db reset` over the whole migration chain
through `20260918214957`, then `npm run db:seed`, against the production build
on 127.0.0.1:3000, Chromium.

- Database chain: **315 assertions, exit 0** — not the 313 recorded earlier in
  this file, because this epic added assertions to `rls.sql` and
  `admin-mfa.sql`.
- `supabase db advisors --local --type security --fail-on error`: no issues.
- Unit: 446 passed, 51 files. Lint clean apart from the pre-existing
  `no-img-element` warning. Typecheck clean. Production build passed.
- Chromium: `mfa`, `realtime-revocation`, `hello-hub`, `access-impact`,
  `my-work`, `identity-lifecycle` — **20 passed, twice consecutively**, and the
  server was confirmed answering after each run.

One process failure worth recording, because it produced a convincing false
negative. The first browser run reported 11 failed, 7 passed, 2 not run. Every
failure was `ERR_CONNECTION_REFUSED`: the server had been started with `&` from
a shell that was then reaped, so it died partway through and the suite went on
testing nothing. This file already warned about exactly that — "a reaped server
produces a page of `ERR_CONNECTION_REFUSED` that reads as failure" — and the
warning was still not enough to stop it being read as a product defect at
first. Confirm the server answers *after* the run, not only before it.

`npm run test:db` could not run on Windows at all. npm hands scripts to
cmd.exe, which has no `sh`, so the `sh -c '... | docker exec ...'` one-liner
failed with `'$DOCKER' is not recognized`. It is now `scripts/test-db.mjs`,
following `seed-local.mjs`, which had already solved this for the same reason.

### Not done

Hosted Auth, live email delivery, realtime reconnect over a hosted socket, and
the Firefox/WebKit/performance runs are not covered here and stay with #55 and
#50. `SEC-MFA` stays `awaiting verification` for that reason: local Auth is
real Auth, but it is not the staging candidate.

## Current feature: task roles, task history, My Work and the shared board/list filters

- Branch: `30-my-work-boardlist-and-task-filtering-on-the-real-backend`, worktree
  at `C:/Users/ookel/qbbe-hub-issue-30`, based on `origin/main` f7ddb15.
  Closes #24, #29 and #30 in one pull request.
- Reproduced gap: naming a reviewer, approver, contributor or follower on a task
  conferred no capability at all, so a review queue could not return a row and a
  task role was decoration. Fixed at the authorization boundary first
  (`20260917230500`), with 15 new allow/deny assertions.
- Activity events recorded only that a task was "updated", with empty metadata.
  They now record which field moved and from what, with labels resolved when the
  change is written, so the history keeps saying what it said at the time.
- My Work and the board now read one filter contract covering all nine
  dimensions plus search, shareable through the URL. A query failure is reported
  as a failure rather than rendered as an empty workload, and due dates group in
  the organization's zone rather than the server's.
- Three defects were found by the browser checks, not by inspection: the board's
  keyboard status control bypassed the board's own move handler, so a card moved
  by keyboard neither moved nor was announced; creating a task left `create=task`
  in the address, so a refresh reopened an empty form over saved work; and the
  new activity policy called `app.has_task_capability`, which — unlike its
  program and project siblings — had never been granted to `authenticated`, so
  every authenticated read of `activity_event` failed and the drawer reported
  that failure as "No recorded changes yet".
- Verified at cf75086, environment: local Supabase (migrations through `20260917233000`) plus the production build on 127.0.0.1:3100, Chromium. `npm run lint` (1 pre-existing
  warning), `npx tsc --noEmit`, `npm test` (441 pass), `npm run build`, a clean
  `supabase db reset` over the whole migration chain, the full `test:db` chain
  (311 PASS, 0 errors), `supabase db advisors --local --type security
  --fail-on error` (no issues), and `playwright test my-work access-impact
  --project=chromium` (8 pass) including a grant/revoke round trip read from the
  second person's own session.
- CI is green on the same commit (https://github.com/Chxmdi/QBBE-HUB/actions/runs/35296542545): lint, typecheck, unit tests, the
  production build, the public-route accessibility pass on Chromium, Firefox
  and WebKit, a clean database reset with the whole `test:db` chain and the
  security advisor, and 11 authenticated Chromium checks. That run landed at
  01:25 UTC, inside the window in which dated assertions built from the
  runner's own clock had been failing.
- Two further defects were found by CI rather than locally, and one of those
  only on its second run: dated unit assertions built from the runner's own
  clock rather than the organization's zone, which fail between 00:00 and
  04:00 UTC; a milestone name that now appears both in the Milestones section
  and in the task dialog's picker, which made an older assertion ambiguous;
  and a race in which `router.replace` had not yet removed `create=task` from
  the address when the page reloaded. The last passed locally and on one CI
  run before failing on the next, so timing-sensitive changes here are now
  checked by running the suite twice through.
- Not covered here: realtime revocation over a hosted socket and hosted Auth
  evidence, which need a staging deployment and remain tracked in #55.
- Note for local reruns: Playwright empties `test-results` at the start of every
  run, so the owner's test TOTP secret now lives in `playwright/.auth`. A
  `supabase db reset` removes the enrolled factor, so delete that file too.

## Current feature: identity lifecycle, the QA matrix and a repeatable local database

Issues #68, #67 and #23, on `68-rls-fixtures-and-qa-matrix` off `31696ad`.

### What was wrong before

`rls.sql` was the only file in the database suite without a transaction, so its
fixtures committed. Every local run left another organization and another two
projects behind. During #66 that residue was mistaken for a product defect: the
assignee picker listed QA Owner seven times because the owner had been added to
each leaked organization.

Rolling it back exposed what the leakage had been hiding. On a genuinely clean
database the suite stopped at 148 of its 311 assertions, because
`admin-mfa.sql` read whichever program happened to exist in the organization —
one `rls.sql` had committed on some earlier run. The suite had been depending
on its own pollution and would have failed for anyone starting fresh.

The QA matrix had never run against current code. The blocker was the fixture:
`seed.sql` fills a workspace that must already exist, only the bootstrap
trigger creates one, and nothing bridged the two. Once it could run, `seed.sql`
itself turned out to be broken — it sets an at-risk project's health and adds
the reason afterwards, but a migration since added a trigger requiring the
reason on insert. Nobody had noticed because the seed had never been run.

### Three product defects, all found in a browser

1. **Password recovery dead-ended.** `/auth/callback` writes the session cookie
   for the host the browser is on, then redirected using `request.url`'s
   origin — the server's own name for itself, `localhost` against `127.0.0.1`.
   The browser followed to a different origin, sent no cookie, and was told its
   recovery session had expired. Anywhere the public hostname differs from what
   the server reports, recovery and email confirmation both fail, silently and
   in a way that reads as an expiry problem. Fixed in `1300bb7`.

2. **Deactivation was one-way and erased the person.** `app.can_read_profile`
   required the subject's membership to be active, so deactivating someone made
   their profile unreadable to everyone including the owner. The administration
   page drops member rows whose profile join came back empty, so the row
   vanished — and the Reactivate button with it. Fixed in `6a1aee6`.

3. **A volunteer could open `/reports`.** `config/navigation.ts` marks it
   staff-only and the sidebar honours that, but the page called only
   `requireSession()`. No report data was exposed — row-level security held and
   the page was empty — but a staff surface and a Generate report button were
   offered to somebody the product had already excluded. Fixed in `f067361`,
   with the regression guard in `access-impact.spec.ts` because the
   authenticated CI job runs that and does not run the matrix.

### What was found and was not a defect

- Staff cannot create a task belonging to no project and no programme; that is
  `app.can_create_scoped_task` working as designed.
- The QA matrix required `/programs`, `/projects` and `/schedule` to redirect
  for a volunteer. That predates #24: those pages are scoped, not forbidden.
  The assertion now checks the page opens holding nothing the volunteer was
  granted.
- Three identity tests failing together on "You're doing that too quickly" was
  the invitation limiter, not the suite. It now resets its own bucket.

### Evidence

Commit `f69fb11`. Local Supabase reset from the full migration chain, seeded
through `npm run db:seed`.

- Database chain: 313 assertions, exit 0. Two consecutive runs leave identical
  row counts — 1 organization, 0 programs, 0 projects, 0 tasks.
- Unit: 445 passed, 51 files.
- Chromium: `identity-lifecycle` 4 passed; `hello-hub`, `access-impact`,
  `my-work`, `qa-matrix` 22 passed. 26 authenticated checks, 0 failed. Server
  confirmed answering after each run, because a reaped server produces a page
  of `ERR_CONNECTION_REFUSED` that reads as failure.
- Lint clean apart from the pre-existing `no-img-element` warning; typecheck
  clean.

Statuses stay at `awaiting verification`. Hosted Auth, live email, realtime
reconnect and the Firefox/WebKit/performance runs are not covered here and stay
with #55 and #50.

### Not done

#52 and #55 need QBBE-owned provider accounts, which no commit produces.
`provider-custody.md` and `staging-provisioning.md` prepare them: the register
to fill in, and the ordered procedure with what you should see at each step.
One correction recorded there — the deploy workflow takes no commit input, so a
frozen commit is a matter of operator timing rather than something the workflow
enforces. Tagging would fix it but the publish condition would then skip, which
belongs with #51.

## Delegation

User authorized agents where they improve speed without reducing accuracy.
Agents completed the read-only cutover inventory and prepared the typed grant
and MFA implementations. The parent reviewed and corrected their authorization
boundaries, added ownership lifecycle enforcement, and ran the clean migration
suite. Scoped-policy cutover, team provenance and MFA browser verification are
now split into independent bounded tasks.

## Workstream order

1. Scoped access, account lifecycle, MFA, team synchronization.
2. Project/task/program lifecycle, milestones, recurrence and calendar edits.
3. Contextual comments, quarantined files, meetings/agendas/events.
4. Portfolio/cadence/workload/outcomes, CRM, search, decisions and reports.
5. Durable events, preferences, authorized delivery, quotas and retry recovery.
6. Live QBBE integration verification.
7. Staging deployment, recovery, operations and named operator sign-off.

Provision staging as soon as QBBE access is available. Full final verification
requires all feature gates at the release commit, plus measured performance,
restore, alerts and actual Safari/mobile operator checks.

Latest verification: Node 22 lint and TypeScript pass without warnings; all 419
unit tests and the production build pass. A clean local Supabase reset applied
every migration through `20260914155347_allow_scoped_record_insert_returning`;
the complete `npm run test:db` suite passes, including MFA, ownership transfer,
scoped access, document quarantine and atomic meeting regressions. The local
database security advisor reports no errors. Hosted Auth/realtime, live ClamAV,
integration and final browser evidence remain required.
