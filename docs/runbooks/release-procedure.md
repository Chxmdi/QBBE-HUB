# Runbook: release procedure (#51)

How one exact commit reaches staging, then production, and how to undo it.
Every release names its commit and keeps its evidence.

## Before you start

- The commit is on `main` and CI (Verify, Database security, Security) is green on it.
- The target environment's settings exist. See the tables in
  [`deployment.md`](deployment.md#gated-netlify-workflow).
- You know which migrations are new since the last release:
  `git diff --name-only <last-release-sha> <sha> -- supabase/migrations`.

## 1. Certify the commit

1. GitHub, **Actions**, **Release candidate**, **Run workflow**, branch `main`.
2. Wait for it to finish. It runs CI in all browsers and on phones, the
   security scans and the 50-user test, then uploads
   `qa-evidence-<sha>.md`.
3. A red job means this commit is not a release candidate. Fix forward and
   start again with the new commit.
4. Download the evidence file from the run's **Artifacts** and keep it with
   the release record below.

## 2. Deploy to staging

1. **Actions**, **Deploy Netlify**, **Run workflow**, branch `main`,
   environment `staging`.
2. Read the run summary: the migration plan, and the **rollback target**
   (the deploy this one replaced).
3. Check staging by hand as its release checklist requires
   (`staging-provisioning.md`).

## 3. Deploy to production

Same as staging with environment `production`. The workflow refuses unless
step 1's Release candidate run is green for this exact commit.

## 4. Record the release

Add to the release's GitHub issue or the execution journal:

| Field | Value |
|---|---|
| Commit | full 40-character SHA |
| Release candidate run | link, and `qa-evidence-<sha>.md` attached |
| Staging deploy run | link |
| Production deploy run | link |
| Migrations applied | from each run's summary |
| Rollback target | deploy ID from the production run's Publish summary |

## Rollback

### Website

1. **Actions**, **Rollback Netlify**, **Run workflow**.
2. Environment: the one to roll back. Deploy ID: the **rollback target** from
   the bad deploy's Publish summary (or any earlier deploy on that site's
   Netlify **Deploys** page).
3. The workflow checks the deploy belongs to that environment's site,
   restores it, and confirms `/sign-in` answers.

### Database

Migrations are never reversed automatically.

- Preferred: fix forward with a new migration and deploy it.
- If the old website must run against the new schema, it can only do so when
  the migration was additive. That is why schema changes go
  expand, migrate, contract (`deployment.md`, CICD-002).
- Destructive recovery (restore from backup) follows `backup-recovery.md`,
  and is rehearsed on staging first.
