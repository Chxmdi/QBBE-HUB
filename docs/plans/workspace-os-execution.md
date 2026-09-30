# Workspace OS: fastest build order and checklist

Written 2026-09-30. How to deliver [workspace-os-plan.md](workspace-os-plan.md)
as quickly as possible without lowering the quality bar. The item IDs
(M1, V1-5 and so on) are the same as in that plan.

## 1. What decides the speed

Writing the code is not the slow part: several build sessions can write in
parallel. The calendar time is set by five things, and this plan attacks
each one:

| Bottleneck | Today | Fix |
|---|---|---|
| **Test run per change** | About 40 minutes, in one "Database security" job that runs 57 browser test files one after another | Split it across 4 parallel machines (W0-1): about 12 minutes |
| **Work waiting on other work** | Everything needs the object registry and the access check first | Agree the interfaces in week 1 (W0-3) so every track can build against them straight away |
| **Two changes editing the same file** | Translation files, the menu, and database-change file names are shared | Each work stream owns its own folders, translation files and a range of database-change timestamps (section 3) |
| **Big changes waiting for review** | Changes of 2,000+ lines | Small changes merged daily behind feature switches, turned on only when finished |
| **Waiting on QBBE** | Decisions, staging checks, French review | Batched: one short sign-off at the end of each wave (section 6) |

## 2. Streams (parallel build sessions)

Six streams, each a separate build session with its own branch. I review
and merge; build sessions never merge their own work. Each stream owns its
folders so streams rarely touch the same files.

| Stream | Owns | Folders | Database-change timestamps |
|---|---|---|---|
| **S1 Core** | Object registry, types, properties, relations, events, actions and undo | `src/features/objects/`, `src/lib/objects/` | `2026110100xxxx` |
| **S2 Access** | Spaces, permissions, `app.can`, sharing, custom roles, public pages | `src/features/spaces/`, `src/features/sharing/` | `2026110200xxxx` |
| **S3 Editor** | Pages, block editor, semantic blocks, co-editing, versions | `src/features/pages/`, `src/features/editor/` | `2026110300xxxx` |
| **S4 Lenses** | Query engine; table, board, list, calendar, timeline, gallery, feed, dashboard, graph and map views | `src/features/lenses/`, `src/lib/query/` | `2026110400xxxx` |
| **S5 Work** | Universal tasks, projects, meetings, decisions, goals, Home, attention, capture, commands | the existing feature folders, plus `src/features/home/` | `2026110500xxxx` |
| **S6 Flow** | Workflows, forms, templates, notifications, integrations, API, offline, analytics | `src/features/workflows/`, `src/features/forms/` | `2026110600xxxx` |

**Shared files** (the main menu, the feature-switch list, the shared
translation file) change only through S1. Other streams add their own
translation files, and those are merged in automatically.

## 3. Working rules

These keep speed up without adding bugs.

1. **Small changes.** Under about 800 changed lines. Each stream merges at least daily.
2. **Merge unfinished work behind switches.** Each module has a switch in the `feature_flag` table, off in production until its wave's sign-off, on in local test setups and on staging.
3. **Agree interfaces first.** Every type, SQL function and server call that more than one stream uses is agreed in the W0-3 change before anyone builds on it. Changing one afterwards needs a note in that change.
4. **Definition of done for every item:**
   - security-rule (RLS) tests for every role;
   - unit tests;
   - a browser test of the main path;
   - accessibility scan clean;
   - English and French text;
   - within the performance budget;
   - merged into `main` with all checks green;
   - deployed to staging.
5. **I check before merging:**
   - checks green on the change combined with the latest `main`;
   - a read-through of the database changes and security rules;
   - no shared file touched outside S1.
6. **Staging deploy at the end of every week**, so problems show up within days, not months.
7. **Never:** skip or weaken a test, merge a red change, or change production data by hand.

## 4. Critical path

The longest chain of work that has to happen in order:

W0 (1 wk) → M1 registry (1 wk) → M10 access check (1.5 wk) → M8 lenses on the check (1 wk) → M17 Home (1 wk) → MVP sign-off

Everything else runs beside this chain. Streams that need the registry or
access check before they're finished use the W0-3 stand-ins: they return
today's results through the new interface, and are swapped for the real
thing when M1 and M10 merge.

## 5. Waves and checklist

Times assume six parallel streams and a roughly 12-minute test run (after
W0-1). They are estimates. Section 7 lists what would make them slip.

### Wave 0: set up for speed (week 1)

- [ ] **W0-1 Split the test run (S1).**
  - The "Database security" job splits into 4 parallel parts, divided by test file, each with its own local database.
  - A final job named "Database security" collects the results, so the branch-protection rule still matches.
  - Target: the full check in under 15 minutes.
