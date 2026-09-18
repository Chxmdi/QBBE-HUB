#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_NUMBER:?Set PROJECT_NUMBER to the canonical GitHub Project number}"
OWNER="${PROJECT_OWNER:-Chxmdi}"
REPO="${REPO:-Chxmdi/QBBE-HUB}"

command -v gh >/dev/null || { echo 'gh CLI is required'; exit 1; }
gh auth status >/dev/null

fields_created=0
fields_present=0
fields_failed=0
failed_fields=()

create_field() {
  local name="$1" type="$2" options="${3:-}"

  if gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json --jq '.fields[].name' \
      | grep -Fxq "$name"; then
    fields_present=$((fields_present + 1))
    return
  fi

  local ok=0
  if [ "$type" = "SINGLE_SELECT" ]; then
    gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "$name" \
      --data-type SINGLE_SELECT --single-select-options "$options" >/dev/null || ok=1
  else
    gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" --name "$name" \
      --data-type "$type" >/dev/null || ok=1
  fi

  if [ "$ok" -eq 0 ]; then
    fields_created=$((fields_created + 1))
  else
    fields_failed=$((fields_failed + 1))
    failed_fields+=("$name")
  fi
}

items_ok=0
items_failed=0
failed_items=()

add_item() {
  local url="$1"
  if gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$url" >/dev/null 2>&1; then
    items_ok=$((items_ok + 1))
  else
    items_failed=$((items_failed + 1))
    failed_items+=("$url")
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

# Enumerated from the repository rather than hardcoded. A fixed range goes stale
# the moment the next issue is filed, and every issue opened after it is then
# missing from a board this project treats as canonical.
mapfile -t item_urls < <(
  gh issue list --repo "$REPO" --state all --limit 1000 --json url --jq '.[].url'
  gh pr list --repo "$REPO" --state all --limit 1000 --json url --jq '.[].url'
)

if [ "${#item_urls[@]}" -eq 0 ]; then
  echo 'Refusing to report success: no issues or pull requests were found to add.' >&2
  exit 1
fi

for url in "${item_urls[@]}"; do
  add_item "$url"
done

echo "Fields:  ${fields_created} created, ${fields_present} already present, ${fields_failed} failed"
echo "Items:   ${items_ok} added or already present, ${items_failed} failed (of ${#item_urls[@]})"

if [ "$fields_failed" -gt 0 ]; then
  printf 'Failed field: %s\n' "${failed_fields[@]}" >&2
fi
if [ "$items_failed" -gt 0 ]; then
  printf 'Failed item: %s\n' "${failed_items[@]}" >&2
fi
if [ "$fields_failed" -gt 0 ] || [ "$items_failed" -gt 0 ]; then
  echo 'Bootstrap incomplete. Re-run after resolving the failures above; it is idempotent.' >&2
  exit 1
fi

echo 'Fields and canonical issue/PR population are present.'
echo 'Now configure the built-in Status options and Project views listed in docs/project-management.md.'
