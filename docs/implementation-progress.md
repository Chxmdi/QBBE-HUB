# PRD v2 release implementation

Updated 2026-09-08. Branch: `implement/prd-v2-release`.

The full approved plan remains in progress. No hosted environment has been
provisioned or deployed, and no production-readiness claim is made.

## Implemented in this branch

| Work | Evidence | Verification |
|---|---|---|
| Server-owned export execution fields and transactionally recorded requests | `20260907213553_secure_export_requests.sql` | Embedded Postgres accepted a valid request and rejected client status/path/expiry/id; full Supabase assertions added |
| Download path/organization validation and failure-closed auditing | `src/app/api/exports/[id]/download/route.ts` | Typecheck/build; end-to-end storage validation pending |
| Paginated, organization-scoped person/data exports | `export-builders.ts`, `read-all.ts` | More than 1,000 records, smaller server cap, foreign subject/data and failed-page regressions |
| Gmail push session-middleware exemption | `src/lib/supabase/middleware.ts` | Unit tests retain authentication for other integration paths; live OIDC rehearsal pending |
| Program report scope and pagination | `report.snapshot.ts` | Foreign decisions excluded, 1,203 tasks counted, failed reads refuse a snapshot |
| Health separate from completion | `src/features/dashboard/health.ts` | Manual health, unknown health and completed-project exclusion tests |
| Password recovery UI and safe redirect targets | `/forgot-password`, `/reset-password`, `safe-redirect.ts` | Redirect unit tests; build; browser tests added; real recovery email/session verification pending |
| Multi-step task dependency cycles | `src/features/tasks/schemas.ts`, dependency command, `20260908045748_enforce_task_dependency_cycles.sql` | Graph unit tests and embedded Postgres three-node cycle denial; full Supabase assertions added |
| Runtime/deployment baseline | `.nvmrc`, package engine, `netlify.toml` | Locked dependencies installed under Node 22; Netlify hosted compatibility remains unverified |
| Program name/description editing, archive browsing and restoration | program edit dialog/action, archive route filter, `20260909004539_audit_program_edits.sql` | Embedded Postgres verified timestamps, actor history and rollback on audit failure; full RLS and authenticated browser assertions added but not run locally |
| Gated Netlify publishing and expanded CI | `.github/workflows/deploy-netlify.yml`, `ci.yml`, `playwright.config.ts` | YAML parsed; workflow run/hosted settings pending. Publishing remains disabled until environment readiness is recorded |

## Current verification evidence

- The initial full run passed 382 unit tests across 42 files. After program
  editing, 381 passed and the required-text convention test caught a new schema
  mismatch; it was fixed and all four tests in that file passed on rerun.
- Final TypeScript and lint checks passed, including dependency-command changes.
- Production build passed again including program editing/archive controls,
  recovery routes and report/export fixes. Latest changed-file lint passed.
- Locked install reported zero dependency vulnerabilities at installation time.
- New migrations executed against a temporary embedded Postgres fixture. This
  is narrower than the full migrated Supabase/RLS suite, which is not run here:
  Docker and a local Supabase stack are unavailable.
- All eight public browser scenarios passed: seven in the full run and the
  recovery error-state scenario on targeted rerun after narrowing an ambiguous
  test locator. Includes six viewport widths, both themes, automated
  accessibility, keyboard navigation, redirects and mocked recovery requests.
- Firefox additionally passed all eight public scenarios. Local WebKit cannot
  create a page: `Page.overrideSetting: Unknown setting: PushAPIEnabled` from
  the installed browser/protocol combination. Stopped after reproducing twice;
  no WebKit acceptance claim. The Ubuntu CI WebKit check remains required.
- The recovery screen was visually inspected with agent-browser. Real recovery
  delivery and authenticated password change still require configured Auth.

## Remaining approved work

- Scoped membership capabilities and UI across all access paths; MFA and team
  access synchronization. Existing broad staff permissions are not yet replaced.
- Project lifecycle, program lead/membership editing, task roles, full milestones, recurrence and calendar
  editing, intake/closure enforcement.
- Shared contextual comments, attachments/quarantine/scanning, agenda lifecycle
  and recurring meetings.
- Full portfolio/report/workload/CRM requirements, preferences and durable custom
  workflows, quota-aware notification delivery and revocation checks.
- Actual Google/VMS/email integration verification and VMS assignment contract.
- QBBE account ownership, staging/production provisioning, gated deployments,
  encrypted Drive backup automation, restore drill, monitoring and pilot.
- Full role/realtime/browser/accessibility/performance acceptance matrix.

The deployment-owner email and sender domain were requested; no values have
been supplied in this session. Do not invent them, reuse personal connected
accounts as QBBE ownership, or publish test data as production.


## Resume context

The user's 2026-09-08 continuation retains the entire approved implementation
and deployment scope. Work is on `implement/prd-v2-release`, uncommitted. Do not
restart the audit or mark the plan complete based on this initial tranche.
Current new work includes program lifecycle controls and CI changes; program
UI/authenticated tests need a migrated Supabase environment. Existing staff
access remains broad and is the next major security implementation area.
No QBBE hosted accounts have been provisioned, no release enabled, no emails
sent, no purchases made. Account owner and sender-domain input remain pending.

The seven-workstream continuation is now tracked in acceptance-matrix.md,
execution-journal.md and readiness-report.md. These supersede stale release
claims in older audits.
