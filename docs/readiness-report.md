# Deployment readiness report

Verdict: **NOT READY**. Full implementation remains in progress; external
verification is blocked. No staging release candidate has been certified.

| Release item | Current evidence |
|---|---|
| Candidate | Epic 01 merged to `main` at `698c52f`. Epic 02 partly on `main`: #26 landed through PR #72; #27, #28 and #76 are merging onto `main` together in one pull request from `76-task-core-follow-ups`, after PR #74 and PR #77 were merged in the wrong order and left the #76 commits on a branch that had already been merged out. #31 remains open. No certified release |
| Staging | No QBBE staging deployment provisioned in this session |
| Production | No publishing authorized by this plan; keep release disabled |
| Code checks | At `c748713`: lint 0 errors and 1 warning (the pre-existing `no-img-element` in `src/components/layout/qbbe-logo.tsx:31`), typecheck clean, `npm test` 504 passed across 54 files, production build passed |
| Database | Clean local reset applied migrations through `20260919120000`; `npm run test:db` 395 assertions across 15 files, exit 0; `supabase db advisors --local --type security --fail-on error` reports no issues |
| Browsers | 38 authenticated Chromium checks against real local Auth (`mfa`, `realtime-revocation`, `hello-hub`, `access-impact`, `my-work`, `identity-lifecycle`, `programs`, `projects`, `milestones`, `task-core`). **The standing bar of two consecutive clean full passes is met on no machine, local or CI, and this row does not claim it.** Three CI runs over product code that is identical apart from two Markdown files: `8c13f1a` 38 of 38 in 3.7 minutes; `5e093db` 36 of 38 (`access-impact:5`, `identity-lifecycle:195`); `c131ee5` 37 of 38 (`identity-lifecycle:195`). A documentation-only diff cannot break a browser test, so those three runs exonerate the code — but they also **withdraw an earlier claim in this row that CI had never reproduced the instability and was the stable instrument.** It has reproduced it twice. The precursor `destination stream closed early` appeared 14, 15 and 18 times across the three runs, including the one that passed everything, so it is background noise rather than a crash signal. Locally the best run was 37 of 38 and a second was 34 of 38, on a machine where `next start` crashed four times in roughly thirty-five minutes. Every one of the 38 has passed locally; local failures were re-run and passed, and `access-impact.spec.ts:87`, the only check to fail twice locally, then passed alone in 46.3s with no crash, having carried a different error each time. **One failure does not fit the environmental explanation and is not filed under it:** `identity-lifecycle.spec.ts:195` failed on CI twice with byte-identical symptoms — `net::ERR_ABORTED` at `http://127.0.0.1:3000/sign-in` from `page.goto` in the shared `signOut` helper at `tests/e2e/auth.ts:122` — having also failed locally once with `ERR_CONNECTION_REFUSED`. A bug that reproduces the same way is the test this report uses to separate a defect from an unstable machine, and this one now passes it. `signOut` clears cookies immediately before that `goto`, a plausible race that would abort the navigation without deactivation itself being wrong, but that is an untested hypothesis. **Open defect (#79), on both local and CI:** `next start` exits `0xC0000409` locally after repeated `destination stream closed early` errors — four times on 2026-09-21 against once the previous day — and CI shows the same failure family at a lower rate. Every other local failure was a transport failure (`ERR_CONNECTION_REFUSED`, `ERR_NETWORK_IO_SUSPENDED`, or a navigation timeout inside `signIn` at `tests/e2e/auth.ts:110`), each matching a logged server exit or a network suspension. **Second environmental fault:** Windows suspended the browser's network stack mid-run three times, and one full run was discarded outright when the machine slept (Playwright reported a 1.7-day total). **Separate flaky test (#80):** `public-routes.spec.ts:27` failed once on CI in Firefox only — Chromium and WebKit passed it in the same run — then passed on re-run and 3 of 3 locally; its assertion uses the default 5s timeout while Firefox timings on that page range from 3.2s to 10.4s. Hosted staging evidence remains outstanding |
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
