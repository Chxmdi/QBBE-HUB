# Launch gates

The approved seven-workstream plan supersedes earlier pilot exemptions. The
finish line is verified staging with all PRD v2 P0/P1 and retained integrations
accepted. Production publishing is a separate release decision.

Authoritative live records:

- [Acceptance matrix](../acceptance-matrix.md): every PRD criterion and integration.
- [Execution journal](../execution-journal.md): active feature, prompts and next action.
- [Readiness report](../readiness-report.md): release evidence and blockers.

No checklist entry is verified merely because it has a CI job or runbook.
Require a passing run and artifact at the candidate commit. Missing QBBE input
blocks dependent verification; independent implementation continues.

Required gates: lint, types, unit/build/dependency checks; migrated RLS/Auth tests;
complete authenticated browser workflows across scoped roles; Chromium, Firefox,
WebKit and actual Safari/mobile; keyboard, themes, zoom and screen-reader checks;
concurrency/reconnect/retry; measured performance; live Google/VMS/email;
Netlify staging compatibility and protected deployment; encrypted database/file
backups, isolated restore, independent alerts and named operational sign-off.

Verified transactional email is mandatory for pilot use under the approved plan.
Disabled external integrations must be disclosed for any separate pilot decision
and do not satisfy full deployment readiness. Supabase MFA settings alone do not
prove application/API/database enforcement. Invite-only admission must be enforced
by the database Auth trigger, not only the browser's signup_allowed check.

Use only QBBE-owned free infrastructure. Keep production publishing disabled.

Workstreams 1–5 now have implementation in the working tree. Workstreams 6–7
remain blocked on QBBE credentials, staging projects, Drive custody and a
named operator. `scripts/verify-integrations.sh` and `scripts/protect-main.sh`
are the starting operator commands; they do not themselves certify readiness.
