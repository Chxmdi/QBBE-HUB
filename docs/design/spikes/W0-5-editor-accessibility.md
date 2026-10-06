# W0-5 spike: editor accessibility (BlockNote)

Written 2026-09-30 by the S3 Editor session. Epic #199. Same as P0-1 in
`docs/plans/workspace-os-plan.md`.

## Decision

**GO for BlockNote 0.55.0 with its Ariakit interface. Final.** The five
conditions in section 4 are built into M4b (the block editor). A plain-Tiptap
fallback is **not needed**, so none was prototyped.

The screen-reader check in section 6, the last open item, was run by QBBE and
**passed** (reported 2026-09-30).


Why it is a go:

- **Every standard block type can be created with the keyboard only.** That
  covers 22 types through the slash menu, plus emoji.
- **The slash menu is built the accessible way.** It follows the standard
  pattern for a text box with a pop-up list ("combobox and listbox"), so a
  screen reader can follow the highlighted option.
- **Blocks can be moved, and changed into other types, without a mouse.**
- **There is no keyboard trap.** A keyboard user can always leave the editor.
- **The layout holds at 200% zoom, and French works.** That includes accents
  typed directly and accents typed with a "dead key" (an accent key that
  combines with the next letter).

What fails as shipped is BlockNote's **surrounding interface**, not its
editing model:

- the formatting toolbar and the drag handle cannot be reached from the
  keyboard;
- several controls have no accessible name;
- there is no visible focus ring;
- one colour contrast fails;
- the check-list boxes are too small to tap.

The spike fixed the most important of these in our own code, in about 150
lines, and measured the difference (section 3). The rest are fixable the
same way.

## 1. What was tested and how

- **Where:** `/dev/editor-spike`. It returns "not found" in production (the
  gate is explained in section 7).
  - `?raw=1` shows BlockNote exactly as shipped.
  - Without it, the page applies the spike's fixes.
- **Build:** the optimised production build (`next build`), started with
  `ENABLE_DEV_SPIKES=1` against the local Supabase database. Tested in
  Chromium.
- **Tests:** `tests/spikes/editor-a11y.spike.ts`, 5 tests.
  - All passed on the final run on 2026-09-30.
  - Raw results are in `evidence/w0-5-*.json`.
  - How to re-run them: section 8.
- **Scanner:** axe, the same accessibility scanner and rule set as the
  existing `qa-matrix` check (WCAG 2.0, 2.1 and 2.2, levels A and AA). It
  scanned each state below in light and dark themes, with and without the
  fixes:
  - editor at rest;
  - slash menu open;
  - formatting toolbar open;
  - drag handle showing;
  - block menu open.

## 2. Results

### Keyboard-only journey (both modes)

"Raw" is BlockNote as shipped. "With fixes" adds the spike's fixes from
section 3.

| Check | Raw | With fixes | Evidence / notes |
|---|---|---|---|
| Tab from the top of the page reaches the editor | Pass (1 Tab) | Pass | |
| Slash menu creates each type: headings 1 to 6, toggle headings 1 to 3, quote, toggle list, numbered, bullet and check lists, paragraph, code block, divider, table, image, video, audio, file | **Pass, 22 of 22** | **Pass, 22 of 22** | Arrow keys only, no mouse. Up to 21 Down presses to reach a type; typing a filter word shortens that. |
| Emoji picker inserts an emoji | Pass | Pass | ARIA problem: see F7 in section 4 |
| Slash menu navigation | Pass | Pass | Up/Down move the highlight and wrap past the top. Typing filters the list. Escape closes it. The editor's `aria-expanded` and `aria-activedescendant` attributes track the menu. |
| Move a block up or down | Pass | Pass | Ctrl+Shift+Up / Ctrl+Shift+Down. The caret stays in the moved block. |
| Turn into another type: shortcut | Pass | Pass | Ctrl+Alt+1 to 6 for headings, Ctrl+Alt+0 for paragraph, Ctrl+Shift+6 to 9 for lists |
| Turn into another type: Markdown | Pass | Pass | Typing `## ` makes a heading 2 |
| Turn into another type: slash menu on a block that already has text | Inserts a new block rather than converting | Same | Not a failure: the shortcuts and the toolbar cover converting |
| Leave a code block | Pass | Pass | Shift+Enter, or Enter three times |
| Move between table cells | Pass | Pass | Tab and Shift+Tab |
| **Get below a table that is the last block** | **Fail** | **Fail** | No key moves the caret out of the table. See F5. |
| **Formatting toolbar from the keyboard** | **Fail** | **Pass** | Alt+F10 (the fix) moves into the toolbar. Arrows move between buttons. Enter applies bold. Escape returns to the text. |
| **Drag handle and block menu from the keyboard** | **Fail** | **Fail** | They appear only on mouse hover. Their actions have keyboard routes: moving (Ctrl+Shift+arrows), deleting (select and Delete) and colours (toolbar). |
| No keyboard trap | Pass | Pass | Tab leaves after at most 2 presses (the first may indent a list item or visit a check box). In a table, Tab moves cells; Escape then Tab leaves. |
| Visible focus on the editor | **Fail** (outline removed) | **Pass** | 2 px brand-colour outline |