- [ ] **W0-2 Build caching (S1).** Keep the Next.js build output and the Playwright browsers between runs. Target: 3 minutes saved per run.
- [ ] **W0-3 Interface-agreement change (S1 + S2 + S4).**
  - Signatures and stand-ins for the object registry, `app.can`, the query-spec format, the action registry and event writing.
  - TypeScript types in `src/lib/objects/contracts.ts`.
- [ ] **W0-4 Feature switches (S1):** one switch per module, readable on the server, with a staging override.
- [x] **W0-5 Spike: editor accessibility (S3)**, same as P0-1. Go/no-go in 3 days.
  - **Go** (BlockNote). The screen-reader check passed.
- [x] **W0-6 Spike: co-editing (S3)**, same as P0-2.
  - **Go** (Yjs over Supabase Realtime). No fallback server is needed.
- [ ] **W0-7 Spike: access check speed (S2)**, same as P0-3.
- [ ] **W0-8 Spike: query engine (S4)**, same as P0-4.
- [ ] **W0-9 Design note merged**, same as P0-5: tables, migration order and each stream's timestamp range.

**Gate W0:** all four spikes pass or have a chosen fallback, and the test
run is under 15 minutes.

### Wave 1: core layer (weeks 2–5)

**S1 Core**
- [ ] **M1a** `object` and `object_type` tables, with RLS through the `app.can` stand-in.
- [ ] **M1b** Triggers and backfill for tasks and projects, with a test that counts match.
- [ ] **M1c** Triggers and backfill for meetings, decisions, risks, `outcome_metric`, people, teams, events, contacts and documents.
- [ ] **M2a** Property definitions; native columns shown as system properties.
- [ ] **M2b** Custom property values (typed table and indexes).
- [ ] **M3a** Relation types and `object_relation`; existing links shown as relations.
- [ ] **M9a** `object_event` written by triggers for every native type.
- [ ] **M9b** The activity feed, audit log and notifications read `object_event`, with a comparison test against the old output.

**S2 Access**
- [ ] **M10a** Spaces: programs become spaces; Workspace and Private spaces.
- [ ] **M10b** Capabilities, grants and inheritance tables.
- [ ] **M10c** The real `app.can` with cached results, plus the **equivalence test across every role and record**. Replaces the stand-in.
- [ ] **M10d** Custom roles.
- [ ] **M10e** Per-property privacy in RLS and the query engine.

**S3 Editor**
- [ ] **M4a** Page type, sidebar tree, favourites, recent.
- [ ] **M4b** Block editor with standard blocks, Markdown shortcuts, drag handles and pasting.
- [ ] **M4c** Saving the live document and deriving `block` rows from it.
- [ ] **M4d** Task descriptions converted to the editor.
- [ ] **M16a** Autosave, version snapshots, trash.

**S4 Lenses**
- [ ] **M8a** Query spec to SQL on the server, run under the viewer's own permissions; a test for each filter type.
- [ ] **M8b** Table view: edit in place, fully usable by keyboard.
- [ ] **M8c** Board and list views on the engine; the existing `/board` and `/my-work` switched over behind a switch.
- [ ] **M8d** `saved_view` converted to lenses.

**S5 Work**
- [ ] **M7a** One shared "create task" action, and every existing place that creates tasks moved onto it.
- [ ] **M7b** Each task records where it came from, with a link back.
- [ ] **M19a** Health and progress calculated for projects.

**S6 Flow**
- [ ] **M14a** `workflow_rule` extended to trigger, condition and action, with steps recorded per run.
- [ ] **M14b** Trigger on any `object_event`; action from the action registry (stand-in until M13).

**Gate W1:** tasks and projects are objects; the access check is proven
equivalent; the table view works on staging; the editor works for pages.

### Wave 2: MVP complete (weeks 6–9)

- [ ] **S1 M13** Action registry, change sets and undo; bulk edit.
- [ ] **S1 M3b** "Related" panel on every object.
- [ ] **S2 M10f** Share menu; inheritance shown in the interface ("inherited from Space X").
- [ ] **S3 M5** Semantic blocks: task, decision, person, status, query and file.
- [ ] **S3 M6** "Turn into…" from selected text, and the "Make a task" suggestion by rules.
- [ ] **S3 M11** Comments and mentions on any object or block.
- [ ] **S3 M16b** Compare versions and restore selectively.
- [ ] **S4 M12** Find across all objects.
- [ ] **S4 M8e** Query blocks in pages (live queries).
- [ ] **S5 M15** Command language with autocomplete (English and French).
- [ ] **S5 M17a** Home: Now, Today, Waiting, Continue, Decisions, Changes.
- [ ] **S5 M17b** My World.
- [ ] **S5 M17c** Attention score with its explanation.
- [ ] **S5 M17d** "While you were away" digest.
- [ ] **S5 M18** Capture inbox, with rule-based suggestions.
- [ ] **S5 M19b** Living project page.
- [ ] **S6 M14c** Workflow screen: build, test run, see run history.

