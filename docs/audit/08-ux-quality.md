# Domain audit — UI, UX, command palette, design system, quality

<!-- progress: 4 of 20 assessed — IN PROGRESS -->

Requirement families in scope: `P0-CMD-01`, `P0-QC-01`, `P0-UX-01..06`,
`P1-UX-07/08`, `UI-001..010` — 20 IDs total.

All paths are relative to `/home/user/QBBE-HUB`.

**Verification actually performed for this audit** (not inherited from docs):
`npm test` → 35 files, **350 tests, all passing**; `npm run lint` and
`npm run typecheck` → clean; `npm run build` → succeeds. `tests/e2e/public-routes.spec.ts`
runs in CI (`.github/workflows/ci.yml:46-56`) against a real Chromium.
`tests/e2e/qa-matrix.spec.ts` does **not** run in CI. Where a UX property is only
claimed in a comment and not asserted anywhere that executes, that is called out.

---

### P0-CMD-01 — Command palette
**Verdict:** Partial
**Requirement:** ⌘K/Ctrl-K opens a palette that searches and **runs safe navigation *and
create* actions**, keyboard-first and screen-reader accessible.
**Evidence:** Shortcut is global and platform-agnostic —
`src/components/layout/workspace-shell.tsx:47-56` binds `metaKey || ctrlKey` + `k` with
`preventDefault`. The palette itself
(`src/components/layout/command-palette.tsx:150-241`) is a native `<dialog>` opened with
`showModal()` (`:98`), so focus trapping and Escape-to-close come from the platform;
focus is moved into the input on open (`:102`). Keyboard-first: ArrowUp/ArrowDown/Enter
at `:137-148`. Screen-reader wiring is unusually careful — `role="combobox"` with
`aria-controls`, `aria-expanded`, `aria-autocomplete="list"` and, critically,
`aria-activedescendant` (`:169-177`) pointing at `role="option"` items with
`aria-selected` (`:215-221`); the "see all results" escape hatch and the empty message are
`role="presentation"` so the listbox owns only options (`:191-213`). Search goes through
the permission-safe `global_search` RPC, debounced 200 ms (`:108-127`).
**Gap:** Two things. (a) **The palette runs no create actions at all.** Its item list is
built from `visibleNav(...)` navigation destinations plus remote search results
(`command-palette.tsx:68-92`); there is no create command anywhere in the file, and the
quick-create menu it should mirror lives only in the topbar. The requirement says
"navigation/create actions"; only navigation is there. (b) **Nothing that executes tests
it.** The only palette test is
`tests/e2e/qa-matrix.spec.ts:150-167` ("command palette opens, searches, and navigates"),
and that suite needs a seeded QA database and is **not in CI**
(`.github/workflows/ci.yml` runs `public-routes` only, and
`docs/production-readiness-audit.md:22` already records the matrix as never verified).
Minor a11y caveat, untested either way: each `role="option"` wraps a focusable `<button>`
(`command-palette.tsx:215-236`), which is the nested-interactive pattern axe flags — the
options are reachable by Tab as well as by `aria-activedescendant`.

### P0-QC-01 — Global quick create
**Verdict:** Partial
**Requirement:** A global create control offers task, project request, meeting, event,
channel, announcement, CRM follow-up and other permitted items.
**Evidence:** `src/components/layout/topbar.tsx:126-141` builds a permission-filtered
create menu — Task for everyone; Project, Program, Meeting, Event, Channel, CRM
organization, CRM contact, CRM follow-up for staff; Announcement for admins. Rendered as
a `+` button with `aria-expanded` at `:168-192`. Every target is genuinely wired, not a
dead link: `?create=` is read and passed to a `defaultOpen` dialog on
`my-work/page.tsx:87` (task), `projects/page.tsx:76`, `programs/page.tsx:59`,
`meetings/page.tsx:106`, `events/page.tsx:106`, `channels/page.tsx:87-89`
(announcement + channel) and `crm/page.tsx:71,77,98` (organization, contact, follow-up).
The menu closes on outside click and on Escape with focus returned to the trigger
(`topbar.tsx:36-62`).
**Gap:** **"Project request" — the one intake item a non-staff user could actually
use — is not in the menu.** The staff-only "Project" entry creates a project directly
(`/projects?create=1`); the request path lives on `/requests`
(`src/app/(workspace)/requests/page.tsx:78-84`, "Propose something"), is member-level by
design (`src/config/navigation.ts:51`), and that page does not read a `create` search
param at all. So for a volunteer or ordinary member the global create menu contains
exactly one item, Task. Also no keyboard shortcut and no create entry in the palette
(see P0-CMD-01), and the menu is a plain `<div>` of links rather than a
`role="menu"`: the shared keyboard-navigable `Menu` primitive
(`src/components/ui/menu.tsx:20-135`, arrows/Enter/Escape/focus restore) exists and is
used in three feature components, but none of the three topbar dropdowns adopt it.

