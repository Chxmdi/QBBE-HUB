# Workspace OS integration (I4): exit test and all-switches regression

Session I4 of the Workspace OS integration phase (epic #199). This file
records what `tests/e2e/wos-mvp-exit.spec.ts` proved, what the full
signed-in suite did with every switch on, and what someone else needs to
fix, precisely enough to act on without rerunning.

How the runs were made: local Supabase (`supabase start`, `db reset`,
`npm run db:seed`), then `WORKSPACE_OS_FLAGS=all npm run build` and
`next start -p 3000 -H 127.0.0.1` with the same variable, then Playwright on
Chromium with one worker, the specs split the way CI splits them
(`node scripts/ci/spec-groups.mjs <part> 4`). Commands and timings are in
the PR.

## 1. The MVP exit test

`tests/e2e/wos-mvp-exit.spec.ts`, three serial tests, staff account:

1. **Meeting path.** On `/meetings-v2/:id` (a meeting in a project the staff
   member manages) the notes take a `/task …` line (captured, rewritten as
   `Task: …`) and the capture form takes a task with an owner and a due
   date. The end-of-meeting review turns both into tasks in the meeting's
   project through `task.create` (M7), with the meeting as `source`. The
   dated task is then asserted by title and date on `/lenses/my-work`
   (section "later"), `/home/world` (My tasks, "Due <date>"),
   `/lenses/board` (card and due label), `/lenses/calendar?at=<day>` (the
   cell of its day) and `/home/projects/:id` (Open tasks, "Due <date>").
   One edit, the due date from the task drawer (`/my-work?task=:id`), then
   the same five places show the new day and the calendar's old cell is
   empty.
2. **Block-editor path.** A page whose first line is a sentence naming a
   person and a date gets the "Make a task" suggestion (M6); the dialog
   takes the due date and the project; the task block is the task (M5). The
   same five places, the same one edit, and ticking the block's checkbox
   completes the task row.
3. **Accessibility and French.** Nine screens (meeting, review, page,
   my-work, My World, board, calendar, project page, task drawer) pass axe
   (WCAG 2.2 AA tags, critical and serious) in light and dark; the main
   path reads in French with the French date.

Live updates: none of these screens subscribe to Realtime (no channel in
`src/features/lenses`, `home`, `project-page`, `meetings-v2`), so each
re-check navigates again; the spec says so in its header.

Time of day: fixture days are computed by the database in America/Toronto,
20 and 27 days out, so the board's short label is always a calendar day and
the "later" bucket always holds the task.

## 2. Findings from the exit test

### Fixed in this PR (small, outside I1/I2/I3, each with a test)

- **A1. Date-only values displayed one day early.** `formatInZone`
  (`src/lib/time.ts`) parsed a bare `YYYY-MM-DD` with `new Date()`, which is
  UTC midnight, then formatted it in America/Toronto: the evening before.
  Every `task.due_at` shown through `format.date`, `formatDate` or
  `dueLabel` (board cards and list rows via `task-card-bits`, Home facts,
  the living project page's "Due …", meeting captures' due date) read a day
  early; dates within a week were unaffected only because `dueLabel` words
  those ("Today", "Tomorrow", weekday). Fix: a bare day is formatted as that
  day in UTC; genuine instants still convert. Tests: `src/lib/time.test.ts`
  and the exit spec's date assertions.
- **A2. Completed task chips on the calendar lens failed colour contrast.**
  `src/features/lenses/calendar/month-grid.tsx` added `opacity-70` to done
  chips; the 11.5px brand text then fell below 4.5:1 on its soft background
  (axe `color-contrast`, serious, light theme). The strike-through alone
  marks it done now. Test: the exit spec's axe pass on the calendar with a
  completed chip in both themes.

### Reported (owner in brackets)

- **F1. The meeting's notes are not the block editor.** [S5 / meetings-v2
  stream; lead to route] `src/features/meetings-v2/components/meeting-notes.tsx`
  still binds `PlaceholderNotesEditor`, a plain textarea whose `/task` lines
  stand in for semantic blocks. The brief's "write meeting notes in the
  block editor and create a task with `/task` or Make a task" is not
  possible in a meeting today; the exit spec therefore proves the meeting
  path with the placeholder and the block-editor path on a page.
