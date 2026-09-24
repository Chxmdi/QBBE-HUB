# Epic 07 — UX, Design System & Accessibility: plan to completion

Written 2026-09-24 against `main` at `9e729bf`. Covers issue #17.

## The situation this plan starts from

All three child issues listed on #17 are closed: #48 (brand shell, PR #9),
#30 (My Work and board, PRs #10 and #66) and #49 (WebKit keyboard focus,
PR #61). The epic is still open because its success criteria are epic-wide,
not per-issue:

> Consistent design tokens/components are used across product surfaces;
> critical workflows expose loading/empty/error/retry states;
> keyboard/responsive/automated accessibility checks pass on supported
> browsers; UI PRs remain connected to real Supabase-backed behavior.

`docs/master-spec.md` §15 sets the bar at **WCAG 2.2 AA**, validated for
contrast, keyboard, visible focus, semantics, screen-reader labels, modals,
drawers, menus, tables, forms, Kanban alternatives, charts, reduced motion and
200% zoom. The requirement IDs in scope are `P0-UX-01..06`, `P1-UX-07/08`,
`UI-001..010`, `P0-CMD-01` and `P0-QC-01`. None of them is a row in
`docs/acceptance-matrix.md` today; their only assessment is
`docs/audit/08-ux-quality.md`.

Re-checked against current `main` for this plan, not inherited from the audit:

