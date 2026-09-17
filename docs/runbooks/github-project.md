# QBBE Hub — GitHub Project Bootstrap

Issue: #59

GitHub Project is the canonical PM surface. Repository Issues/PRs remain the durable work/evidence objects.

## Required repository configuration

Set repository variable:
- `QBBE_PROJECT_URL` = canonical GitHub Project URL

Set repository secret:
- `QBBE_PROJECT_PAT` = fine-grained/classic token able to add items to and update the Project

`.github/workflows/project-sync.yml` auto-adds newly opened/reopened Issues and PRs to the Project.

## Bootstrap existing canonical work

Run:

```bash
PROJECT_NUMBER=<number> PROJECT_OWNER=Chxmdi ./scripts/bootstrap-github-project.sh
```

The script creates/validates the custom fields and adds Issues #11–#59 plus PRs #9/#10.

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

- #11–#59 visible in the Project
- PR #9 and PR #10 visible
- new test Issue/PR is auto-added by workflow
- all required fields exist
- Status options match exactly
- all nine views exist and filter/group correctly
- closed Issue does not get treated as Done unless its DoD has actually been satisfied

The GitHub connector used by ChatGPT does not expose Projects V2 field/view mutation APIs. The repository automation above makes setup reproducible, but final verification must be performed from a Projects V2 write-capable GitHub session.