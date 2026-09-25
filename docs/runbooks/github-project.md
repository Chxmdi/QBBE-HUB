# QBBE Hub — GitHub Project Bootstrap

Issue: #59

GitHub Project is the canonical PM surface. Repository Issues/PRs remain the durable work/evidence objects.

## Required repository configuration

`gh` must be authenticated with the `project` scope (see below). Nothing else is
required.

New Issues and pull requests are captured by the Project's **built-in**
workflows (below), which run inside GitHub and need no token, secret or
repository workflow. The old `.github/workflows/project-sync.yml` needed a
Project token in a repository variable that was never set, so it failed on
every Issue and pull request; it was removed (#75). The bootstrap script
remains the way to catch up anything added before the built-in workflow was
switched on.

## Bootstrap existing canonical work

Run:

```bash
PROJECT_NUMBER=<number> PROJECT_OWNER=Chxmdi ./scripts/bootstrap-github-project.sh
```

The script creates/validates the custom fields, then enumerates every Issue and
pull request in the repository and adds each one. It is idempotent, so re-running
it after new work is filed is the intended way to reconcile the board.

It reports what it actually did and exits non-zero if any field or item failed,
naming each one. A clean run is the only run that prints a success line.

`gh` must be authenticated with the `project` scope. The default `repo` scope is
not sufficient and every Project call fails without it:

```bash
gh auth refresh -s project
```

## Built-in Status options

Configure the Project's built-in `Status` field exactly as:
- Backlog
- Ready
- In Progress
- Verification
- Blocked
- Done

## Required views

For each: open the Project, click **+ New view** (right of the last view tab),
choose the layout, rename the tab (double-click its name), type the filter in
the **Filter** bar, set **Group by** / **Sort by** from the view's menu (the
down-arrow on the tab), then click **Save**.

| # | View name | Layout | Filter | Group by |
|---|---|---|---|---|
| 1 | Execution Board | Board | `is:open` | Status (columns) |
| 2 | Roadmap | Roadmap | `is:issue` | Epic / Workstream |
| 3 | Critical Path | Table | `is:open priority:P0` | Target |
| 4 | Verification Queue | Table | `status:Verification` | Verification |
| 5 | External Blockers | Table | `is:open status:Blocked` | Owner |
| 6 | Security | Table | `type:Security` | Status |
| 7 | Staging Gate | Table | `target:Staging` | Status |
| 8 | Production Gate | Table | `target:Production` | Status |
| 9 | PRD Coverage | Table | `has:"PRD / Acceptance IDs"` | PRD / Acceptance IDs |

A view shows nothing until items carry the field values it filters on. Set
Type, Priority and Target when triaging each Issue.

## Built-in workflows (automatic capture)

Open the Project, click the **...** menu at the top right, then
**Workflows**. For each row below: select it in the left list, click
**Edit**, set it as shown, click **Save and turn on workflow**.

| Workflow | Setting |
|---|---|
| Auto-add to project | Repository `QBBE-HUB`, filter `is:issue,pr is:open` |
| Item added to project | Set Status to **Backlog** |
| Item reopened | Set Status to **In Progress** |
| Item closed | Set Status to **Done** |
| Pull request merged | Set Status to **Done** |

Auto-add only captures items created or updated after it is switched on; run
the bootstrap script once afterwards to add everything older.

## Required workflow semantics

- Newly captured work starts in Backlog unless intentionally triaged otherwise.
- Dependency-ready work moves to Ready.
- Active implementation moves to In Progress.
- Implementation complete but acceptance pending moves to Verification.
- Failed required checks remain Verification or Blocked; never Done.
- Done means the canonical Issue Definition of Done and acceptance evidence are satisfied.

## Verification checklist

- every canonical Issue is visible in the Project
- every pull request is visible, including PR #9 and PR #10
- a newly filed Issue/PR appears on the board by itself (Auto-add), within a minute
- all required fields exist
- Status options match exactly
- all nine views exist and filter/group correctly
- closed Issue does not get treated as Done unless its DoD has actually been satisfied

The GitHub connector used by ChatGPT does not expose Projects V2 field/view mutation APIs. The repository automation above makes setup reproducible, but final verification must be performed from a Projects V2 write-capable GitHub session.