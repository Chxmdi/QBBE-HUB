# Workspace OS wave 2: plan, acceptance criteria and required tests

Wave 2 makes pages and data good enough for daily use: the rest of the editor
(Phase 1), templates that build hubs (Phase 2), a spreadsheet-grade table,
charts and more view layouts (Phase 3), and collaboration (Phase 4). It is 14
units, each one pull request to `main` behind a switch that already exists.

This document is the contract for every unit. **A unit is done only when every
acceptance criterion below has at least one passing test that would fail if
the criterion broke, and the PR body maps each criterion ID to its test.** The
lead reviews against this table, not against the description.

## 1. Step 0 (already on main before any unit starts)

Step 0 removes the shared files that caused wave 1's merge conflicts. Every
unit edits **only the files it owns** (section 4). The shared files below
already call every unit's slot; units fill in their own slot file.

| Slot | Owner files | Called from (do not edit) |
|---|---|---|
| Editor options, block specs, components inside and after the editor | `src/features/editor/adapter/blocknote/units/<id>-*.tsx` and `.css` (e1, e2, e3, e4, e5, c1) | `units/index.tsx`, `editor.tsx` |
| Block fallback when a block fails | `units/e3-blocks.tsx` (`BlockFallback`, `useBlockFallbackLabels`) | `block-frame.tsx` (wraps every custom block) |
| Lazy rendering of heavy blocks | `units/e5-performance.tsx` (`LazyBlock`) | `block-frame.tsx` |
| Editor strings | `src/features/editor/i18n/units/<id>.en.ts` and `.fr-CA.ts`, read as `t("units.<id>.…")` | `editor/i18n/en.ts`, `fr-CA.ts` |
| Lens strings | `src/features/lenses/i18n/units/<id>.*` (d1–d4) | `lenses/i18n/en.ts`, `fr-CA.ts` |
| Pages strings | `src/features/pages/i18n/units/<id>.*` (x1, c1, c2, c3) | `pages/i18n/en.ts`, `fr-CA.ts` |
| Table cell editing | `src/features/lenses/table/cell-editor.tsx`, `editable.ts`, `units/d1-grid.ts` (keys, copy, paste) | `table-lens.tsx` |
| Table totals row and column-menu entries | `src/features/lenses/table/units/d2-totals.tsx` | `table-lens.tsx` |
| View-block layouts | `src/features/lenses/view-block/layouts/d3.ids.ts` + `d3-layouts.tsx`; `d4.ids.ts` + `d4-layouts.tsx` | `layouts/index.tsx`, `schema.ts`, `view-config.tsx`, `view-block.tsx` |
| Page header buttons | `src/features/pages/components/units/c1-page-presence.tsx`, `c3-page-watch.tsx`, `x1-page-export.tsx` | `units/index.tsx`, `page-view.tsx` |
| Totals over a lens (permission-safe) | `public.lens_aggregate` (migration `20261110000000`) and `runLensAggregate` in `src/lib/query/aggregate.ts` | used by D2 and D3 |

`lens_aggregate` runs as the caller, so a total never counts a row the caller
cannot open. Its SQL tests (`supabase/tests/lens-aggregate.sql`) check every
fixture person at both sign-in levels against a direct count under RLS.

## 2. Rules for every unit

1. Work on branch `wave2/<id>` from the Step 0 commit on `main`. Never merge.
2. Edit only the files your unit owns (section 4) and new files you create.
   If you must touch another file, keep the change to one or two lines,
   explain it in the PR, and expect the lead to resolve it. Never edit
   `editor.css`, `units/index.tsx`, `layouts/index.tsx`, or another unit's files.
3. No new `page.tsx` routes. Use panels, dialogs, tabs and API routes instead.
4. Do not edit the seed (`scripts/seed*`). Tests create their own data through
   `sql()` in `tests/e2e/db.ts` and clean up after themselves.
5. Every new string exists in English and Québec French with exactly the same
   keys (the type checker enforces it).
