# Scoped-access cutover inventory

Source inspection at base commit `670b12d` plus current uncommitted work.
The full migration chain and local database security advisor passed on
2026-09-09. This inventory still requires effective `pg_policies`/`pg_proc`
comparison after the coordinated cutover; it is not a live security certification.

## Reproduced bypass categories

| Surface | Existing authority | Required coordinated change |
|---|---|---|
| Program/project parents | 20260818080848 policies directly use is_org_member/is_org_staff | Change parent policies and read/manage helpers together |
| Memberships/milestones | Parent helper SELECT plus permissive FOR ALL manage policies | Validated scoped roles, same-org targets, no self-escalation |
| Tasks/activity | 20260818081240 staff-or-assignee; organization-wide activity | Assigned-role/context capabilities and reference-aware activity |
| Task children/dependencies | Parent task subqueries; dependency writes check blocked endpoint only | Scope both dependency endpoints; protect assignment/context fields |
| Meetings/events/decisions | 20260818081647 and 20260902002148 contain staff FOR ALL grants | Change parent/helper/child policies; preserve organizer/attendee assignments |
| Linked channels/messages | Public/member channel helpers; project/program references independent | Apply parent scope to read/post/reply/join; preserve organization channels and DMs |
| Documents/storage | Staff/org visibility and owner write branches | Metadata and object policies must agree; scoped uploads and revocation |
| Stored reports/versions | Organization staff reading stored snapshots | Parent scope plus treatment of previously generated broad snapshots |
| CRM/opportunities | Broad staff FOR ALL | Explicit CRM/restricted-note capabilities and linked-work access |
| Search | global_search is SECURITY INVOKER | Test each union arm under new table RLS; add missing agenda/contact sources |
| Export worker | Service-role builder receives organization but not requester scope | Actor-aware extraction, execution/download revocation checks, invalidate unsafe artifacts |
| Email/digest workers | Render from stored notification/ledger | Recheck current source access before render/send, including retries/digests |
| Google Calendar writes | Service-role integration client | Validate actor and record permission at privileged side-effect boundary |
| Pages/actions | requireStaff/session.isStaff blocks assigned volunteers | Replace with matching record/action capabilities alongside RLS |

`record_report_version` and `decide_report_version` are SECURITY INVOKER;
their broad table policies are the concern. Do not misclassify them as definer
bypasses. Communication/meeting helper functions are SECURITY DEFINER boundaries.

## Delivery groups

1. Preparation: typed role/grant model, provenance, impact preview and explicit
   backfill review. No broad staff backfill and no permission cutover yet.
2. Coordinated cutover: parent/child policies, activity, linked communication,
   files/storage, reports, privileged outputs and route/action gates. An
   unconverted output must be explicitly unavailable rather than leak scope.
3. Lifecycle: deactivation, invitation/MFA enforcement, team/direct-grant
   reconciliation and all revoked-access paths.
4. Evidence: effective policy/function/grant inspection, direct API/storage
   allow/deny, reparenting/cross-org denial, realtime reconnect and stale-worker
   permission checks at the same candidate commit.

## Preparation evidence completed before cutover

The administrator preview at `/admin/access` reads the full paginated local
inventory, fails closed on partial reads, and shows inferred owner, lead and
membership sources without changing authority. Its seven calculation tests and
authenticated Chromium owner/volunteer scenarios pass; the owner scenario also
covers keyboard details and axe in both settled themes.

## Bounded fix completed before cutover

The original channel/conversation membership helpers checked retained join rows
without active organization membership. The new
`20260909095310_enforce_active_communication_membership.sql` adds active-org
checks while preserving historical joins. The regression passes in the full
local Supabase `test:db` chain using the repository's actual message read/insert
policies and proves history plus explicit join rows remain. Realtime reconnect
verification remains pending.

## Coordinated cutover in the working tree

`20260910030005_cut_over_core_scoped_access.sql`,
`20260910030223_secure_team_channel_access.sql` and
`20260912021000_cut_over_remaining_scoped_surfaces.sql` replace staff-wide
program, project, meeting, event, decision, document, report, CRM and activity
policies with capability or explicit CRM predicates. Route gates use
`requireSession` for assigned-work pages. Effective `pg_policies` inspection
after a clean reset is still required before this inventory is a live
certification.
