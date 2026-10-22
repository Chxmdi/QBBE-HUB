# Job activation review

Source inventory after reconciliation: 29 handlers. This is not a claim that
the live database has 29 registered/enabled jobs. No database inspection or
mutation was performed for this inventory.

| Review group | Handlers | Required before activation |
|---|---|---|
| Scanning | scan-documents, scan-form-files, scan-receipts | Real scanner ready; approved pending fixtures; verify each quarantine/download path |
| Notification and reminders | drain-notifications, retry-failed-emails, daily-digest, announcement-nudge, scheduled-announcements, due-date-reminders, grant-report-reminders, stale-project-sweep, team-signal-reminders, team-signal-digest, decision-revisit-reminders, follow-events | Approved recipients/workload; stale backlog review; actual email allowlist configured; verify deduplication and suppression semantics |
| Workflow execution | retry-workflow-executions, workflow-events, workflow-resume | Review enabled workflows and pending executions, including their external actions; synthetic execution only initially |
| Integrations | google-sync, gmail-push-sync, gmail-watch-renew, vms-sync, zeffy-sync, zeffy-events | Credentials, destination and scopes confirmed per environment; approved test events; current schema |
| Exports | run-exports | Approved synthetic requests; large output checks; correct storage permissions |
| Retention/cleanup | expire-exports, purge-job-history, apply-retention, report-record-retention | Owner-reviewed retention settings and affected workload; do not infer safety from the handler name |

For each handler record schedule, backlog, deduplication key, retry policy,
side effects, approved test case and result in the private execution ledger.
Review source implementation and current application status before checking off
any row. This grouped inventory is not completion of that review.

Host-local allowlisting narrows execution without changing the database registry.
It does not undo completed work or make queued work synthetic. A healthy job
configuration endpoint does not mean handlers have succeeded. Verify both HTTP
status and execution outcome; successful transport can report a failed job.
