# Launch readiness: plan and task checklist

Written 2026-09-27 against `main` at `c4c583e`. Covers what stands between the
built features and staff using QBBE Hub: epics #19 (platform), #20
(observability and recovery), #21 (staging certification) and #22 (production
launch), plus the open quality work under #18 and the open items in #13, #16
and #17.

## Where it stands

- **Built and merged:**
  - the operating hub (epics 01–07);
  - integrations code (epic 06);
  - the paperless and bookkeeping features (see
    [`paperless-bookkeeping-plan.md`](paperless-bookkeeping-plan.md)).
- **Not deployed.** There is no staging environment yet (#55), and production
  publishing stays disabled until staging is certified (#21). Until then nobody
  can use the app, so this is the critical path for 2026-10-01.
- **Most remaining blockers need QBBE's accounts or decisions.** The code side
  of the release path is in place: gated deploy, release procedure, drift check
  and smoke checks (#51, #128).

## Task checklist

### A. QBBE setup (blocks everything below)
Follow `docs/runbooks/qbbe-ownership-and-environments.md` (#52) in phase order,
then `docs/runbooks/staging-provisioning.md` (#55).

- [ ] Branch protection on `main`: run `scripts/protect-main.sh` with an admin
  token so `Verify` and `Database security` are required (#51).
- [ ] Decide the GitHub organization and move the repository there (#52 phases
  B1 and C2). The transfer cannot be undone, so read that phase fully first.
- [ ] Create QBBE-owned Supabase projects, one for staging and one for
  production (#52 B2).
- [ ] Add each environment's secrets to its GitHub environment (#52 phase D).
  Never reuse production secrets in staging.
- [ ] Set up the GitHub Project fields and views (#59).
- [ ] Provision staging and deploy one frozen commit through the gated path
  (#55).

### B. Integrations that need QBBE accounts (#16, #47)
- [ ] A QBBE-owned Google Cloud project and test account (Calendar and Drive).
- [ ] Verify QBBE's sender domain in Resend and choose a test recipient (#47).
- [ ] The volunteer-management provider contract and test credentials.
- [ ] Run the live staging checks in
  `docs/runbooks/epic-06-live-verification.md` and record the evidence. Then
  close #42–#47 and #16.
- [ ] Documents: a live malware scanner for uploads. The code is done; the
  scanner service is owed. Then close #35 and #13.

### C. Quality and performance (#18)
- [ ] Browsers and mobile devices: record nightly Firefox, WebKit and mobile
  results (#50).
- [ ] 50-user performance: re-run the load test with the current query fixes and
  record p95 ≤ 2 s and realtime ≤ 5 s (#115).
- [ ] Split or shard the Database security CI job, which reached its time limit
  on 2026-09-27 (see the bookkeeping plan).
- [ ] Proxy: check the session locally instead of making an Auth round trip on
  every request (#138).
- [ ] Freeze a candidate commit and run the full matrix at that exact commit,
  with evidence (#50). Then close #18.

### D. Observability and recovery (#20)
- [ ] Redacted error reporting, job and integration health, quotas and
  independent alerts (#53).
- [ ] Encrypted backups and a restore drill with a named custodian, recovery
  point and recovery time (#54, `docs/runbooks/backup-recovery.md`).

### E. Certification and launch (#21, #22)
- [ ] Reconcile the acceptance matrix and readiness evidence at the release
  commit (#56).
- [ ] Operator acceptance: Safari/mobile, custody, runbooks and sign-off (#57).
- [ ] UX sign-offs (#17):
  - a screen-reader pass with VoiceOver and NVDA;
  - brand sign-off against the QBBE identity.
- [ ] Production deploy, following `docs/runbooks/release-procedure.md`, and
  production verification (#58, #22).

### F. Product follow-ups (not launch blockers)
- [ ] Team oversight: let admins see who is on track, from the work itself
  (#136).

## Order for the fastest path to staff using the app

1. Section A, which only QBBE can do.
2. Then staging deploys in about a day, because the release path is already
   built.
3. Sections B and D, run in parallel on staging.
4. Sections C and E at one frozen commit.
5. Production.

Until step 2 is done, 2026-10-01 records go into the interim Drive folder (see
the bookkeeping plan, section D).