6. RLS stays the authority. New tables get RLS, policies and SQL tests that try
   to read and write as a person who must be refused. Server actions check the
   session and validate input with zod. New write paths call `enforceRateLimit`.
7. Behind the switch named for the unit. With the switch off, nothing new is
   visible and nothing new can be called (test it).
8. Unit test files are `*.test.ts` (the runner does not pick up `.tsx`).
   Browser test titles end with `[switches on]` or `[switch off]`.
9. Commit messages are one plain sentence. No model names anywhere.
10. Before reporting, merge `origin/main` again and re-run everything.

### Required verification (paste the real output into the PR)

```
npm run typecheck && npm run lint && npm test          # all pass
npx supabase db reset --local && npm run db:seed
node scripts/test-db.mjs                                # all pass, including yours
npm run build                                           # full production build
# browser: your spec(s), twice in a row, both must pass
NO_PROXY='*' npx playwright test tests/e2e/<yours>.spec.ts --project=chromium --repeat-each=2
# and the neighbours you might break:
NO_PROXY='*' npx playwright test <neighbour specs listed for your unit> --project=chromium
```

Then drive the feature once by hand in the browser, take a screenshot, and read
it. Run the code-review skill on your diff and fix what it finds.

### States every user-facing feature must cover (each with a test)

Empty, loading, error (with a way to retry), no access, mobile width (320 px,
no horizontal scroll), French, keyboard only, and no serious or critical axe
finding with the feature open, in light and dark themes.

## 3. Units, acceptance criteria and required tests

Notation: **U** = unit test (vitest), **S** = SQL test, **B** = browser test.
Every criterion needs at least the test types listed.

### E1 — Paste and Markdown shortcuts (switch `wos_editor`)

