# QBBE-HUB Sites migration checklist

Baseline: `6a55e996d18190247662c4d6b68d946c3fe7b677`. Branch: `sites/hosting-compatibility`.
Staging first. Preserve the existing product and original deployment.

## S01 — Baseline
- [x] Read repository instructions and hosting configuration.
- [x] Record source SHA and isolate implementation branch.
- [x] Inventory 185 page files and 44 handlers in `route-inventory.json`.
- [x] Identify scanner TCP, local SMTP, proxy/CSP and external-caller risks.
- [ ] Map server actions, jobs and feature flags to scenarios.
- [ ] Capture running baseline with authorized staging accounts.

## S02 — Runtime compatibility (in progress)
- [x] Add Sites runtime scaffolding without replacing application source.
- [x] Preserve original Next.js build/start/dev commands.
- [x] Add separate `build:sites` and `dev:sites` commands.
- [x] Update dependency lockfile.
- [x] Complete dependency installation.
- [x] Pass type checking and existing unit tests (2,859 tests; see status for environment).
- [ ] Build Worker and inspect output/resource limits.
- [ ] Prove hosted rendering, cookies, CSP, server action, editor persistence and export.

## S03 — Staging setup
- [ ] Select staging Supabase project and matching configuration.
- [ ] Register one private Site; persist its returned identity.
- [ ] Configure runtime secrets and build-time public settings.
- [ ] Check browser bundles for privileged secrets.

## S04 — Authentication and access
- [ ] Prove supported coexistence of Sites access and existing Supabase login.
- [ ] Verify login, refresh, logout, MFA, invites and inactive accounts.
- [ ] Verify role changes and unauthorized data access denial.
- [ ] Resolve public pages, API tokens, OAuth callbacks and service callers.

## S05 — Scanner and email
- [ ] Confirm external scanner/job execution location.
- [ ] Implement minimal authenticated HTTPS or external-job adapter.
- [ ] Test clean/infected/timeout/retry/stale-result cases; preserve quarantine.
- [ ] Keep local SMTP out of hosted execution; verify production provider path.

## S06 — Data and realtime
- [ ] Verify schema, grants, RLS and storage policies on staging.
- [ ] Prove real read/write flows and cross-user denial.
- [ ] Test realtime updates and revocation.
- [ ] Preserve staging feature flags and email suppression.

## S07 — Jobs and integrations
- [ ] Validate callback URLs and signed webhooks.
- [ ] Verify one job runner per environment, retries and deduplication.
- [ ] Verify enabled Google, VMS and email integrations with test resources.

## S08 — Parity
- [ ] Execute every required route scenario across enabled features and roles.
- [ ] Compare desktop/mobile UI with matching data and flags.
- [ ] Test OCR/PDF workers, offline behavior, exports and accessibility.
- [ ] Measure performance against baseline and close migration regressions.

## S09 — Release and recovery
- [ ] Match source SHA, package, saved version and deployment.
- [ ] Verify terminal publication success and runtime health.
- [ ] Rehearse version, configuration and job-routing rollback.
- [ ] Verify supported automation before claiming GitHub-to-Sites CI deployment.

## S10 — Pilot and production
- [ ] Complete staging pilot and evidence review.
- [ ] Confirm audience and production environment.
- [ ] Release only after required gates pass; retain old host for recovery.

## Evidence and blockers
Check items only after their stated outcome has evidence. A build does not prove hosted behavior.
Staging configuration and scanner hosting remain unresolved. No Site has been created or deployed.
Record command results and limitations in `IMPLEMENTATION-STATUS.md`.