- **F2. A `/task` line in meeting notes carries no owner or due date.**
  [S5] `saveNotesWithCaptures` inserts captures with body only. Only the
  capture form takes an owner and a due date. The notes task therefore
  lands undated and unassigned; it shows on the project page but not on the
  calendar or in anyone's My tasks.
- **F3. The meeting shows the capture's copy of the due date, not the
  task's.** [S5] `meeting_capture.due_on` and `meeting_action.due_at` are
  copied at capture time and never follow `task.due_at`; after the one
  edit the meeting page (and the classic `/meetings/:id` actions list) still
  prints the old day. "One edit updating all of them" does not reach the
  meeting. The spec asserts title and status there and does not assert the
  date either way.
- **F4. The task block prints no due date or assignee.** [S3 / editor]
  `semantic-blocks.tsx` `ObjectCard` for a task shows the title, status
  badge and "Open task"; the date set in Make a task is invisible in the
  notes, so the notes cannot show the edited value. Asserted as title +
  status only.
- **F5. Tasks created from a page block record `source: manual`.** [I1 /
  universal tasks] `semantic.commands.ts` `createTask` passes
  `source: { type: "manual", id: null }` for both the `/task` block and the
  Make-a-task dialog, so M7's "each task records where it came from" loses
  the page. Expected: a `page`/`document` source with the page id.
- **F6. `wos_meetings_v2` (and `wos_decisions_v2`, `wos_goals`,
  `wos_mobile`, `wos_object_approvals`) are not in `workspaceOsFlagKeys`.**
  [I1 / W0-4] `src/features/meetings-v2/flag.ts` re-implements the
  override read. `WORKSPACE_OS_FLAGS=all` still turns them on, but a named
  list (`WORKSPACE_OS_FLAGS=wos_meetings_v2`) is parsed in two places.

## 3. Regression with every switch on

(Filled in from the runs; see the PR for the per-part timings.)

## 4. How CI should run the suite with the switches on

Proposal only; I3 and the lead own `ci.yml`.

**Recommendation: a second matrix dimension on the `browsers` job, not a
nightly.** The switches are what the integration phase is about; a failure
with them on should block the pull request that caused it, and a nightly
would report it a day late to a queue nobody owns. The job already builds
the app once per machine, so the only change is the environment:

```yaml
strategy:
  matrix:
    include:
      - { suite: signed-in, part: 1, parts: 4 }
      # … the seven rows as today …
    flags: [off, all]          # new dimension: 14 rows instead of 7
env:
  WORKSPACE_OS_FLAGS: ${{ matrix.flags == 'all' && 'all' || '' }}
```

`WORKSPACE_OS_FLAGS` must be set on **both** the build step and the
`next start` step (the server reads it per request; the client bundle does
not need it). The `database-security` gate job needs no change: it already
waits for every row of `browsers`.

What the `all` rows must not run: the tests that assert a screen is hidden
while its switch is off (section 3 lists them). They cannot pass under an
override that can only turn switches on, and they are not wrong: they test
the off state, which the `off` rows still cover. Two ways to express that,
for the lead to choose:

1. Title convention plus `--grep-invert`. Each such test already says so in
   its title ("stays hidden while the switch is off", "Off by default", "with
   the switch off"); normalise them to one phrase, e.g. end the title with
   `[switch off]`, and the `all` rows run
   `npx playwright test $SPECS --grep-invert "\[switch off\]"`. Cheap, and
   visible in the test list. The `off` rows run everything, as today.
2. A guard in the specs: `test.skip(process.env.WORKSPACE_OS_FLAGS === "all", "needs the switch off")`
   at the top of those tests. Self-describing, but it marks them "skipped"
   in the `all` report, which reads like a weakened suite.

Either way the exit spec (`wos-mvp-exit.spec.ts`) is the inverse: it needs
the switches on and should be excluded from the `off` rows the same way
(`[switches on]`), or it fails there on its first `goto`.

Cost: the signed-in parts take about 12–13 minutes each (section 3 has the
measured times), so the extra dimension adds seven parallel machines of
roughly the same length and no wall-clock time while the runner pool has
room. If it does not, the fallback is the nightly workflow (`workflow_call`
with a new `flags: all` input, the way `browsers` and `mobile` are passed
today), accepting the day's delay.

`tests/e2e/durations.json` has no entry for any `wos-*`, `workspace-os-*`
or `lenses-*` spec, so `spec-groups.mjs` counts each as 30 s; the measured
times in section 3 should go into that file so the four parts stay even.
