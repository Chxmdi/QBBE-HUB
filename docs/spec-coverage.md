# Spec coverage vs. QBBE Hub Master Specification v1.0

This matrix is the honest record of what the product implements. Update it in
the **same PR** as the slice (working agreement). Do not mark Gmail / VMS /
production email **done** on stubs.

## How to add a table (Unit 1 recipe)

1. Create the table, indexes, and RLS policies in the **same** migration.
2. Add one **allow** and one **deny** case to `supabase/tests/rls.sql`.
3. Seed/auth fixtures live in `supabase/tests/qa-users.sql`.
4. Run `npm run test:db` against local Supabase (`supabase start`).
5. Colocate Zod/command tests under `src/features/<name>/tests/`.

## Units

| Unit | Spec IDs | Status | Tests |
|---|---|---|---|
| 0 CI Playwright path | DONE-003 | Implemented | `npx playwright test public-routes` (no `QA_CHROME_PATH` in GHA) |
| 1 RLS + command harness | TST-001, TST-003, DONE-002 | Implemented | `npm test`, `npm run test:db` |
| 2 Milestones | P0-PRJ-03 | Implemented | schema tests; RLS volunteer insert deny; UI on project page + calendar union |
| 3 Canonical task statuses | P0-TSK-02, P0-TSK-03 | Implemented | board columns = `TASK_STATUSES`; blocked-without-reason unit test |
| 4 Channel membership | P0-COMM-01/03, P0-GOV-01/02, P0-LINK-01 | Implemented | add/leave commands; RLS private channel; program/project auto-channel |
| 5 DMs + permalinks | P0-DM-01, P0-MSG-06 | Implemented | `/messages` in nav + qa-matrix; `?message=` / `?thread=` in ChannelView |
| 6 Admin identity | P0-ADM-01, AUTH-007 | Implemented | transferOwnership; reactivate; invite honesty when email unset |
| 7 People / teams | P0-PPL-02, P0-PPL-03, P0-UX-06 | Implemented | team commands + Admin UI; `/people?person=` highlight |
| 8 Volunteer home | P0-VOL-02 | Implemented | Home hides portfolio/CRM CTAs; qa-matrix volunteer assertions; RLS CRM deny |
| 9 Notification email | P0-NOT-03, NTF, JOB | Implemented locally via Mailpit | dedupe unit tests; job `GET/POST /api/jobs/notification-email` (cron auth, not a user session) |
| 10 Report PDF | P0-RPT-04, RPT-003 | Implemented | `/reports/[id]/pdf`; volunteer/staff-without-access 404 via RLS |
| 11 Gmail inbox | P0-INB-01, P0-GML-01, GML-001–006 | **Gated** on Google credentials | OAuth + first metadata sync on connect; cron `/api/jobs/gmail-sync`; UI stays Not connected without secrets |
| 12 VMS boundary | P0-VOL-01 | **Gated** on VMS contract | Connect probes `VMS_API_URL` and refuses if unreachable; disconnect clears org `vms_id`s only |
| 13 P1 slices | P1-TSK-06/07/08, P1-ANN-07, P1-PRJ-06/07, P1-CAL-03, P1-UX-08, P1-WF | Implemented in-product | workflows fire on task status + announcement publish; deps/checklists/recurrence/templates/saved views |
| 14 Hardening | Part IV §16.9, §17.2 | In product + operator leftover | jobs bypass session middleware; deactivated users land on `/account-inactive`; invite-only signup; CSP/HSTS; staff-gated portfolio routes |
| 15 RAID log | P1-PRJ (risks & issues) | Implemented | `risk`/`issue` tables with a generated 1–9 score; settle-without-a-reason blocked by CHECK **and** Zod; escalation keeps the issue pointing at the risk; RLS allow+deny for staff/volunteer/guest |
| 16 Funding pipeline | CRM (opportunity records) | Implemented | `opportunity` with a derived `is_open`; an award needs an amount and a date, a refusal needs a reason, and an open bid cannot hold either — CHECK constraints mirrored by Zod; totals kept per currency; staff-only RLS with allow+deny. Forecasting stays deferred (P2-CRM-07) — no probability, no weighted value. |
| 17 Intake | Project requests and approvals | Implemented | `project_request` (anyone proposes, staff decide, approval creates the project in one transaction and keeps a pointer back) and `approval_request` (one nullable FK per subject plus a CHECK, not a polymorphic id); only the named approver can answer; one open ask per subject; `/requests` queue with stale-request warning; 15 unit tests, RLS allow+deny for propose, read-own, impersonation, queue access and approver identity |
| 18 Search coverage | P0-CMD-01, P1-SRC-03, P0-UX-06 | Implemented | `global_search` covers 13 record types including risks, issues, documents and opportunities; results round-robin so no type is starved by the limit; deep links land on the row and highlight it; drift test ties SQL branches to UI labels; RLS assertions prove search is not a side door |

## Deliberately not first-release (P2)

Native mobile apps, collaborative docs, built-in video, autonomous AI, presence
(P2-DM-04), opportunity forecasting (P2-CRM-07), Slack bridge, service-user/case
records. **ADR-003** (plain-text messages) remains in force.
