# Documents and tasks, the Notion way: plan

Written 2026-09-30 against `main` at `58b7982`. Scope agreed with QBBE on the
same day: **documents and tasks**, for **QBBE only**.

## Goal

Make QBBE Hub the one place QBBE writes things down and tracks work.

- **Documents:** pages written in a block editor, organized in a tree with the files QBBE already uploads. Linked to each other and to tasks, edited together live, with history.
- **Tasks:** the task features staff know from Notion, ClickUp and Asana:
  - QBBE's own fields on tasks;
  - table, board, calendar and timeline views;
  - subtasks, templates, workload;
  - one-click actions and simple automations.

Every item meets the bar the rest of the app meets:
- row-level security (RLS) tested for every role;
- English and Quebec French;
- WCAG 2.2 AA accessibility;
- browser and database tests in CI;
- staging before production.

## Out of scope

- **Selling to other companies:** sign-up for new organizations, billing, single sign-on, public API. QBBE only.
- **Public web pages:** QBBE's records stay behind sign-in.
- **AI assistant:** not planned. It would need a privacy decision and an update to the staff privacy notice first. The editor is chosen so it can be added later.
- **General-purpose databases** (inventory lists, contact tables and so on): tasks and projects get custom fields and views instead. Revisit once Phase 3 is in use.
- **Relations, rollups and formulas** between arbitrary tables. Tasks already link to projects, milestones and programs; totals are added where QBBE needs them (N3-6).
- **Synced blocks, whiteboards, offline editing and custom domains:** rarely used and costly; revisit on request.

## What exists today

Checked against `main` for this plan.

**Documents**

