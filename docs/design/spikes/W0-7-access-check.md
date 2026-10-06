# W0-7 spike: one access check, correct and fast

Written 2026-09-30 by the S2 Access build session (epic #199, plan A6 in
`docs/plans/workspace-os-plan.md`, item W0-7 / P0-3 in
`docs/plans/workspace-os-execution.md`).

The question: can one check, `app.can(object_id, capability)`, give exactly
the answers today's rules give, and stay fast on a board?

## Verdict

**GO, with one condition on how lists use it.**

- **Correct.** For all 60 organization members plus a stranger, at both
  sign-in levels, on every task, project and program (2,042 objects, then
  2,040 after the changes delete two), the new check gives exactly the
  answer today's rules give. That is zero mismatches across 2,963,532
  checks, before and after about 20 kinds of change made through today's
  tables. The trigger-kept cache also matched a full
  rebuild row for row. Getting there found three rules the A6 design had
  not spelled out (findings 1 and 3); all are now modelled.
- **Fast for lists, when lists use the set-based form.** On a 500-task
  board, a policy that reads the new cache is within 1.3 ms of today's
  policy (from 1.2 ms faster to 1.3 ms slower), and returns exactly the same
  rows. The target was under 20 ms added.
- **Too slow when called once per row.** Calling `app.can()` on each row of
  a 500-row board adds 40 to 340 ms, so it fails the target. `app.can()` is
  for one record at a time (a drawer, a page, an action's permission check).
  Lists must use the set-based form, as the #115 rewrite already does today.
- **Cheap to keep current.** Giving someone a 1,000-task program costs 33 ms;
  moving a 500-task project to another program costs 26 ms.
- **One weak spot to fix before M10c:** a bulk insert of 500 tasks costs
  0.6 to 1.1 s instead of about 40 ms, because the prototype's triggers work
  one row at a time. Statement-level triggers fix that (see "Before building for real").

- **Two changes to the agreed design (W0-9) follow from this.** The cache
  must be refreshed straight away when access changes, not deleted and
  recomputed on the next check. And organization roles need a "ceiling"
  rule. Both are explained in "How this fits the agreed design".

## What was built

Everything is in `supabase/spikes/w0-7-access/`. It is **not a migration**:
`supabase db reset` and the deploy never apply it. Everything lives in its own
`spike_access` schema, so one `drop schema spike_access cascade` removes it,
including the triggers it adds to today's tables. The check is called
`spike_access.can` so it cannot collide with the W0-3 stand-in for `app.can`.

| File | What it does |
|---|---|
| `20261102000100_access_spike_schema.sql` | Tables, the cache, the refresh triggers and the check |
| `20261102000200_access_spike_dual_write.sql` | Mirrors today's tables into the new model (triggers) and backfills |
| `equivalence-*.sql` | The equivalence test (setup, one shard of people, changes, report) |
| `timing.sql` | Board and refresh timings |
| `scripts/spikes/access-spike.mjs` | Runs any of the above against the local database container only |

### The model

- **Objects** (`spike_access.object`): every securable thing, with its chain
  of parents stored as an array: a task, then its project, then its space,
  then the workspace. This stands in for S1's object registry.
- **Spaces**: one Workspace space per organization; one space per program
  (with the program's own id); one Private space per person; custom spaces
  later.
- **Capabilities**: the seven from A6 (view, comment, edit content, edit
  structure, manage, run workflow, share), plus **review** and **approve**,
  which today's rules already tell apart and approvals will need. Each is a
  bit, so one number holds a person's whole answer for an object.
- **Roles** (`access_role`): named bundles of capabilities. The built-in
  ones are today's roles, restated. Custom roles (M10d) are more rows in the
  same table.
- **Grants** (`access_grant`): role R on object O, to a person, a team, or
  everyone holding an organization role. A grant reaches everything under O
  by default. A grant's **reach** can instead be "this object only", or
  "this object and the tasks directly in it" (only needed to copy today's
  lead column exactly, finding 3).
- **Cache** (`access_cache`): one row per (person, object) holding the
  combined capabilities from person and team grants. Triggers keep it
  current: a grant change refreshes only its people and only the objects
  under it; a move refreshes the moved object and everything under it.
- **Organization roles are not cached.** Owner, admin and leadership viewer
  reach everything in the organization, and owner/admin writing depends on
  the session having completed two-step sign-in (MFA). These are answered
  live from a five-row table. So a promotion, a suspension or a session
  without MFA takes effect on the very next query, with nothing to refresh,
  and the cache does not need a row per admin per object.
- **Some organization roles are also ceilings**, applied live
  (`org_role_ceiling`): an owner or admin is read-only everywhere until the
  session completes MFA, and a leadership viewer is always read-only, whatever
  grants they hold (finding 1).
- **Membership is checked live too**: a deactivated person loses everything
  at once, even though their cache rows are still there.

### How today's roles map

| Today | New role | Capabilities |
|---|---|---|
| Program lead or manager, project manager | manager | all nine |
| Contributor; task assignee or requester | contributor | view, comment, edit content, run workflow |
| Reviewer | reviewer | view, comment, edit content, review |
| Approver; task reviewer or approver column | approver | view, comment, edit content, review, approve |
| Follower, read only | follower / read only | view, comment |
| Owner, admin, leadership viewer | org reader (live) | view, comment |
| Owner, admin in an MFA session | org admin (live) | all nine |

Today's capability words map one to one: read to **view**, collaborate to
**run workflow**, review to **review**, approve to **approve**, manage to
**manage**. "Edit a task" (the task update policy: manage, collaborate,
review or approve) is **edit content**. "Edit a project or program" (its
update policy: manage) is **manage**.

| Today's source | In the new model |
|---|---|
| `program_access_grant` | its role on the program's space, inherited by the projects and tasks under it |
| `program.lead_id` | manager on the program's space and the tasks directly in it, **not its projects** (finding 3) |
| `project_access_grant` | its role on the project, inherited by its tasks. Rows with source `program_inherited` are **not** copied: inheritance gives the same answer |
| `project.owner_id` | manager on the project |
| task assignee, requester | contributor on the task |
| task reviewer, approver columns | approver on the task |
| `task_assignment` | its role on the task |
| Team-sourced grants | today stored one row per person; the new model also supports a grant to the team itself (tested in the timing run) |

## Equivalence

**Result: pass. Zero mismatches.**

| Round | People | Checks | Mismatches | Slowest of 4 sessions |
|---|---|---|---|---|
| 1. After the backfill | 61 | 1,482,492 | 0 | 26 min |
| 2. After the changes | 61 | 1,481,040 | 0 | 31 min |
| 3. Trigger-kept cache against a full rebuild | 32,000+ rows | every row | 0 | under 1 s |

**Who:** every organization member (the owner, an admin, staff, volunteers,
guests, the 50 perf people, the QA scoped-role users), a leadership viewer,
the external accountant (a Guest with a current ledger grant), and one
stranger with no membership. Each is checked twice, before and after MFA
(aal1 and aal2), except the stranger.

**What:** every task (2,021), project (14) and program (5), which is the
seed, the #115 performance fixture, and an edge-case fixture. Each is
checked for six answers: view, edit, manage, collaborate, review and
approve.

**Today's side** is what the live rules decide. View is observed as the
person, by reading the rows today's select policies let them see. The other
answers come from the functions the update policies call
(`has_task_capability`, `has_project_capability`,
`has_program_capability`).

**Edge-case fixture:** one person per program role, and one per project
role; a program and project nobody below owner/admin reaches; a project with
no program; a project task whose own program column names another program;
program-level and organization-level tasks; each task actor column
(assignee, requester, reviewer, approver) and each assignment role; the
accountant assigned one task.

**Round 2's changes**, all made through today's tables so they reach the new
model only through triggers:
- a volunteer given the whole 2,000-task program;
- a project grant removed, and another changed to a different role;
- one project moved to another program with its 200 tasks, and one moved
  out of every program;
- a project owner and a program lead changed;
- a lead's `record_lead` grant row removed (finding 3), and the lead
  deactivated and then reactivated;
- tasks moved from a project to program level, and to organization level;
- 25 tasks reassigned, reviewer and approver columns changed, assignments
  removed and added;
- a team grant created, then one member leaving the team;
- one person deactivated, a staff member promoted to admin, and an admin
  demoted to staff;
- a task and a project deleted.

**Mismatches found on the way, and their causes** (all fixed before the
final run):

| Run | Mismatches | Cause | Fix |
|---|---|---|---|
| First full run, round 1 | 12,000+ answers for 2 people | Organization roles are also ceilings: owner/admin without MFA and leadership viewers are read-only whatever grants they hold (finding 1) | `org_role_ceiling`, applied live |
| Second full run, round 2 | 12 answers, 1 person, 1 task | The lead column reaches the program's direct tasks, not only the program (finding 3) | Grant reach "this object and its direct tasks" |

View never disagreed in any run.

The run takes about an hour on 4 cores. Most of that is today's side:
`has_task_capability` costs about 2 ms a call for a person without access,
and each round makes about a million such calls.

## Speed

Measured on the local database (4 cores): the seed, the #115 performance
fixture (50 people, 2,000 tasks), plus a "Bench program" with two projects of
500 tasks each. Each query ran 5 times to warm up, then 30 times (10 for the
slowest variant), with planning included each time, as PostgREST does.

### Board: 500 tasks

Two board shapes: one project's board (all 500 tasks of one project), and
the workspace `/board` as `src/features/tasks/services/task.queries.ts`
builds it (every unarchived task the person can read, in sort order), at
500 rows. Median milliseconds (95th percentile in brackets).

| Board and person | a. today | e. cache policy | Added | b. today + `can(view)` per row |
|---|---|---|---|---|
| Project board, owner (MFA) | 1.10 (1.57) | 0.99 (2.10) | −0.1 | 63.1 (90.7) |
| Project board, staff with project grant | 2.78 (3.23) | 4.10 (4.47) | +1.3 | 59.3 (68.6) |
| Project board, volunteer with 20 assigned | 2.15 (2.45) | 1.40 (1.55) | −0.8 | 4.9 (5.3) |
| Workspace board, owner (MFA) | 1.95 (2.27) | 2.36 (3.17) | +0.4 | 350.7 (387.3) |
| Workspace board, staff with project grant | 5.12 (6.58) | 3.95 (4.56) | −1.2 | 192.4 (223.4) |
| Workspace board, volunteer | 3.33 (3.69) | 3.25 (3.97) | −0.1 | 53.3 (67.6) |

Every person saw exactly the same rows under both policies (500, 500, 20,
500, 500 and 420).

**A "can I edit this?" flag on every card** is where the new model helps
most. Today the only way is `has_task_capability` per row:

| Board and person | d. today, `has_task_capability` flag | c. `app.can` flag per row | f. set-based flag from the cache |
|---|---|---|---|
| Project board, owner | 386 | 61.4 | 1.15 |
| Project board, staff | 1,670 | 66.3 | 5.01 |
| Workspace board, staff | 1,691 | 63.8 | 6.57 |
| Workspace board, volunteer | 1,338 | 52.4 | 3.44 |

The per-row `app.can` is 10 to 40 times faster than today's function, but
only the set-based form is within budget.

**Why per-row `app.can` cannot be made fast enough:** Postgres cannot fold a
function that runs its own query into the calling query, so each row pays a
separate function call. I measured the floor at about 6 µs for a call doing
one index lookup, and about 60 to 80 µs for the full check (membership, the
organization role, the cache). Four lookups is the minimum the answer needs,
so 500 rows cost 30 to 40 ms at best.

### Keeping the cache current

One statement each, all triggers included (the dual write from today's
tables, then the cache refresh).

| Change | ms |
|---|---|
| Add a person to the 1,000-task program (program grant) | 32.9 |
| Remove that grant | 11.9 |
| Add a person to one 500-task project | 13.0 |
| A person joins a team that has the 1,000-task program | 19.6 |
| Move a 500-task project to another program (everyone recomputed) | 25.6 |
| Change the program lead | 52.1 |
| Change one task's assignee | 3.8 |
| Insert one task | 1.8 |
| **Insert 500 tasks in one statement** | **641** (42 without the prototype) |
| Rebuild the whole cache (59 people, 3,086 objects) | 384 |

The timings above are from the final run. Across the four timing runs made
during the spike, the medians moved by up to about 1.5 ms on the boards, and
the 500-task insert ranged from 641 to 1,114 ms.

Cache size: 32,766 rows for 59 people and 3,086 objects, about 555 rows a
person, 4.7 MB with indexes. It grows with people times the objects each can
reach, not with people times all objects, because organization-wide access is
not cached.

## Findings

1. **Organization roles are ceilings as well as grants (found by the
   equivalence test, fixed).** Round 1 of the first full run disagreed on
   about 12,000 answers, all "today says no, the prototype says yes", for two
   people only:
   - the **owner without MFA** (aal1) on every task, project and program they
     own or lead: today's functions refuse an owner or admin everything but
     read until the session completes MFA, *even through their own grants*;
   - the **leadership viewer** (perf person 10, who also holds contributor
     grants) at both levels: today a leadership viewer is read-only
     everywhere, whatever else they hold.

   The prototype had added the owner's own project-owner grants on top. The
   fix is a per-role **ceiling** (`org_role_ceiling`): owner and admin are
   capped at view and comment without MFA, and leadership viewer always is. It
   is applied live, like the role's own grants, so the cache is unchanged.
   After the fix those people match exactly. The real build needs this
   concept: A6 did not mention it.
2. **Owner/admin MFA is checked two different ways today.** The task,
   project and program functions accept the session's `aal2` claim alone.
   `app.is_org_admin`, used by the admin screens, also requires a verified
   TOTP factor to exist. In practice the claim implies the factor, so the
   risk is low. The prototype copies the claim-only rule so it can be proved
   equal. **Recommendation:** in the real `app.can`, require the verified
   factor too (as `is_org_admin` does). That is deliberately stricter than
   today, so the equivalence test would be updated on purpose, in the same
   change.
3. **A program lead's reach depends on a grant row, not the lead column.**
   `has_program_capability` checks `program.lead_id` directly, which reaches
   the program and its program-level tasks. `has_project_capability` does
   not look at `lead_id`: the lead reaches the projects only through the
   `record_lead` grant a trigger writes. Today the app refuses to name an
   inactive person as lead, so new data always has both. But a program whose
   lead was set before that trigger existed, or whose `record_lead` row is
   missing for any other reason (the migration logs these in
   `scoped_access_backfill_issue`), gives its lead the program but not its
   projects. The prototype first modelled the lead column as "this object
   only", and equivalence round 2 caught it: 12 answers, for one lead on one
   program-level task, which today's rules allow. The lead column reaches the
   program *and the tasks directly in it*. With that reach, the case matches
   exactly. Round 2 removes a lead's `record_lead` row on purpose to test
   this. **Decision needed:** this is almost certainly unintended. The real
   build should make the lead one inherited grant, which is a deliberate
   behaviour change. Before migrating, check the hosted
   `scoped_access_backfill_issue` rows (read-only) to see whether any real
   program is affected.
4. **`program_inherited` project grants are redundant.** They are the old
   model's copy of a program grant onto each project. The prototype does not
   copy them and gets the same answers from inheritance, so they can be
   retired once `app.can` is the only check.
5. **Reading the session in a per-row expression is expensive.** The first
   ceiling fix read the MFA level once per cache row, which pushed the staff
   board from 3 ms to 19 ms. Working it out once per organization brought it
   back to 3 ms. Any real policy must read session values once per query.
6. **The external accountant has no task access to model.** The accountant
   is a Guest plus a time-limited ledger grant. The ledger grant gives books
   access through `app.can_read_ledger`, not tasks, so the accountant reads
   only tasks they are assigned, today and in the prototype (tested). Ledger
   access is out of this spike's scope. It would later become a Finance
   space, with the grant's expiry date and its MFA requirement carried over.
7. **Not covered by `app.can`:**
   - which **fields** a reviewer may change (`enforce_scoped_task_update`).
     That is per-property access, M10e;
   - **channels** (`channel_access_grant`), meetings and documents. They
     follow the same pattern and are M10c work.

## Recommended design (for M10a to M10c)

1. **Keep the model as prototyped:** objects with a stored parent chain;
   spaces (Workspace, one per program, Private, custom); capability bits;
   roles as capability bundles (built-in rows now, custom roles in M10d);
   grants to a person, a team or an organization role, reaching everything
   below unless marked "this object only". Drop the "object and its direct
   tasks" reach once finding 3 is decided.
2. **Cache person and team grants; answer organization roles, role
   ceilings, membership and MFA live.** This keeps the cache small, and makes
   suspension and MFA take effect immediately.
3. **Two forms of one check, from the same cache** (the W0-3 signature,
   `app.can(object_id, capability)`, is unchanged):
   - `app.can(object_id, capability)` for one record at a time (about 70 µs);
   - for lists, the policy form: `organization_id = any(my orgs) and
     (organization_id = any(orgs where my role gives it) or id in
     (select app.cached_ids(capability)))`, evaluated once per query like the
     #115 policies. S4's query engine should generate this form, never
     per-row calls. The W0-3 interface should name both.
4. **Dual write while today's tables stay the source of truth:** triggers on
   today's tables write grants into the new model, exactly as prototyped, and
   the equivalence test runs in CI (as `task-read-equivalence.sql` does) until
   the old tables are retired.
5. **Before building for real:**
   - Make the dual-write and refresh triggers statement-level, with
     transition tables, so a bulk insert of N tasks is one refresh, not N
     (fixes the slow bulk insert).
   - Keep the equivalence test's fixture small enough for CI. The full run
     here takes about an hour, because today's `has_task_capability` costs
     about 2 ms a call for a person without access, and a full round is about
     a million calls. A CI version with the edge-case fixture and the QA
     users, rather than all 2,000 perf tasks, takes seconds.
   - Decide the MFA question in finding 2 and the lead question in finding 3.

## How this fits the agreed design (W0-9)

`docs/design/workspace-os-object-layer.md` section 7 (merged in #201 while
this spike ran) fixes the shape of spaces, grants and `app.can`. The spike
agrees with most of it; these are the points where the measurements say
something different, for the lead session to decide:

1. **Capability names: the agreed map wins.** The stand-in maps comment to
   manage, collaborate, review or approve; edit content to manage or
   collaborate; and run workflow, share and edit structure to manage. The
   spike used a different naming, but what it proved is lower level: the
   cache holds today's five record capabilities (read, collaborate, review,
   approve, manage) exactly, for every person and record. Any name map is
   then one bit expression over them. **Recommendation:** store those five
   (plus any new ones) as bits, and keep the name map in one place, inside
   `app.can`, exactly as in the stand-in. The spike's own naming should not
   be adopted.
2. **Refresh the cache at once; don't delete and compute on a miss.**
   Section 7.3 says triggers delete cache rows and the next check computes
   them. Three measurements argue against that:
   - A list can only use the fast set-based form if a missing row means "no
     access". With compute-on-miss it could also mean "not worked out yet",
     so lists would fall back to per-row checks: 40 to 340 ms on a 500-task
     board.
   - Computing a miss for a task means calling today's functions, about
     0.5 to 2 ms each. A board of 500 cold tasks would take up to about 1 s.
   - Refreshing at once is cheap: 33 ms to give someone a 1,000-task
     program, 26 ms to move a 500-task project.

   **Recommendation:** triggers recompute the affected people on the affected
   objects straight away, as prototyped. The nightly job becomes a full
   rebuild (384 ms here) compared against the kept cache, which is the
   spike's round 3 check.
3. **Organization roles, ceilings and membership are not cache inputs.**
   They are answered live (see "The model"), so `organization_membership` is
   not on the trigger list, and a suspension needs no refresh. Section 7
   should also add the ceiling rule (finding 1); it is not there today.
4. **Bits rather than `capabilities text[]`.** The spike stored an integer
   bit mask. A text array was not measured, but a list test on an array
   costs more than a bitwise AND on every cache row read.
5. **Reading `program_access_grant` through, not copying it:** both work.
   The spike copied it with a trigger, which let the cache logic see only one
   grant table. Reading it through (one source of truth, as section 7
   prefers) gives the same answers as long as the compute query unions both
   tables. The spike's `compute` function is the place to do that.
6. **The M10c equivalence test** should grow from the stand-in's
   `supabase/tests/workspace-os-can.sql`, adding this spike's edge cases:
   the ceilings, a lead without a `record_lead` row, team grants, moves, and
   the external accountant. That keeps it fast enough for CI.

## How to reproduce

All steps run against the local database only.

1. Start the local stack: `npx supabase start`. If it worked, the command
   prints the local API and database addresses.
2. Load users, seed and helpers: `npm run test:db` (leaves the QA users and
   the `tests.*` helpers in place; it should end with "assertions passed"),
   then `npm run db:seed`.
3. Load the performance fixture:
   `docker exec -i supabase_db_workspace psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/perf-fixture.sql`.
   You should see "Performance fixture created".
4. Apply the prototype: `node scripts/spikes/access-spike.mjs apply`. It
   should end with "apply: …s".
5. Timings: `node scripts/spikes/access-spike.mjs timing` (about 2.5
   minutes; everything is rolled back).
6. Equivalence: `node scripts/spikes/access-spike.mjs equivalence` (about
   an hour on 4 cores). **Warning: this commits its fixture and changes to
   the local database**, because it runs four parallel sessions, which only
   see committed rows. It ends with `EQUIVALENCE PASS` or fails with the
   mismatches listed. If it stops part-way, `equivalence resume` restarts
   from the changes (round 1 kept), and `equivalence round2` runs only the
   round 2 sessions still missing, then the report.
7. Put the local database back: `npx supabase db reset && npm run db:seed`.
   Or, to remove only the prototype: `node scripts/spikes/access-spike.mjs drop`.

## What was and was not verified

**Verified, on the local database only:**
- The equivalence result above: zero mismatches over the full run.
- The timings above; the final timing run is the one reported.
- On every board, the cache policy returned exactly the same rows as
  today's policy.
- After merging the latest `main` into this branch: `npm run lint` (0
  errors; the 2 warnings are in files this change does not touch),
  `npm run typecheck`, and `npm test` (121 files, 1,250 tests) all pass.
- `npm run test:db`: 2,040 assertions pass across 65 files, on a freshly reset
  database with the prototype not applied. Nothing in this change is a
  migration, and neither the suite nor CI ever applies the prototype.

**Not verified:**
- Nothing was run against a hosted database. The finding 3 check of the
  hosted `scoped_access_backfill_issue` table is left for the lead session,
  read-only.
- The timings are from one local machine (4 cores), not staging, and are
  single-user: no concurrent load was measured.
- Channels, documents, meetings, ledger access and per-field rules are not
  modelled (finding 7).
- The equivalence test covers the policies' `USING` checks, not the
  `enforce_scoped_task_update` trigger that limits which fields a reviewer
  may change.
- The recommended fixes are not built: statement-level refresh triggers, the
  MFA factor check (finding 2), and a single inherited lead grant
  (finding 3).
