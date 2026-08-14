# Launch-gate evidence (Part IV §17.2)

Tick with evidence, not aspiration. This file is the checklist for a
**staging/pilot** cut after Units 0–8; Units 9–12 stay gated until live
integrations are tested.

| Gate | Evidence in this repo | Status |
|---|---|---|
| Lint / typecheck / unit / production build | `.github/workflows/ci.yml` job `verify` | CI |
| Public a11y + responsive (auth routes) | `npm run test:a11y` → `tests/e2e/public-routes.spec.ts` | CI |
| Authenticated 18-screen matrix + `/messages` | `npm run test:qa` — needs seeded QA DB | Opt-in |
| RLS allow **and** deny | `npm run test:db` (`supabase/tests/rls.sql`) | Local Supabase |
| Error monitoring | `ERROR_MONITORING_DSN` → `src/lib/observability.ts`; unset = local log only | Config |
| MFA for owner/admin | Supabase Auth setting + `deployment.md` step 7 | Operator |
| Backups | `backup-recovery.md`; first restore drill still pending | Operator |
| Privacy / retention | `privacy.md` | Review |
| Channel history volume | `CHANNEL_HISTORY_PAGE_SIZE` + Load older | In product |
| Honest integrations | Admin/Inbox stay **Not connected** without secrets | In product |
| Coverage matrix | `docs/spec-coverage.md` | In product |

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
