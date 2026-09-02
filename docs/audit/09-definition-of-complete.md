# Domain audit — the specification's Definition of Complete

<!-- progress: 10 of 10 assessed -->

`DONE-001..010` (spec lines 3325–3334). These are the criteria the whole
effort is measured against, which is why they were taken first.

They are cross-cutting gates rather than features, so each is assessed against
the codebase as a whole. All paths are relative to `/home/user/QBBE-HUB`.

---

### DONE-001 — Acceptance criteria pass with live-backed data, not only mock data
**Verdict:** Partial
**Requirement:** Criteria must be demonstrated against a real database, not fixtures alone.
**Evidence:** No mock data ships — `grep -rIn "mockData|MOCK_|fakeData|lorem" src/` returns 0.
The database half is genuinely live-backed: `supabase/tests/rls.sql` runs 172 assertions
against a fully migrated Postgres in CI (`.github/workflows/ci.yml:79-86`).
**Gap:** The UI half is not. The authenticated matrix `tests/e2e/qa-matrix.spec.ts`
(10 tests) is the only suite that exercises signed-in screens against a real database, and
it is not in CI — CI runs `npx playwright test public-routes` only (`ci.yml:52`). Nothing in
the repository records when it last passed or against what. The 322 unit tests run against
an in-memory double (`tests/support/fake-supabase.ts`), which is the right tool for handler
logic but is by definition not live-backed.

### DONE-002 — Authorization enforced server/database-side and tested for allowed and denied cases
**Verdict:** Complete
**Requirement:** The authorization boundary is the server/database, and both directions are tested.
**Evidence:** RLS is the boundary — every one of the 75 tables carries
`enable row level security`, and policies live in the same migration as the table they
protect. `supabase/tests/rls.sql` holds 172 assertions covering both directions explicitly,
per role (owner, admin, staff, volunteer, guest) and across organizations, and runs in CI
under the required `Database security` check. Two standing assertions
(`rls.sql:1275-1300`) now also prove no policy or `SECURITY DEFINER` helper tests membership
in any organization rather than the row's.
**Note:** This was *not* true earlier today. The suite had never executed — its fixture
aborted on a `gen_salt` resolution error before the first assertion — and 28 policies plus
2 helpers used unscoped membership tests. Both fixed and verified against production. The
criterion is met now; it was recorded as met for weeks while it was not.

### DONE-003 — Loading, empty, error, retry, destructive and permission states implemented
**Verdict:** Partial
**Requirement:** Each applicable state is implemented where the feature needs it.
**Evidence:** Destructive actions confirm before acting, and the retention editor puts the
affected record count in the sentence rather than a generic warning. Permission states are
enforced by RLS and reflected in the UI. A root boundary (`src/app/error.tsx`) and a
workspace boundary (`src/app/(workspace)/error.tsx`) both report to the error monitor.
**Gap:** Coverage is shallow relative to the route count. There are **39 `page.tsx` files,
2 `error.tsx`, 1 `loading.tsx` and 1 `not-found.tsx`.** No route segment below the workspace
has its own boundary, so a failure in any single screen collapses to the same generic
workspace-wide error, and slow segments have no skeleton of their own. Per-screen empty
states were not systematically verified here and remain open.

### DONE-004 — Keyboard/responsive behaviour checked; accessibility automation passes
**Verdict:** Partial
**Requirement:** UI changes are checked for keyboard and responsive behaviour, and automated
accessibility checks pass.
**Evidence:** `tests/e2e/public-routes.spec.ts` runs six widths (1440/1280/1024/768/390/320),
both themes, horizontal-overflow detection, keyboard traversal, focus visibility and reduced
motion, with axe at `wcag2a/2aa`, `wcag21a/21aa`, `wcag22a/22aa` (`:86`). All six tests pass,
verified locally today. It runs on every push and pull request.
**Gap:** Public routes only — the sign-in and sign-up pages. Every signed-in screen, which is
substantially the whole product, has no accessibility automation in CI. The spec requires
WCAG 2.2 AA; axe decides only part of it, and criteria such as accessible authentication,
consistent help and redundant entry are not machine-checkable and have had no human pass.

### DONE-005 — Analytics/audit/notifications emitted where the feature specification requires them
**Verdict:** Partial
**Requirement:** Features emit the audit, analytics and notification signals their own
specification calls for.
**Evidence:** An audit trail exists and is written from 12 service modules, with 27 distinct
`audit_event` write sites. Document access, export requests and export downloads are each
recorded. Notifications have a dedicated table, delivery ledger, digest and preferences.
**Gap:** The criterion is *per feature* — "where the feature specification requires them" —
and that cannot be settled from the aggregate. It needs the per-family audits (01–08) to
say, for each requirement, whether its required signal is emitted. Recorded as Partial
because the mechanism plainly exists and its per-feature completeness is unassessed, not
because a specific signal is known missing.

### DONE-006 — Automated tests cover the risk appropriate to the feature, and CI passes
**Verdict:** Partial
**Requirement:** Test coverage is proportionate to each feature's risk, and CI is green.
**Evidence:** CI passes — verified green on `main` today across both jobs. 322 unit tests,
172 RLS assertions, lint, type-check, production build, public accessibility suite and a
high-severity dependency audit.
**Gap:** Coverage is uneven against risk rather than proportionate to it. Four of the nine
job delivery guarantees rest on SQL run by hand once in August with nothing re-running them
(`docs/runbooks/jobs.md:184-190`, now marked). Some cited unit tests assert the *text* of a
migration via `readFileSync` and `toContain`, which passes whether or not the migration was
ever applied. And the highest-risk surface in the product — signed-in, multi-role behaviour
in a browser — is the one with no suite in CI.

