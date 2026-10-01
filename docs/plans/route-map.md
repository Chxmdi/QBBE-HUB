# Route map

Written 2026-10-01 (Workspace OS Phase 0, unit U1). The data behind this
table is `src/config/route-map.ts`; `src/config/route-map.test.ts` walks
`src/app` and fails when a `page.tsx` is added, moved or removed without the
map following, so this file and the app directory cannot drift apart for
long. Edit the data file first, then this table.

Every `page.tsx` under `src/app` (182 routes today) has exactly one entry.
Route groups such as `(workspace)` and `(auth)` are dropped from the pattern;
dynamic segments keep their brackets.

## Statuses

| Status | Meaning | Count |
|---|---|---|
| production | Reachable today with no switch: in the menu or linked from a record. | 81 |
| beta | Hidden behind a `wos_*` switch until its wave's sign-off (`src/lib/feature-flags.ts`, or a feature's own `flag.ts` or `gate.ts` for keys not yet in the shared list: `wos_goals`, `wos_decisions_v2`, `wos_meetings_v2`, `wos_mobile`, `wos_object_approvals`). | 71 |
| migration | An old screen the plan replaces one feature at a time ([workspace-os-plan.md](workspace-os-plan.md) section 9), or a `/collab/*` screen whose panels move onto the object's own page. Stays reachable for one release after the menu switches, then is removed. Each names its canonical destination. | 15 |
| admin | Administration screens under `/admin/*` and `/spaces/{admin,roles,publish}`: owners and admins only, with two-step sign-in where the screen demands it. | 14 |
| deprecated | Fully replaced by its canonical destination; kept only until deleted. | 1 |

The admin status is about the area, not the audience: `/workflows`,
`/builder` and `/apps/manage/[id]` are also owner-and-admin screens, but they
are modules behind a switch, so they are classified beta by their switch.

## One canonical destination per daily task

Each daily task has one place to go. The test asserts each destination is
named once, exists in the map, and is not itself a migration or deprecated
screen.

| Daily task | Canonical destination | Today | Screen |
|---|---|---|---|
| Home | `/home` | beta (wos_home) | Home (M17a): Now, Today, Waiting, Continue, Decisions, Changes |
| My Work | `/lenses/my-work` | beta (wos_lenses) | My Work on the lens engine (M8c) |
| Pages | `/pages` | beta (wos_pages) | Pages: sidebar tree, favourites, recent (M4a) |
| Data | `/lenses` | beta (wos_lenses) | Data: saved lenses index (M8d) |
| Communication | `/inbox` | production | Communication: notification inbox |
| Programs | `/programs` | production | Programs: the daily destination until spaces replace them (M10a) |
| Settings | `/settings` | production | Settings: profile, language, two-step sign-in |

Why these:

- **Home** goes to the M17 Home. Today's dashboard at `/` is the screen it
  replaces, so `/` is a migration entry pointing at `/home`.
- **My Work** goes to the lens version (M8c), which the lens code names as
  the new version of `/my-work`; `/board` follows the same rule.
- **Pages** is the Workspace OS pages tree (M4a).
- **Data** is the saved-lens index (M8d): the one entry to every table, board,
  calendar, timeline, gallery, feed and dashboard lens. The table lens itself
  is reachable from it.
- **Communication** stays the notification inbox; channels, messages, saved
  messages and announcements sit beside it and are not replaced.
- **Programs** stays `/programs` until M10a's migration steps reach step 4
  (switch the menu); `/spaces` is beta beside it, not yet its replacement.
- **Settings** stays `/settings`.

## Migration pairs

| Old screen | Canonical destination | Source of the pair |
|---|---|---|
| `/` | `/home` | M17a Home replaces the dashboard home |
| `/my-work` | `/lenses/my-work` | M8c; the lens page says it is the new version of `/my-work` |
| `/board` | `/lenses/board` | M8c; the lens page says it is the new version of `/board` |
| `/search` | `/lenses/find` | M12; Find is the new search page |
| `/forms`, `/forms/new`, `/forms/[id]`, `/forms/[id]/edit`, `/forms/[id]/submissions`, `/forms/submissions/[id]` | `/forms-v2`, `/forms-v2/new`, `/forms-v2/[id]`, `/forms-v2/[id]/responses` | V1-6; `form_v2.legacy_form_id` and the conversion action copy the old forms |
| `/meetings/[id]` | `/meetings-v2/[id]` | V1-9 meetings as objects; the meetings list is not replaced |
| `/collab/objects/[objectId]`, `/collab/live/[objectId]`, `/collab/versions/[objectId]`, `/collab/versions/[objectId]/compare` | `/objects/[id]` | Each page says it stays on its own URL only until integration puts the panel on the object's page |

