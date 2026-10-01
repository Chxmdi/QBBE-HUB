# Demo dataset: what every chapter can rely on

The recordings run against the QA seed (`npm run db:seed`) plus the files in `scripts/demo/dataset/`, applied in name order by `node scripts/demo/dataset.mjs`. The organization stays the Quebec Board of Black Educators (the videos are for its members); everything else on screen is fictional.

## People (the QA accounts, renamed)

| Account | Signs in as | Name on screen | Role | Title |
|---|---|---|---|---|
| owner | qa-owner@example.com | Danielle Pierre | owner | Executive Director |
| admin | qa-admin@example.com | Marc-André Joseph | admin | Operations Manager |
| staff | qa-staff@example.com | Keisha Bernard | staff | Program Coordinator |
| lead | qa-lead@example.com | Jean-Philippe Étienne | staff | Program Lead, Youth |
| pm | qa-pm@example.com | Amara Diallo | staff | Project Manager |
| volunteer | qa-volunteer@example.com | Samuel Okafor | volunteer | Volunteer tutor |
| contributor | qa-contributor@example.com | Rosalie Charles | volunteer | Volunteer, events |
| readonly | qa-readonly@example.com | Nadège Toussaint | volunteer | Board observer |
| guest | qa-guest@example.com | Omar Benali | guest | Partner, Centre Afrika |

Password for all: `QaTest!2026`. Chapters sign in with the account their audience uses: `staff` for most, `owner` or `admin` for administration and money, `volunteer` for the volunteer's view.

## Content, by file

Each area's build session owns one file and the chapters that use it. Use fixed UUIDs in the form `dd<area>0000-0000-4000-8000-0000000000nn` so files never collide, and make every statement idempotent (`on conflict (id) do nothing`, or `insert … select … where not exists`).

| File | Owner | Must contain |
|---|---|---|
| `00-people.sql` | lead session | The names and titles above |
| `10-work.sql` | core session | 3 programs (Youth Tutoring, Black History Month, Scholarship Fund), 6 projects at different stages and health, about 40 tasks spread over the people (some overdue, some due this week, some done), milestones, 2 status updates, labels |
| `20-collab.sql` | core session | 4 channels (#general, #youth-tutoring, #events, #board) with 10 to 20 messages each over the last month, 2 direct conversations, 3 announcements (one needing acknowledgement), 4 meetings (2 past with notes, agendas and decisions; 2 coming), 5 calendar events |
| `25-documents.sql` | core session | Folders (Governance, HR, Programs, Finance, Templates), 12 documents with scan status `clean`, 2 templates, 1 form definition with 3 submissions, 1 signing document |
| `30-money.sql` | money session | Chart of accounts approved, fiscal year 2026 open, 3 funds, 40 journal entries over the year, 8 receipts (3 pending review), 6 bills (2 awaiting approval), 3 invoices, a bank account with an import of 25 transactions half reconciled, a budget with lines for each program, GST/QST settings and one period, a payroll run, a year-end not yet closed |
| `35-relationships.sql` | money session | 12 contacts, 6 organizations (funders, schools, partners), interactions and follow-ups, 10 gifts (two with acknowledgements), 2 grants with reports |
| `40-admin.sql` | money session | 2 pending invitations, 1 approval rule, 1 workflow rule with 2 executions, 1 API token (hash only), retention rule, a legal hold |
| `50-workspace-os.sql` | workspace OS session | 8 pages in a tree (with block content), 1 custom space shared with staff, 3 saved lenses, 2 goals with metrics, 1 published page, 1 app, 1 blueprint, 2 templates v2, 5 capture items |

Dates are relative to `now()` so the screens look current whenever the set is re-rendered. Amounts are in Canadian dollars with GST and QST where they apply. Names and text are bilingual where the schema has both columns, French otherwise matching the English.
