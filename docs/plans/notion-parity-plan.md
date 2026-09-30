# Notion's main features in QBBE Hub: plan

Written 2026-09-30 against `main` at `58b7982`.

## Goal

Give QBBE Hub the Notion features people actually rely on:
- pages you write in with a block editor, nested in a sidebar;
- databases with your own columns (properties) and many views of the same data;
- links between pages and records, with backlinks;
- real-time co-editing, comments on blocks, and page history;
- per-page sharing;
- templates, import and export, and simple automations.

All of this has to meet the bar every other feature already meets:
- row-level security (RLS) on every table;
- English and Quebec French;
- WCAG 2.2 AA accessibility;
- browser and database tests in CI;
- staging before production.

**Not the goal:** a copy of Notion's look, or features QBBE has no use for. Those are listed under "Left out" with the reason.

## What already exists

Checked against `main` for this plan:

| Notion feature | In QBBE Hub today |
|---|---|
| Pages and a block editor | **Missing.** No rich-text editor anywhere; documents are uploaded files. |
| Nested pages and a sidebar tree | **Missing.** Documents have folders, not pages. |
| Databases with your own properties | **Missing.** Tasks and projects have fixed fields only. |
| Table, board, list and calendar views | Partly: tasks have a list, a board (`/board`) and a calendar (`/schedule`), all fixed to tasks. |
| Saved views with filters | Partly: saved task views (`/saved`, P1-UX-08). |
| Gallery and timeline views | **Missing.** |
| Relations, rollups, formulas | **Missing.** |
| @mentions | Partly: in comments and channels, for people only. |
| Backlinks ("linked from") | **Missing.** |
| Comments | Partly: on records (tasks, projects and others); not on a passage of text. |
| Real-time co-editing and presence | **Missing.** Supabase Realtime is used for channel messages only. |
| Page history and restore | Partly: task history is a change log; there is no document version history. |
| Trash and restore | Partly: archive and restore for tasks. |
| Templates | Partly: document mail-merge templates (#147); no page or database templates. |
| Search and quick find | **Present:** full-text search (`/search`) and the command palette. |
| Forms that feed a database | Partly: forms exist (#145) with their own storage. |
| Import and export | Partly: CSV export in places; no Markdown/HTML/Notion import. |
| Sharing, guests, public pages | Partly: role-based access (owner, admin, staff, member, volunteer, accountant); no per-page sharing; nothing public. |
| Automations and reminders | Partly: job runner, reminders and notifications for tasks. |
| AI assistant | **Missing.** |

## Decisions

My recommendation is listed first for each. **Decisions for you** are marked; I'll build the recommendation unless you say otherwise.

**D1. Editor library: BlockNote** (open source, built on Tiptap and ProseMirror).
- It already behaves like Notion: slash menu, drag handles, blocks, and Markdown shortcuts as you type.
- Building the same on plain Tiptap costs weeks. Lexical is less mature for this.
- **Licence:** the core is MPL-2.0 (the Mozilla Public License), which is fine for us. A few extras (multi-column layout, AI, some exports) are in paid "XL" packages. We build our own versions of the ones we need instead of paying.
- **Spike first:** check keyboard use and screen readers in the editor before committing (see Phase 0).

**D2. Co-editing: Yjs, sent over Supabase Realtime.** (Yjs is the shared-editing library BlockNote uses.)
- Netlify can't hold the long-lived connections a normal Yjs sync server needs, but Supabase Realtime already can.
- Each page keeps its latest merged state in the database, plus a plain-text copy used for search and exports.
- **Fallback if the spike shows the delay or reliability isn't good enough:** a small sync server on the same always-on machine planned for virus scanning (#35).

**D3. One database engine for everything.**
- Tasks and projects become databases on the same engine. Their fixed fields become built-in properties, and people can add their own.
- The alternative is a second, separate system next to tasks, which would double the code and confuse people.
- Existing task pages, security rules and tests stay as they are. The new engine reads the same tables.

**D4. Who sees a page (decision for you).**
- **Recommended:** a page takes its parent's access unless someone changes it. Access levels are *can view*, *can comment* and *can edit*, given to people or roles.
- The top level has two spaces: "Workspace" (all staff) and "Private" (only you).
- Volunteers see only pages shared with them.

**D5. Public web pages (decision for you). Recommended: off.**
- A nonprofit's records shouldn't be one click from public.
- If you want it: owner or admin only, off by default, a clear "public" badge, and a review before a page goes live.

**D6. AI assistant (decision for you). Recommended: later, opt-in.**
- Summaries, drafting, and questions answered from your pages would send page text to an AI provider.
- That needs a privacy decision and an update to the staff privacy notice first.
- If yes: Claude, only on pages the asking person can read, and the admin can switch it off.

**D7. Order.** Pages and databases first, then collaboration, then the rest. Each phase can be used on its own; nothing waits for the end.

## Left out, and why

- **Synced blocks** (the same block shown on many pages): complex and rarely used; links and embeds cover it.
- **Custom domains and site publishing:** see D5.
- **Notion's own API and integrations gallery:** out of scope; our Google, email and volunteer integrations stay.
- **Offline editing:** needs a separate offline design; the app keeps needing a connection.
- **Charts inside databases:** the dashboard and reports cover it; revisit after Phase 3.

## Phases

Each phase is its own set of PRs. Each phase must pass the same gates:
- tests for the security rules, the app code and the browser flows;
- an accessibility scan;
- French strings reviewed;
- deployed to staging before it merges to production.

Phases 1 and 2 can run in parallel once Phase 0 settles the shared design.

### Phase 0: Spikes and shared design (about 1 week)

Spikes are short experiments that answer a risky question before real work starts.

- [ ] **N0-1 Editor spike.** Can the editor meet WCAG 2.2 AA?
  - Test: BlockNote in a test page; keyboard only through every block type; VoiceOver and NVDA; 200% zoom; French.
  - Result: go/no-go on BlockNote, recorded here.
- [ ] **N0-2 Co-editing spike.** Can two people edit together without losing or scrambling each other's changes?
  - Test: Yjs over Supabase Realtime between two browsers; measure the delay; reconnect after dropping the connection; merge work done while offline.
  - Target: p95 (95% of edits) arriving within 1 second; no lost edits after 1,000 random edits from two sides.
- [ ] **N0-3 Data model and access design.**
  - Tables: pages, blocks, databases, properties, rows, views, page permissions and page versions.
  - How access is inherited from a parent page and checked by RLS.
  - How tasks and projects map onto the engine (D3).
  - Written up as a short design note and reviewed before Phase 1.
- [ ] **N0-4 Performance budget.**
  - Targets: a 5,000-row database opens in under 1 second; a 200-block page loads in under 1.5 seconds; search stays under 300 ms.
  - Added to the existing 50-user load test.

### Phase 1: Pages and the editor (about 3 weeks)

- [ ] **N1-1 Pages.**
  - Create, rename, add an icon and cover image, move, duplicate.
  - Sidebar tree with nested pages you can drag to reorder; Favourites; Recent.
  - A "Workspace" space and a "Private" space.
- [ ] **N1-2 Block editor with a `/` menu.** The `/` menu inserts any block. Block types:
  - text, headings 1–3, bulleted, numbered and to-do lists, toggle;
  - quote, callout, divider, code with syntax highlighting, simple table;
  - image, file (virus-scanned through the existing document pipeline), link bookmark, embed (allowed sites only).
- [ ] **N1-3 Editing comfort.**
  - Markdown shortcuts (`#`, `-`, `[]`, `>`, ```` ``` ````).
  - Drag handles to move blocks; turn one block type into another.
  - Copy and paste from Word, Google Docs and web pages, keeping formatting.
- [ ] **N1-4 Page links.**
  - `@` to mention a page, a person or a date; `[[` to link to a page.
  - Backlinks section at the bottom of each page.
  - Mentioning a person sends them a notification (reuses notifications).
- [ ] **N1-5 Trash.** Deleted pages go to Trash for 30 days and can be restored or deleted for good. Deleting forever respects legal hold (#146).
- [ ] **N1-6 Page history.** A version is saved automatically every 10 minutes of editing and on demand. You can view an older version and restore it. Retention follows record retention (#146).
- [ ] **N1-7 Search.**
  - Page titles and text appear in `/search` and the command palette ("quick find").
  - French words are matched properly (accents, word endings).
- [ ] **N1-8 Access (D4).** Share menu on each page; access inherited from the parent; RLS tests for every role, including volunteers and the accountant.
- [ ] **N1-9 Tests.**
  - Browser tests for create, edit, move, link, trash and restore.
  - Accessibility scan of the editor; keyboard-only journey.
  - Pages view on phones: the editor is usable at 390 px wide.

### Phase 2: Databases (about 4 weeks)

- [ ] **N2-1 Databases.**
  - A database is a page whose content is rows. It can be full-page, or placed inline inside another page.
  - Every row is itself a page, with a body you can write in.
- [ ] **N2-2 Property types.**
  - text, number (with currency and percent formats), select, multi-select, status;
  - date and date range, person, checkbox, URL, email, phone, files;
  - created by / created time, last edited by / last edited time.
- [ ] **N2-3 Views.**
  - Table (resize, reorder and hide columns), board (group by any select or status property), list.
  - Each view keeps its own filters, sorts and grouping.
  - Views can be shared with everyone or kept personal (extends saved views).
- [ ] **N2-4 Filters.** And/or groups; operators suited to each property type; "me" and "today" as relative values.
- [ ] **N2-5 Tasks and projects on the engine (D3).**
  - The task board and list become views of the Tasks database; people can add their own properties.
  - Existing pages, links and saved views keep working (browser tests prove it).
- [ ] **N2-6 Import and export CSV.** Includes mapping CSV columns to properties.
- [ ] **N2-7 Tests.**
  - RLS on rows: a person sees a row only if they can see the database.
  - Tests with a 5,000-row database against the performance budget.

### Phase 3: More views and connected data (about 3 weeks)

- [ ] **N3-1 Calendar view** for any database with a date property (reuses the calendar screen).
- [ ] **N3-2 Gallery view** showing cards with cover images.
- [ ] **N3-3 Timeline view:** bars from start to end dates; drag to change dates; group by a property.
- [ ] **N3-4 Relations** between databases, both ways (for example, Projects ↔ Donors in CRM).
- [ ] **N3-5 Rollups:** count, sum, average, earliest and latest across a relation.
- [ ] **N3-6 Formulas.**
  - A safe, limited formula language: arithmetic, text, dates, if/then, `prop()`.
  - Calculated on the server, never run as arbitrary code.
  - Clear error messages in English and French.
- [ ] **N3-7 Link existing records.** Tasks, projects, documents, contacts and meetings can be mentioned and embedded in pages as live cards.

### Phase 4: Working together (about 3 weeks)

- [ ] **N4-1 Real-time co-editing (D2).** Changes appear for everyone within a second.
- [ ] **N4-2 Presence.** Avatars of who is on the page; each person's cursor in their colour.
- [ ] **N4-3 Comments on a selection.** Comment threads attached to highlighted text; resolve and reopen; a page-level comments panel.
- [ ] **N4-4 Notifications.** Mentions, replies, and changes to pages you follow; included in the inbox and the email digest.
- [ ] **N4-5 Edit safety.**
  - A page can be locked against edits.
  - "Suggest edits" mode for volunteers: changes wait for a staff member to accept them.

### Phase 5: Templates, automations and wiki (about 3 weeks)

- [ ] **N5-1 Page templates:** a gallery of starters, for example meeting notes, project brief, event plan, board minutes, grant report. Available in both languages.
- [ ] **N5-2 Database templates:** new rows start from a chosen template; a template can create tasks.
- [ ] **N5-3 Recurring pages:** for example, weekly meeting notes created every Monday (uses the job runner).
- [ ] **N5-4 Automations** that run "when a property changes to X": notify someone, set another property, or create a task. Admins can see a log of what ran.
- [ ] **N5-5 Wiki verification.** A page can be marked verified with an owner and an expiry date. It shows as "needs review" when expired, and the owner gets a reminder.
- [ ] **N5-6 Forms feed databases.** A form (#145) can add a row to any database.

### Phase 6: Import, export and sharing outside (about 2 weeks)

- [ ] **N6-1 Import:**
  - Markdown, HTML and Word (.docx) files become pages;
  - a Notion export (.zip) becomes pages and databases, keeping links between them.
- [ ] **N6-2 Export:** a page or a whole tree as Markdown or PDF; a database as CSV.
- [ ] **N6-3 Public pages (only if D5 is yes).** Read-only link, owner or admin only, clearly labelled, and can be withdrawn instantly.

### Phase 7: AI assistant (only if D6 is yes; about 2 weeks)

- [ ] **N7-1 Privacy decision and staff-notice update** before any code.
- [ ] **N7-2 In the editor:** summarize, draft, rewrite, translate between English and French.
- [ ] **N7-3 "Ask QBBE":** questions answered only from pages the asker can read, with links to the sources.

## Risks

| Risk | Effect | What we do |
|---|---|---|
| The editor fails accessibility (N0-1) | Staff using a screen reader can't write pages | Decided in Phase 0 before any build; fall back to plain Tiptap with our own accessible menus |
| Co-editing over Supabase Realtime is too slow or unreliable (N0-2) | Lost or jumbled edits | Spike with hard targets; fallback sync server on the always-on machine (D2) |
| Inherited access rules make pages slow | Slow sidebar and search | Access worked out once and cached per page, with a test proving it matches the full rule; measured in N0-4 |
| Moving tasks onto the engine breaks current work | Regressions in the most-used screens | Existing browser and security-rule tests must stay green; done behind a switch per organization until proven |
| Scope grows | Months without a release | Each phase ships on its own; "Left out" list above |
| Free-plan limits (database size, Realtime connections) | Staging or production hits a limit | Measured in Phase 0; flagged to you before we reach it |

## What I need from you

1. D4 (who sees a page): OK with the recommendation?
2. D5 (public pages): off, or on with the safeguards?
3. D6 (AI assistant): later/opt-in, never, or now?
4. Anything from Notion you use that isn't listed here.

Until you answer, I'll start Phase 0 (spikes and design), which doesn't depend on any of these.
