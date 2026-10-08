# Runbook: release procedure (#51)

How one exact commit reaches staging, then production, and how to undo it.
Every release names its commit and keeps its evidence.

## Before you start

- The commit is on `main` and CI (Verify, Database security, Security) is green on it.
- The target environment's settings exist. See the tables in
  [`deployment.md`](deployment.md#gated-deploy-workflow) and [`hosting.md`](hosting.md).
- You know which migrations are new since the last release:
  `git diff --name-only <last-release-sha> <sha> -- supabase/migrations`.

## 1. Deploy to staging

Staging comes first: the Release candidate's performance gate measures the
staging site, which must be running the commit being certified.

1. **Actions**, **Deploy**, **Run workflow**, branch `main`,
   environment `staging`.
2. Read the run summary: the migration plan, and the **rollback target**
   (the deploy this one replaced).
3. Check staging by hand as its release checklist requires
   (`staging-provisioning.md`).

## 2. Certify the commit

1. GitHub, **Actions**, **Release candidate**, **Run workflow**, branch `main`,
   at the commit staging is running.
2. Wait for it to finish. It runs CI in all browsers and on phones, the
   security scans, and the 50-user test against the staging site (the same
   test on one GitHub runner also runs, for information only), then uploads
   `qa-evidence-<sha>.md`. If the `staging` environment requires a reviewer,
   the **Performance (staging)** job waits for that approval.
3. A red job means this commit is not a release candidate. Fix forward and
   start again with the new commit. **Performance (staging)** red with
   "Staging is running …, not …" means step 1 was skipped or staging has
   moved on: deploy this commit to staging, then run the candidate again.
4. Download the evidence file from the run's **Artifacts** and keep it with
   the release record below.

## 3. Deploy to production

Same as staging with environment `production`. The workflow refuses unless
step 2's Release candidate run is green for this exact commit.

## 4. Record the release

Add to the release's GitHub issue or the execution journal:

| Field | Value |
|---|---|
| Commit | full 40-character SHA |
| Release candidate run | link, and `qa-evidence-<sha>.md` attached |
| Staging deploy run | link |
| Production deploy run | link |
| Migrations applied | from each run's summary |
| Rollback target | the image named in the production run's Release summary |

## Rollback

### Website

1. **Actions**, **Rollback**, **Run workflow**.
2. Environment: the one to roll back. Commit: the full SHA of the release to
   restore. The bad deploy's **Release** summary names the image it replaced
   (`<environment>-<commit>`); `/opt/qbbe/<environment>/releases.log` on the
   server lists every release.
3. The workflow puts that image back with the environment's current settings,
   and confirms `/sign-in` answers and `/api/health/version` reports that
   commit.

### Database

Migrations are never reversed automatically.

- Preferred: fix forward with a new migration and deploy it.
- If the old website must run against the new schema, it can only do so when
  the migration was additive. That is why schema changes go
  expand, migrate, contract (`deployment.md`, CICD-002).
- Destructive recovery (restore from backup) follows `backup-recovery.md`,
  and is rehearsed on staging first.
