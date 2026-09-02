# Production Readiness Audit

**Audit date:** 2026-08-18  
**Baseline:** `claude/production-ready-deployment-8n56h5`  
**Verdict:** **NOT DEPLOYMENT READY**

This is an evidence-based baseline against the governing specification now
stored in [`docs/master-spec.md`](./master-spec.md). The supplied specification
is outcome-oriented rather than a spec-ID-by-spec-ID document, so a numbered
requirement certification cannot yet be made. `docs/spec-coverage.md` remains
an implementation ledger and does not replace the governing specification.

## Evidence collected

| Check | Result |
| --- | --- |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm test` | Pass — 32 files / 318 tests (CI job **Verify**, green on `main`) |
| Production build | Pass |
| Public Playwright accessibility/responsive suite | Pass — 6 tests (CI job **Verify**) |
| Authenticated production QA matrix | **Not verified** — 10 tests exist (`tests/e2e/qa-matrix.spec.ts`) but the suite is not wired into CI and needs a seeded QA database, so nothing in this repository records when it last passed or against what. An earlier revision of this table recorded it as "Pass"; that had no artifact behind it. Treat as unverified until a dated run exists. It signs in as `qa-owner` and makes one volunteer check, so it does not exercise the five-role matrix — `supabase/tests/rls.sql` does that. |
| Database/RLS suite | Pass — CI applies all 55 migrations (through `20260828200241`) to a local Supabase Postgres; all allow/deny cases passed, including inaccessible-versus-attended private meeting children and cross-organization core identity, program, project, milestone, task, label, and CRM records. CI now enforces the same matrix and fails on local database-advisor security errors. |
| Supabase local security advisor | Pass — `supabase db advisors --local --type security --fail-on error` returns no issues after the test helpers' search paths were fixed. Full performance-advisor warnings remain to be assessed separately. |
| Dependency audit | Pass — `npm audit --audit-level=high` reports 0 vulnerabilities after the Next.js 16.3.1 upgrade |

## Requirement matrix

| Area | Status | Evidence / gap |
| --- | --- | --- |
| Workspace shell, themes, responsive navigation, auth and onboarding | ✅ Complete in code | App routes, design tokens, public E2E suite |
| Operations dashboard, My Work, task list and Kanban | ✅ Complete in code | Workspace routes plus task services/components |
| Programs, projects, milestones, health, updates and closure | ✅ Complete in code | Project/program routes and command services |
| Channels, DMs, threads, reactions, mentions, saved messages, pins and message conversions | ✅ Complete in code | Communication services/components, audience-scoped person/team mentions, `/saved`, and saved-message RLS allow/deny coverage. |
| Announcements, acknowledgements and scheduled delivery | ✅ Complete in code | Announcement commands and idempotent scheduled-announcement fan-out job |
| Meetings, agendas, notes, decisions and task actions | ✅ Complete in code | Meeting commands and meeting pages |
| Events, calendar and master schedule | 🟡 Partial | Hub events/schedules exist; linked Google Calendar meetings and events now create, update and cancel alongside their Hub record. Calendar overlays reconcile with paginated persisted sync tokens and safe full rebuild on expiry. Real-account validation remains required. |
| People, teams and role/workload visibility | 🟡 Partial | People and team administration exist; authenticated owner/volunteer QA now passes. Expanded multi-user/realtime coverage is still required. |
| CRM, relationships and follow-ups | ✅ Complete in code | CRM routes/commands and schema |
| Documents and resources | ✅ Complete in code | Private signed URLs, document audit events and access checks are implemented. |
| Reports, approval, CSV and PDF | ✅ Complete in code | Snapshot/approval commands plus CSV and generated-PDF routes |
| Notifications and preferences | 🟡 Partial | In-app alerts, due/overdue task and CRM reminders, overdue acknowledgement reminders, dedupe, account settings, quiet hours and per-channel mutes are implemented. Real email-provider validation and delivery observability remain incomplete. |
| Search, command palette and Quick Create | ✅ Complete in code | Permission-aware Quick Create opens task, project, program, meeting, event, channel, announcement, and CRM creation flows. |
| Admin, invitations, audit and access controls | ✅ Complete in code | Admin screen, actions, audit table and RLS policies |
| Gmail OAuth and inbox sync | 🟡 Partial | OAuth, token storage, paginated inbox/history reconciliation, on-demand full-message retrieval, and server-side send/reply are implemented. Gmail watches renew daily when Pub/Sub is configured; protected Pub/Sub intake stores the last pushed history ID and the scheduled worker reconciles Inbox changes/removals from Gmail history. Real-account/Pub/Sub setup validation and existing-connection reauthorization remain required. |
| Google Calendar integration | 🟡 Partial | OAuth now requests the narrow `calendar.events` write scope; overlay ingest uses paginated persisted sync tokens, safe cancellation reconciliation, and full rebuild after expiry. Linked Hub meeting/event creation, updates and cancellation are implemented without blocking Hub workflows on sync failure. Failed cancellation preserves the link and marks the owner connection degraded for recovery. Existing Calendar connections must reauthenticate for the new scope; real-account validation remains required. |
| Google Drive integration | 🟡 Partial | Per-user OAuth uses the read-only Drive metadata scope; initial and scheduled sync now use a paginated persisted change-feed cursor, safely reconcile removals, and rebuild after token expiry. Drive resources remain idempotent document links without copying file contents. Real-account validation remains required; write access is deliberately out of scope for this read-only integration. |
| Volunteer Management System integration | 🟡 Partial | The scheduled VMS worker maps normalized identities and availability into explicitly linked **active organization members** only, with actionable connection-health states on errors. Assignment sync, provider-specific reconciliation, and real-account validation remain required. |
| Production transactional email and digests | 🟡 Partial | Critical delivery has bounded retries through a Resend-compatible HTTP provider when configured (or Mailpit locally). A daily digest cron honors user preferences and records per-notification delivery rows. Real provider-account validation and delivery observability remain required. |
| Background jobs and automation | 🟡 Partial | Cron routes and admin-defined workflows for task changes, announcements, project health, completed meetings, and newly assigned event roles exist. Assignment workflows can notify the assigned member, event owner, admins, or a selected team; duplicate assignments do not rerun workflows. Email retry scheduling is bounded; scheduled-announcement fan-out and hourly due/overdue/acknowledgement reminders are idempotent; integration failures surface actionable health states; workers record redacted, per-organization execution results visible to admins. Durable queues landed on 2026-08-19, the day after this audit was taken: pgmq backs every job, with `job_definition`, `job_run` and pg_cron dispatch (`20260819165607_jobs.sql`). Audit trails for no-op executions remain absent. |
| Security and RLS | 🟡 Partial | Migrations enable RLS; scope identity, programs/projects/tasks, CRM/reporting/integrations, meetings/events, activity, and audit data to the current organization; sign private-document URLs; and make private-message, task-child, and meeting-child records inherit parent visibility. The 164-assertion allow/deny suite exercises blocked and permitted access, including cross-organization data, and passes in CI against a migrated database — first verified on 2026-09-01. Before that date the claim was untrue: the suite's fixture bootstrap aborted on a `gen_salt` resolution error, so no assertion had ever executed, and the CI job that runs it had never been triggered because `main` did not exist. A full security review of the remaining communication, notification, document, and feature-flag policies plus production-database validation remain required. |
| Observability | 🟡 Partial | Structured console logging and an optional Sentry-compatible DSN exist. Production monitoring, alert routing and operational validation remain unverified. |
| CI/CD and branch strategy | 🟡 Partial | CI enforces lockfile install, lint, type-check, unit, production build, public E2E, high-severity dependency audit, and a migrated local-Supabase RLS/security-advisor job. `main` now exists and CI runs on every push to it. Branch protection, the default-branch setting, preview deployments and integration-test enforcement are repository settings and remain outside this codebase. |
| Dependency security | ✅ Complete in code | Next.js and its matching ESLint configuration are upgraded to 16.3.1; the Next 16 proxy/flat-config migration is applied, and `npm audit --audit-level=high` reports 0 vulnerabilities. |
| Risks and issues (RAID) | ✅ Complete in code | `risk`/`issue` with a generated 1–9 score; settling without a reason blocked by CHECK and mirrored in Zod; RLS allow+deny across staff, volunteer and guest. Built 2026-08-22, after this audit was taken. |
| Funding pipeline | ✅ Complete in code | `opportunity` with derived `is_open`; awards require an amount and date, refusals a reason, open bids neither; totals never summed across currencies; staff-only RLS. Forecasting deliberately deferred — no probability field, no weighted value. |
| Intake requests and approvals | ✅ Complete in code | `project_request` and `approval_request`; approval creates the project in one transaction; one nullable FK per subject with a CHECK rather than a polymorphic id; only the named approver may answer; one open ask per subject. |
| Report versioning and sign-off | ✅ Complete in code | `report_version` is append-only by absence — SELECT and INSERT policies, no UPDATE or DELETE — so an approved report's figures cannot change; regenerating appends a version and clears the sign-off. Asserted in CI. |
| Data exports | 🟡 Partial | Runs on the job runtime; files sit in a bucket with no storage policies, reachable only via a 2-minute signed URL after an explicit check; expiry deletes the file and keeps the record; downloads counted atomically. Real-provider storage behaviour under load is unverified. |
| Outputs and outcomes | ✅ Complete in code | `program_operation` with derived `contact_hours`; `outcome_metric`/`outcome_measurement` with a direction the database refuses to contradict and one reading per metric per day; totals count delivered sessions only. |
| Retention policies | 🟡 Partial | A whitelist with per-subject floors enforced by trigger (audit trail: 6 years); policies created disabled and confirmed with the affected count; `retention_run` has no write policy. The nightly sweep has not yet run against production data. |
| Rate limiting | ✅ Complete in code | Counters on write paths and the job endpoint. `rate_limit_counter` has RLS enabled with no policy, which denies all client access by design; the advisor reports this as INFO. |
| Multi-organization isolation | ✅ Complete in code | Every organization-owned table scopes to the row's organization, and two standing assertions prove no policy or `SECURITY DEFINER` helper tests membership in any organization instead. Corrected 2026-09-01: twenty-eight policies and two helpers had used the unscoped form since the August scoping pass, latent because production holds one organization. |
| Deployment, backup and recovery rehearsal | ❌ Missing | Runbooks exist but there is no evidence of QBBE-owned accounts, deployed environments, backups, a staged rehearsal or a tested rollback. |

## Required next actions

1. Maintain the complete Master Spec in the repository and reconcile this
   audit against every authoritative requirement as implementation changes.
2. Provide QBBE-controlled Supabase, Vercel, Google OAuth, VMS and email
   provider configuration to perform real integration and staging validation.
3. Implement the partial and missing rows above, beginning with production
   email validation/observability, VMS assignment synchronization, and expanded
   multi-user/realtime test coverage. (Durable background processing is done —
   see the jobs row.)
4. Add integration, authenticated multi-role and multi-user realtime coverage
   to CI. (The RLS allow/deny suite is done — it runs in the `database-security`
   job, green since 2026-09-01.)
5. Protect `main` and make it the repository default branch, configure preview
   deployments and require all checks before production deployment.

Until those items are completed and verified with real QBBE-owned production
accounts, the application must not be represented as deployment ready.
