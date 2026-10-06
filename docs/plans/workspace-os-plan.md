# Workspace OS on QBBE Hub: plan

Written 2026-09-30 against `main` at `58b7982`. It replaces the earlier
Notion plan. Source: QBBE's "Workspace OS — Product Architecture, Phase 1"
brief (sections 1–50), with two instructions from QBBE:
- **no AI features;**
- **QBBE only.**

## 1. Summary

Workspace OS turns QBBE Hub into one system where everything is an
**object**: a task, a project, a meeting, a page, a decision. You can:
- write it like a document;
- give it structure when useful;
- link it to anything;
- see it through any **lens** (table, board, calendar, timeline and more);
- let **workflows** move it along.

The same object shows everywhere, so changing it once changes it everywhere.

**How it fits QBBE Hub.** The system is not rebuilt. Most of the brief's
object types already exist as working features with security rules and
tests. The plan adds a shared **object layer** underneath them:
- one registry of objects;
- shared properties, relations, content, events, permissions and history.

Each existing feature is then connected to that layer one at a time.
Screens people use today keep working throughout.

**Without AI.** Every feature in the brief that depends on AI is either left
out or rebuilt with clear rules instead (section 5). For example:
- "Convert to task?" spots a person plus a date in your sentence, using fixed rules;
- "Build mode" becomes a blueprint designer;
- "Change intelligence" ranks changes by fixed rules;
- agents are left out.

**Effort:** about 11–13 months with three work tracks in parallel. The core
(section 7, "MVP") is usable after about 5 months. Details in section 11.

## 2. Rules this plan follows

These make "added perfectly onto the existing system" concrete.