### DONE-007 — Database changes include migrations, indexes/policies, rollback/forward plan, and seed/test updates
**Verdict:** Complete
**Requirement:** Schema change ships with its migration, its policies, a rollback story and
test updates.
**Evidence:** 57 migrations, append-only once applied, with the working rule that policies
and indexes ship in the same migration as the table they protect
(`docs/runbooks/deployment.md:81`). Rollback is documented as an inverse migration plus
expand → migrate → contract for risky changes (`deployment.md:89-94`), which is the correct
strategy for a system where old app versions must keep working mid-deploy. Test updates are
enforced by convention in `docs/spec-coverage.md` ("add one allow and one deny case") and in
practice — every domain added recently shipped with RLS assertions.
`tests/unit/migration-filenames.test.ts` now gates version-prefix uniqueness and ordering.

### DONE-008 — Observability exists for external integration and background job failure paths
**Verdict:** Complete *(was Partial; closed 2026-09-02 — see the note at the end of this entry)*
**Requirement:** When an integration or background job fails, that failure is observable.
**Evidence:** Every job execution writes exactly one `job_run` row whatever the outcome, with
duration, processed and failed counts and a redacted error
(`src/features/jobs/services/runner.ts`). A run carrying per-message failures is now
distinguished as `partial` rather than shown green (`src/features/jobs/services/run-health.ts`).
Integration failures surface as connection health states. Admin → Jobs exposes all of it.
**Gap:** **None of it reaches the error monitor.** `reportError` from
`src/lib/observability.ts` has exactly four call sites, all in the two React error
boundaries (`src/app/error.tsx:23`, `src/app/(workspace)/error.tsx:21`). No server action, no
route handler, no integration client and nothing in the job runtime reports to the
configured `ERROR_MONITORING_DSN`. So a nightly job that fails at 03:00 is durably recorded
and entirely silent: it is discoverable, not observable. Someone has to think to go and look.
This was the single clearest gap in the family.

**Closed.** `reportError` is now called from three failure paths, chosen so that
every handler is covered without touching each one: `recordJobRun`
(`src/lib/job-observability.ts`) reports whenever an integration records a
failed run, and `runJob` (`src/features/jobs/services/runner.ts`) reports both
when a handler throws and when a run *returns cleanly having dropped work* —
the quietest case, where the process exits fine and the row says "succeeded".
Errors are passed through `sanitizeJobError` first: an external monitor is more
exposed than the admin-visible ledger, so the redaction protecting the ledger
has to apply at least as strictly. The integration alert is emitted after the
ledger insert and carries `ledgerWritten`, so a run whose failure could not even
be recorded still raises its hand — that being the run most worth hearing about.
Pinned by 5 tests in `src/lib/job-failure-reporting.test.ts`, verified to fail
without the change.

### DONE-009 — Feature documentation/runbook updated when knowledge would otherwise live only in a developer's head
**Verdict:** Complete
**Requirement:** Operational knowledge is written down rather than held informally.
**Evidence:** Seven runbooks covering deployment, jobs, integrations, QA, privacy,
backup/recovery and the launch gate, plus a coverage ledger and a readiness audit. They are
kept current with the code — today alone they were corrected for the real job scheduler, the
real required check names, the WCAG tag set and the provenance of the specification. Where
something is *not* verified, the docs now say so explicitly rather than implying otherwise.

### DONE-010 — No blocker-level TODO, disabled primary button, fake count, placeholder integration or dead navigation in a release-enabled flow
**Verdict:** Complete
**Requirement:** Nothing in a shipping flow is a stub, a lie or a dead end.
**Evidence:** Zero `TODO`/`FIXME`/`HACK`/`XXX:` across all of `src/`. No mock or placeholder
data. All **19** navigation destinations in `src/config/navigation.ts` resolve to a real
`page.tsx` — no dead links. Counts on the dashboard and sidebar badges are computed from
queries rather than hardcoded. `disabled:` styling exists on the button primitive as normal
state styling, not as a permanently-off control.
**Note:** Gmail, Drive, VMS and production email deliberately render **Not connected**
without credentials rather than pretending to work. That is honest gating, which is what
this criterion asks for — the opposite of a placeholder integration.

---

## Summary

| Verdict | Count |
|---|---|
| Complete | 5 — DONE-002, 007, 008, 009, 010 |
| Partial | 5 — DONE-001, 003, 004, 005, 006 |
| Missing | 0 |

**No criterion is unmet outright**, and the two structural ones — authorization
enforced and tested in the database, and no stubs or dead ends in shipping
flows — are met with strong evidence.

The three findings a maintainer should see first:

1. **DONE-008 was the clearest gap and is now closed.** Background job and
   integration failures were recorded but never reported — a failure at 03:00
   waited for someone to open the admin page. Three failure paths now report,
   including the run that succeeds having silently dropped work.
2. **DONE-001, 004 and 006 all fail on the same fact:** the authenticated QA
   matrix is not in CI. Every signed-in screen — nearly the whole product — has no
   automated coverage against a real database in a browser. Three separate criteria
   are Partial for this one reason, which makes wiring that suite into CI the
   highest-leverage single change available.
3. **DONE-003 is thin where it will be felt.** 39 pages share 2 error boundaries
   and 1 loading state. Any screen's failure presents as the same generic
   workspace-wide error, which is exactly the state a user cannot report usefully.
