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

## Current feature: scoped-access cutover, MFA and team provenance

- Branch: implement/prd-v2-release; existing implementation is uncommitted.
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
- Added TOTP enrollment/challenge UI and required owner/admin AAL2 at the
  workspace and database write boundaries. AAL1 administrators retain the read
  access needed to reach `/mfa`, while administrative and staff-level database
  mutations fail. Focused MFA unit tests and database allow/deny tests pass;
  local Auth browser verification is active.
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
- Next independent verification: authenticated browser checks for MFA, meeting
  completion and document pending/error states. Workstreams 6–7 wait on QBBE
  credentials and scanner hosting (`scripts/verify-integrations.sh`).
- Required environment: local Supabase is available with the storage services
  excluded because their health check timed out. Full Storage verification remains
  a Workstream 3 dependency; live Auth/MFA and realtime remain staging gates.

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