Not migration, on purpose:

- `/projects/[id]` stays production. The living project page
  (`/home/projects/[id]`, M19) says it folds into `/projects/[id]`, so the
  old URL is the destination, not the thing replaced.
- `/calendar` and `/schedule` stay production. The calendar lens (V1-1) is a
  lens over dated objects; nothing in the plan or the code names it as the
  replacement of the unified calendar or the master schedule yet.
- `/documents/templates` and `/admin/templates` stay. Templates v2 (V1-13)
  covers object, page and space templates; letters, contracts and
  acknowledgements (#147) and the agenda and record templates are different
  things.
- `/reports` stays. Dashboards per role (V2-5) live under `/insight`; board
  reports with versions are not dashboards.

## Deprecated

| Route | Canonical destination | Why |
|---|---|---|
| `/dev/editor-spike` | `/pages/[pageId]` | The W0-5 and W0-6 spikes are done (go for BlockNote and Yjs). The route 404s outside development and is deleted after wave 1. |

## Every route

| Route | Status | Switch | Canonical | Task |
|---|---|---|---|---|
| `/sign-in` | production |  |  | Sign in |
| `/sign-up` | production |  |  | Sign up (invite-only after the first organization) |
| `/forgot-password` | production |  |  | Password reset request |
| `/reset-password` | production |  |  | Password reset |
| `/mfa` | production |  |  | Two-step sign-in (MFA) |
| `/welcome` | production |  |  | First-run onboarding |
| `/account-inactive` | production |  |  | Deactivated member landing |
| `/` | migration |  | `/home` | Home: today's dashboard, replaced by M17 Home |
| `/home` | beta | `wos_home` |  | Home (M17a): Now, Today, Waiting, Continue, Decisions, Changes |
| `/home/world` | beta | `wos_home` |  | My World (M17b) |
| `/home/commands` | beta | `wos_home` |  | Command language on its own page (M15) until it mounts in the palette |
| `/home/projects/[id]` | beta | `wos_home` |  | Living project page (M19); folds into /projects/[id] at integration |
| `/my-work` | migration |  | `/lenses/my-work` | My Work: the old screen, replaced by the lens version (M8c) |
| `/board` | migration |  | `/lenses/board` | Board: the old screen, replaced by the lens version (M8c) |
| `/search` | migration |  | `/lenses/find` | Search: replaced by Find (M12) |
| `/lenses` | beta | `wos_lenses` |  | Data: saved lenses index (M8d) |
| `/lenses/my-work` | beta | `wos_lenses` |  | My Work on the lens engine (M8c) |
| `/lenses/board` | beta | `wos_lenses` |  | Board lens (M8c) |
| `/lenses/table` | beta | `wos_lenses` |  | Table lens (M8b) |
| `/lenses/calendar` | beta | `wos_lenses` |  | Calendar lens (V1-1) |
| `/lenses/timeline` | beta | `wos_lenses` |  | Timeline lens (V1-2) |
| `/lenses/gallery` | beta | `wos_lenses` |  | Gallery lens (V1-3) |
| `/lenses/feed` | beta | `wos_lenses` |  | Feed lens (V1-4) |
| `/lenses/dashboard` | beta | `wos_lenses` |  | Dashboard lens (V1-5) |
| `/lenses/find` | beta | `wos_lenses` |  | Find (M12) |
| `/lenses/embed` | beta | `wos_lenses` |  | Query block preview harness (M8e) |
| `/pages` | beta | `wos_pages` |  | Pages: sidebar tree, favourites, recent (M4a) |
| `/pages/[pageId]` | beta | `wos_pages` |  | One page in the block editor (M4b; editor also behind wos_editor) |
| `/objects/[id]` | beta | `wos_objects` |  | Any object with its Related panel (M3b) |
| `/collab/objects/[objectId]` | migration | `wos_editor` | `/objects/[id]` | Collaboration panels for one object (S3b); move onto the object page |
| `/collab/live/[objectId]` | migration | `wos_editor` | `/objects/[id]` | Presence, cursors and page lock (V1-17); move onto the object page |
| `/collab/versions/[objectId]` | migration | `wos_editor` | `/objects/[id]` | Autosave and version history (M16a); move onto the object page |
| `/collab/versions/[objectId]/compare` | migration | `wos_editor` | `/objects/[id]` | Compare and restore versions (M16b); move onto the object page |
| `/collab/trash` | beta | `wos_editor` |  | Trash with 30-day restore (M16a) |
| `/collab/layouts` | beta | `wos_editor` |  | Object page layouts per type (V2-4) |
| `/collab/layouts/[typeKey]` | beta | `wos_editor` |  | Edit one type's page layout (V2-4) |
| `/collab/layouts/[typeKey]/preview` | beta | `wos_editor` |  | Preview one type's page layout (V2-4) |
| `/dev/editor-spike` | deprecated |  | `/pages/[pageId]` | W0-5 and W0-6 editor spikes; 404 outside development; remove after wave 1 |
| `/capture` | beta | `wos_capture` |  | Capture inbox (M18) |
| `/following` | beta | `wos_objects` |  | Following and notification rules (V1-14) |
| `/offline` | beta | `wos_offline` |  | Offline queue status (V3-1) |
| `/inbox` | production |  |  | Communication: notification inbox |
| `/channels` | production |  |  | Channels |
| `/channels/[id]` | production |  |  | One channel |
| `/messages` | production |  |  | Direct messages |
| `/messages/[id]` | production |  |  | One conversation |
| `/saved` | production |  |  | Saved messages |
| `/announcements` | production |  |  | Announcements |
| `/requests` | production |  |  | Intake requests |
| `/approvals` | production |  |  | Approvals (#143) |
| `/object-approvals/[type]/[id]` | beta | `wos_object_approvals` |  | Approvals on any object (V2-7) |
| `/forms` | migration |  | `/forms-v2` | Forms list: the original builder, converted by V1-6 |
| `/forms/new` | migration |  | `/forms-v2/new` | New form in the original builder (V1-6) |
| `/forms/[id]` | migration |  | `/forms-v2/[id]` | Fill in a form in the original builder (V1-6) |
| `/forms/[id]/edit` | migration |  | `/forms-v2/[id]` | Edit a form in the original builder (V1-6) |
| `/forms/[id]/submissions` | migration |  | `/forms-v2/[id]/responses` | Submissions of one form (V1-6) |
| `/forms/submissions/[id]` | migration |  | `/forms-v2/[id]/responses` | One submission (V1-6) |
| `/forms-v2` | beta | `wos_forms_v2` |  | Forms for any type (V1-6) |
| `/forms-v2/new` | beta | `wos_forms_v2` |  | New form (V1-6) |
| `/forms-v2/[id]` | beta | `wos_forms_v2` |  | One form (V1-6) |
| `/forms-v2/[id]/responses` | beta | `wos_forms_v2` |  | Responses as objects (V1-6) |
| `/projects` | production |  |  | Projects |
| `/projects/[id]` | production |  |  | One project; the living project page (M19) lands here |
| `/programs` | production |  |  | Programs: the daily destination until spaces replace them (M10a) |
| `/programs/[id]` | production |  |  | One program |
| `/goals` | beta | `wos_goals` |  | Goals (V1-11) |
| `/goals/[id]` | beta | `wos_goals` |  | One goal (V1-11) |
| `/decisions/[id]` | beta | `wos_decisions_v2` |  | One decision with the full record (V1-10) |
| `/decisions/trail/[projectId]` | beta | `wos_decisions_v2` |  | Decision trail of a project (V1-10) |
| `/spaces` | beta | `wos_spaces` |  | Spaces (M10a) |
| `/spaces/[id]` | beta | `wos_spaces` |  | One space and its share menu (M10f) |
| `/spaces/roles` | admin | `wos_spaces` |  | Custom roles (M10d) |
| `/spaces/admin` | admin | `wos_spaces` |  | Admin controls: sign-in rules, audit export, role report (V2-9) |
| `/spaces/publish` | admin | `wos_public_pages` |  | Publish and unpublish public pages (V1-18) |
| `/p/[slug]` | beta | `wos_public_pages` |  | A public page, read from the published copy (V1-18) |
| `/calendar` | production |  |  | Unified calendar (CAL-001) |
| `/schedule` | production |  |  | Master schedule (P0-GNT-01) |
| `/meetings` | production |  |  | Meetings list |
| `/meetings/[id]` | migration |  | `/meetings-v2/[id]` | One meeting: replaced by meetings as objects (V1-9) |
| `/meetings-v2` | beta | `wos_meetings_v2` |  | Meetings v2 index (U12) |
| `/meetings-v2/[id]` | beta | `wos_meetings_v2` |  | Meeting as an object with semantic notes (V1-9) |
| `/meetings-v2/[id]/review` | beta | `wos_meetings_v2` |  | End-of-meeting review (V1-9) |
| `/events` | production |  |  | Events |
| `/events/[id]` | production |  |  | One event |
| `/documents` | production |  |  | Documents |
| `/documents/[id]` | production |  |  | One document |
| `/documents/templates` | production |  |  | Letter, contract and acknowledgement templates (#147) |
| `/templates-v2` | beta | `wos_objects` |  | Templates for objects, pages and spaces (V1-13) |
| `/templates-v2/new` | beta | `wos_objects` |  | New template (V1-13) |
| `/templates-v2/[id]` | beta | `wos_objects` |  | One template (V1-13) |
| `/signatures` | production |  |  | E-signature requests |
| `/signatures/[id]` | production |  |  | One signature request |
| `/people` | production |  |  | People directory |
| `/people/overview` | production |  |  | Team overview (#136) |
| `/people/[id]/work` | production |  |  | One person's work (#136) |
| `/crm` | production |  |  | Relationships (CRM) |
| `/crm/[id]` | production |  |  | One contact or organization |
| `/reports` | production |  |  | Reports |
| `/reports/[id]` | production |  |  | One report |
| `/insight/dashboards` | beta | `wos_lenses` |  | Dashboards per role (V2-5) |
| `/insight/operations` | beta | `wos_lenses` |  | Operations analytics (V3-5) |
| `/insight/process` | beta | `wos_lenses` |  | How work flows (V3-3) |
| `/insight/what-if` | beta | `wos_lenses` |  | What-if timeline (V3-4) |
| `/insight/graph` | beta | `wos_lenses` |  | Graph lens (V2-1) |
| `/insight/map` | beta | `wos_lenses` |  | Map lens (V2-1) |
| `/workflows` | beta | `wos_workflows_v2` |  | Workflows (M14c) |
| `/workflows/new` | beta | `wos_workflows_v2` |  | New workflow (M14c) |
| `/workflows/[id]` | beta | `wos_workflows_v2` |  | One workflow and its runs (M14c) |
| `/workflows/[id]/runs/[runId]` | beta | `wos_workflows_v2` |  | One run, step by step (V1-12) |
| `/workflows/reviews/[id]` | beta | `wos_workflows_v2` |  | A person's review asked for by a workflow (V1-12) |
| `/api-tokens` | beta | `wos_workflows_v2` |  | API access tokens (V2-8) |
| `/api-tokens/docs` | beta | `wos_workflows_v2` |  | Private API documentation (V2-8) |
| `/apps` | beta | `wos_objects` |  | App launcher (V2-3) |
| `/apps/[slug]` | beta | `wos_objects` |  | One app (V2-3) |
| `/apps/[slug]/[screen]` | beta | `wos_objects` |  | One app screen (V2-3) |
| `/apps/manage/[id]` | beta | `wos_objects` |  | Manage one app (V2-3) |
| `/builder` | beta | `wos_objects` |  | Blueprint designer (V2-2) |
| `/builder/[id]` | beta | `wos_objects` |  | One blueprint (V2-2) |
| `/upkeep` | beta | `wos_objects` |  | Workspace upkeep reports (V3-2) |
| `/google` | beta | `wos_objects` |  | Google objects: calendar, Drive, Gmail (V1-15) |
| `/google/search` | beta | `wos_objects` |  | Search across Google Drive and Gmail (V2-6) |
| `/m` | beta | `wos_mobile` |  | Phone home; redirects to /m/today (V1-16) |
| `/m/today` | beta | `wos_mobile` |  | Phone: today (V1-16) |
| `/m/tasks` | beta | `wos_mobile` |  | Phone: tasks (V1-16) |
| `/m/inbox` | beta | `wos_mobile` |  | Phone: inbox (V1-16) |
| `/m/capture` | beta | `wos_mobile` |  | Phone: capture (V1-16) |
| `/m/search` | beta | `wos_mobile` |  | Phone: search (V1-16) |
| `/m/approvals` | beta | `wos_mobile` |  | Phone: approvals (V1-16) |
| `/settings` | production |  |  | Settings: profile, language, two-step sign-in |
| `/settings/notifications` | production |  |  | Email and notification settings |
| `/admin` | admin |  |  | Admin home |
| `/admin/access` | admin |  |  | Admin: access and roles |
| `/admin/approvals` | admin |  |  | Admin: approval rules (#143) |
| `/admin/design-system` | admin |  |  | Admin: component gallery (UI-008) |
| `/admin/email` | admin |  |  | Admin: email delivery |
| `/admin/exports` | admin |  |  | Admin: exports |
| `/admin/jobs` | admin |  |  | Admin: background jobs |
| `/admin/records` | admin |  |  | Admin: records and legal holds (#146) |
| `/admin/retention` | admin |  |  | Admin: retention (#146) |
| `/admin/team-signals` | admin |  |  | Admin: team signals (#136) |
| `/admin/templates` | admin |  |  | Admin: project, agenda and record templates |
| `/finance/ledger` | production |  |  | Ledger home |
| `/finance/ledger/accountant` | production |  |  | Ledger: accountant view |
| `/finance/ledger/accounts` | production |  |  | Ledger: chart of accounts |
| `/finance/ledger/funds` | production |  |  | Ledger: funds |
| `/finance/ledger/funds/release` | production |  |  | Ledger: release restricted funds |
| `/finance/ledger/general-ledger` | production |  |  | Ledger: general ledger |
| `/finance/ledger/journal` | production |  |  | Ledger: journal entries |
| `/finance/ledger/journal/new` | production |  |  | Ledger: new journal entry |
| `/finance/ledger/journal/[id]` | production |  |  | Ledger: one journal entry |
| `/finance/ledger/periods` | production |  |  | Ledger: periods |
| `/finance/ledger/receipts` | production |  |  | Ledger: receipts |
| `/finance/ledger/returns` | production |  |  | Ledger: returns |
| `/finance/ledger/statements` | production |  |  | Ledger: statements |
| `/finance/ledger/trial-balance` | production |  |  | Ledger: trial balance |
| `/finance/ledger/year-end` | production |  |  | Ledger: year end |
| `/finance/budgets` | production |  |  | Budgets |
| `/finance/budgets/programs` | production |  |  | Budgets by program |
| `/finance/budgets/[id]` | production |  |  | One budget |
| `/finance/budgets/[id]/report` | production |  |  | Budget report |
| `/finance/sales-tax` | production |  |  | GST and QST |
| `/finance/sales-tax/lines` | production |  |  | GST and QST: lines |
| `/finance/sales-tax/worksheet` | production |  |  | GST and QST: worksheet |
| `/finance/bank` | production |  |  | Bank accounts |
| `/finance/bank/[id]` | production |  |  | One bank account |
| `/finance/bank/reconciliations/[id]` | production |  |  | One bank reconciliation |
| `/finance/receipts` | production |  |  | Receipts |
| `/finance/gifts` | production |  |  | Gifts and grants |
| `/finance/gifts/[id]` | production |  |  | One gift |
| `/finance/gifts/donors` | production |  |  | Donors |
| `/finance/gifts/grants` | production |  |  | Grants |
| `/finance/gifts/grants/[id]` | production |  |  | One grant |
| `/finance/gifts/statement` | production |  |  | Donor statement |
| `/finance/payables` | production |  |  | Bills and invoices |
| `/finance/payables/aging` | production |  |  | Payables aging |
| `/finance/payables/bills/new` | production |  |  | New bill |
| `/finance/payables/bills/[id]` | production |  |  | One bill |
| `/finance/payables/contacts` | production |  |  | Payables contacts |
| `/finance/payables/invoices` | production |  |  | Invoices |
| `/finance/payables/invoices/new` | production |  |  | New invoice |
| `/finance/payables/invoices/[id]` | production |  |  | One invoice |
| `/finance/payroll` | production |  |  | Payroll (#177) |
| `/finance/payroll/[id]` | production |  |  | One payroll run |

## Keeping it current

1. Add, move or remove the `page.tsx`.
2. Edit `src/config/route-map.ts` to match. `npm test -- route-map` fails
   until it does, naming the pattern that is missing or stale.
3. Regenerate the "Every route" table above from the data file (a short
   script over `ROUTE_MAP` is enough) and update the counts.
4. When a migration pair's menu entry switches to the new screen (plan
   section 9, step 4), keep the old entry as migration for one release, then
   delete the page and its entry together.
