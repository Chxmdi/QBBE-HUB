# Domain audit — UI, UX, command palette, design system, quality

**Complete — 20 of 20 assessed.**

**The shape of this family:** the design system is real where it is visible and
thin where it is not. Colour is thoroughly tokenized (43 of 54 tokens), the
layout vocabulary is varied rather than a wall of cards, deep links are
record-precise and safe by construction, and reduced motion is done with the
correct technique. What is missing clusters in two places — the states a
developer on a fast connection with an owner account never sees, and the
categories nobody had to look at to ship a screen.

Three findings lead:

1. **Six named primitives are absent** — select, checkbox, radio, switch,
   tooltip, popover — which is the whole form-control family except text input,
   plus both overlay primitives. Every form needing a select either uses a bare
   element or repeats one, which is what UI-004's "before duplicating" clause
   exists to prevent.
2. **Loading and error states are the gap, and predictably so.** `EmptyState`
   appears in 26 files; `Skeleton` in 3; there is no error/retry or
   permission-denied primitive at all. These are exactly the states that never
   appear in development, and UI-008 (no Storybook) removes the one environment
   where they would have been reviewed.
3. **Saved views are write-only.** `saved_view` has an insert and a delete and
   **no select anywhere** — a user can save a view and destroy it, but never
   list or apply one. Schema, policies and half the commands are built; what is
   missing is a query.

Two categories have no tokens at all: **spacing** and **z-index layers**. Spacing
falls back to Tailwind's scale, which is coherent but not QBBE's. Z-index is the
riskier one — with no layer tokens, the stacking of drawer over dialog over toast
is settled ad hoc per call site, which is how overlay bugs that only appear in
combination get made.

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
### P0-UX-03 / UI-001 — Design tokens centralized across colour, spacing, type, radius, elevation, motion and status — **Partial**

`src/design-system/styles/globals.css` defines **54 custom properties**, and the
distribution is lopsided:

| Category | Tokens |
|---|---|
| Colour (semantic, brand, surface, status) | 43 |
| Shadow / elevation | 4 |
| Radius | 3 |
| Motion (duration, easing) | 3 |
| Typography | 1 |

Colour is genuinely systematized and carries the whole semantic layer — surfaces,
ink, brand, accent, danger, muted — which is why components read
`bg-surface-soft`, `text-muted`, `text-danger-fg` rather than raw values.

**Two categories the requirement names have no tokens at all: spacing and
z-index layers.** Spacing runs on Tailwind's default scale, which is a coherent
system but not a QBBE one, so "centralized" is true only by inheritance and any
QBBE-specific rhythm cannot be expressed. Z-index is worse — with no layer
tokens, the stacking order of drawer over dialog over toast over menu is settled
ad hoc at each call site, which is exactly how overlay bugs that only appear in
combination get created. Typography has a single font token and no scale, so type
sizes are Tailwind literals too.

### UI-003 (P0) — No feature component hard-codes brand colours where a token exists — **Partial**

Mostly honoured, and the exceptions are real: **9 hard-coded hex values** remain
in feature components. Three are unambiguous violations:

- `src/features/onboarding/components/onboarding-flow.tsx:109` — `bg-[#221219]`,
  a brand-dark surface with no token reference.
- `src/features/calendar/components/week-view.tsx:22` — `dark:text-[#f2b8c8]`
- `src/features/calendar/components/week-view.tsx:23` — `text-[#7a5f1a]`

The week-view pair is the more instructive failure. Both sit beside token-based
classes (`bg-brand-soft text-brand-fg`, `bg-accent/20`) and exist only to patch
the *other* theme — someone found the token produced poor contrast in dark mode
and pinned a literal rather than adding a token for that state. So the dark theme
of the calendar is maintained by hand at two call sites and will drift the moment
the brand palette changes.

### UI-002 (P0) — Dark mode maintains equivalent hierarchy, contrast and behaviour — **Partial**

