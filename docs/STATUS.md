# Launch status

**As of 2026-10-22. Decision: NO-GO for production.**

This page is the only current record of launch status. Update the date and
every line when something changes; older status documents are kept for
history only and say so at their top.

## Environments

| Environment | Exists | Evidence |
|---|---|---|
| Staging | Not deployed through the pipeline | The Deploy workflow has 0 runs; Server setup has 0 runs. [hosting.md](runbooks/hosting.md) describes the intended Oracle server. |
| Production | Not deployed through the pipeline | The Deploy workflow has 0 runs. Publishing stays disabled. |

## Latest pipeline runs

| Workflow | Latest result |
|---|---|
| CI on `main` | Success, 2026-10-14, commit `423f991` |
| Release candidate | 3 runs, none successful; latest 2026-10-05: failure |
| Deploy | Never run |
| Server setup | Never run |
| Rollback | Never run |

## Open blockers

| Blocker | Owner |
|---|---|
| Pre-launch audit fixes (Phase 1) in progress on `claude/p12-*` branches | Development |
| Release candidate must pass once on `main` | Development |
| Staging and production Supabase projects, server setup, first deploy | QBBE (see [owner-checklist.md](plans/owner-checklist.md)) |
| Named on-call operator, privacy officer and incident register location ([incident-response.md](runbooks/incident-response.md)) | QBBE |
| External uptime monitoring and alert recipients | QBBE |
| Restore drill recorded ([backup-recovery.md](runbooks/backup-recovery.md)) | QBBE and development |

## How to update this page

1. Change the date at the top.
2. Re-read the run history (GitHub > Actions, or `gh run list --workflow <file>`)
   and update the tables.
3. Change the decision only with the owner's sign-off.