| Criterion | Finding |
|---|---|
| Automated accessibility on signed-in screens | **Not run in CI.** `qa-matrix.spec.ts` holds the axe scan, 6-width/2-theme sweep and 200% zoom check for 19 workspace routes, but CI's authenticated list omits it. Axe in CI covers only 3 public routes and one admin page. |
| Supported browsers | The signed-in suite runs in Chromium only. Firefox and WebKit run the public routes only. WebKit carries a silent retry (#89). |
| Error states | **24 of 36 workspace pages ignore query errors.** A failed database read renders as the empty state ("No projects yet"), and the retry boundary in `(workspace)/error.tsx` is never reached. |
| Loading states | One route-level `loading.tsx` for the whole workspace; `Skeleton` used in 3 files. |
| Bypass blocks (WCAG 2.4.1) | **No skip link.** |
| Focus not obscured (WCAG 2.4.11) | Sticky topbar and fixed mobile bottom nav, no `scroll-padding` to keep focused items clear of them. |
| Tokens | 15 hard-coded hex colours (onboarding, calendar week view, avatar palette, sidebar). No z-index or type-scale tokens. |
| Primitives | No select, checkbox, radio, switch, tooltip or popover; 5 files use bare `<select>`, 11 use bare checkboxes. |
| Reduced motion | OS preference honoured correctly; no in-app setting. |
| Shell | No breadcrumbs; topbar dropdowns (quick create, notifications, user) do not use the keyboard `Menu` primitive. |
| Command palette | Navigation and search only, no create actions; each option wraps a focusable button (nested interactive). |
| Quick create | No "propose a project" entry, so members and volunteers get one item. |
| Saved views | Written and deleted, never read — no way to list or apply one. |
| Isolated component review | None (no Storybook or equivalent). |

Already good and not reopened: dark mode as a token swap, reduced-motion CSS,
varied layout vocabulary, record-precise deep links, persisted density,
charts with `role="img"` plus a screen-reader data table.

So the shape of the work is: **make the checks run first, then fix what they
and this audit find, then record evidence.** Fixing before the checks run would
mean fixing blind and having no way to show it held.

## Sequence

Ordered by what the others depend on.

### 1. Make the evidence run — first, because everything else is measured by it

- Add `qa-matrix` to CI's authenticated Chromium list. CI already seeds the
  workspace and signs in as the QA users, so this is mostly wiring. Expect it
  to fail on first run; each failure is a finding for the steps below, not a
  reason to trim the suite.
- Extend the axe scan to **dark theme** and to **open overlays** (dialog,
  task drawer, command palette, mobile nav drawer, each topbar menu). Axe on a
  closed page never sees the surfaces most likely to fail.
- Run the signed-in accessibility set in **Firefox and WebKit** too.
  Decision needed (below): every PR or nightly.
- #89 (WebKit retry that hides a fault) belongs to epic 08, but WebKit results
  cannot be read as evidence for this epic until the retry at least reports
  itself. Do its first requirement here if it is still open.

### 2. Error and loading states — P0-UX-05, UI-006

- A small `must(result)` helper that throws on a Supabase error, applied to
  every query in the 24 pages, so failures reach the existing error boundary
  with its "Try again" button instead of pretending to be empty. Add a
  source-scan test (like `notification-links.test.ts`) that fails when a
  workspace page reads `{ data }` without handling `error`.
- A shared `ErrorState` component with retry, for client-side fetches that
  cannot use the route boundary: channel "load older", command palette
  search, notification list, task drawer loads.
- Per-route `loading.tsx` skeletons for the heaviest screens: board, My Work,
  calendar, project detail, CRM detail, channel. Built from `Skeleton` so
  they share one look.
- Permission-denied: detail pages already call `notFound()` for records the
  reader cannot see, which is the correct non-disclosing behaviour. Confirm
  every detail page does, and that `not-found.tsx` offers a way back.

### 3. Accessibility defects — WCAG 2.2 AA

- **Skip link** to the `main` landmark, first in the tab order (2.4.1).
- **`scroll-padding-top/bottom`** equal to the topbar and mobile-nav heights
  (2.4.11).
- Topbar quick-create, notifications and user dropdowns moved onto the `Menu`
  primitive (arrow keys, Escape, focus return, `role="menu"`).
- Command palette: options stop wrapping focusable buttons; selection stays on
  `aria-activedescendant`.
- The 4 `outline-none` uses each shown to keep a visible focus replacement.
- Whatever axe reports once step 1 runs on signed-in screens in both themes.
- **Reduced-motion user setting** (UI-009): a profile preference, a toggle in
  Settings, and a root class that the existing reduced-motion CSS also honours.

### 4. Design system completeness — UI-001, UI-003, UI-004, UI-008

- Tokens for **z-index layers** (base, sticky, drawer, dialog, toast, menu) and
  a **type scale**; replace the literal `z-40/z-50` and `text-[13.5px]`-style
  values as they are touched. Spacing stays on Tailwind's scale; record that
  as a decision rather than duplicate it.
- Replace the 15 hex literals with tokens, adding the missing dark-mode
  tokens the calendar was patching by hand.
- Primitives: **Select, Checkbox, Switch** (native elements, centrally styled,
  labelled), then Radio, Tooltip and Popover only where a screen needs them.
  Migrate the 5 selects and 11 checkboxes.
- **Component gallery** at a signed-in route (admin-only), rendering every
  primitive in every state — default, hover, focus, disabled, loading, error,
  empty, both themes. This is the "equivalent" UI-008 allows, it is where
  loading and error states get reviewed, and step 1's axe scan covers it.
- `docs/design-system.md`: tokens, primitives, and when to use a dialog, a
  drawer or a page (UI-010).

### 5. Shell and navigation gaps — P0-UX-01, P0-CMD-01, P0-QC-01, P1-UX-08

- Command palette gains the same permission-filtered **create actions** as
  quick create.
- Quick create gains **"Propose a project"** and `/requests` reads
  `?create=1`.
- **Saved views** listed and applied on My Work and the board (the missing
  query and a list; schema, policies and write paths exist).
- **Breadcrumbs** on nested surfaces only, where they add orientation (admin
  sub-pages, project/CRM/meeting/event detail), per spec §5.2.

### 6. Record and close

- Add rows for `P0-UX-01..06`, `P1-UX-07/08`, `UI-001..010`, `P0-CMD-01`,
  `P0-QC-01` to `docs/acceptance-matrix.md`, each with commit, CI run and test.
- Update `docs/audit/08-ux-quality.md` verdicts.
- Close #17 once every row it covers is verified or explicitly deferred with a
  reason.

## What each part needs before the epic can close

| Part | Done means |
|---|---|
| Evidence | `qa-matrix` and the overlay/dark axe scans run in CI and pass, on the browsers decided below |
| Error/loading | No workspace page swallows a query error (test enforces it); skeletons on the named screens; client fetches show retry |
| Accessibility | Skip link, focus-not-obscured, menus, palette fix, reduced-motion setting shipped; zero serious/critical axe violations signed-in, both themes |
| Design system | No hex literals in features; z-index and type tokens; Select/Checkbox/Switch in use; gallery route; design-system doc |
| Shell | Palette create actions, "Propose a project", saved views usable, breadcrumbs where useful |
| Record | Acceptance rows added and verified; audit doc updated |

## Needs a person, not code

- **Screen-reader pass.** Automated tools catch roughly a third of WCAG
  failures. One manual pass with VoiceOver (Safari) and NVDA (Firefox or
  Chrome) through sign-in, My Work, the task drawer, the board, a channel and
  the command palette is the honest minimum.
- **Brand sign-off.** #48 asked for "visual review against approved QBBE
  identity"; nothing records that it happened.
- **Real mobile Safari.** Covered by #57 (operator acceptance), not required
  to close this epic, but the automated WebKit run is a desktop engine.

## Decisions needed

1. **Browser coverage cost.** Running the signed-in suite in Firefox and
   WebKit on every PR adds roughly 10–15 minutes of CI. Alternative: every PR
   in Chromium, all three nightly and before a release.
2. **Child issues.** The work above is not tracked by any open issue. Create
   one child issue per part (2–5) under #17 so each PR closes something.
3. **Gallery vs Storybook.** The plan uses an in-app gallery (no new
   dependency, real tokens, real auth). Storybook is the alternative.

## Two risks worth naming now

- **The first CI run of `qa-matrix` will be red.** It has not run against
  current code in CI ever, and its only recorded pass (`f69fb11`) found two
  real defects. Budget for a round of fixes before anything else in this epic
  can be called verified.
- **The error-state change is visible to users.** Today a transient database
  failure looks like an empty list; afterwards it shows an error with retry.
  That is the requirement, but it will surface failures that were previously
  silent, so watch Admin → Jobs and error reports after it ships.
