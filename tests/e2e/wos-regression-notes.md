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

- **F7. The qa-matrix sweep covers no Workspace OS route.** [lead / each
  stream] `tests/e2e/qa-matrix.spec.ts` sweeps its own `ROUTES` list plus
  `tests/e2e/routes/*.json`, and no file there names `/home`, `/lenses/*`,
  `/pages`, `/spaces`, `/objects`, `/meetings-v2`, `/capture`, `/commands`,
  `/apps`, `/forms-v2` or `/workflows-v2`. Its 25 green tests below therefore
  say nothing about the new screens' overflow at six widths, 200% zoom or
  themes; each Workspace OS spec runs its own axe pass instead. A
  `tests/e2e/routes/workspace-os.json` with a `qa` list is the fix, but it
  can only ship with the all-on CI job (section 4): under the off job those
  routes answer "Not found".

## 3. Regression with every switch on

One local Supabase, seeded once, the four signed-in parts run one after the
other on that same database (CI gives each part a fresh one; where that
difference explains a failure it is said below), then the three qa-matrix
shards. Chromium, one worker. `WORKSPACE_OS_FLAGS=all` at build and run
time. `CRON_JOB_SECRET` set; `SMTP_HOST`/`SMTP_PORT` were **not** set for the
main run (CI's `local-supabase` action sets them), which explains one
failure below, confirmed by a rerun with them set.

| Part | Result | Wall time |
| --- | --- | --- |
| signed-in 1/4 (18 files) | 45 passed, 3 failed | 11.0 min (661 s) |
| signed-in 2/4 (32 files) | 56 passed, 9 failed, 2 did not run | 10.2 min (611 s) |
| signed-in 3/4 (26 files) | 38 passed, 14 failed | 7.3 min (439 s) |
| signed-in 4/4 (27 files) | 63 passed, 11 failed | 9.6 min (576 s) |
| qa-matrix 1/3 | 9 passed | 7.2 min (434 s) |
| qa-matrix 2/3 | 8 passed | 6.4 min (387 s) |
| qa-matrix 3/3 | 8 passed | 1.2 min (75 s) |

### 3a. Tests that assume the switch is off (fail by design under `all`)

Each of these opens a Workspace OS screen with its switch off and expects
"Not found — or not yours to see" (or a 404). The env override can only turn
switches on, so they cannot pass in an all-on run, and they are correct as
tests of the off state. Where the check sits at the **start** of a long
functional test, the whole test is lost in the all-on run (marked ★): the
off check should be its own test so the functional path still runs.

| Spec and test | Line | Lost coverage |
| --- | --- | --- |
| meetings-v2 "the organizer captures during a meeting…" ★ | 68 | the whole V1-9 flow |
| templates-v2 "a space template previews real dates…" ★ | 34 | the whole templates flow |
| workspace-os-home "Home stays hidden while the switch is off" | 152 | none |
| insight-graph "the graph lens centres on a project…" ★ | 36 | the graph lens |
| insight-process "process analytics shows time in status…" ★ | 50 | process analytics |
| lenses-table "with the switch off the table lens does not exist" | 187 | none |
| objects-related "the Related panel lists links both ways…" ★ | 43 | the Related panel |
| workflows-v2 "the screens do not exist while the switch is off" | 29 | none |
| workspace-os-capture "the capture page stays hidden while the switch is off" | 137 | none |
| wos-task-description "with the editor switch off, the drawer keeps the plain description field" | 73 | none |
| api-v1 "a token without the actions scope cannot run actions, and the API is off with the switch" | 129 | none (the off check is last) |
| decisions-v2 "a project manager records the full decision…" ★ | 67 | the decisions flow |
| forms-v2 "a task form turns an answer into a task, and is hidden while its switch is off" ★ | 37 | the forms flow |
| google-objects "a calendar event becomes a meeting…" ★ | 46 | the Google objects flow |
| insight-map "the map lens places events…" ★ | 37 | the map lens |
| insight-whatif "the what-if timeline previews a milestone shift…" ★ | 36 | what-if |
| object-approvals "a project manager sends a task for approval…" ★ | 66 | object approvals |
| workspace-os-apps "apps are hidden while the switch is off" | 95 | none |
| workspace-os-commands "the command page stays hidden while the switch is off" | 108 | none |
| wos-pages "the pages screens are hidden while the switch is off" | 175 | none |
| following "follow a project and a search, set a rule, and unfollow" ★ | 39 | following |
| goals "a program lead links a project and a metric…" ★ | 82 | goals |
| insight-dashboards "the dashboards show role templates…" ★ | 31 | dashboards |
| insight-operations "operations shows workload…" ★ | 46 | operations |
| mobile "a staff member works through the phone screens at 390px" ★ | 89 | the phone screens |
| upkeep "upkeep lists a stale page for review and possible duplicates" ★ | 41 | upkeep |
| workspace-os-blueprints "staff can look but not change; volunteers and a switched-off module see nothing" | 121 | only the last check |
| workspace-os-project-page "the living project page stays hidden while the switch is off" | 106 | none |
| wos-editor "with the editor switch off, a page shows no editor" | 318 | none |
| wos-spaces "the page stays hidden while the switch is off" | 30 | none |

Total: 30 tests in 29 files; 17 of them (★) also hide a functional path in
the all-on run.

Owner: each stream's spec author; the lead decides the convention (section
4). Not fixed here: none of these specs is I4's.