| ID | Criterion | Tests |
|---|---|---|
| E1-1 | Pasting rich text (HTML) keeps headings, bold, italic, links, lists and quotes as editor blocks. | U, B |
| E1-2 | Pasting Markdown text turns it into the same blocks as typing it. | U, B |
| E1-3 | Pasting cells copied from a spreadsheet (tab-separated, with or without HTML table) makes a table block with the same rows and columns. | U, B |
| E1-4 | Pasting an image or file uploads it through the existing scanned upload and inserts an image or file block; while the scan is pending the block says so. | U, B |
| E1-5 | Pasting unsafe HTML (script, event handlers, javascript: links, iframes) inserts only safe text; nothing runs. | U, B |
| E1-6 | Every Markdown shortcut works when typed at the start of a line: `#`–`######`, `-`/`*`, `1.`, `[]`, `>`, `---`, ```` ``` ````, and `>!` makes a callout. | U, B |
| E1-7 | Pasting more than the editor's size limit shows the existing "too large" state instead of freezing. | U, B |
Neighbour specs: `wos-editor`, `editor-blocks`, `editor-save-queue`.

### E2 — Undo history and keyboard shortcuts (switch `wos_editor`)

| ID | Criterion | Tests |
|---|---|---|
| E2-1 | Undo and redo work across typing, block creation, move, turn-into, colour, duplicate and delete, each one step. | U, B |
| E2-2 | Undo stops at the page's opened state (or the last restore) and says "Nothing more to undo" to screen readers. | B |
| E2-3 | Undo and redo have buttons with names, and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y work. | B |
| E2-4 | A keyboard-shortcuts dialog (opened with `?` outside text and from a button) lists every shortcut the editor supports, in both languages, and is fully keyboard navigable. | U, B |
| E2-5 | An undo that would affect another person's change is not offered silently: after a save from elsewhere the history starts again. | U, B |
Neighbour specs: `wos-editor`, `editor-save-queue`.

### E3 — Code and media blocks, block fallbacks (switch `wos_editor`)

| ID | Criterion | Tests |
|---|---|---|
| E3-1 | Code blocks have a language picker (at least plain text, JavaScript, TypeScript, Python, SQL, JSON, HTML, CSS, Bash) and a copy button that copies the exact code. | U, B |
| E3-2 | Image, video, audio and file blocks have a caption and an accessible name; an image without alt text asks for it. | U, B |
| E3-3 | A block that fails to render shows the fallback with "Try again"; the rest of the page keeps working and saving. | U, B |
| E3-4 | An invalid or unsupported embed or file never breaks the page; it shows its own readable message. | U, B |
| E3-5 | Every block type has a readable empty state (what to do next). | B |
Neighbour specs: `editor-blocks`, `wos-blocks`, `editor-layout-blocks`.

### E4 — Mobile editing (switches `wos_editor` + `wos_mobile`)

| ID | Criterion | Tests |
|---|---|---|
| E4-1 | At 390 px and 320 px the editor has no horizontal scroll and a touch toolbar with bold, italic, link, list, checklist, heading, undo and redo. | B |
| E4-2 | Each block can be moved up and down and opened in the block menu by touch (buttons at least 24 px). | B |
| E4-3 | The slash menu, block menu and formatting toolbar fit on screen at 320 px and are dismissible. | B |
| E4-4 | Nothing changes on desktop widths. | B |
Neighbour specs: `wos-editor`, `wos-mobile` (if present), `qa-matrix` routes.

### E5 — Speed on long pages (switch `wos_editor`)

| ID | Criterion | Tests |
|---|---|---|
| E5-1 | A 100-block page opens with no layout shift above 0.1 (measured CLS) and is editable within the measured budget recorded in the PR. | B |
| E5-2 | View blocks and embeds render only when near the screen, keeping their height so nothing jumps; scrolling to them renders them. | U, B |
| E5-3 | Time to open and time until typing works are measured separately (performance marks) and exposed for tests. | U, B |
| E5-4 | A 500-block page stays usable: typing at the end appears within 100 ms per key (recorded). | B |
| E5-5 | Lazy blocks are still found by in-page search and by the table of contents anchors. | B |
Neighbour specs: `editor-view-block`, `editor-layout-blocks`, `wos-editor`.

### T1 — Templates that build hubs, with versions (switch `wos_pages`)

| ID | Criterion | Tests |
|---|---|---|
| T1-1 | A template can contain any block in the registry, including view blocks, task and decision blocks and checklists. | U, S, B |
| T1-2 | "Use template" with a start date creates the page, its tasks and milestones with resolved dates, and a task view filtered to them. | S, B |
| T1-3 | The preview renders the template in the real editor, read-only. | B |
| T1-4 | Editing a template creates a new version; pages made from an older version keep their content and show which version they came from. | S, B |
| T1-5 | Duplicating a template copies none of the source's private data (private pages, people not in the copier's organization, private comments). | S, B |
| T1-6 | Someone who cannot see a template cannot use, preview or duplicate it. | S, B |
Database change: yes (versions). Neighbour specs: `page-templates`, `templates-v2`, `wos-pages`.

### D1 — Spreadsheet-style table: cells (switches `wos_lenses` + `wos_objects`)

| ID | Criterion | Tests |
|---|---|---|
| D1-1 | Every property kind the table shows can be edited in place by someone allowed to edit: text, number, date, select, multi-select, person, checkbox, relation, URL, email. | U, B |
| D1-2 | Arrow keys, Tab, Enter, Escape, Home/End and Page Up/Down move and edit like a spreadsheet; F2 or Enter edits, Escape cancels. | U, B |
| D1-3 | Copying a range of cells puts tab-separated text on the clipboard; pasting a range fills cells the person can edit and skips the rest, saying how many were skipped. | U, B |
| D1-4 | Every cell change is recorded as a change set and can be undone. | S, B |
| D1-5 | Invalid values (bad date, text in a number) are refused with a message and nothing is saved. | U, B |
| D1-6 | Someone who cannot edit a record sees its cells read-only; the server refuses a forged edit. | S, B |
Neighbour specs: `lenses-table`, `lens-view-engine`, `lens-csv`.

### D2 — Spreadsheet-style table: columns (switch `wos_lenses`)

| ID | Criterion | Tests |
|---|---|---|
| D2-1 | A totals row offers count, empty, filled, sum, average, minimum and maximum per column (by kind), computed by `lens_aggregate` over every matching row, not only the loaded page. | U, S, B |
| D2-2 | Totals never include rows the viewer cannot open (two viewers, different totals, both correct). | S, B |
| D2-3 | Totals follow the table's filters and grouping; each group shows its own totals. | U, B |
| D2-4 | The totals choice per column is kept with the viewer's settings. | U, B |
| D2-5 | Admins can add, rename and hide a column (property) from the column menu; others do not see those entries and the server refuses them. | S, B |
Database change: only if needed for D2-4/D2-5. Neighbour specs: `lenses-table`, `lens-view-engine`.

### D3 — Charts (switch `wos_lenses`)

| ID | Criterion | Tests |
|---|---|---|
| D3-1 | A "Chart" layout in the view block shows bar, line, pie or a single number, by a grouping property and a total (count, sum, average). | U, B |
| D3-2 | Dashboards can add the same chart as a tile. | B |
| D3-3 | Charts use `lens_aggregate`, so they never count records the viewer cannot open. | S, B |
| D3-4 | Every chart has a text alternative (a table of its numbers) and works in both themes. | U, B |
| D3-5 | Empty, loading and error states are readable. | B |
Neighbour specs: `editor-view-block`, `lenses-dashboard`.

### D4 — More view layouts (switch `wos_lenses`)

| ID | Criterion | Tests |
|---|---|---|
| D4-1 | The view block offers timeline, gallery (with cover property) and feed layouts using the shared view settings. | U, B |
| D4-2 | Timeline places records by start and end dates, handles missing dates, and is keyboard navigable. | U, B |
| D4-3 | Each layout respects filters, sort and page-local filters exactly as the table does. | U, B |
| D4-4 | Each layout works at 320 px and passes axe in both themes. | B |
Neighbour specs: `editor-view-block`, `lenses-timeline`, `lenses-gallery-feed`.

### X1 — Page export and import (switch `wos_pages`)

| ID | Criterion | Tests |
|---|---|---|
| X1-1 | "Export" downloads the page as Markdown that round-trips its text blocks (headings, lists, checklists, quotes, code, tables). | U, B |
| X1-2 | View blocks in the page export as CSV files (zipped with the Markdown) with only the rows the exporter can see. | U, S, B |
| X1-3 | "Import" accepts a Markdown or HTML file and creates a new page with the same blocks; unsafe HTML is stripped. | U, B |
| X1-4 | Export and import are refused for people without access; imports are size-limited and rate-limited. | U, B |
Neighbour specs: `wos-pages`, `lens-csv`.

### C1 — Live presence and co-editing (switches `wos_pages` + `wos_editor`)

| ID | Criterion | Tests |
|---|---|---|
| C1-1 | People on the same page see each other's names and colours in the header and their cursors in the text. | B |
| C1-2 | Two people typing in different blocks of the same page both keep all their text, and the saved page has both (no silent loss). | B |
| C1-3 | Two people typing in the same block both keep their text, or the conflict dialog appears; never a silent loss. | B |
| C1-4 | Presence never shows someone who cannot open the page, and leaves within 30 s of a tab closing. | S, B |
| C1-5 | If live co-editing cannot meet C1-2 reliably (20 repeated runs), the unit ships presence plus an "also editing" notice instead and says so in the PR. | B |
Neighbour specs: `editor-save-queue`, `page-collab`, `wos-editor`.

### C2 — Activity history (switches `wos_pages` + `wos_objects`)

| ID | Criterion | Tests |
|---|---|---|
| C2-1 | Page, block (added, moved, removed), property, permission and relation changes are recorded with event names `<type>.<verb>` (for example `page.updated`, `block.moved`). | U, S |
| C2-2 | Pages and records have an Activity tab listing who did what and when, newest first, in the reader's language. | B |
| C2-3 | Restoring a version adds an activity entry and keeps the history before it. | S, B |
| C2-4 | Permission changes appear in activity. | S, B |
| C2-5 | Nobody sees activity about objects they cannot open. | S, B |
Database change: yes. Neighbour specs: `page-collab`, `record-page`.

### C3 — Watched pages and notifications (switch `wos_pages`)

| ID | Criterion | Tests |
|---|---|---|
| C3-1 | People can watch and unwatch a page; watchers are notified of comments and replies on it. | S, B |
| C3-2 | A mention in a page comment notifies the mentioned person, once, if they can open the page. | S, B |
| C3-3 | Notification preferences have categories for mentions, assigned work, comments, approvals and watched pages, and each one is honoured. | U, S, B |
| C3-4 | A comment stays attached to its block after blocks above it are added, moved or removed, and after a reload. | B |
| C3-5 | Nobody is notified about a page they cannot open. | S |
Database change: yes. Neighbour specs: `page-collab`, notifications specs.

## 4. File ownership

| Unit | Owns |
|---|---|
| E1 | `units/e1-paste.*`, `editor/i18n/units/e1.*`, new files under `editor/adapter/paste/` |
| E2 | `units/e2-history.*`, `editor/i18n/units/e2.*`, new files under `editor/adapter/history/` |
| E3 | `units/e3-blocks.*`, `editor/i18n/units/e3.*`, `adapter/blocknote/blocks.tsx` (embed/bookmark views only), new files |
| E4 | `units/e4-mobile.*`, `editor/i18n/units/e4.*`, new files |
| E5 | `units/e5-performance.*`, `editor/i18n/units/e5.*`, new files |
| T1 | `src/features/templates-v2/**`, `pages/components/new-page-from-template.tsx`, its migration and SQL test |
| D1 | `table/cell-editor.tsx`, `table/editable.ts`, `table/units/d1-grid.ts`, `lenses/services/lens.actions.ts` (cell update only), `lenses/i18n/units/d1.*` |
| D2 | `table/units/d2-totals.tsx`, `lenses/i18n/units/d2.*`, new files |
| D3 | `view-block/layouts/d3*`, `lenses/dashboard/**`, `lenses/i18n/units/d3.*` |
| D4 | `view-block/layouts/d4*`, `lenses/i18n/units/d4.*` |
| X1 | `pages/components/units/x1-page-export.tsx`, `pages/components/pages-sidebar.tsx` (import entry only), `pages/i18n/units/x1.*`, new API routes |
| C1 | `units/c1-presence.*`, `pages/components/units/c1-page-presence.tsx`, `editor/i18n/units/c1.*`, `pages/i18n/units/c1.*` |
| C2 | `pages/components/page-collab*.tsx`, `objects/components/record-page.tsx` (activity tab only), `pages/i18n/units/c2.*`, its migration |
| C3 | `pages/components/units/c3-page-watch.tsx`, `src/features/notifications/**`, `pages/i18n/units/c3.*`, its migration |

Reserved migration timestamps: T1 `20261110010000`, D2 `20261110020000`,
C2 `20261110030000`, C3 `20261110040000`, D1 `20261110050000`,
X1 `20261110060000`, C1 `20261110070000`. Use yours only.

## 5. Merge order and checks by the lead

Editor units merge in order E1, E2, E3, E4, E5 (C1 after E5); the others merge
as they arrive. Before each merge the lead checks: every criterion ID has a
passing test named in the PR; CI green on the head; the branch is current with
`main`; a combined local run of the unit's specs and its neighbours.

## 6. Known environment issue

Once in wave 1, a browser test on CI waited ten minutes for the home page and
the local database then refused a sign-in token as "issued in the future".
Local PostgREST (v16.4) never showed this in hundreds of runs; it matches the CI
machine's clock stepping during the run. If it recurs, check the runner's clock
before suspecting the code.
