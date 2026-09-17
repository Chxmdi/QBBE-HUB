# QBBE Hub — Canonical GitHub Project Operating Model

GitHub Project is the single project-management source of truth for QBBE Hub. Repository Issues represent Epics and executable work; pull requests represent implementation evidence; GitHub Actions represents automated verification evidence; the acceptance/readiness documents represent formal release evidence.

## Traceability chain

`PRD / acceptance requirement -> Epic -> Issue -> tasks -> PR -> tests / Actions -> acceptance evidence -> staging certification -> production verification`

A merged PR is not equivalent to an accepted requirement. An implemented feature is not Done until the verification required by its canonical Issue passes.

## Canonical Epics

- #11 — Identity, Access, Security & MFA
- #12 — Programs, Projects, Milestones & Tasks
- #13 — Meetings, Events, Comments & Documents
- #14 — Dashboard, Portfolio, CRM & Reporting
- #15 — Notifications, Workflows & Administration
- #16 — External Integrations
- #17 — UX, Design System & Accessibility
- #18 — Testing, Verification & Quality Engineering
- #19 — Platform, CI/CD & Infrastructure
- #20 — Observability, Reliability & Recovery
- #21 — Staging Release Certification
- #22 — Production Launch & Verification

## Canonical delivery Issues

### Epic #11 — Identity, Access, Security & MFA
- #23 — Identity lifecycle: P0-AUTH-01, P0-AUTH-04
- #24 — Scoped memberships/database authorization: P0-AUTH-02, P0-AUTH-03
- #25 — MFA/AAL2: SEC-MFA

### Epic #12 — Programs, Projects, Milestones & Tasks
- #26 — Programs: P0-PROG-01, P0-PROG-02, P1-PROG-03
- #27 — Projects: P0-PRJ-01..06, P1-PRJ-07..09
- #28 — Milestones: P0-MIL-01
- #29 — Task core: P0-TSK-01..05
- #30 — My Work / Board / filters: P0-TSK-06..08
- #31 — Task dependencies/checklists/recurrence/calendar: P1-TSK-09..12

### Epic #13 — Meetings, Events, Comments & Documents
- #32 — Events: P0-EVT-01..02
- #33 — Meetings/agendas: P0-MTG-01..03, P1-MTG-04, P0-AGD-01..04, P1-AGD-05..06
- #34 — Contextual comments: P0-COM-01..05
- #35 — Documents/files: P0-FIL-01, P1-FIL-02

### Epic #14 — Dashboard, Portfolio, CRM & Reporting
- #36 — RAID/updates: P1-RID-01..04, P1-UPD-01..02
- #37 — Dashboard/portfolio: P0-DASH-01..06, P1-DASH-07..10
- #38 — CRM: P1-CRM-01..06
- #39 — Search/reports/exports: P0-SRC-01, P1-RPT-01..03

### Epic #15 — Notifications, Workflows & Administration
- #40 — Notifications: P0-NOT-01..03, P1-NOT-04..06
- #41 — Administration: P0-ADM-01..02, P1-ADM-03
- #42 — Channels/workflows continuity: EXT-CHANNELS, EXT-WORKFLOWS

### Epic #16 — External Integrations
- #43 — Gmail: INT-GMAIL
- #44 — Google Calendar: INT-CALENDAR
- #45 — Google Drive: INT-DRIVE
- #46 — VMS: INT-VMS
- #47 — Transactional email: INT-EMAIL

### Epic #17 / #18 — UX & Quality
- #48 — QBBE brand shell/design system
- #49 — WebKit keyboard-focus regression
- #50 — Final QA matrix: QA-FINAL

### Epic #19 — Platform, CI/CD & Infrastructure
- #51 — CI/CD and release gates
- #52 — QBBE-owned provider accounts and isolated staging/production

### Epic #20 — Observability, Reliability & Recovery
- #53 — Observability: OPS-OBSERVE
- #54 — Backup + restore: OPS-BACKUP, OPS-RESTORE

### Epic #21 — Staging Release Certification
- #55 — Exact-commit staging deployment: OPS-DEPLOY staging
- #56 — Acceptance/readiness evidence reconciliation
- #57 — Operator acceptance: OPS-SIGNOFF

### Epic #22 — Production Launch & Verification
- #58 — Production Launch Verification (final project task)

## Critical path

The baseline critical path is:

`#24 scoped authorization -> domain feature verification (#26-#42) -> #50 final QA + #51 delivery gates + #52 environments + #53/#54 operations -> #55 staging -> #56 evidence reconciliation -> #57 operator sign-off -> #21 staging certification -> #58 production verification -> #22 complete`

#23 and #25 are launch-critical identity gates. #43-#47 are externally blocked until QBBE-controlled provider access is available, but they must not block unrelated implementation work.

## Dependency rules

Every executable Issue must explicitly state:

- `Blocked by #...`
- `Blocks #...` when known
- external dependencies separately from code dependencies

Do not use prose-only hidden dependencies in PR descriptions. If a dependency changes, update the canonical Issue.

## Recommended GitHub Project statuses

1. Backlog — defined but not dependency-ready
2. Ready — dependency-ready and executable
3. In Progress — implementation underway
4. Verification — implementation exists; required validation is running or pending
5. Blocked — a real unresolved dependency prevents the next required step
6. Done — Issue Definition of Done and acceptance evidence are satisfied

Use a separate external-blocker field or marker where possible. Missing external credentials must not force unrelated work into Blocked.

## Recommended Project fields

- Type: Epic / Story / Task / Bug / Security / Ops
- Status: Backlog / Ready / In Progress / Verification / Blocked / Done
- Phase: lifecycle phase 0–12
- Priority: P0 / P1 / P2 / P3
- Workstream / Epic
- PRD / Acceptance IDs
- Verification: Not Run / Failed / Partial / Passed
- Environment: Local / CI / Staging / Production
- Risk: Critical / High / Medium / Low
- Owner
- Target: Functional / Staging / Production

## Recommended Project views

- Execution Board — grouped by Status
- Roadmap — grouped by Epic/Target
- Critical Path — launch-blocking dependencies only
- Verification Queue — implementation exists but acceptance is incomplete
- External Blockers — provider/credential/operator dependencies
- Security — identity/RLS/MFA/privacy/supply-chain work
- Staging Gate — all work feeding #21
- Production Gate — #58 dependencies
- PRD Coverage — grouped by requirement family

## Pull request rules

Every future PR must use `.github/PULL_REQUEST_TEMPLATE.md` and include:

- `Closes #<primary canonical Issue>` for work that completes that Issue
- parent Epic
- PRD/acceptance IDs
- dependency impact
- implementation/security/data impact
- exact validation commands/results/artifacts
- release impact

Use `Refs #...` for related Issues that the PR advances but does not fully close.

Do not use Linear IDs as the canonical work identity. Historical `CHI-*` commit names may remain for audit history, but GitHub Issue numbers are authoritative from this migration forward.

## Acceptance evidence rules

`docs/acceptance-matrix.md` remains the formal PRD acceptance ledger. `docs/execution-journal.md` remains the execution/evidence journal. `docs/readiness-report.md` remains the release-readiness verdict.

Each verified item must identify the exact commit or release SHA, environment, command/scenario, result and artifact. Code presence, a schema column, a written runbook or a merged PR is not sufficient by itself.

## Final completion rule

The project is not complete when the feature backlog is empty. It is complete only after #58 Production Launch Verification succeeds and Epic #22 can close with production evidence.