### 3b. Other failures, with root cause

- **R1. `notifications.spec.ts` "inbox filters, weekly modes, mutes, and one
  actionable email" — environment.** `email_delivery.status` was `sent` but
  Mailpit held no message: without `SMTP_HOST` the provider is `log`
  (`src/features/notifications/services/email-provider.ts:55`), which
  reports success. CI's `local-supabase` action exports
  `SMTP_HOST=127.0.0.1` and `SMTP_PORT=54325`; my main run did not.
  RERUN_NOTIFICATIONS
- **R2. `translated-workspace.spec.ts` both tests — test infrastructure
  limit, reached because of data volume.** `recordedText()` dumps up to
  2,000 rows of every public table as one JSON string through
  `tests/e2e/db.ts` `sql()`, which uses `spawnSync` with Node's default
  `maxBuffer` of 1,048,576 bytes. `object_event` held 10,257 rows (9.2 MB)
  after parts 1–2 on the same database; 2,000 of them as JSON passed 1 MB,
  so the output was cut ("Unterminated string in JSON at position
  1114110") and the second call failed outright ("psql failed", exit by
  signal). In CI each part starts empty, so it has not tripped yet, but
  M9's event rows grow with every spec that creates records and the margin
  is thin. Suggested one-line fix in `tests/e2e/db.ts` (not I4's file):
  `spawnSync(…, { input, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 })`.
  RERUN_TRANSLATED
- **R3. `wos-admin-controls.spec.ts` "an admin sets a rule, reads the role
  report and downloads the audit log" — real bug [admin controls, V2-9;
  not I1/I2/I3].** The CSV had the right header but no
  `sign_in_rule_changed` row although two exist in `audit_event`. The export
  (`src/app/(workspace)/spaces/admin/audit-export/route.ts`) asks for
  `MAX_ROWS = 50_000` oldest-first in one PostgREST request, and PostgREST
  returns at most `max_rows = 1000` (`supabase/config.toml:18`; the hosted
  default is the same). With 5,344 audit rows in the organization, the
  newest 4,000+ events, the rule change among them, were silently dropped.
  Any organization past 1,000 events in the chosen range gets a truncated
  export that looks complete. Fix: page with `.range(from, to)` in steps of
  1,000 until a short page (or stream), and add a test that writes 1,001
  events and expects the last one in the CSV. In CI the part's fresh
  database stays under 1,000 rows, which is why it passes there.
- **R4. `lenses-timeline.spec.ts` "bars move by keyboard, dependents move
  after confirming, and a drag reschedules" — RERUN_TIMELINE**
- **R5. `wos-mvp-exit.spec.ts` test 1 (this PR's spec) — test data from my
  own earlier local runs.** Eight tasks from previous runs of the spec sat
  on the same due day; the month grid shows four chips per day and folds
  the rest into "+N more", so the new chip was hidden. Fixed in the spec:
  it now deletes its tasks in `afterAll`. In CI (fresh database) it did not
  apply. RERUN_EXIT
- **R6. `lenses-board-list.spec.ts` "the new board and My Work show the same
  tasks as the old ones, for every role" — data volume on the shared
  database; the legacy board is the one that truncates.** The fixture inserts
  one task per open project × 7 people × 3 statuses; after parts 1–3 the
  database had 34 open projects, so 714 fixture tasks. The old `/board` reads
  at most 300 tasks (`src/features/tasks/services/task.queries.ts:50`
  `.limit(300)`) and showed 78 fewer blocked tasks for the owner; the lens
  board showed them all. On CI's fresh database the fixture stays well under
  300. Not a Workspace OS defect; worth knowing that the comparison test's
  oracle has a cap the lens engine does not.

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
