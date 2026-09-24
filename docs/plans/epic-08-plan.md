# Epic 08 — Testing, Verification & Quality Engineering: plan to completion

Written 2026-09-24 against `main` after PRs #104–#107. Covers issue #18.

## What "done" means

From #18:

> CI gates lint/typecheck/unit/build/browser QA/database-RLS/dependency
> security as appropriate; critical role/workflow matrices have allow and deny
> evidence; supported-browser/accessibility/concurrency/50-user performance
> acceptance is recorded against a frozen candidate; failed checks keep work
> out of Done.

Child issues: #49 (WebKit keyboard focus) is **closed** by PR #61. What remains
is #50, the final QA matrix (acceptance ID `QA-FINAL`). Its required coverage:

1. Every role: owner, admin, program lead, project manager, staff, volunteer,
   and the relevant scoped members.
2. Critical end-to-end journeys: identity, work, collaboration, CRM and
   reporting, notifications, integrations.
3. Database, API and realtime allow **and** deny cases.
4. Concurrency and idempotency on critical writes and jobs.
5. Chromium, Firefox, WebKit/Safari, plus required mobile viewports and devices.
6. Automated and keyboard accessibility.
7. A 50-user synthetic fixture: p95 interaction ≤ 2 s, realtime ≤ 5 s.
8. Dependency and security scan plus the regression suite at the exact release SHA.

Every row records the commit, environment, command, result and artifact.

## Where it stands today (checked against `main`)