| Feature | Today |
|---|---|
| Uploaded files, folders, virus scanning, text search, mail-merge templates | Present (#147, #35) |
| Pages written in the app with a block editor | **Missing** |
| Links between pages; backlinks | **Missing** |
| Live co-editing; comments on a passage | **Missing** |
| Version history | **Missing** for documents |
| Retention and legal hold | Present for financial records (#146) |

**Tasks**

| Feature | Today |
|---|---|
| Title, description (plain text), status, priority, assignee, requester, reviewer | Present |
| Start and due dates, estimate in hours, blocked reason | Present |
| Dependencies with loop prevention; checklists; labels; milestones | Present |
| Recurring tasks (`task_series`); task from a message | Present |
| List (`/my-work`), board (`/board`), calendar (`/schedule`); saved views | Present |
| Comments with @mentions; change history; archive and restore | Present |
| Rich-text descriptions | **Missing:** plain text only |
| Subtasks | **Missing:** checklists only |
| QBBE's own fields on tasks | **Missing** |
| Table view (spreadsheet-like, edit in place); timeline view | **Missing** |
| Bulk edit; task templates; one-click buttons; automations | **Missing** |
| Workload view; time tracking; followers | **Missing** |

## Decisions

My recommendation is listed first; I'll build it unless you say otherwise.

**D1. Editor: BlockNote** (open source, built on Tiptap and ProseMirror).
- It already has Notion's slash menu, blocks, drag handles and Markdown shortcuts.
- **Licence:** the core is MPL-2.0 (the Mozilla Public License), which is fine for us. Paid extras aren't needed; we build what we use.
- The same editor is used for page bodies and task descriptions, so both feel the same.
- **Accessibility spike first** (N0-1). If it fails: plain Tiptap with our own accessible menus.

**D2. Live co-editing: Yjs sent over Supabase Realtime.** (Yjs is the shared-editing library BlockNote uses.)
- Supabase Realtime is already in use, and Netlify can't host the connections a separate sync server needs.
- **Fallback:** a small sync server on the always-on machine planned for virus scanning (#35).

**D3. Custom fields on tasks and projects, not a separate database system.**
- QBBE's own fields (for example "Funder", "Event", "Language", "Hours spent") live alongside the built-in ones.
- Every view (table, board, calendar, timeline) can filter, sort and group by them.
- This gets the Notion-database experience for tasks without a second system to maintain.

**D4. Who sees a page.**
- A page takes its parent's access unless someone changes it. Access levels are *view*, *comment* and *edit*, given to people or roles.
- Top-level spaces: **Workspace** (all staff), **Private** (only you), and one space per program if wanted.
- Volunteers and the accountant see only pages shared with them.

## Phases

Each phase ships on its own and passes the same gates:
- tests for the security rules, the app code and the browser flows;
- an accessibility scan;
- French strings reviewed;
- deployed to staging before production.

The documents track (Phases 1 and 4) and the tasks track (Phases 2, 3 and 5) run in parallel after Phase 0.

### Phase 0: Spikes and design (about 1 week)

Spikes are short experiments that answer a risky question before real work starts.

- [ ] **N0-1 Editor accessibility spike.**
  - Test: keyboard-only use of every block, VoiceOver and NVDA, 200% zoom, French text entry.
  - Result: go/no-go on BlockNote, recorded here.
- [ ] **N0-2 Co-editing spike.** Two browsers editing the same page.
  - Target: 95% of edits arrive within 1 second; no lost edits after 1,000 random edits from both sides; recovers after the connection drops.
- [ ] **N0-3 Design note.** Tables for pages, page access, page versions and custom fields. How inherited access is checked quickly and safely. Reviewed before building.
- [ ] **N0-4 Performance budget.**
  - Targets: a 200-block page loads in under 1.5 seconds; a 2,000-task table view in under 1 second; search stays under 300 ms.
  - Added to the 50-user load test.

### Phase 1: Pages and the editor (about 3 weeks)

- [ ] **N1-1 Pages and the tree.**
  - Pages and uploaded files live together in one sidebar tree, which replaces the folders.
  - Create, rename, icon, cover image, move by dragging, duplicate.
  - Favourites and Recent.
- [ ] **N1-2 Block editor with a `/` menu.** Block types:
  - text, headings, bulleted, numbered and to-do lists, toggle;
  - quote, callout, divider, code, simple table;
  - image and file (virus-scanned), link bookmark, embed (allowed sites only).
  - Markdown shortcuts as you type; drag handles; turn a block into another type.
  - Pasting from Word and Google Docs keeps formatting.
- [ ] **N1-3 Links.**
  - `@` to mention a page, person, task, project or date; `[[` to link a page.
  - A "Linked from" section at the bottom of each page.
  - A mentioned person gets a notification.
- [ ] **N1-4 Task descriptions use the same editor**, so descriptions get headings, lists, images and links. Existing plain-text descriptions are converted automatically.
- [ ] **N1-5 Trash and history.**
  - Deleted pages sit in Trash for 30 days.
  - A version is saved every 10 minutes of editing and on demand; view and restore old versions.
  - Both respect legal hold and retention rules (#146).
- [ ] **N1-6 Search.** Page text in `/search` and the command palette, with French accents and word endings handled.
- [ ] **N1-7 Sharing (D4)**, with RLS tests for every role, including volunteers and the accountant.
- [ ] **N1-8 Uploaded files, improved.**
  - Preview PDFs and images in the page.
  - Upload a new version of a file and keep the old ones.
  - A file can be pinned inside any page.

### Phase 2: Task fields and views (about 3 weeks)

- [ ] **N2-1 Custom fields (D3)** on tasks and projects.
  - Types: text, number, select, multi-select, date, person, checkbox, URL.
  - Admins manage fields in Settings.
  - A field can apply to all projects or to one project.
- [ ] **N2-2 Table view.** A spreadsheet-like grid:
  - edit cells in place; resize, reorder and hide columns;
  - group rows; totals at the bottom of number columns;
  - fully usable with the keyboard.
- [ ] **N2-3 Timeline view.**
  - Bars from start to due date; drag to reschedule.
  - Arrows for dependencies; tasks that depend on a moved task shift with it after you confirm.
  - Group by project or person.
- [ ] **N2-4 Every view uses every field.** Board, list, calendar and timeline filter, sort and group by any field, including custom ones. And/or filters; "me" and "today" as relative values.
- [ ] **N2-5 Saved views (extends P1-UX-08):** shared or personal; set as a project's default view.
- [ ] **N2-6 Bulk edit.** Select many tasks, then change status, assignee, dates or a field in one go, or archive them. Undo available for 10 seconds.
- [ ] **N2-7 Views inside pages.** Drop a live task view (for example, "this project's open tasks") into any page.

### Phase 3: Doing the work (about 3 weeks)

- [ ] **N3-1 Subtasks** with their own assignee and dates. The parent shows progress (for example, 3 of 5 done). Existing checklists stay for quick lists.
- [ ] **N3-2 Task templates** (for example, "Event setup" or "Grant application") that create a task with subtasks, fields and a description. Project templates create a set of tasks with dates relative to the start date.
- [ ] **N3-3 Workload view.**
  - Each person's estimated hours per week, with over-capacity shown in red.
  - Drag a task to another person or week.
  - Respects time off where it's recorded.
- [ ] **N3-4 Time tracking.** A start/stop timer or manual entry on a task; weekly timesheet per person; estimate vs actual on projects; CSV export.
- [ ] **N3-5 Followers.** Follow a task or page to be notified of changes. Assignee, requester and reviewer follow automatically.
- [ ] **N3-6 Project totals.** Tasks done vs total, hours estimated vs spent, and overdue count, shown on the project page and in views.

### Phase 4: Working together on documents (about 3 weeks)

- [ ] **N4-1 Live co-editing (D2):** changes appear for everyone within a second.
- [ ] **N4-2 Presence:** who's on the page, and each person's cursor.
- [ ] **N4-3 Comments on a passage:** threads attached to highlighted text; resolve and reopen; a page comments panel.
- [ ] **N4-4 Text to task:** highlight text in a page, press a key, and it becomes a task linked back to that spot.
- [ ] **N4-5 Meeting notes that finish themselves** (extends meetings):
  - the agenda starts from open items;
  - action items written in the notes become tasks with owners and due dates;
  - decisions are listed on the meeting page.
- [ ] **N4-6 Page locking** against edits, and "suggest edits" mode for volunteers: a staff member accepts or rejects each suggestion.

### Phase 5: Less busywork (about 2 weeks)

- [ ] **N5-1 Page templates** (for example, meeting notes, project brief, event plan, board minutes, grant report) in both languages, plus QBBE's own.
- [ ] **N5-2 Buttons in pages and tasks**, for example "Start event checklist", which creates the tasks from a template.
- [ ] **N5-3 Automations**, with a log admins can read. Each is "when X, do Y", for example:
  - when a status changes, notify someone, set a field or create a task;
  - when a due date is near, remind the assignee.
- [ ] **N5-4 Recurring pages**, for example weekly meeting notes created every Monday. Uses the job runner and the existing recurring-task engine.
- [ ] **N5-5 Wiki verification.** A page can be marked verified with an owner and review date; it shows "needs review" after that date and the owner is reminded.
- [ ] **N5-6 Weekly digest** of followed pages and tasks, due work, and items waiting on you. Extends the team-signals digest (#136); off by default.

### Phase 6: Moving content in and out (about 1 week)

- [ ] **N6-1 Import:**
  - Word (.docx), Markdown and HTML become pages;
  - a Notion or Google Docs export becomes pages with links kept;
  - a CSV becomes tasks, with columns mapped to fields.
- [ ] **N6-2 Export:** a page or tree as PDF or Markdown; any task view as CSV.

## Risks

| Risk | Effect | What we do |
|---|---|---|
| The editor fails accessibility (N0-1) | Staff using a screen reader can't write pages | Decided in Phase 0; plain-Tiptap fallback |
| Co-editing is too slow or unreliable on Supabase Realtime (N0-2) | Lost or jumbled edits | Hard targets in the spike; sync-server fallback (D2) |
| Inherited page access slows the sidebar and search | Slow screens | Access worked out once and cached per page, with a test proving it matches the full rule; measured in N0-4 |
| Custom fields slow task views | Slow board and table | Fields indexed; 2,000-task budget in N0-4 |
| Changing task descriptions and the board breaks current work | Regressions on the most-used screens | Existing browser and security-rule tests stay green; each change goes to staging first |
| Free-plan limits (database size, Realtime connections) | Staging or production hits a limit | Measured in Phase 0 and flagged before we reach it |

## Order and effort

About 16 weeks if done one after another. With the documents and tasks tracks in parallel after Phase 0, about 10 weeks.

What people notice first, in order:
1. Pages with the editor (Phase 1).
2. Task table and timeline views (Phase 2).
3. Subtasks and templates (Phase 3).
