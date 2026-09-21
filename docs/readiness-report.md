# Deployment readiness report

Verdict: **NOT READY**. Full implementation remains in progress; external
verification is blocked. No staging release candidate has been certified.

| Release item | Current evidence |
|---|---|
| Candidate | Epic 01 merged to `main` at `698c52f`. Epic 02 in progress at `c748713` on `76-task-core-follow-ups` (stacked on `28-milestones-owner-status-evidence-order`); no certified release |
| Staging | No QBBE staging deployment provisioned in this session |
| Production | No publishing authorized by this plan; keep release disabled |
| Code checks | At `c748713`: lint 0 errors and 1 warning (the pre-existing `no-img-element` in `src/components/layout/qbbe-logo.tsx:31`), typecheck clean, `npm test` 504 passed across 54 files, production build passed |
| Database | Clean local reset applied migrations through `20260919120000`; `npm run test:db` 395 assertions across 15 files, exit 0; `supabase db advisors --local --type security --fail-on error` reports no issues |
| Browsers | 38 authenticated Chromium checks against real local Auth (`mfa`, `realtime-revocation`, `hello-hub`, `access-impact`, `my-work`, `identity-lifecycle`, `programs`, `projects`, `milestones`, `task-core`). **The standing bar of two consecutive clean full passes is not met at `c748713`, and this row does not claim it.** Best full run: 37 of 38, the one failure following a logged server crash. A second full run: 34 of 38, with two crashes inside it. Every one of the 38 checks has since passed: the second run's four failures were re-run and passed, and `access-impact.spec.ts:87`, the only check to fail twice, then passed alone in 46.3s with no crash — its two failures carried different errors, which is instability rather than a defect. **No failure in any run was an assertion about product behaviour**; every one was a transport failure (`ERR_CONNECTION_REFUSED`, `ERR_NETWORK_IO_SUSPENDED`, or a navigation timeout inside the shared `signIn` helper at `tests/e2e/auth.ts:110`), each matching a logged server exit or a network suspension. **Open defect, worsening:** the local `next start` process crashes under the suite — exit `0xC0000409` after repeated `destination stream closed early` errors — four times in roughly 35 minutes on 2026-09-21 against once the previous day; it fails whichever checks are running at the time. **Second environmental fault:** Windows suspended the browser's network stack mid-run three times, and one full run was discarded outright when the machine slept (Playwright reported a 1.7-day total). Hosted staging, Firefox and WebKit evidence remain outstanding |
| Full acceptance | See acceptance-matrix.md; no overall acceptance certification |
| Operations | Document quarantine is enforced in code/RLS, but a QBBE-controlled ClamAV host, restore/backup/alert custody, and operator sign-off are not established |

## External inputs

- QBBE provider account-owner email, existing sender domain and secure provider access.
- Actual VMS contract, QBBE Google configuration and authorized test recipients.
- Named product/privacy owner, operator, recovery custodian and alert recipients.
- Isolated restore environment and named Safari/mobile acceptance operator.

Do not put credentials, backup data or recovery keys in this report. Continue
independent work while inputs are missing. A disabled integration is not full
readiness, even if a separate explicitly labelled pilot could proceed.

## Final gate

Require every mandatory acceptance row verified at the frozen release commit;
complete lint/types/unit/build/dependency/database/browser/concurrency checks;
document p95 interaction ≤2 seconds and realtime ≤5 seconds on the agreed
50-user fixture; prove encrypted database/file restore within 24-hour RPO and
one-business-day RTO; obtain named operator sign-off. Attach staging URL,
environment inventory, administrator guide, recovery guide and production
release procedure. Missing evidence leaves readiness blocked.