| Area | Finding |
|---|---|
| CI gates | Verify job: lint, typecheck, unit, build, public-route browsers (all three), `npm audit --audit-level=high`. Database security job: RLS suite, Supabase security advisor, signed-in browser suites and `qa-matrix`. `scripts/protect-main.sh` makes both `Verify` and `Database security` required checks on `main`. |
| Roles in fixtures | `supabase/tests/qa-users.sql` has one user per org role (owner, admin, staff, volunteer, guest). **Browser suites exercise mostly owner and volunteer.** Admin, staff and guest have almost no browser coverage; scoped roles (program lead, project manager, contributor, read-only) are covered only in SQL. |
| Database allow/deny | Strong: 22 SQL test files, about 456 assertions, including scoped grants, revocation, cross-organization access and leftover surfaces. |
| Browser journeys | 16 specs, 76 checks. Identity, programs, projects, milestones, tasks, work planning, documents and events are covered. **No browser spec for CRM, reports, channels/DMs, meetings, notifications or admin.** |
| Realtime | One check (`realtime-revocation`): revoked access stops delivery. No positive delivery check and no latency measurement. |
| Concurrency/idempotency | Only `work-planning.sql` (duplicate occurrences). About 50 `on conflict` / idempotency sites in migrations, **mostly untested under real parallel sessions**. The job runner has no double-claim test. |
| Browsers | Firefox and WebKit run signed-in suites nightly (from #104), **no nightly result recorded yet**. WebKit carries a silent retry on "internal error" in `public-routes.spec.ts` (#89 open). No mobile-device projects in `playwright.config.ts`. |
| Accessibility | Done in epic 07: axe in both themes on every route and overlay, keyboard paths, 200% zoom, reduced motion. Manual screen-reader pass is owed (E07-18). |
| Performance | **Nothing exists.** No load tool, no 50-user fixture, no measurement. |
| Security scanning | `npm audit` (high and above) and the Supabase advisor. **No static analysis (CodeQL) and no secret scanning in CI.** The repo is public, so CodeQL is free. |
| Frozen-candidate evidence | No workflow runs the whole matrix at one SHA and writes the evidence down. |
| Staging | #55 (hosted staging) is not provisioned. Staging runs are external blockers. |

## Workstreams

Each is a child issue under #18 (and #50), delivered as its own PR.

### E08-A — Role matrix in the browser (roles, allow and deny)
- Add scoped QA users to the seed: a program lead, a project manager, a
  project contributor and a read-only member, each on a known program or project.
- New `tests/e2e/role-matrix.spec.ts`: a table of every workspace route and key
  action against every role. The expected result is allowed, redirected,
  not-found or read-only. It asserts the page and also that **no record data**
  reaches a denied user in the HTML.
- Admin and staff surfaces: admin pages need admin with two-factor; staff-only
  pages refuse a volunteer and a guest.

### E08-B — Missing critical journeys
New specs, each covering the happy path plus one deny case:
- `crm.spec.ts`: organization, contact, interaction, follow-up.
- `reports.spec.ts`: project status report, program report, export.
- `collaboration.spec.ts`: channel message, DM, comment with @mention, meeting
  with agenda and action item.
- `notifications.spec.ts`: an assignment raises an in-app notification; mark
  read; preferences mute it.
- `admin.spec.ts`: invite, role change, deactivate (partly in
  `identity-lifecycle`, so extend rather than duplicate).
- Integrations stay on their fakes and unit tests (epic 06). Live provider
  runs are staging work.

### E08-C — Realtime allow, deny and latency
- Positive delivery: two browser contexts; a message posted by one appears in
  the other.
- Deny: a non-member subscribed to the channel receives nothing.
- A Node probe (`scripts/qa/realtime-latency.mjs`) measures publish-to-receive
  time over N messages and reports p50 and p95. It feeds E08-F.

### E08-D — Concurrency and idempotency
- SQL tests that open **two real sessions** (via `dblink` or two `psql`
  connections in `scripts/test-db.mjs`) and race:
  - two status updates on one task (last write wins, audited, no lost event);
  - one invitation accepted twice (exactly one membership);
  - the same job claimed by two workers (exactly one runs);
  - a notification event delivered twice (deduplicated);
  - the same email webhook delivered twice (one suppression).
- Unit tests for the job runner's retry and backoff paths.

### E08-E — Browsers and devices
- Read the first nightly Firefox/WebKit signed-in run and fix what it finds.
- Root-cause #89 (the WebKit "internal error" retry) and remove the retry.
- Add `mobile-chrome` (Pixel 7) and `mobile-safari` (iPhone 14) Playwright
  projects for `qa-matrix` and the core journeys, nightly.
- Real iOS Safari and Android checks stay with the operator sign-off
  (OPS-SIGNOFF), done by a person.

### E08-F — 50-user performance
- `scripts/qa/seed-perf.mjs`: a synthetic fixture of 50 users, realistic
  programs, projects, a few thousand tasks, channels with history. It is
  idempotent and runs only against local or staging.
- Load driver: **k6** (HTTP scenarios for the key pages and server actions,
  50 virtual users, p95 thresholds that fail the run), plus the realtime
  probe from E08-C.
- `.github/workflows/perf.yml`: runs nightly and on demand against the local
  stack in CI. This is indicative, and catches regressions. The authoritative
  run is against staging once #55 exists.
- Thresholds: interaction p95 ≤ 2 s, realtime p95 ≤ 5 s. A breach fails the job.

### E08-G — Security scanning and gates
- Add CodeQL (JavaScript/TypeScript) on pull requests and weekly.
- Add secret scanning (gitleaks) on pull requests.
- Add `actions/dependency-review-action` on pull requests.
- Add the new scans to the required checks in `scripts/protect-main.sh`
  (`Verify` and `Database security` are already required). Applying it needs
  your admin token.
- Playwright `retries` stays 0 on CI, so a flaky test fails rather than hides.

### E08-H — Frozen-candidate evidence
- `.github/workflows/release-candidate.yml` (workflow_dispatch, input: SHA)
  runs everything above at that SHA: all browsers, mobile projects,
  concurrency, performance, security scans.
- It writes `qa-evidence-<sha>.md` as an artifact: one row per matrix line
  with the command, result, duration and run link.
- Update `QA-FINAL` in `docs/acceptance-matrix.md` and `docs/runbooks/qa.md`
  from that evidence.

### E08-I — Close-out
- Run E08-H on a local-stack candidate now. Run it again on staging once #55 exists.
- Close #50 and #18 when every mandatory row passes at one frozen staging
  candidate. Anything that fails gets its own issue and keeps #50 open.

## Dependencies and blockers

| Blocker | Owner | Affects |
|---|---|---|
| Hosted staging (#55) | You | Authoritative runs for E08-F and E08-I |
| Platform pipeline (#51, epic 09) | Shared | Deploy-to-staging step inside E08-H |
| Screen-reader pass (E07-18) | You | Accessibility row of QA-FINAL |
| Real-device Safari/Android (OPS-SIGNOFF) | You or a named operator | Device row |
| Admin token to apply branch protection | You | E08-G |

Everything else can be built and proven on the local stack in CI now.

## Order

1. E08-G first. It is small, and it makes every later PR go through the new gates.
2. E08-A and E08-D next. They are the allow/deny and concurrency evidence the epic names explicitly.
3. E08-B and E08-C.
4. E08-E.
5. E08-F.
6. E08-H, then E08-I.

## Task checklist

- [ ] E08-0 Create child issues under #18 for E08-A..H
- [ ] E08-G1 Add CodeQL, gitleaks and dependency-review workflows
- [ ] E08-G2 Add the new scans to `protect-main.sh` (you apply it)
- [ ] E08-A1 Seed scoped QA users (lead, PM, contributor, read-only)
- [ ] E08-A2 `role-matrix.spec.ts`: every route and action by every role, with no-data-leak checks
- [ ] E08-D1 Two-session race harness in `scripts/test-db.mjs`
- [ ] E08-D2 Race tests: task update, invitation, job claim, notification, webhook
- [ ] E08-D3 Job runner retry and backoff unit tests
- [ ] E08-B1 `crm.spec.ts`
- [ ] E08-B2 `reports.spec.ts`
- [ ] E08-B3 `collaboration.spec.ts` (channels, DMs, comments, meetings)
- [ ] E08-B4 `notifications.spec.ts`
- [ ] E08-B5 Extend admin coverage
- [ ] E08-C1 Realtime delivery and deny browser check
- [ ] E08-C2 `realtime-latency.mjs` probe
- [ ] E08-E1 Read the first nightly Firefox/WebKit run; fix findings
- [ ] E08-E2 Root-cause #89; remove the WebKit retry
- [ ] E08-E3 Mobile Chrome and Safari projects, nightly
- [ ] E08-F1 `seed-perf.mjs` 50-user fixture
- [ ] E08-F2 k6 scenarios with p95 thresholds
- [ ] E08-F3 `perf.yml` workflow (nightly and on demand)
- [ ] E08-H1 `release-candidate.yml` with an evidence artifact
- [ ] E08-H2 Update `QA-FINAL`, `docs/runbooks/qa.md`
- [ ] E08-I1 Local-stack candidate run recorded
- [ ] E08-I2 (after #55) Staging candidate run; close #50 and #18
- [ ] You: staging (#55), screen-reader pass, real-device check, branch-protection token
