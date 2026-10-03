# Feature test coverage

One row per folder in `src/features/` (72). Generated on 2026-10-03 from the code by a script, then checked by hand where a number looked wrong; the method is below so the numbers can be reproduced.

| Feature | Unit test files | Browser spec files | Database test files | Main path | Error cases | Permission checks | Examples | Notes |
|---|---:|---:|---:|:-:|:-:|:-:|---|---|
| admin | 5 | 22 | 64 | yes | yes | yes | `access-impact.test.ts`, `access-impact.spec.ts`, `activity-history.sql` |  |
| announcements | 0 | 7 | 22 | yes | yes | yes | `announcements.spec.ts`, `budgets.sql` | Admin gate, rate limit, scheduling: `src/features/announcements/tests/` (#363). |
| api-tokens | 2 | 3 | 84 | yes | yes | yes | `api-actions.test.ts`, `api-v1.spec.ts`, `activity-history.sql` |  |
| approvals | 1 | 6 | 9 | yes | yes | yes | `approvals.test.ts`, `approval-delegation.spec.ts`, `approval-delegation.sql` |  |
| apps | 2 | 2 | 1 | yes | yes | yes | `app-schema.test.ts`, `workspace-os-apps.spec.ts`, `workspace-os-apps.sql` |  |
| auth | 1 | 9 | 0 | yes | yes | yes | `mfa.test.ts`, `french-ui.spec.ts` |  |
| banking | 2 | 2 | 10 | yes | yes | yes | `parsers.test.ts`, `bank.spec.ts`, `bank-reconciliation.sql` |  |
| blueprints | 6 | 3 | 35 | yes | yes | yes | `i18n.test.ts`, `workspace-os-blueprint-starters.spec.ts`, `activity-history.sql` |  |
| budgets | 1 | 2 | 92 | yes | yes | yes | `budget.test.ts`, `budgets.spec.ts`, `activity-history.sql` |  |
| calendar | 3 | 6 | 2 | yes | yes | yes | `google-calendar-write.test.ts`, `lenses-calendar.spec.ts`, `drive-integration-access.sql` |  |
| capture | 1 | 2 | 86 | yes | yes | yes | `capture.test.ts`, `workspace-os-capture.spec.ts`, `activity-history.sql` |  |
| channels | 4 | 7 | 53 | yes | yes | yes | `history-paging.test.ts`, `announcements.spec.ts`, `apply-page-template.sql` |  |
| collab | 5 | 5 | 2 | yes | yes | yes | `presence.test.ts`, `object-layouts.spec.ts`, `object-presence-lock.sql` |  |
| commands | 1 | 2 | 98 | yes | yes | yes | `commands.test.ts`, `workspace-os-commands.spec.ts`, `activity-history.sql` |  |
| comments | 2 | 23 | 32 | yes | yes | yes | `comment-links.test.ts`, `access-impact.spec.ts`, `apply-page-template.sql` |  |
| crm | 4 | 7 | 8 | yes | yes | yes | `labels.test.ts`, `access-impact.spec.ts`, `crm-continuity.sql` |  |
| dashboard | 3 | 16 | 116 | yes | yes | yes | `portfolio.test.ts`, `access-impact.spec.ts`, `activity-history.sql` |  |
| decisions | 1 | 1 | 80 | yes | yes | yes | `decisions-v2.test.ts`, `decisions-v2.spec.ts`, `activity-history.sql` |  |
| documents | 9 | 7 | 36 | yes | yes | yes | `clamav.test.ts`, `document-search.spec.ts`, `apply-page-template.sql` |  |
| editor | 26 | 29 | 128 | yes | yes | yes | `c1-presence.test.ts`, `activity-history.spec.ts`, `activity-history.sql` |  |
| events | 0 | 4 | 26 | yes | yes | yes | `event.commands.test.ts`, `events.spec.ts`, `activity-history.sql` | Reader-versus-manager refusals: `src/features/events/tests/event.commands.test.ts` (#362). |
| exports | 2 | 1 | 113 | yes | yes | yes | `export-builders.test.ts`, `translated-workspace.spec.ts`, `activity-history.sql` |  |
| finance | 2 | 10 | 7 | yes | yes | yes | `money.test.ts`, `bank.spec.ts`, `document-search-templates.sql` |  |
| following | 2 | 2 | 78 | yes | yes | yes | `rules.test.ts`, `following.spec.ts`, `activity-history.sql` |  |
| forms | 1 | 5 | 3 | yes | yes | yes | `form-fields.test.ts`, `forms-esign.spec.ts`, `forms-esign.sql` |  |
| forms-v2 | 1 | 3 | 30 | yes | yes | yes | `properties.test.ts`, `forms-v2-conditional.spec.ts`, `apply-page-template.sql` |  |
| gifts | 3 | 2 | 78 | yes | yes | yes | `acknowledgement.test.ts`, `gifts.spec.ts`, `activity-history.sql` |  |
| goals | 1 | 2 | 84 | yes | yes | yes | `goals.test.ts`, `goals.spec.ts`, `activity-history.sql` |  |
| google-objects | 2 | 2 | 82 | yes | yes | yes | `drive.test.ts`, `connected-search.spec.ts`, `activity-history.sql` |  |
| home | 3 | 6 | 97 | yes | yes | yes | `attention.test.ts`, `navigation-v2.spec.ts`, `activity-history.sql` |  |
| inbox | 2 | 7 | 2 | yes | yes | yes | `gmail-ingest.test.ts`, `french-ui.spec.ts`, `drive-integration-access.sql` |  |
| insight | 7 | 7 | 111 | yes | yes | yes | `dashboards.test.ts`, `insight-dashboards.spec.ts`, `activity-history.sql` |  |
| jobs | 26 | 5 | 113 | yes | yes | yes | `decisions-v2.test.ts`, `announcements.spec.ts`, `activity-history.sql` |  |
| ledger | 7 | 10 | 100 | yes | yes | yes | `approval-chain.test.ts`, `bank.spec.ts`, `activity-history.sql` |  |
| lenses | 24 | 17 | 124 | yes | yes | yes | `semantic.test.ts`, `lens-csv.spec.ts`, `activity-history.sql` |  |
| lenses-graph | 1 | 2 | 99 | yes | yes | yes | `graph.test.ts`, `insight-graph.spec.ts`, `activity-history.sql` |  |
| lenses-map | 1 | 2 | 25 | yes | yes | yes | `map.test.ts`, `insight-map.spec.ts`, `activity-history.sql` |  |
| meetings | 3 | 7 | 33 | yes | yes | yes | `meeting-summary.test.ts`, `collaboration.spec.ts`, `apply-page-template.sql` |  |
| meetings-v2 | 2 | 3 | 98 | yes | yes | yes | `meeting-v2.commands.test.ts`, `meetings-v2.spec.ts`, `activity-history.sql` |  |
| mobile | 2 | 3 | 94 | yes | yes | yes | `touch.test.ts`, `editor-mobile.spec.ts`, `activity-history.sql` |  |
| notifications | 8 | 16 | 4 | yes | yes | yes | `email-templates-locale.test.ts`, `access-impact.spec.ts`, `concurrency.sql` |  |
| object-approvals | 2 | 1 | 1 | yes | yes | yes | `object-approval.commands.test.ts`, `object-approvals.spec.ts`, `wos-object-approvals.sql` |  |
| object-comments | 3 | 30 | 101 | yes | yes | yes | `mentions.test.ts`, `activity-history.spec.ts`, `activity-history.sql` |  |
| object-layouts | 2 | 3 | 104 | yes | yes | yes | `layout.test.ts`, `object-layouts.spec.ts`, `activity-history.sql` |  |
| objects | 15 | 6 | 115 | yes | yes | yes | `lens.actions.test.ts`, `activity-history.spec.ts`, `activity-history.sql` |  |
| offline | 2 | 2 | 78 | yes | yes | yes | `op-log.test.ts`, `offline.spec.ts`, `activity-history.sql` |  |
| onboarding | 0 | 11 | 0 | yes | yes | yes | `french-ui.spec.ts` | Unit tests added in #363. |
| outcomes | 3 | 5 | 5 | yes | yes | yes | `outcomes.test.ts`, `hello-hub.spec.ts`, `insight-operations.sql` |  |
| pages | 7 | 32 | 68 | yes | yes | yes | `page-categories.test.ts`, `activity-history.spec.ts`, `activity-history.sql` |  |
| payables | 1 | 3 | 74 | yes | yes | yes | `model.test.ts`, `approvals.spec.ts`, `activity-history.sql` |  |
| payroll | 1 | 2 | 73 | yes | yes | yes | `parsers.test.ts`, `payroll.spec.ts`, `activity-history.sql` |  |
| people | 4 | 5 | 1 | yes | yes | yes | `person-work.test.ts`, `person-work.spec.ts`, `team-signals.sql` |  |
| preferences | 0 | 9 | 0 | yes | yes | yes | `french-ui.spec.ts` | Unit tests added in #363. |
| programs | 2 | 5 | 67 | yes | yes | yes | `colors.test.ts`, `hello-hub.spec.ts`, `activity-history.sql` |  |
| project-page | 1 | 2 | 90 | yes | yes | yes | `project-page.test.ts`, `workspace-os-project-page.spec.ts`, `activity-history.sql` |  |
| projects | 6 | 16 | 106 | yes | yes | yes | `i18n.test.ts`, `access-impact.spec.ts`, `activity-history.sql` |  |
| public-pages | 1 | 6 | 79 | yes | yes | yes | `publication.test.ts`, `wos-admin-controls.spec.ts`, `activity-history.sql` |  |
| record-retention | 4 | 4 | 29 | yes | yes | yes | `job-language.test.ts`, `qa-matrix.spec.ts`, `apply-page-template.sql` |  |
| reports | 4 | 7 | 110 | yes | yes | yes | `pdf.test.ts`, `access-impact.spec.ts`, `activity-history.sql` |  |
| requests | 2 | 2 | 2 | yes | yes | yes | `intake.test.ts`, `projects.spec.ts`, `project-lifecycle.sql` |  |
| retention | 2 | 1 | 2 | yes | yes | yes | `job-language.test.ts`, `translated-workspace.spec.ts`, `person-work-summary.sql` |  |
| risks | 3 | 15 | 23 | yes | yes | yes | `i18n.test.ts`, `access-impact.spec.ts`, `approval-delegation.sql` |  |
| sales-tax | 1 | 3 | 1 | yes | yes | yes | `return-lines.test.ts`, `ledger.spec.ts`, `sales-tax.sql` |  |
| search | 1 | 3 | 0 | yes | yes | yes | `search-result-types.test.ts`, `portfolio-search.spec.ts` | Permission filtering of results is tested in `supabase/tests/lens-find.sql` (31 checks: private pages, volunteers, signed-out callers), under the lenses feature. |
| sharing | 3 | 6 | 99 | yes | yes | yes | `i18n.test.ts`, `wos-admin-controls.spec.ts`, `activity-history.sql` |  |
| spaces | 6 | 6 | 11 | yes | yes | yes | `publication.test.ts`, `wos-admin-controls.spec.ts`, `activity-history.sql` |  |
| tasks | 13 | 47 | 105 | yes | yes | yes | `commands.test.ts`, `access-impact.spec.ts`, `activity-history.sql` |  |
| templates-v2 | 4 | 4 | 84 | yes | yes | yes | `template-hub.test.ts`, `page-templates.spec.ts`, `activity-history.sql` |  |
| universal-tasks | 7 | 0 | 90 | yes | yes | yes | `capture.test.ts`, `activity-history.sql` |  |
| upkeep | 1 | 3 | 28 | yes | yes | yes | `report.test.ts`, `staff-screens.spec.ts`, `apply-page-template.sql` |  |
| versions | 4 | 6 | 81 | yes | yes | yes | `autosave.test.ts`, `object-presence-lock.spec.ts`, `activity-history.sql` |  |
| workflows | 8 | 2 | 83 | yes | yes | yes | `actions.test.ts`, `workflows-pickers.spec.ts`, `activity-history.sql` |  |

## How the columns are worked out

- **Unit test files**: `*.test.ts(x)` inside the feature folder, or anywhere that imports `@/features/<feature>/`.
- **Browser spec files**: Playwright specs in `tests/e2e/` that visit a route whose page or API route imports the feature.
- **Database test files**: `supabase/tests/*.sql` that name a table or function the feature reads or writes (`.from("…")`, `.rpc("…")`), leaving out tables every test touches (user profiles, memberships, organizations, activity, audit, notifications).
- **Main path**: at least one unit or browser test exists for the feature.
- **Error cases**: one of those tests checks a refusal, invalid input or failure (it matches words such as "refuse", "invalid", "fail", "cannot", "missing", "required").
- **Permission checks**: a unit or browser test checks a denial (role, volunteer, other organization, MFA, "not allowed", 42501), or a database test asserts a refusal (`throws_ok`, `is_empty`, 42501).

## Limits of this table

- It shows that tests of each kind exist, not that every rule in a feature is tested. A "yes" can rest on a single test.
- Matching is by imports, routes and table names, so a test can be counted for more than one feature, and a feature tested under another name can be undercounted (search is the known case; see its note).
- The review of saves that did not check whether a row changed is in [save-action-review.md](save-action-review.md).
