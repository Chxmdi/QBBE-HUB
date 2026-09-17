#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_NUMBER:?Set PROJECT_NUMBER to the canonical GitHub Project number}"
OWNER="${PROJECT_OWNER:-Chxmdi}"
REPO="${REPO:-Chxmdi/QBBE-HUB}"

command -v gh >/dev/null || { echo 'gh CLI is required'; exit 1; }
gh auth status >/dev/null

create_field() {
  local name="$1" type="$2" options="${3:-}"
  if gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json --jq '.fields[].name' | grep -Fxq "$name"; then
    echo "Field exists: $name"
    return
  fi
  if [[ "$type" == "SINGLE_SELECT" ]]; then
    gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "$name" --data-type SINGLE_SELECT --single-select-options "$options"
  else
    gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "$name" --data-type "$type"
  fi
}

# GitHub Projects includes a built-in Status field. Configure its options in the UI as:
# Backlog, Ready, In Progress, Verification, Blocked, Done.
create_field "Type" SINGLE_SELECT "Epic,Story,Task,Bug,Security,Ops"
create_field "Phase" TEXT
create_field "Priority" SINGLE_SELECT "P0,P1,P2,P3"
create_field "Epic / Workstream" TEXT
create_field "PRD / Acceptance IDs" TEXT
create_field "Verification" SINGLE_SELECT "Not Run,Failed,Partial,Passed"
create_field "Environment" SINGLE_SELECT "Local,CI,Staging,Production"
create_field "Risk" SINGLE_SELECT "Critical,High,Medium,Low"
create_field "Owner" TEXT
create_field "Target" SINGLE_SELECT "Functional,Staging,Production"

for n in $(seq 11 59); do
  gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "https://github.com/$REPO/issues/$n" >/dev/null || true
done
for n in 9 10; do
  gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "https://github.com/$REPO/pull/$n" >/dev/null || true
done

echo 'Fields and initial canonical issue/PR population are present.'
echo 'Now configure the built-in Status options and Project views listed in docs/project-management.md.'