Dark mode is implemented as a token override (`.dark` at `globals.css:76`,
`html.dark:108`) rather than per-component overrides, which is the right
structure: components keep reading semantic tokens and the palette swaps beneath
them. Focus rings get their own dark treatment (`.dark :focus-visible:124`), so
the accessible affordance survives the swap rather than disappearing into the
ground.

Marked Partial rather than Complete for the reason above: the two `dark:text-[#...]`
literals in `week-view.tsx` are evidence that at least one surface did **not**
maintain equivalent contrast through the token layer and was corrected outside
it. Nothing measures contrast in either theme (see UI-007/TST-007), so how many
other surfaces are in that state is unknown.

### UI-004 (P0) — Accessible primitives built before duplicating — **Partial**

12 primitives exist in `src/components/ui/`: avatar, badge, button, dialog,
drawer, empty-state, input, menu, skeleton, table, tabs, toast. The command menu
exists as `src/components/layout/command-palette.tsx` — outside the primitives
directory, but it exists.

**Six of the named primitives are absent: select, checkbox, radio, switch,
tooltip, popover.** That is the entire form-control family except text input,
plus both transient-overlay primitives.

The consequence is the one the requirement's "before duplicating" clause is aimed
at: every form in the application that needs a select or a checkbox is either
using a bare HTML element with local styling, or repeating one. A native
`<select>` is a defensible choice — it is accessible and keyboard-correct by
default — but it is a choice nothing records, and it means select styling cannot
be changed centrally.

### P0-UX-05 / UI-006 (P0) — Every data surface has loading, empty, error/retry and permission-denied states — **Partial**

Empty states are well covered: `EmptyState` is used in **26** files across
features and routes, and the search page's is purposeful rather than blank.

Loading is not. `Skeleton` exists as a primitive but appears in only **3** files,
against 26 for `EmptyState` — so most data surfaces render nothing while loading
rather than a skeleton. Error/retry and permission-denied states have no shared
primitive at all; permission failures surface as whatever the RLS refusal
produced, and there is no retry affordance anywhere.

The asymmetry is the finding: the team built the primitive for the state that is
easy to see in development (empty) and skipped the ones that appear only under
latency and denial, which are exactly the states a developer on a fast connection
with an owner account never encounters.

### UI-007 (P0) — Hover, focus-visible, pressed, disabled, loading and destructive states; focus never removed — **Partial**

`focus-visible` is handled globally in `globals.css` (including a dark-mode
variant at `:124`), and `Button` supports `loading` and `disabled` — used
throughout, e.g. `agenda-triage.tsx`.

But `focus-visible` appears in only **2 of the 12 primitives** (`menu.tsx`,
`tabs.tsx`) as an explicit style, and there are **4 `outline-none` declarations**
in the codebase. Each of those four needs to pair with a replacement focus
affordance; the global rule supplies one, so this is probably safe — but "probably
safe, verified nowhere" is the accurate description, and the requirement's
sentence "Focus must not be removed for keyboard users" is precisely the thing
`outline-none` does when its replacement is missed.

No automated check asserts any of this. `public-routes.spec.ts` runs axe against
unauthenticated routes only, and axe does not test focus visibility. Every
interactive surface behind sign-in — which is all of the operational UI — is
unverified for focus behaviour.

### P0-UX-04 / UI-009 (P0/P1) — Reduced motion via OS preference *and* user setting — **Partial**

The OS half is done properly and thoroughly: `globals.css:129-137` reduces
animation duration, iteration count, transition duration and scroll behaviour
under `prefers-reduced-motion: reduce`, applied to `*`, `*::before` and
`*::after`. Using `0.01ms` rather than `none` is the correct technique — it
preserves `transitionend` events so state feedback does not break, which is the
clause UI-009 adds and the naive implementation gets wrong.

**The user setting does not exist.** `grep -rn "reduceMotion\|reduced_motion\|motionPref"`
returns nothing: no preference column, no toggle. A user on a shared or managed
machine who cannot change the OS setting has no way to reduce motion in the Hub,
which is the case the requirement's second clause is for.

