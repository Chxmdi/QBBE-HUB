# ADR-004: Where the service role key is used, and what replaces row-level security there

Status: Accepted
Date: 2026-10-22
Owners: QBBE Hub engineering

## Context

[ADR-002](ADR-002-rls-as-authorization-boundary.md) makes Postgres row-level
security (RLS) the authorization boundary and reserved the service role key
(which bypasses RLS) for server-only workers. The code has since grown other
uses. Each one is a place where a mistake in application code, not a policy,
decides who sees what, so each must be known, justified and reviewed.

## Decision

The service role client (`createSupabaseServiceClient`, `src/lib/supabase/service.ts`)
may be imported only by the files below. Each entry names why RLS cannot do
the job and the check that stands in for it. `tests/unit/service-role-allowlist.test.ts`
fails when a file outside this table imports it, or a file in the table no
longer does; a change that adds one adds a row here with its reason, reviewed
like a policy change.

| File | Why the service role | What stands in for RLS |
|---|---|---|
| `src/lib/supabase/service.ts` | Defines the client. | Server-only module; never imported by client components. |
| `src/features/jobs/services/runner.ts` | The job runner works across every user and organization; there is no single person to act as. | Reached only from `/api/jobs/<name>` after the constant-time `CRON_JOB_SECRET` check, and from webhooks after their signature checks. |
| `src/features/jobs/services/runner-status.ts` | Reads the job runner status function, which only the service role may call (it compares stored secrets). | Returns one status word, never a URL or secret. |
| `src/features/jobs/services/jobs.queries.ts` | Queue metrics, dead letters and the operations snapshot have no per-row owner and no API route for signed-in users. | Called only by Admin > Jobs, behind `requireAdminAal2()`; job rows themselves are read through RLS. |
| `src/lib/rate-limit.ts` | Rate-limit counters must be written for any caller, including signed-out ones, and no user may read or reset them. | Writes a counter only through `rate_limit_hit`; returns allowed or not. |
| `src/app/api/integrations/zeffy/webhook/route.ts` | Zeffy calls without a user session. | HMAC signature over the raw body, checked before parsing; rate limited; writes only Zeffy event and payment rows. |
| `src/app/api/integrations/email/webhook/route.ts` | The email provider calls without a user session. | Svix signature over the raw body, checked before parsing; updates only delivery status and the suppression list. |
| `src/app/api/integrations/gmail/push/route.ts` | Google Pub/Sub calls without a user session. | OIDC token verified (issuer, audience, service account, expiry) before parsing; only queues a sync for the matching connection. |
| `src/features/api-tokens/services/api-handler.ts` | The private API authenticates with access tokens, not Supabase sessions. | Token hash lookup, scope check, per-address and per-token rate limits; every query is filtered to the token owner's organization and permissions (`app.can_as`). |
| `src/app/api/exports/[id]/download/route.ts` | Export files sit in a storage bucket no user may read directly. | The export row is read through the person's own session (RLS) first; organization and storage path are checked; a single-use, short-lived signed link is issued. |
| `src/features/inbox/services/gmail.commands.ts` | Gmail tokens live in `integration_secret`, which no user may read. | Every lookup is pinned to `session.userId` and `session.organizationId`; only that person's own connection is used. |
| `src/features/calendar/services/google-calendar-write.ts` | Calendar tokens live in `integration_secret`. | Called after the person's own permission checks on the Hub record; only the caller's own connection and Hub-owned events are touched. |
| `src/app/(workspace)/google/search/page.tsx` | Search uses the person's own Google tokens. | Behind `requireSession()` and the Google switch; every token lookup is pinned to `session.userId`. |
| `src/features/gifts/services/gift.commands.ts` | Reads the email suppression list, which no user may read. | Reads one address's suppression reason only, during a send already authorized through RLS. |
| `src/features/admin/services/admin.commands.ts` | Ending a deactivated person's sessions needs the Auth admin API. | Runs only after an RLS-checked admin update of the membership; signs out that one user. |
| `src/features/workflows/services/workflow.commands.ts` | A workflow test run and its signing secret act as the workflow, which may touch records the admin cannot see directly. | Behind the workflow admin guard; the rule is first read through the admin's session (RLS); the run is recorded as a test. |

Operator scripts outside `src/` read the key from the operator's own
terminal, never from the app:

- `scripts/ops/reset-admin-mfa.mjs`: break-glass removal of an owner's or
  admin's authenticators. Stand-in checks: an identity check and two approvers
  who are different owners or admins, matched by sign-in account; an audit row
  before and after ([account-recovery.md](../runbooks/account-recovery.md)).
- `scripts/backup/*`: the nightly backup and restore, with their own key
  ([backup-recovery.md](../runbooks/backup-recovery.md)).

## Consequences

- RLS stays the boundary for everything a person does through their own
  session. The rows above are the reviewed exceptions.
- A new use needs a reason that RLS cannot cover, a stand-in check, and a row
  here; the test makes the row impossible to forget.