An earlier single-press measurement suggested a keyboard trap. It was wrong:
the first Tab indents a list item, and the second Tab leaves. It has been
corrected above.

### 200% zoom (viewport halved, as `qa-matrix` does)

- The page does not scroll sideways (0 px overflow).
- The slash menu (310 px wide) fits inside the 640 px width.
- The formatting toolbar wraps to fit the width.

### Quebec French

- The page `lang` is `fr-CA`, and the editor inherits it, so spell-check
  and screen readers use French.
- BlockNote's own French dictionary translates the menus ("Titre 1",
  "Liste à puces" and so on). Typing `/titre` and `/liste` filters as
  expected.
- Typing this text key by key stored it exactly:
  `Élève à l’école : « Ça va? » — œuvre, naïve, Noël, où, çà, ÀÉÈÊËÎÏÔÙÛÜŸÇ`
- Dead-key composition (´ then e, ` then e, ^ then e, ¨ then e) stored
  exactly `éèêë`. This was simulated with the browser's input-method
  interface.
- One condition: BlockNote's dictionary is **France French**. Its wording
  must go to QBBE's French reviewer (#141), and some strings will need a
  Quebec override. Example: "Diviseur" for divider; "Séparateur" is more
  natural.

### axe violations

"Raw" is BlockNote as shipped. "With fixes" adds the spike's fixes from
section 3. "States" counts theme-and-state combinations out of 10: five
states, each in light and dark.

| Rule | Impact | Raw: states | With fixes: states | What it is |
|---|---|---|---|---|
| `aria-input-field-name` | serious | 10 of 10 | 2 of 10 (slash list only) | The editor had no name (fixed: "Document content"). The slash list still has none. |
| `label` | critical | 10 of 10 | 10 of 10 | The check-list check box has no label |
| `target-size` | serious | 10 of 10 | **0** | Check box was 12 × 24 px (fixed with CSS: 24 × 24) |
| `aria-allowed-attr` | critical | 8 of 10 | 8 of 10 | `aria-expanded` is set on `role="textbox"`, which does not allow it (see F6) |
| `button-name` | critical | 5 of 10 | 6 of 10 | The toolbar's block-type select has no name (the count depends on whether the toolbar is still showing at the moment of the scan) |
| `color-contrast` | serious | 1 of 10 | 2 of 10 | Raw: the highlighted slash option was white on #067dcd (4.35:1; fixed with the brand tokens). Left over: a 1.1:1 reading on the block-type select while the block menu opens, which is probably its fade-in animation being scanned mid-way. Confirm when theming. Earlier runs also flagged the grey slash group labels (3.97:1); retheme them anyway. |
| `scrollable-region-focusable` | serious | 2 of 10 | 2 of 10 | The slash list scrolls but cannot take focus. Harmless in practice: focus stays in the editor, which points at the highlighted option. Still fix, so the scan is clean. |
| `aria-hidden-focus` | serious | 2 of 10 | 2 of 10 | Ariakit's focus-guard elements around the block menu |

Every remaining item can be fixed in our theme or with small attribute
patches. None needs a change to BlockNote's editing model. The full list,
with element selectors, is in `evidence/w0-5-axe.json`.

## 3. The fixes the spike prototyped

The fixes are in `src/features/editor/spike/editor-spike-inner.tsx` and
`editor-spike.css`. All but the last were measured above.

1. **Editor name and description.** Uses BlockNote's own `domAttributes`
   option.
   - The editor gets `aria-label="Document content"` / "Contenu du document".
   - It also gets an `aria-describedby` hint listing the keys: `/`, Alt+F10,
     Escape then Tab, and Ctrl+Shift+Up/Down.
2. **Focus ring** (WCAG 2.4.7). The design system's `:focus-visible` outline
   is put back on the editor.
3. **Contrast** (WCAG 1.4.3). The highlighted slash option uses
   `--color-brand-fg` on `--color-brand-soft`, which pass in both themes.
4. **Target size** (WCAG 2.5.8). Check-list boxes are 24 × 24 px.
5. **Alt+F10 moves into the formatting toolbar**, following the standard
   toolbar convention. Escape returns to the text.
   - BlockNote keeps the toolbar open while focus is inside it, so no patch
     was needed.
   - One catch: pressing Alt+F10 before the toolbar has appeared does
     nothing, because the toolbar appears a moment after text is selected.
6. **Escape then Tab always leaves the editor.** This copies the editor
   CodeMirror (the same convention GitHub uses). It makes leaving predictable
   inside tables and lists, where Tab is taken for other things.

## 4. Findings to carry into M4b

| # | Finding | Severity | Plan |
|---|---|---|---|
| F1 | The formatting toolbar is mouse-only as shipped | High | Keep fix 5; add a browser test |
| F2 | The drag handle and block menu are mouse-only | Medium | All their actions have keyboard routes. Also add "Move up / Move down / Delete / Turn into" to a block menu opened by a key (proposed: Ctrl+/), built from our `Menu` primitive |
| F3 | Missing names: slash list, block-type select, check boxes | High (critical in axe) | Set by our wrapper. Check boxes need a custom check-list block, or an upstream fix |
| F4 | No focus ring; 2 contrast failures; small check boxes | High | Our theme (fixes 2–4); retheme the group labels |
| F5 | The caret cannot get below a table that is the last block | Medium | Add an empty paragraph after a final table, or a key binding. Report upstream. |
| F6 | `aria-expanded` on a `textbox` breaks the ARIA rules | Low for users, but critical in axe | Screen readers announce the highlighted option correctly through `aria-activedescendant`. Section 6 confirms that. Then either take `aria-expanded` out in our wrapper or open an upstream issue. |
| F7 | The emoji picker is `role="grid"` holding `role="option"` items, and the editor keeps pointing at the old slash list while it is open | Medium | Screen readers probably say nothing while picking an emoji. Hide the emoji item for now (typing `:` stays available) until fixed upstream. |
| F8 | The French dictionary is France French | Low | Quebec overrides, reviewed under #141 |

## 5. Dependencies, licences and size

| Package | Version (pinned) | Licence |
|---|---|---|
| `@blocknote/core`, `@blocknote/react`, `@blocknote/ariakit` | 0.55.0 | MPL-2.0 |
| `yjs`, `y-protocols`, `y-prosemirror` (for W0-6) | 13.6.33, 1.0.7, 1.3.7 | MIT |
| Brought in by these: Tiptap 3.31, ProseMirror, Ariakit 0.4.40, emoji-mart 5.6 | | MIT |

- **No paid "XL" packages** (`@blocknote/xl-*`, which are GPL or commercial)
  are used.
- **No copyleft licence anywhere** in the installed dependency tree. This
  was checked with a script over `package-lock.json`.
- **MPL-2.0** is file-level: if we change BlockNote's own files, those
  changed files must stay public. Wrapping, theming and extending it from our
  code is fine.
- **Size:** the editor route's JavaScript is **1.05 MB raw, 323 KB
  gzip-compressed**, across 6 chunks, including Yjs.
  - It loads only on pages with the editor: `next/dynamic` with server
    rendering turned off.
  - The shared bundle is unchanged.
  - The emoji data is a large part. If it is dropped (see F7), measure again.

## 6. Screen-reader check — passed

**Result: passed.** QBBE ran this script and reported on 2026-09-30 that the
screen-reader test is good. The go in "Decision" is therefore final.

The report did not include step-by-step notes: what VoiceOver and NVDA said
at each step, and which browsers were used. If they are sent later, add them
here. They are the baseline for the M4b screen-reader regression check.

The script as it was run follows.

This could not run in the cloud container, which is why it needed a person.
It was **the one outstanding check before the go was final**. A result of "Fail" on steps 3, 4, 5 or 8 in
either screen reader turns the go into a no-go. The fallback then is plain
Tiptap with our own menus (section 9).

**Before you start**

1. Ask the S3 session for the spike build, running on a machine you can
   reach. Or run it yourself with the commands in section 8.
2. Sign in as `qa-staff@example.com`, password `QaTest!2026`.
3. Open `http://127.0.0.1:3000/dev/editor-spike` in the browser named for
   each screen reader:
   - **VoiceOver** (macOS): Safari. Turn it on with Cmd+F5.
   - **NVDA** (Windows): Firefox, then Chrome. NVDA is free from nvaccess.org.
4. Do every step twice, once for each screen reader. Write down, word for
   word, what it says.
5. If a step fails, note the step number, the screen reader, the browser and
   what was said. Then reload the page and go on to the next step.

**Steps.** What you should hear is after each step.

1. **Press Tab until the editor has focus.**
   You should hear: "Document content, edit text" (VoiceOver) or "Document
   content, editable" (NVDA), then the key-hint sentence.
   Failure: silence, or "group" with no name.
2. **Press Ctrl+End.** Then, in NVDA, press Enter to switch to focus mode if
   it has not switched already.
   You should hear the last line, "Send the minutes", and that it is a
   check box or list item.
3. **Press Enter, then type `/`.**
   You should hear that a list is available, then "Heading 1, Top-level
   heading, Ctrl-Alt-1", or similar.
   Failure: nothing is said about the menu.
4. **Press Down 3 times.**
   You should hear each option read as it becomes highlighted: "Heading 2",
   "Heading 3", "Quote".
   Failure: silence, or the text of the line read again.
5. **Press Enter, then type "Test quote".**
   You should hear the menu close and your typing echoed.
6. **Press Ctrl+Shift+Up.**
   The block moves up one place. Check with the reading keys: VoiceOver
   Ctrl+Option+Up, NVDA Up arrow.
   Note what, if anything, is announced. The move is expected to be silent.
   That is a finding, not a failure.
7. **Select the line with Shift+Home, then press Alt+F10.**
   You should hear "Toolbar", then the first button ("Heading 2" or
   "Paragraph", the block-type select).
8. **Press Right, then Enter.**
   You should hear "Bold", then that it is pressed or on.
   Then **press Escape.** You should hear your text again; focus is back in
   the editor.
9. **Type `/`, type `titre`**, after switching the language to French by
   setting the `qbbe-locale=fr-CA` cookie and reloading.
   You should hear French: "Titre 1…", spoken with a French voice.
10. **Press Escape, then Tab.**
    You should hear that focus has left the editor and moved to whatever
    comes next (or the browser toolbar).
    Failure: focus stays in the editor.

Send the notes to the S3 session, or post them on #199. S3 records the
result in this file and ticks P0-1.

## 7. How the spike is kept out of production

- `src/features/editor/spike/enabled.ts` serves the route only when either:
  - the app runs on a development server (`NODE_ENV` is not "production"); or
  - `ENABLE_DEV_SPIKES=1` is set **and** the Supabase address is on the
    machine itself (127.0.0.1 or localhost).
- A hosted deploy can never meet the second condition, even if the variable
  is set by mistake. Unit tests cover all four cases.
- The route also needs a signed-in session, and tells search engines not to
  index it.
- CI builds with a placeholder hosted address, so the route is a 404 there.
  It is in no route list, so the accessibility and route sweeps
  (`public-routes`, `qa-matrix`, `role-matrix`) never visit it.
- The spike tests live in `tests/spikes/` with their own
  `playwright.spikes.config.ts`. CI's `tests/e2e/*.spec.ts` sweep never
  picks them up.

## 8. How to re-run

These are the steps from `.claude/skills/verify/SKILL.md`, plus two spike
steps. Local Supabase only.

1. Create the local signing key and start the local stack:

   ```bash
   bash scripts/local-signing-key.sh
   npx supabase start -x studio,edge-runtime,logflare,vector,supavisor,imgproxy
   ```

   It worked if the output ends by printing the local addresses.

2. Seed the database:

   ```bash
   npm run db:seed
   ```

   It worked if the last line is: `Seeded. Sign in as qa-owner@example.com / QaTest!2026`.

3. Apply the spike table and its rules to the local database. This is only
   needed for W0-6, and only after every database reset:

   ```bash
   bash scripts/spikes/apply-spike-schema.sh
   ```

   It worked if you see: "Spike schema applied to the local database."
   The script refuses any database that is not on this machine.

4. Export the app variables from `npx supabase status -o env`, as in the
   verify skill, then build and start the app:

   ```bash
   npm run build
   ENABLE_DEV_SPIKES=1 npx next start -p 3000 -H 127.0.0.1
   ```

5. Run the spike tests:

   ```bash
   QA_CHROME_PATH=/opt/pw-browsers/chromium npx playwright test -c playwright.spikes.config.ts
   ```

   - It worked if the run reports "13 passed", in about 5 minutes.
   - The run rewrites `docs/design/spikes/evidence/*.json`.
   - Leave out `QA_CHROME_PATH` on a machine where Playwright installed its
     own browsers.

## 9. The fallback, if the screen-reader check fails

- Build on plain Tiptap 3 (MIT) with our own slash menu, toolbar and block
  menu, all made from the `Menu` primitive in `src/components/ui/menu.tsx`.
- W0-6 shows the co-editing layer is the same for both: y-prosemirror.
  So the fallback changes only the interface layer, not storage or sync.
- Estimated at about 1 extra week for S3, as the execution plan's risk
  table says.