Motion tokens exist (2 duration, 1 easing), so motion is systematized as UI-009
asks.

### UI-005 (P0) — Use cards selectively; vary page hierarchy — **Complete**

The layout vocabulary is genuinely varied rather than card-uniform: `Table` for
operational lists, `EmptyState` for absence, drawers and dialogs for focused
work, and section backgrounds and dividers driven by surface tokens
(`bg-surface-soft` and the `--color-surface-*` family, which is why 43 of the 54
tokens are colour). The dashboard mixes counts, a donut, a table and lists rather
than wrapping each in a card. No wall of cards.

### UI-010 (P1) — Drawers for contextual editing, full pages for complex configuration, modals for short decisions — **Partial**

The primitives exist and the modal side is used heavily: **13 files use `Dialog`,
1 uses `Drawer`.**

That ratio is the finding. The drawer exists precisely for "contextual editing
where retaining workspace context is valuable", and the application's most
obvious instance of that — the task drawer, built deliberately in earlier work —
is the single user. Everything else that could retain context (editing a risk
from the project page, an agenda item from the meeting, a contact from CRM) uses
a modal, which is the pattern the requirement reserves for short focused
decisions. The distinction the requirement draws is implemented as a capability
and not applied as a rule.

### P0-UX-06 (P0) — Deep links open the exact authorized record — **Complete**

Deep links are constructed centrally in `global_search`'s `href` column and are
record-precise rather than page-level: `/my-work?task=<id>`,
`/channels/<channel>?message=<id>`, `/projects/<id>?tab=risks&risk=<id>`,
`/crm/<org>?opportunity=<id>`, `/documents?document=<id>`, `/people?person=<id>`.
Every named target in the requirement — task, comment thread, channel message,
meeting, project, CRM record — has a form.

"Authorized" is guaranteed structurally rather than by a check at the link: the
destination page reads the record through RLS, so a link to a record the opener
cannot see resolves to a refusal, not a disclosure. A pasted or forwarded link
therefore cannot leak, which is the property that makes deep links safe to put in
an email.

### P1-UX-07 (P1) — User-configurable compact/comfortable density — **Complete**

Implemented and persisted server-side, not merely a client toggle:
`src/components/layout/topbar.tsx:304-319` offers the control, calls
`setDisplayDensity(next)` and refreshes, so the choice follows the user across
devices and sessions rather than living in one browser. Both values are typed
(`density?: "comfortable" | "compact"`, `:79`), the control carries an
`aria-label` naming the target state, and `Table` documents compact mode as a
supported behaviour (`src/components/ui/table.tsx:9`).

### P1-UX-08 (P1) — Users can save filters and layouts within their permission scope — **Missing (write-only)**

The `saved_view` table exists, is organization- and user-scoped, and is
**written but never read**. The only two references in the entire application are
in `src/features/admin/services/workflow.commands.ts`: an `insert` (`:24-27`) and
a `delete` (`:43-46`). There is no `select` against `saved_view` anywhere.

So a user can create a saved view and can delete one, but can never list their
saved views or apply one — the feature is unreachable from the UI in the only
direction that makes it a feature. The permission scoping the requirement asks
for is correctly in place (`user_id` on both write paths, plus RLS), guarding
data nobody can retrieve.

This is worth separating from the ordinary "Missing" verdicts: the schema, the
policies and half the commands were all built, so the remaining work is a query
and a list, not a feature.

### UI-008 (P1) — Storybook or equivalent isolated component environment — **Missing**

No `.storybook` directory and no storybook dependency in `package.json`, and no
equivalent (Ladle, Histoire, a component gallery route). Design-system review
therefore happens against live data only, which means the states the requirement
singles out — "states that are difficult to reach through live data" — are the
ones never reviewed. Loading and error states are precisely those states, which
is consistent with UI-006 finding `Skeleton` in 3 files and no error primitive at
all.

### P0-QC-01 / P0-CMD-01 — see the entries recorded earlier in this file.

