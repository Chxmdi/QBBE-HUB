# Feature test coverage

One row per folder in `src/features/` (72), generated on 2026-10-03 from the code by a script and checked by hand where a number looked wrong. The method is below so the numbers can be reproduced.

Every feature has at least one unit or browser test of its main path, error cases in at least 2 test files, and permission checks in at least 3.

| Feature | Unit test files | Browser spec files | Database test files | Files testing error cases | Files testing permissions | Examples | Notes |
|---|---:|---:|---:|---:|---:|---|---|
| admin | 8 | 22 | 64 | 24 | 87 | `access-impact.test.ts`, `access-impact.spec.ts`, `activity-history.sql` |  |
| announcements | 1 | 7 | 22 | 8 | 28 | `announcement.commands.test.ts`, `announcements.spec.ts`, `budgets.sql` |  |
| api-tokens | 2 | 3 | 84 | 4 | 86 | `api-actions.test.ts`, `api-v1.spec.ts`, `activity-history.sql` |  |
| approvals | 1 | 6 | 9 | 7 | 15 | `approvals.test.ts`, `approval-delegation.spec.ts`, `approval-delegation.sql` |  |
| apps | 2 | 2 | 1 | 4 | 3 | `app-schema.test.ts`, `workspace-os-apps.spec.ts`, `workspace-os-apps.sql` |  |
| auth | 1 | 9 | 0 | 10 | 10 | `mfa.test.ts`, `french-ui.spec.ts` |  |
| banking | 2 | 2 | 10 | 3 | 12 | `parsers.test.ts`, `bank.spec.ts`, `bank-reconciliation.sql` |  |
| blueprints | 6 | 3 | 35 | 7 | 39 | `i18n.test.ts`, `workspace-os-blueprint-starters.spec.ts`, `activity-history.sql` |  |
| budgets | 2 | 2 | 92 | 2 | 92 | `budget.commands.test.ts`, `budgets.spec.ts`, `activity-history.sql` | Action rules (admin, rate limit, amounts per month, database messages): `src/features/budgets/tests/budget.commands.test.ts`. |
| calendar | 5 | 6 | 2 | 9 | 9 | `google-calendar-write.test.ts`, `lenses-calendar.spec.ts`, `drive-integration-access.sql` |  |
| capture | 1 | 2 | 86 | 2 | 84 | `capture.test.ts`, `workspace-os-capture.spec.ts`, `activity-history.sql` |  |
| channels | 6 | 7 | 53 | 11 | 62 | `announcement.commands.test.ts`, `announcements.spec.ts`, `apply-page-template.sql` |  |
| collab | 5 | 5 | 2 | 5 | 7 | `presence.test.ts`, `object-layouts.spec.ts`, `object-presence-lock.sql` |  |
| commands | 1 | 2 | 98 | 3 | 97 | `commands.test.ts`, `workspace-os-commands.spec.ts`, `activity-history.sql` |  |
| comments | 2 | 23 | 32 | 19 | 56 | `comment-links.test.ts`, `access-impact.spec.ts`, `apply-page-template.sql` |  |
| crm | 5 | 7 | 8 | 12 | 18 | `labels.test.ts`, `access-impact.spec.ts`, `crm-continuity.sql` |  |
| dashboard | 3 | 16 | 116 | 16 | 129 | `portfolio.test.ts`, `access-impact.spec.ts`, `activity-history.sql` |  |
| decisions | 1 | 1 | 80 | 2 | 78 | `decisions-v2.test.ts`, `decisions-v2.spec.ts`, `activity-history.sql` |  |
| documents | 9 | 7 | 36 | 15 | 43 | `clamav.test.ts`, `document-search.spec.ts`, `apply-page-template.sql` |  |
| editor | 26 | 29 | 128 | 41 | 161 | `c1-presence.test.ts`, `activity-history.spec.ts`, `activity-history.sql` |  |
| events | 1 | 4 | 26 | 5 | 30 | `event.commands.test.ts`, `events.spec.ts`, `activity-history.sql` | Reader-versus-manager refusals: `src/features/events/tests/event.commands.test.ts`. |
| exports | 2 | 1 | 113 | 3 | 113 | `export-builders.test.ts`, `translated-workspace.spec.ts`, `activity-history.sql` |  |
| finance | 2 | 10 | 7 | 11 | 17 | `money.test.ts`, `bank.spec.ts`, `document-search-templates.sql` |  |
| following | 2 | 2 | 78 | 3 | 80 | `rules.test.ts`, `following.spec.ts`, `activity-history.sql` |  |
| forms | 1 | 5 | 3 | 6 | 8 | `form-fields.test.ts`, `forms-esign.spec.ts`, `forms-esign.sql` |  |
| forms-v2 | 1 | 3 | 30 | 4 | 32 | `properties.test.ts`, `forms-v2-conditional.spec.ts`, `apply-page-template.sql` |  |
| gifts | 4 | 2 | 78 | 4 | 78 | `acknowledgement.test.ts`, `gifts.spec.ts`, `activity-history.sql` |  |
| goals | 1 | 2 | 84 | 2 | 83 | `goals.test.ts`, `goals.spec.ts`, `activity-history.sql` |  |
| google-objects | 2 | 2 | 82 | 3 | 81 | `drive.test.ts`, `connected-search.spec.ts`, `activity-history.sql` |  |
| home | 3 | 6 | 97 | 4 | 102 | `attention.test.ts`, `navigation-v2.spec.ts`, `activity-history.sql` |  |
| inbox | 3 | 7 | 2 | 8 | 9 | `gmail-ingest.test.ts`, `french-ui.spec.ts`, `drive-integration-access.sql` |  |
| insight | 7 | 7 | 111 | 9 | 117 | `dashboards.test.ts`, `insight-dashboards.spec.ts`, `activity-history.sql` |  |
| jobs | 30 | 5 | 113 | 29 | 123 | `announcement.commands.test.ts`, `announcements.spec.ts`, `activity-history.sql` |  |
| ledger | 7 | 10 | 100 | 11 | 107 | `approval-chain.test.ts`, `bank.spec.ts`, `activity-history.sql` |  |
| lenses | 24 | 17 | 124 | 30 | 149 | `semantic.test.ts`, `lens-csv.spec.ts`, `activity-history.sql` |  |
| lenses-graph | 1 | 2 | 99 | 3 | 99 | `graph.test.ts`, `insight-graph.spec.ts`, `activity-history.sql` |  |
| lenses-map | 1 | 2 | 25 | 2 | 27 | `map.test.ts`, `insight-map.spec.ts`, `activity-history.sql` |  |
| meetings | 4 | 7 | 33 | 7 | 42 | `meeting-schedule.commands.test.ts`, `collaboration.spec.ts`, `apply-page-template.sql` |  |
| meetings-v2 | 2 | 3 | 98 | 2 | 99 | `meeting-v2.commands.test.ts`, `meetings-v2.spec.ts`, `activity-history.sql` |  |
| mobile | 2 | 3 | 94 | 4 | 94 | `touch.test.ts`, `editor-mobile.spec.ts`, `activity-history.sql` |  |
| notifications | 8 | 16 | 4 | 19 | 21 | `email-templates-locale.test.ts`, `access-impact.spec.ts`, `concurrency.sql` |  |
| object-approvals | 2 | 1 | 1 | 3 | 3 | `object-approval.commands.test.ts`, `object-approvals.spec.ts`, `wos-object-approvals.sql` |  |
| object-comments | 3 | 30 | 101 | 26 | 128 | `mentions.test.ts`, `activity-history.spec.ts`, `activity-history.sql` |  |
| object-layouts | 2 | 3 | 104 | 2 | 105 | `layout.test.ts`, `object-layouts.spec.ts`, `activity-history.sql` |  |
| objects | 15 | 6 | 115 | 19 | 125 | `lens.actions.test.ts`, `activity-history.spec.ts`, `activity-history.sql` |  |
| offline | 2 | 2 | 78 | 3 | 79 | `op-log.test.ts`, `offline.spec.ts`, `activity-history.sql` |  |
| onboarding | 1 | 11 | 0 | 12 | 12 | `onboarding.commands.test.ts`, `french-ui.spec.ts` |  |
| outcomes | 3 | 5 | 5 | 7 | 13 | `outcomes.test.ts`, `hello-hub.spec.ts`, `insight-operations.sql` |  |
| pages | 7 | 32 | 68 | 32 | 103 | `page-categories.test.ts`, `activity-history.spec.ts`, `activity-history.sql` |  |
| payables | 1 | 3 | 74 | 3 | 74 | `model.test.ts`, `approvals.spec.ts`, `activity-history.sql` |  |
| payroll | 1 | 2 | 73 | 2 | 72 | `parsers.test.ts`, `payroll.spec.ts`, `activity-history.sql` |  |
| people | 4 | 5 | 1 | 5 | 10 | `person-work.test.ts`, `person-work.spec.ts`, `team-signals.sql` |  |
| preferences | 1 | 9 | 0 | 10 | 9 | `locale.commands.test.ts`, `french-ui.spec.ts` |  |
| programs | 3 | 5 | 67 | 5 | 70 | `colors.test.ts`, `hello-hub.spec.ts`, `activity-history.sql` |  |
| project-page | 1 | 2 | 90 | 2 | 90 | `project-page.test.ts`, `workspace-os-project-page.spec.ts`, `activity-history.sql` |  |
| projects | 7 | 16 | 106 | 19 | 122 | `i18n.test.ts`, `access-impact.spec.ts`, `activity-history.sql` |  |
| public-pages | 1 | 6 | 79 | 5 | 82 | `publication.test.ts`, `wos-admin-controls.spec.ts`, `activity-history.sql` |  |
| record-retention | 4 | 4 | 29 | 7 | 33 | `job-language.test.ts`, `qa-matrix.spec.ts`, `apply-page-template.sql` |  |
| reports | 4 | 7 | 110 | 9 | 115 | `pdf.test.ts`, `access-impact.spec.ts`, `activity-history.sql` |  |
| requests | 2 | 2 | 2 | 4 | 5 | `intake.test.ts`, `projects.spec.ts`, `project-lifecycle.sql` |  |
| retention | 2 | 1 | 2 | 3 | 3 | `job-language.test.ts`, `translated-workspace.spec.ts`, `person-work-summary.sql` |  |
| risks | 4 | 15 | 23 | 17 | 41 | `i18n.test.ts`, `access-impact.spec.ts`, `approval-delegation.sql` |  |
| sales-tax | 1 | 3 | 1 | 4 | 5 | `return-lines.test.ts`, `ledger.spec.ts`, `sales-tax.sql` |  |
| search | 1 | 3 | 0 | 4 | 3 | `search-result-types.test.ts`, `portfolio-search.spec.ts` | Result filtering by permission is tested in `supabase/tests/lens-find.sql` (31 checks), under the lenses feature. |
| sharing | 3 | 6 | 99 | 7 | 103 | `i18n.test.ts`, `wos-admin-controls.spec.ts`, `activity-history.sql` |  |
| spaces | 6 | 6 | 11 | 6 | 20 | `publication.test.ts`, `wos-admin-controls.spec.ts`, `activity-history.sql` |  |
| tasks | 14 | 47 | 105 | 47 | 154 | `commands.test.ts`, `access-impact.spec.ts`, `activity-history.sql` |  |
| templates-v2 | 4 | 4 | 84 | 8 | 86 | `template-hub.test.ts`, `page-templates.spec.ts`, `activity-history.sql` |  |
| universal-tasks | 7 | 0 | 90 | 4 | 90 | `capture.test.ts`, `activity-history.sql` |  |
| upkeep | 1 | 3 | 28 | 3 | 31 | `report.test.ts`, `staff-screens.spec.ts`, `apply-page-template.sql` |  |
| versions | 4 | 6 | 81 | 6 | 86 | `autosave.test.ts`, `object-presence-lock.spec.ts`, `activity-history.sql` |  |
| workflows | 9 | 2 | 83 | 11 | 91 | `actions.test.ts`, `workflows-pickers.spec.ts`, `activity-history.sql` |  |

## How the columns are worked out

- **Unit test files**: `*.test.ts(x)` inside the feature folder, or anywhere that imports `@/features/<feature>/`.
- **Browser spec files**: Playwright specs in `tests/e2e/` that visit a route whose page or API route imports the feature.
- **Database test files**: `supabase/tests/*.sql` that name a table or function the feature reads or writes, leaving out tables every test touches (user profiles, memberships, organizations, activity, audit, notifications).
- **Files testing error cases**: unit or browser test files above that check a refusal, invalid input or failure.
- **Files testing permissions**: unit or browser test files above that check a denial (role, volunteer, other organization, MFA, "not allowed", 42501), plus database test files above that assert a refusal (`throws_ok`, `is_empty`, 42501).

## What this does and does not show

- It counts test files, not rules. Two files testing errors means two files exercise an error path, not that every rule of the feature is tested.
- Matching is by imports, routes and table names. A shared table (tasks, projects) counts its database tests toward every feature that uses it, so the database and permission columns are generous for features built on shared tables.
- The review of every save that did not check whether a row changed, with a test behind each verdict, is in [save-action-review.md](save-action-review.md).
