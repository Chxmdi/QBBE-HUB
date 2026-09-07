#!/usr/bin/env bash
# Apply the branch protection `main` is supposed to have.
#
# Why this is a script rather than a click-path: the audit found `main`
# protected with `required_status_checks.enforcement_level: "off"`, zero
# contexts and zero rulesets — CI ran on every pull request and gated nothing,
# and three merges landed with no review and no passing check required. A
# click-path in a settings page is what produced that gap, because nothing
# records whether the clicks were made. This is re-runnable and diffable.
#
# Usage:
#   GITHUB_TOKEN=<a token with `administration: write` on the repo> \
#     scripts/protect-main.sh [owner/repo]
#
# The token needs repo admin rights. A fine-grained PAT needs
# "Administration: Read and write"; a classic PAT needs `repo`. The token this
# project's CI environment carries is deliberately narrower and cannot do this.
#
# Re-running is safe: an existing ruleset of the same name is updated in place.

set -euo pipefail

REPO="${1:-Chxmdi/QBBE-HUB}"
NAME="main: require CI"
API="https://api.github.com/repos/${REPO}/rulesets"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "GITHUB_TOKEN is not set. It needs 'administration: write' on ${REPO}." >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}"
      -H "Accept: application/vnd.github+json"
      -H "Content-Type: application/json")

# required_approving_review_count is 0 deliberately. The specification asks for
# review before merge, but this repository has effectively one human maintainer,
# and requiring an approval nobody can give would make `main` unmergeable rather
# than protected. Raise it to 1 the moment a second maintainer exists — that is
# the only change needed for full CICD-001 compliance.
read -r -d '' BODY <<'JSON' || true
{
  "name": "main: require CI",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    { "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "Verify" },
          { "context": "Database security" }
        ]
      }
    }
  ]
}
JSON

existing=$(curl -fsS "${auth[@]}" "${API}" \
  | python3 -c "import json,sys; print(next((str(r['id']) for r in json.load(sys.stdin) if r.get('name')=='${NAME}'), ''))")

if [[ -n "${existing}" ]]; then
  echo "Updating existing ruleset ${existing}..."
  curl -fsS -X PUT "${auth[@]}" --data-binary "${BODY}" "${API}/${existing}" >/dev/null
else
  echo "Creating ruleset..."
  curl -fsS -X POST "${auth[@]}" --data-binary "${BODY}" "${API}" >/dev/null
fi

echo "Applied. Verifying against the live rules for the default branch:"
curl -fsS "${auth[@]}" "https://api.github.com/repos/${REPO}/rules/branches/main" \
  | python3 -c "
import json,sys
rules = json.load(sys.stdin)
if not rules:
    print('  NO RULES APPLY TO main — the ruleset did not take effect.'); raise SystemExit(1)
for r in rules:
    t = r.get('type')
    if t == 'required_status_checks':
        checks = [c['context'] for c in r['parameters']['required_status_checks']]
        print('  required status checks:', ', '.join(checks))
    else:
        print('  ' + t)
"
