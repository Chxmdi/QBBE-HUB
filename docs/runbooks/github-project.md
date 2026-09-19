# QBBE Hub — GitHub Project Bootstrap

Issue: #59

GitHub Project is the canonical PM surface. Repository Issues/PRs remain the durable work/evidence objects.

## Required repository configuration

`gh` must be authenticated with the `project` scope (see below). Nothing else is
required.

There is no auto-add workflow. `.github/workflows/project-sync.yml` used to add
each newly opened Issue and pull request to the Project, and failed by design
whenever the repository variable `QBBE_PROJECT_URL` was unset — which it never
was. The result was a required check that was red on every Issue and every pull
request in the repository's history, which is how people learn to ignore checks.
It was removed rather than configured, because nothing here depends on the board
being current within seconds.

Reconciling the board is a deliberate act: re-run the bootstrap script below. It
is idempotent, so running it after a batch of work is filed is the intended way
to catch the board up.

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

Create these Project views:
1. Execution Board — board, grouped by Status
2. Roadmap — roadmap/table grouped by Epic / Workstream and Target
3. Critical Path — launch-blocking items only
4. Verification Queue — Status=Verification or Verification != Passed
5. External Blockers — external dependency items
6. Security — identity/RLS/MFA/privacy/supply-chain scope
7. Staging Gate — items required by #21
8. Production Gate — #58 and all launch dependencies
9. PRD Coverage — grouped by PRD / Acceptance IDs

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
- a newly filed Issue/PR appears on the board after the bootstrap script is re-run
- all required fields exist
- Status options match exactly
- all nine views exist and filter/group correctly
- closed Issue does not get treated as Done unless its DoD has actually been satisfied

The GitHub connector used by ChatGPT does not expose Projects V2 field/view mutation APIs. The repository automation above makes setup reproducible, but final verification must be performed from a Projects V2 write-capable GitHub session.