1. **Wrap, don't rewrite.** Existing tables (`task`, `project`, `meeting`, `decision`, `risk`, `outcome_metric` and others) stay. Each becomes a *native type* registered in the object layer. Nothing is moved into a generic key-value table.
2. **One source of truth for access.** A single check, `app.can(object, capability)`, used by the database's row-level security (RLS), search, lenses, workflows and public pages. For native types it calls the existing rules (for example `app.has_task_capability`), so nothing becomes more open than today.
3. **Every change is reversible.** Database changes (migrations) only add at first; old columns are removed only after a full release shows they are unused. Each module sits behind a switch in the existing `feature_flag` table and can be turned off.
4. **Existing tests stay green.** New layers bring their own security-rule, unit, browser and accessibility tests, plus a test proving the new access check agrees with the old rules for every role and record.
5. **Same quality bar as today:** English and Quebec French; WCAG 2.2 AA; legal hold and retention (#146) respected; performance budgets checked in the 50-user load test; staging before production.
6. **Progressive disclosure (brief §42).** Beginners see "Open, type, create, share". Properties, relations, workflows and apps appear only when someone reaches for them.

## 3. What already exists, mapped to the brief

| Brief | In QBBE Hub today | What changes |
|---|---|---|
| §3 Objects | Separate tables per feature | Object registry over all of them (A1) |
| §5 Type: Task, Project, Meeting, Decision, Goal, Person | `task`, `project`, `meeting`, `decision`, `outcome_metric`/`outcome_measurement`, `user_profile`, `team`, `risk`, `event`, `crm_contact`, `crm_organization`, `opportunity`, `document`, `project_request` | Registered as native types (M1) |
| §5 Property | Fixed columns only | System properties + custom properties (M2) |
| §5 Relation | Foreign keys, `task_dependency`, `milestone_dependency`, `crm_link` | Relation layer; foreign keys exposed as relations (M3) |
| §5 Block | Plain-text descriptions | Block editor with semantic blocks (M4, M5) |
| §5 Lens | List, board, calendar for tasks; `saved_view` | Lens engine for any type (M8, V1-1..4) |
| §5 Space | Programs with memberships and grants | Spaces, with programs becoming spaces (M10) |
| §5 Event | `activity_event`, `audit_event`, `approval_event` | Unified object events (M9) |
| §5 Action | Server commands per feature | Action registry with undo (M13) |
| §5 Identity | Users, roles, teams | Adds automation and integration identities (M10) |
| §16 Meetings | Meetings, agenda, attendees, actions | Become objects; notes gain semantic blocks (V1-9) |
| §17 Decisions | `decision` table | Gains the brief's fields (V1-10) |
| §18 Goals | Outcomes and metrics per program | Goal type linking projects and metrics (V1-11) |
| §25 Automation | `workflow_rule` (trigger → condition → notify) and `workflow_execution` log | Workflow engine with steps, branches, delays and retries (M14, V1-12) |
| §31 Comments | `record_comment` on 12 record types | Any object and any block (M11) |
| §37 Forms | `form_definition`, `form_submission` | A form produces objects of a type (V1-6) |
| §38 Dashboards | Dashboard and portfolio pages | Dashboard lens (V1-5) |
| Approvals | Full routing, delegation, audit | Workflow step and object action (V1-12) |
| Search | Full-text search with French handling for documents and messages | Across all objects (M12) |
| Command palette | Navigation, search, create | Command language (M15) |
| Google | Calendar, Drive, Gmail connections (#16) | Sources for capture and search (V1-15, V2-6) |

## 4. Architecture

### A1. Object registry

- **`object`**: one row per object of every type. Holds:
  - `id` (the same id as the underlying record, e.g. a task's id);
  - `type_id`, `space_id`, `title`, `icon`, `cover`;
  - `parent_object_id` (for nesting);
  - owner, created by/at, updated by/at, `archived_at`, `deleted_at`;
  - `search_vector` (for search).
- **Native types:** database triggers on the existing tables keep their `object` row in sync. Existing code does not change.
- **New types** (user-defined, pages, decisions if extended): `object` plus the property tables below.
- A page is simply an object of type **Page** with content. Nesting is `parent_object_id`, so pages and tasks can nest under anything.

### A2. Types and properties

- **`object_type`**: name in English and French, icon, native or custom, the default lens, and the default template.
- **`property_definition`**: per type, with a name in each language, a kind and options. Kinds:
  - text, number, currency, date, date range, duration, status, select, multi-select;
  - person, relation, formula, location, progress, rating, file, URL, email, phone, checkbox;
  - created/edited by and time, computed (a rollup).
- **Native columns** (such as `task.due_at`) appear as *system properties*: read and written through the same interface but stored in their existing column.
- **Custom property values:** one typed table, `property_value(object_id, property_id, value_text, value_number, value_date, value_json)`, indexed per kind so filters stay fast.
- **Property-level privacy (§33):** a property can be restricted to certain roles. The query engine removes it for others, and a test proves it.

### A3. Relations

- **`relation_type`:** for example "owns", "contains", "originated from", "supports", "blocks", "applies for". Each has a name and a reverse name in both languages, and how many can link on each side (one-to-one, one-to-many, many-to-many).
- **`object_relation(from_id, relation_type_id, to_id)`:** RLS requires the viewer to see both ends.
- **Existing links become relations:** `task.project_id`, `task_dependency` and `crm_link` show up as relations through a database view, so no data is duplicated.
- **Rollups:** a computed property over a relation, for example the percentage of tasks done or the sum of hours. Stored and refreshed on change so views stay fast.

### A4. Content and blocks

- **Editor: BlockNote** (open source, built on Tiptap/ProseMirror; core licensed MPL-2.0, the Mozilla Public License).
- **Accessibility spike first** (P0-1). If it fails: plain Tiptap with our own accessible menus.
- **Storage:**
  - the live document is a Yjs document (Yjs is the shared-editing library) saved per object;
  - `block` rows are derived from it (id, object, type, position, text, the object it references) and used for search, backlinks, queries and comments on a block.
- **Semantic blocks (§7):** task, decision, goal, metric, person, status, query, chart, button, form, workflow, embed, file.
  - A semantic block points at a real object: a task block *is* the task.
  - Deleting the block asks whether to delete the object or only the block.
- **Co-editing:** Yjs sent over Supabase Realtime. Fallback: a small sync server on the always-on machine planned for virus scanning (#35).

### A5. Events

- **`object_event`**: object, actor (a person, a workflow or an integration), verb, which properties changed (before and after), and time.
- Written by triggers, so no code path can skip it.
- The existing activity feed, audit log, notifications and team signals read from it. Older tables stay until everything reads the new one.
- **An "outbox" of new events** drives workflows, notifications, the attention engine and "what changed" summaries.

### A6. Identity, spaces and permissions

- **Identities:** people and teams exist today. New ones: *automation* (a workflow acting) and *integration* (Google). Every event and action names one.
- **Spaces:** each program becomes a space. Plus a Workspace space (all staff), a Private space per person, and optional spaces such as Board or Admin.
- **Capabilities:** view, comment, edit content, edit structure, manage, run workflow, share.
- **Inheritance:** workspace, then space, then object, then property. Grants go to people, teams or roles.
- **Custom roles** built from capabilities, alongside the existing roles (owner, admin, staff, member, volunteer, accountant).
- **One check for everything:** `app.can(object_id, capability)`.
  - Native types call their existing rules first.
  - The result is kept in a table per person and object, refreshed on change, so lists stay fast.
  - An **equivalence test** proves the new check matches the old rules for every role on every seeded record, as was done for the task rules in #115.
- **Two-step sign-in (MFA)** is still required for admin actions, as today.

### A7. Lens and query engine

- **Query spec** (stored as JSON):
  - the type or types;
  - filters in and/or groups, with relative values ("me", "today", "this week");
  - sorts, grouping and which properties to show;
  - following relations, for example "tasks of projects in this space".
- **Execution:** turned into SQL on the server and always run under the viewer's own permissions, so there is no path around RLS.
- **Lens = query + presentation:** document, table, board, list, calendar, timeline, gallery, feed, dashboard, graph and map.
- The existing `saved_view` rows are converted to lenses.
- **Query blocks (§9)** are lenses embedded in a page; that's what makes pages "living".
- **Performance budget:** a 5,000-object table opens in under 1 second.

### A8. Actions and undo

- **Action registry:** assign, change status, archive, move, create object, link, publish, approve, notify and others. Each declares the capability it needs.
- **Every action writes a change set:** a list of before/after values.
- **Undo** replays the change set in reverse, for example "46 tasks archived. Undo".
- The command palette, buttons, bulk edit and workflows all go through actions, so one set of permissions and one audit trail covers all of them.

### A9. Workflow engine

- Extends `workflow_rule` and `workflow_execution`.
- **Definition:** a graph of steps: trigger, condition, action, branch, wait, approval (using the existing approval engine), a person's review, webhook, sub-workflow, loop over a list.
- **Runs:** each step's input, output, timing and error is recorded.
- **Failures:** retries with increasing gaps; you can retry from the failed step (§26).
- **Execution:** the existing job runner (`/api/jobs`) runs steps and scheduled waits, so nothing new needs hosting.
- **Safety limits:** a maximum number of steps per run, a limit on loops, a rate limit per workflow, and a switch to stop a workflow at once.

### A10. Versions

- Snapshots of object content (the Yjs state) every 10 minutes of editing and on demand.
- Property and relation history comes from events.
- Workflows and types keep versions.
- **Compare** shows before and after side by side. **Restore** can bring back the whole object, one block or one property.
- Retention and legal hold apply.

### A11. Search: Find and Explore

- **Find:** search across every object you can see, using the French-aware text search that already exists; filters by type, space and person.
- **Explore:** open any object's "Related" panel (§19) and follow relations step by step. Includes a graph view.
- **"Ask" (plain-language questions) is AI and is left out.** Its most useful case, "what changed while I was away", is covered without AI by the change digest (M17).

### A12. Offline and phones

- **Documents:** the Yjs editor already keeps working offline and merges when back online.
- **Structured changes** (status, properties, new tasks): saved on the device first as a list of operations, then sent to the server when back online. If two people changed the same field, the latest change wins and the other is shown to you to review.
- **Delivery:** the app installs on phones and computers from the browser as a progressive web app (PWA). No app-store apps.

### A13. Public pages

- A space or object can be **published** by an owner or admin.
- Publishing writes a **read-only copy of chosen fields** to a separate public table. Public pages read only that table, never the live data.
- Safeguards:
  - a "public" badge everywhere the object appears;
  - properties marked private are never published;
  - a review step before anything goes live;
  - unpublish takes effect immediately.

## 5. Brief sections left out or rebuilt without AI

| Brief | Decision |
|---|---|
| §6 "Convert to task?" | **Rules-based:** a person mention plus a date phrase in English or French ("Friday", "vendredi", "Oct 3") offers "Make a task". Shown as a quiet icon in the margin, never a popup. Can be switched off. |
| §7 AI-output block, §5 AI-derived property | Left out. |
| §16 "AI proposes decisions and tasks" | Replaced by semantic blocks: typing `/decision` or `/task` in meeting notes creates real objects as you go, and an end-of-meeting review lists them. |
| §20 Capture suggestions | **Rules-based:** matches a project by mention, link or keyword; recognises links and file types; the email sender is matched to a contact. |
| §21 "Ask" | Left out. "What changed" is covered by the change digest (M17). |
| §22 Commands in plain language | A **fixed command language** with autocomplete: `create project Website Redesign`, `assign "Homepage" to Jordan`, `show blocked tasks`. No free-form AI. |
| §23 Build mode | **Blueprint designer (V2-2):** pick a starter (for example Recruiting, Event, Grant, Volunteer intake) or draw types and relations on a canvas. It previews and asks for approval before building. |
| §27–30, §34 Agents and AI permissions | Left out. Automation identities (A6) and workflow logs cover "nothing important happens invisibly". |
| §31 Change intelligence, §32 Briefs | **Rules-based ranking** (M17): deadline moves, status changes on followed work, newly blocked items, approvals and changed numbers rank highest. |
| §48 Autonomous agents, organization intelligence | Left out. The non-AI parts are in V3. |

## 6. Brief items that don't apply to a QBBE-only system

I've made a default for each. Tell me if you want any of them.

| Brief | Default |
|---|---|
| Multiple workspaces, "any company" onboarding (§43 as a sign-up flow) | **Not built.** QBBE's workspace is set up with the V2 blueprint designer instead. |
| Enterprise single sign-on and SCIM (automatic user setup from a directory) | **Google sign-in only** (V2-9), since QBBE uses Google. SCIM not built. |
| Marketplace, SDK, cross-company portals | **Not built.** A private API with access tokens is built (V2-8), for tools such as Zapier. |
| GitHub integration | **Not built:** QBBE doesn't use GitHub for its work. |
| Slack integration | **Not built:** QBBE uses the Hub's own channels. Can be added if QBBE adopts Slack. |
| Native desktop and phone apps | **Installable web app** (A12) instead of app-store apps. |

## 7. MVP: prove the object layer (about 5 months)

Each item ships behind a feature switch, goes to staging first, and meets
the quality bar in section 2.

### Phase 0: spikes and design (3 weeks)

Spikes are short experiments that answer a risky question before real work starts.

- [x] **P0-1 Editor accessibility.** BlockNote with keyboard only, VoiceOver, NVDA, 200% zoom and French text. Go/no-go recorded here.
  - **Result: go** for BlockNote 0.55.0 (Ariakit interface), with five conditions for M4b. The screen-reader check passed (QBBE, 2026-09-30). Details: `docs/design/spikes/W0-5-editor-accessibility.md`.
- [x] **P0-2 Co-editing.** Yjs over Supabase Realtime between two browsers. Target: 95% of edits arrive within 1 second; no lost edits after 1,000 random edits from both sides; recovers after the connection drops.
  - **Result: go.** No fallback server is needed. p95 is 44 ms. The sync layer is exact over 1,000 edits with a connection drop. Recovery works.
  - Two editor-binding findings, F1 and F2, are to manage in M4c and V1-17. Details: `docs/design/spikes/W0-6-coediting.md`.
- [ ] **P0-3 Access check.** `app.can` with cached results over the seeded data (like the #115 performance data). Must agree with every existing rule, and add less than 20 ms to a board load.
- [ ] **P0-4 Query engine.** Query spec to SQL; a 5,000-object table opens in under 1 second; each type of filter is shown to be safe against SQL injection.
- [ ] **P0-5 Design note.** Tables A1–A10 and the migration order (section 9). Reviewed before M1.

### Core layer

- [ ] **M1 Object registry and native types.**
  - `object`, `object_type`, and triggers for task, project, meeting, decision, risk, `outcome_metric`, `user_profile`, team, event, contact and document.
  - Existing records are copied in (backfilled).
  - Test: every record has exactly one object row, and the count matches after every insert and delete.
- [ ] **M2 Properties.** System properties for native columns; custom properties (all kinds except formula); an editor in Settings, then Types; per-property privacy.
- [ ] **M3 Relations.** Relation types, `object_relation`, existing links exposed as relations, and a "Related" panel on every object (§19).
- [ ] **M4 Block editor and nested content.**
  - Pages; nesting under any object; a sidebar tree per space; favourites and recent.
  - All standard blocks, Markdown shortcuts, drag handles, pasting from Word and Google Docs.
  - Task descriptions move to the editor, converted from plain text.
- [ ] **M5 Semantic blocks, part 1:** task, decision, person, status, query and file. A task block is the task itself.
- [ ] **M6 Progressive structure (§8).**
  - Select text or list items, then "Turn into…" any type; the original text stays linked.
  - "Make a task" from a sentence (the rules in section 5).
- [ ] **M7 Universal tasks (§14).** Every place that creates tasks (meetings, documents, comments, projects, messages, workflows) uses one "create task" action. Each task records where it came from, and shows in My tasks, the project, the calendar and goals.
- [ ] **M8 Lenses, part 1:** document, table (edit in place, fully usable by keyboard), board and list. `saved_view` converted; views shared or personal.
- [ ] **M9 Events.** `object_event` from triggers. The activity feed, audit log and notifications switch to it, and a test compares them with the old output.

### Using it

- [ ] **M10 Spaces and permissions.**
  - Spaces, with programs converted to spaces.
  - Capabilities, inheritance, custom roles, and the share menu.
  - `app.can` equivalence test across every role and record.
- [ ] **M11 Comments and mentions** on any object or block: threads, resolve, reactions, `@person`, `@object`. Builds on `record_comment`.
- [ ] **M12 Find.** Search across all objects, with type and space filters, in the palette and on `/search`.
- [ ] **M13 Actions and undo.** Action registry, change sets, undo toast; bulk edit on table and board.
- [ ] **M14 Workflows, basic.** Trigger (any object event), condition, action (any registered action). Extends `workflow_rule`; each run is logged.
- [ ] **M15 Command language (§22).** Create, assign, move, show, open and add-to commands with autocomplete, in English and French.
- [ ] **M16 Autosave and versions (A10):** compare and restore; trash with 30-day restore.
- [ ] **M17 Home, My World and Attention (§11–13).**
  - Home sections: Now, Today, Waiting, Continue, Decisions and Changes.
  - My World: My tasks, meetings, projects, waiting on, mentions, decisions needed.
  - **Attention score** from fixed rules: deadline closeness, how many items this blocks, project priority, mentions, assigned role and recent changes. It explains itself, for example "Website launch in 3 days; 2 of your tasks block it".
  - A "while you were away" digest.
- [ ] **M18 Capture inbox (§20).** Quick capture from anywhere (text, link, file, photo with the existing text reader, forwarded email); suggestions from the rules; one tap to file it.
- [ ] **M19 Native projects, basic (§15).** A living project page built from query blocks: open tasks, recent decisions, milestones, files, activity, risks. Health and progress are calculated.

**MVP exit test:** create a task in meeting notes, and see it in My tasks, on the project board, on the calendar and in the project's page, with one edit updating all of them. That is the brief's §3 promise.

## 8. V1, V2, V3

### V1: complete for daily use (about 4 months)

- [ ] **V1-1 Calendar lens** for any type with a date (reuses `/schedule`).
- [ ] **V1-2 Timeline lens:** drag to reschedule; dependency arrows; linked dates shift after you confirm.
- [ ] **V1-3 Gallery lens.**
- [ ] **V1-4 Feed lens:** events for a query, for example "everything in the Events space".
- [ ] **V1-5 Dashboard lens (§38):** metric, chart, query, table, board, calendar, progress, text, activity, goal and embed tiles; filters that apply to the whole dashboard. Existing dashboard pages are rebuilt on it.
- [ ] **V1-6 Forms (§37):** any type can expose chosen properties as a form, and responses become objects. Existing `form_definition` rows are converted.
- [ ] **V1-7 Relations, advanced:** two-way relations, how many can link on each side, rollups.
- [ ] **V1-8 Formulas:** a safe, limited language (arithmetic, text, dates, if/then, `prop()`, relation totals). Calculated on the server, never run as arbitrary code. Error messages in both languages.
- [ ] **V1-9 Meetings as objects (§16):** agenda, notes with semantic blocks, decisions, tasks, questions and follow-ups. An end-of-meeting review screen. Recording is a file attachment; no transcript.
- [ ] **V1-10 Decisions (§17):** problem, options considered, evidence, reasoning, participants, revisit date. The revisit date sends a reminder. A "decision trail" view on projects.
- [ ] **V1-11 Goals (§18):** a goal links to projects and metrics (`outcome_metric`). Progress updates automatically from metrics and project completion.
- [ ] **V1-12 Workflows, advanced (§25–26):**
  - branches, waits, approval steps, a person's review, loops over a list, sub-workflows;
  - outbound webhooks, retries;
  - run history with a step-by-step view and "retry from here".
- [ ] **V1-13 Templates:** for objects, pages and whole spaces, in both languages, with dates relative to a start date.
- [ ] **V1-14 Notifications and following:** follow an object or query; rules per person; the digest.
- [ ] **V1-15 Google:** calendar events appear as meeting objects; Drive files can be linked as objects; Gmail forwards into the capture inbox. Builds on #16.
- [ ] **V1-16 Phone experience (§40):** capture, today, inbox, tasks, search, messages, approvals. The builder stays desktop-only.
- [ ] **V1-17 Live co-editing:** presence, cursors, comments on a block and on selected text, suggested changes with accept or reject.
- [ ] **V1-18 Public pages (A13):** documentation, knowledge base, event page, application form, directory. Owner or admin only, with review.

### V2: build your own (about 3 months)

- [ ] **V2-1 Graph lens and map lens** (a location property on an OpenStreetMap map).
- [ ] **V2-2 Blueprint designer (replaces Build mode):**
  - draw types, properties and relations on a canvas;
  - preview the lenses, forms and workflows it will create;
  - approve, then it's built as one undoable change set;
  - starter blueprints: Recruiting, Volunteer intake, Event, Grant, Donor stewardship, Inventory.
- [ ] **V2-3 Apps (§24):** a named app with its own navigation, screens (lenses and pages), forms, actions, permissions and dashboards.
- [ ] **V2-4 Custom object layouts:** choose which properties, related lists and blocks show on a type's page.
- [ ] **V2-5 Advanced dashboards:** cross-space totals, trends over time, dashboards per role (for example Executive or Finance).
- [ ] **V2-6 Search across connected apps:** Google Drive and Gmail results in Find, respecting each person's Google access.
- [ ] **V2-7 Approvals on any object:** the existing approval engine available as an action and a workflow step for any type.
- [ ] **V2-8 Private API and webhooks** with access tokens tied to an identity, following the same permissions and rate limits.
- [ ] **V2-9 Admin controls:**
  - Google sign-in;
  - session length and two-step sign-in rules per role;
  - audit log export;
  - property-level permission reports;
  - a view of what each role can see.

### V3: runs itself (about 2 months, non-AI parts only)

- [ ] **V3-1 Offline (A12):** operations saved on the device and synced for structured changes; full offline reading of recently used spaces.
- [ ] **V3-2 Workspace upkeep:**
  - stale-page review with owners;
  - broken-link and orphaned-object reports;
  - possible duplicates found by title and properties;
  - unused properties and lenses.
- [ ] **V3-3 How work flows ("process discovery"):**
  - time spent in each status and bottlenecks, from events;
  - average turnaround per type;
  - approval wait times.
- [ ] **V3-4 What-if timeline:** shift a milestone and see which tasks, projects and goals move, before committing.
- [ ] **V3-5 Operations analytics:** workload trends, overdue patterns, and each goal's direction, on dashboards.

## 9. Migration and coexistence

Existing features are connected to the new layer one at a time, in this
order:

1. Tasks and projects.
2. Meetings and decisions.
3. Goals and metrics, risks.
4. Documents.
5. Contacts and organizations (CRM), events, requests.
6. Finance records: registered as read-only objects so they can be linked and searched. Their own rules and workflows stay unchanged.

For each feature:
1. Register the type and copy existing records in (backfill).
2. Turn on the new lenses next to the old screens.
3. Compare their results in tests.
4. Switch the menu to the new screens.
5. Keep the old screen reachable for one release.
6. Remove it.

Rollback at any point: turn the feature switch off, and the old screens and
tables are still there.

## 10. Risks

| Risk | Effect | What we do |
|---|---|---|
| The new access check disagrees with the old rules | Someone sees what they shouldn't | Equivalence test over every role and record before any screen uses it; old RLS stays in force underneath |
| Object layer slows lists and search | Slower daily use | Cached access, indexed property values, budgets in P0; 50-user load test on every phase |
| Editor accessibility (P0-1) | Screen-reader users locked out | Decided before building; fallback editor |
| Co-editing reliability (P0-2) | Lost edits | Hard targets; fallback sync server |
| Workflows loop or flood email | Spam, runaway jobs | Step and loop limits, rate limits, instant stop switch, email allow-list on staging |
| Public pages leak private data | Privacy breach | Separate published copy, private properties never published, review step, admin only |
| Scope (brief is large) | Months without anything usable | MVP ships first and is usable alone; each V-phase ships in pieces |
| Supabase free-plan limits (database size, Realtime connections) | Service stops at a limit | Measured in P0; upgrade decision flagged to you before needed |

## 11. Timeline and parallel tracks

| Track | Covers |
|---|---|
| A: Object core | A1–A3, A5–A8, M1–M3, M9–M10, M13 |
| B: Editor and content | A4, A10, M4–M6, M11, M16 |
| C: Work and experience | M7–M8, M12, M14–M15, M17–M19, then lenses |

| Stage | Length | Usable result |
|---|---|---|
| Phase 0 | 3 weeks | Go/no-go on editor, co-editing and access check |
| MVP | about 4½ months after Phase 0 | Pages, universal tasks, table/board/list, Home and Attention, capture, basic workflows |
| V1 | about 4 months | Calendar, timeline and dashboard lenses; meetings, decisions and goals as objects; advanced workflows; phones; co-editing; public pages |
| V2 | about 3 months | Blueprints, apps, graph and map, API, admin controls |
| V3 | about 2 months | Offline, upkeep, process and what-if analytics |

## 12. Decisions for QBBE

Decided by QBBE on 2026-09-30.

1. **Public pages (V1-18): yes, as planned.** Owner or admin only, with a review step; the switch can be turned off at any time.
2. **Section 6 defaults: kept.** Google sign-in only (email and password stay for the QA accounts and as a fallback), no Slack or GitHub integration, an installable web app instead of store apps.
3. **Order: Meetings and Decisions (V1-9, V1-10) join the MVP.** Meetings are where QBBE's tasks and decisions start, and the MVP exit test itself begins in meeting notes. Both are built behind `wos_meetings_v2` and `wos_decisions_v2`, so this adds acceptance scope (about 30 minutes in the session), not build time.