### P0-UX-01 — Persistent application shell
**Verdict:** Partial
**Requirement:** Sidebar, top bar, breadcrumbs, global search/command palette,
quick-create, notification control, theme control and user menu stay available across
major screens.
**Evidence:** One shell wraps every signed-in route —
`src/app/(workspace)/layout.tsx:86-101` renders `WorkspaceShell` for the whole
`(workspace)` group, and `src/components/layout/workspace-shell.tsx:58-101` composes
sidebar + topbar + command palette + mobile bottom nav around `{children}`. Seven of the
eight named elements are present and real:
sidebar with permission-aware live counts (`src/components/layout/sidebar.tsx:99-146`,
counts computed server-side at `layout.tsx:28-84`);
sticky topbar (`topbar.tsx:144`);
global search/palette trigger with a `⌘K` hint (`topbar.tsx:154-164`);
quick create (`topbar.tsx:168-192`);
notification control with unread badge and mark-all-read (`topbar.tsx:195-302`);
theme control (`topbar.tsx:323-331`) persisted in `localStorage` and applied before paint
by an inline script that also honours `prefers-color-scheme`
(`src/app/layout.tsx:20-28`);
user menu with settings/email-preferences/sign-out (`topbar.tsx:334-373`).
**Gap:** **There are no breadcrumbs anywhere in the product** — `grep -rn "readcrumb"
src/` returns nothing, and `PageHeader` (`src/components/shared/page-header.tsx:7-33`)
offers only `eyebrow`/`title`/`description`. Seven detail pages compensate with a
single-level `← Parent` link (e.g. `src/app/(workspace)/projects/[id]/page.tsx:122`,
`meetings/[id]/page.tsx:151`), which orients one level up but is not a trail; nested
surfaces such as `admin/retention` or a task drawer inside a project board give the reader
no path. Note the spec's own §5.2 tempers this ("breadcrumbs are used only where they add
orientation"), so this is a shortfall against the P0-UX-01 checklist rather than a
usability hole. Also missing from the topbar versus §5.2's list: **help**. No automated
test asserts the shell renders on any authenticated screen.

### P0-UX-02 — Responsive behaviour
**Verdict:** Partial
**Requirement:** Desktop, tablet and current mobile browsers support core work and
communication; navigation collapses without hiding required actions.
**Evidence:** The collapse is properly built, not a media-query hide. Desktop sidebar is
`hidden … lg:block` and the same nav is re-rendered on mobile as a real modal drawer with
focus trap, Escape, and focus restoration to the trigger
(`src/components/layout/sidebar.tsx:275-283`, `:286-359`). A fixed bottom navigation
carries Home / My Work / Channels / Calendar / More with 52 px targets and
`env(safe-area-inset-bottom)` (`src/components/layout/mobile-nav.tsx:37-83`), and `More`
opens the full drawer, so nothing is unreachable. `main` reserves `pb-24` on mobile to
clear it (`workspace-shell.tsx:85`). Every required topbar action stays visible at mobile
width — only the P1 density toggle is `md:` gated (`topbar.tsx:314`). Wide tables scroll
inside their own container rather than widening the page
(`src/components/ui/table.tsx:22-30`).
**Verified by execution:** `tests/e2e/public-routes.spec.ts:38-71` sweeps 1440/1280/1024/
768/390/320 in both themes and fails on >2 px horizontal overflow or a submit target under
36 px. It runs in CI (`.github/workflows/ci.yml:46-56`) and **I ran it here: 6/6 passed**
against Chromium.
**Gap:** **That sweep covers only `/sign-in` and `/sign-up`** (`public-routes.spec.ts:10-13`).
The equivalent authenticated sweep — 19 workspace routes × 6 widths × 2 themes, plus a
200 %-zoom pass — is `tests/e2e/qa-matrix.spec.ts:13-42, 77-147`, which needs a seeded QA
database and is **not wired into CI**; `docs/production-readiness-audit.md:22` states
plainly that no run of it has ever been recorded. So responsive behaviour of every screen
where the actual work happens is asserted by code review only. Concretely unverified:
the board, calendar week grid, and Master Schedule timeline are the three surfaces most
likely to overflow at 320 px and none has an executing check.