**Gate MVP (end of week 9):**
- The MVP exit test passes on staging: a task written in meeting notes appears in My tasks, on the board, on the calendar and on the project page, with one edit updating all of them.
- QBBE's acceptance session: 1 hour.
- Switches turned on in production.

### Wave 3: V1 (weeks 10–15)

- [ ] **S4 V1-1** Calendar lens.
- [ ] **S4 V1-2** Timeline lens with dependency shifting.
- [ ] **S4 V1-3** Gallery lens.
- [ ] **S4 V1-4** Feed lens.
- [ ] **S4 V1-5** Dashboard lens; existing dashboards rebuilt on it.
- [ ] **S1 V1-7** Two-way relations and rollups.
- [ ] **S1 V1-8** Formula language, evaluated on the server.
- [ ] **S5 V1-9** Meetings as objects with an end-of-meeting review.
- [ ] **S5 V1-10** Decisions with the full fields and revisit reminders.
- [ ] **S5 V1-11** Goals linked to projects and metrics.
- [ ] **S5 V1-16** Phone screens: capture, today, inbox, tasks, search, approvals.
- [ ] **S6 V1-6** Forms for any type; existing forms converted.
- [ ] **S6 V1-12** Workflow branches, waits, approvals, reviews, loops, webhooks, retries, and retry from a failed step.
- [ ] **S6 V1-13** Templates for objects, pages and spaces.
- [ ] **S6 V1-14** Following and notification rules.
- [ ] **S6 V1-15** Google: Calendar to meetings, Drive links, Gmail to the capture inbox.
- [ ] **S3 V1-17** Live co-editing, presence, comments on selected text, suggested edits.
- [ ] **S2 V1-18** Public pages, with a review step.

**Gate V1:** staging acceptance, then the French review of the new screens
(QBBE's reviewer, #141), then production.

### Wave 4: V2 (weeks 16–19)

- [ ] **S4 V2-1** Graph and map lenses.
- [ ] **S1 V2-2** Blueprint designer and the starter blueprints.
- [ ] **S1 V2-3** Apps.
- [ ] **S3 V2-4** Custom object layouts.
- [ ] **S4 V2-5** Advanced dashboards.
- [ ] **S6 V2-6** Search across Google Drive and Gmail.
- [ ] **S5 V2-7** Approvals on any object.
- [ ] **S6 V2-8** Private API and webhooks.
- [ ] **S2 V2-9** Admin controls: Google sign-in, session rules, audit export, the "what can this role see" report.

### Wave 5: V3 (weeks 20–22)

- [ ] **S6 V3-1** Offline changes synced when back online.
- [ ] **S1 V3-2** Workspace upkeep reports.
- [ ] **S4 V3-3** How work flows (process analytics).
- [ ] **S4 V3-4** What-if timeline.
- [ ] **S4 V3-5** Operations analytics.

**Gate done:** full release-candidate run (all browsers, security scans,
the 50-user load test), then production.

## 6. What QBBE needs to do, and when

| When | What | Time needed |
|---|---|---|
| Now | Answer the 3 decisions in `workspace-os-plan.md` §12 | 5 min |
| End of Wave 0 | Nothing unless a spike fails, in which case approve the fallback | 5 min |
| End of Wave 2 (MVP) | Try the MVP exit test on staging; accept or list problems | 1 hour |
| End of Wave 3 (V1) | Staging acceptance; French reviewer checks the new screens | 2 hours + reviewer |
| End of Wave 5 | Final acceptance | 1 hour |

Staging must be running (done on 2026-09-30) and needs the owner account
(Part 8 of the staging steps) before the MVP acceptance session.

## 7. What would make this slip, and the plan for each

| Risk | Early warning | Response |
|---|---|---|
| Editor or co-editing spike fails | W0-5 or W0-6 misses its target | Switch to the fallback the same week; S3 loses about 1 week |
| Access check disagrees with the old rules or is slow | M10c equivalence or speed test fails | S2 fixes before any screen switches; screens keep the stand-in, so other streams keep going |
| Test run still slow | W0-1 over 15 minutes | Split into 6 parts; move the phone and accessibility sweep to the nightly run |
| Merge conflicts between streams | More than 2 per week | Tighten ownership; S1 takes over the file in dispute |
| Waiting on QBBE sign-off | A gate open for more than 3 days | Next wave starts behind switches anyway; sign-off only blocks turning switches on in production |
| Supabase free-plan limits | Database size or Realtime connections over 70% | Flagged to QBBE with the cost of the next plan, before the limit |

## 8. Tracking

- Each checklist item becomes a GitHub issue under a Workspace OS epic, labelled by stream and wave.
- Each item is ticked here in the change that finishes it.
- A progress report is posted to the epic at the end of every wave.
