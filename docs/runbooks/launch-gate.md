# Launch-gate evidence (Part IV §17.2)

Tick with evidence, not aspiration. This file is the checklist for a
**staging/pilot** cut after Units 0–8; Units 9–12 stay gated until live
integrations are tested.

| Gate | Evidence in this repo | Status |
|---|---|---|
| Lint / typecheck / unit / production build / high-severity dependency audit | `.github/workflows/ci.yml` job `verify` | CI |
| Public a11y + responsive (auth routes) | `npm run test:a11y` → `tests/e2e/public-routes.spec.ts` | CI |
| Authenticated 18-screen matrix + `/messages` | `npm run test:qa` — needs seeded QA DB | Opt-in |
| RLS allow **and** deny + database-security advisor | `npm run test:db` and `supabase db advisors --local --type security --fail-on error` | CI + local Supabase |
| Error monitoring | `ERROR_MONITORING_DSN` parsed as a Sentry DSN and posted to `/store/` | Config |
| MFA for owner/admin | Supabase Auth setting + `deployment.md` step 7 | Operator |
| Backups | `backup-recovery.md`; first restore drill still pending | Operator |
| Privacy / retention | `privacy.md` | Review |
| Channel history volume | `CHANNEL_HISTORY_PAGE_SIZE` + Load older | In product |
| Honest integrations | Email/Gmail/VMS stay **Not connected** until a live send/sync/API succeeds | In product |
| Cron jobs | `/api/jobs/*` skip session middleware; `vercel.json` crons; `CRON_JOB_SECRET` | In product |
| Invite-only signup | `signup_allowed` RPC after the first organization exists | In product |
| Coverage matrix | `docs/spec-coverage.md` | In product |

## Production-account evidence (operator-owned)

Do not mark a production cut ready until every row has a dated artifact or
operator confirmation. Configuration values belong only in the deployment
secret manager; never record them in this repository or this checklist.

| Requirement | Evidence required | Current state |
|---|---|---|
| Production Supabase | Project ref, migrated schema, MFA/redirect settings, least-privilege keys | Not verified |
| Vercel production and preview deployments | Linked project, protected environment variables, preview URL | Not verified |
| Google OAuth and Pub/Sub | QBBE-owned consent screen, redirect URI, scope review, authenticated push rehearsal | Not verified |
| Volunteer Management System | QBBE endpoint credential, successful identity/assignment reconciliation | Not verified |
| Transactional email | Verified QBBE sender domain, send/reply receipt, webhook/alert evidence | Not verified |
| Error monitoring and alert routing | Production DSN, test exception, on-call alert receipt | Not verified |
| Backups and recovery | Scheduled backup plus documented successful restore drill | Not verified |
| Staging rehearsal | Owner, admin, staff, volunteer, and guest workflow results | Not verified |

## Commands (developer)

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:a11y    # after build + next start
npm run test:db      # after supabase start
```

Production email, Gmail, and VMS are **not** launch-blocking for the internal
pilot described in spec §16.1, provided the UI does not claim they are
connected.
