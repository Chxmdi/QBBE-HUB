# Privacy and retention

Hub stores **QBBE work data**, not a second volunteer database and not
service-user/case records (those are P2 / out of first release).

## What we keep

| Data | Retention | Notes |
|---|---|---|
| Auth identities (`auth.users`) | While the account is active; deactivated rows stay for audit | Reactivate is a recovery path (Unit 6) |
| Messages, tasks, projects, reports | Until an admin archives/deletes per policy | Soft-delete (`deleted_at`) on messages |
| Frozen report snapshots | Keep the approved bytes; live data must not rewrite them | PDF/CSV export is audited |
| Gmail metadata | Only while `integration_connection` is connected | Disconnect drops Hub’s mail rows, not Hub tasks |
| VMS ids on `user_profile` | Optional link; disconnect clears sourced fields only | Hub does not copy the volunteer DB |
| Notification delivery rows | Needed for job idempotency | Dedupe keys prevent double-send |
| Audit events | Keep; do not prune from the app | Access changes, exports, ownership transfer |

## What we do not log

- Full Gmail bodies in application logs (SEC-006)
- Service-role keys, OAuth refresh tokens, or SMTP credentials
- Fake “sent” states when `EMAIL_PROVIDER_API_KEY` is unset

## Access

Postgres RLS is the authorization boundary. Volunteers cannot read CRM,
reports, or admin tables. Private channel bodies are invisible to non-members
in queries, realtime, and `global_search`.

## Operator review (before production pilot)

- [ ] Confirm Supabase project region and backup retention with QBBE
- [ ] Confirm MFA on owner/admin (AUTH-006) — see `deployment.md`
- [ ] Confirm no production seed data
- [ ] Confirm Gmail/VMS remain disconnected until QBBE-owned credentials exist
