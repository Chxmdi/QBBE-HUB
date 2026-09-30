# W0-7 spike: one access check, correct and fast

Written 2026-09-30 by the S2 Access build session (epic #199, plan A6 in
`docs/plans/workspace-os-plan.md`, item W0-7 / P0-3 in
`docs/plans/workspace-os-execution.md`).

The question: can one check, `app.can(object_id, capability)`, give exactly
the answers today's rules give, and stay fast on a board?

## Verdict

**GO, with one condition on how lists use it.**

- **Correct:** EQUIVALENCE_SUMMARY
- **Fast for lists, when lists use the set-based form.** On a 500-task
  board, a policy that reads the new cache adds 0.1 to 6 ms over today's
  policy, and returns exactly the same rows. The target was under 20 ms.
- **Too slow when called once per row.** Calling `app.can()` on each row of
  a 500-row board adds 40 to 340 ms, so it fails the target. `app.can()` is
  for one record at a time (a drawer, a page, an action's permission check).
  Lists must use the set-based form, as the #115 rewrite already does today.
- **Cheap to keep current.** Giving someone a 1,000-task program costs 24 ms;
  moving a 500-task project to another program costs 29 ms.
- **One weak spot to fix before M10c:** a bulk insert of 500 tasks costs
  1.1 s instead of 42 ms, because the prototype's triggers work one row at a
  time. Statement-level triggers fix that (see "Before building for real").

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
  unless it is marked "this object only".
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
| `program.lead_id` | manager on the program's space, **this object only** (see finding 2) |
| `project_access_grant` | its role on the project, inherited by its tasks. Rows with source `program_inherited` are **not** copied: inheritance gives the same answer |
| `project.owner_id` | manager on the project |
| task assignee, requester | contributor on the task |
| task reviewer, approver columns | approver on the task |
| `task_assignment` | its role on the task |
| Team-sourced grants | today stored one row per person; the new model also supports a grant to the team itself (tested in the timing run) |

## Equivalence

EQUIVALENCE_SECTION

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
| Project board, owner (MFA) | 0.79 (0.86) | 0.87 (0.94) | +0.1 | 45.2 (77.2) |
| Project board, staff with project grant | 4.16 (5.10) | 11.09 (11.66) | **+6.9** | 55.6 (81.7) |
| Project board, volunteer with 20 assigned | 7.56 (9.82) | 3.76 (5.05) | −3.8 | 11.9 (13.0) |
| Workspace board, owner (MFA) | 2.52 (3.34) | 3.55 (4.10) | +1.0 | 344.9 (424.4) |
| Workspace board, staff with project grant | 7.34 (8.27) | 13.19 (15.50) | **+5.9** | 163.9 (228.9) |
| Workspace board, volunteer | 6.57 (10.29) | 4.61 (4.84) | −2.0 | 54.2 (81.7) |

Every person saw exactly the same rows under both policies (500, 500, 20,
500, 500 and 420).

**An "can I edit this?" flag on every card** is where the new model helps
most. Today the only way is `has_task_capability` per row:

| Board and person | d. today, `has_task_capability` flag | c. `app.can` flag per row | f. set-based flag from the cache |
|---|---|---|---|
| Project board, owner | 532 | 49.7 | 1.25 |
| Project board, staff | 2,061 | 49.2 | 23.7 |
| Workspace board, staff | 2,043 | 62.3 | 23.2 |
| Workspace board, volunteer | 1,671 | 56.1 | 7.9 |

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
| Add a person to the 1,000-task program (program grant) | 24.0 |
| Remove that grant | 11.6 |
| Add a person to one 500-task project | 13.3 |
| A person joins a team that has the 1,000-task program | 16.1 |
| Move a 500-task project to another program (everyone recomputed) | 28.7 |
| Change the program lead | 53.8 |
| Change one task's assignee | 5.6 |
| Insert one task | 2.4 |
| **Insert 500 tasks in one statement** | **1,114** (42 without the prototype) |
| Rebuild the whole cache (59 people, 3,086 objects) | 410 |

Cache size: 32,766 rows for 59 people and 3,086 objects, about 555 rows a
person, 4.7 MB with indexes. It grows with people times the objects each can
reach, not with people times all objects, because organization-wide access is
not cached.

## Findings

FINDINGS_SECTION

## Recommended design (for M10a to M10c)

1. **Keep the model as prototyped:** objects with a stored parent chain;
   spaces (Workspace, one per program, Private, custom); capability bits;
   roles as capability bundles (built-in rows now, custom roles in M10d);
   grants to a person, a team or an organization role, inherited unless marked
   "this object only".
2. **Cache person and team grants; answer organization roles, membership and
   MFA live.** This keeps the cache small, and makes suspension and MFA take
   effect immediately.
3. **Two forms of one check, from the same cache:**
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
     (fixes the 1.1 s bulk insert).
   - Keep the equivalence test's fixture small enough for CI. The full run
     here takes about an hour, because today's `has_task_capability` costs
     about 2 ms a call for a person without access, and a full round is about
     a million calls. A CI version with the edge-case fixture and the QA
     users, rather than all 2,000 perf tasks, takes seconds.
   - Decide the MFA question in finding 1.

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
   mismatches listed.
7. Put the local database back: `npx supabase db reset && npm run db:seed`.
   Or, to remove only the prototype: `node scripts/spikes/access-spike.mjs drop`.

## What was and was not verified

VERIFIED_SECTION
