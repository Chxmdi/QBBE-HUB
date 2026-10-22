# Sites migration release gates

Updated 2026-10-22. This is a sanitized engineering checklist; owner approvals and
private operational evidence remain outside the public repository.

## Implemented in this change

- Reconcile the migration branch with main `423f99108c8291836f8868aaff7c281f2c22daef`.
- Add HTTPS scanner selection, digest-bound verdict validation, response-size
  limits, deadline and error redaction while preserving the original TCP adapter.
- Add a separate container-host scanner service candidate under
  `deploy/scanner-https`, including contract tests and setup instructions.
- Add an optional host-local `JOB_RUNNER_ALLOWLIST` before any runner database
  access. Unset preserves existing behavior; empty blocks every job; comma-separated
  exact names permit selected jobs. No wildcard. Rejected runs return the existing
  disabled-job error and do not create job-run rows. This is not a dry-run mode:
  allowed jobs still execute their actual handlers.

## Activation sequence

1. Confirm environment identity and the deployed source version. Current main
   includes additional Zeffy migrations: do not deploy the combined candidate
   until the owner confirms schema compatibility. This change runs no migrations.
2. Provision and validate the scanner; set both server-only HTTPS settings.
3. Set the host allowlist to an explicit reviewed subset before scheduler routing.
   Scan-only candidate: `scan-documents,scan-form-files,scan-receipts`. It still
   changes scan status, so use approved fixtures and review the pending workload.
4. Review each remaining handler's queued work, retries and external effects.
   Use the email recipient allowlist for approved test delivery. Do not treat
   suppression as a non-mutating preview; suppression can update message state.
5. Owner enters the cron secret and executes the already documented
   `app.configure_job_runner` call only when all activation prerequisites pass.
6. Check job health AND individual run outcomes. HTTP 200 on a job route can still
   contain a failed execution outcome. A host-restricted job is deliberately
   inactive, not an acceptance-test pass.
7. Expand the host allowlist per reviewed batch. Final full-feature acceptance
   must cover all required jobs, including the new Zeffy jobs when enabled.

## Outstanding release gates

- [ ] Provider/region/cost approved and real scanner provisioned.
- [ ] ClamAV image, TLS, signature updates and real test-file scanning verified.
- [ ] Runtime time/CPU/body/response limits established for required workloads.
- [ ] Current schema compatibility confirmed by owner without agent DB changes.
- [ ] Staff and owner TOTP, logout/session expiry, role separation verified.
- [ ] French/English, editor saves, core workflows and realtime verified.
- [ ] All upload types and maximum supported file sizes verified end to end.
- [ ] Approved email, required webhooks/OAuth and every required job verified.
- [ ] Large exports and agreed concurrency/performance workload verified.
- [ ] Privacy lead approval and production data-flow review completed.
- [ ] Tested hosting fallback and rollback rehearsal completed.
- [ ] Seven clean staging days recorded after final material corrections.
- [ ] Production publication/domain/configuration explicitly approved.
- [ ] Production acceptance and seven clean days completed before cleanup.

Keep current public staging access unchanged. No production cutover, cron switch,
database changes or resource purchases are performed by these source changes.
