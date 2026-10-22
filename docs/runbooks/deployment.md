# Deployment runbook

## Environments (ENV-001)

| Environment | Web | Data | Notes |
|---|---|---|---|
| local | `npm run dev` | local Supabase (`supabase start`) or dev project | synthetic data only |
| staging | `qbbe-app-staging` container on the QBBE server ([`hosting.md`](hosting.md)) | staging Supabase project | synthetic data only |
| production | `qbbe-app-production` container on the QBBE server | production Supabase project | release gates and restore evidence required |

All accounts (GitHub org/repo, Oracle Cloud, Supabase, domain/DNS, email provider)
must be **QBBE-owned**. Use two named administrators where the free plan
supports them; otherwise name a separate recovery custodian. Document recovery
without shared daily credentials (ENV-002). No paid plans or automatic upgrades.

## First production deployment

1. Create the production Supabase project (QBBE org). Note the project URL
   and anon key.
2. Apply migrations: `supabase link --project-ref <ref> && supabase db push`.
3. In Supabase Auth settings:
   - Configure the site URL to the production domain and add
     `https://<domain>/auth/callback` to redirect URLs.
   - **Turn on email confirmation** (Authentication → Sign In / Providers →
     Email → **Confirm email** on) and set up the project's SMTP sender so the
     confirmation email actually arrives. Since 2026-10-22 (SEC-001) an invited
     person gets no membership until their address is confirmed; with
     confirmation off, the emailed invitation link is the only proof.
   - **Leave "Allow new users to sign up" on.** Invited people create their
     account through the sign-up form; turning sign-up off in Supabase would
     refuse them too. The database decides who may join: once an organization
     exists, `app.handle_new_user` refuses an account that does not carry a
     valid invitation link for that exact address, and the refusal aborts the
     account creation. Before 2026-10-22 it matched the invitation on the
     address alone, so anyone who knew an invited address could take the seat.
     Two other ways in still need an open invitation for the address: Google
     sign-in, when Google says it has verified the address (the seat follows
     once Auth confirms it), and an operator creating the account through the
     Auth admin API with the link's secret in `user_metadata.invite_token`
     (as `scripts/qa/perf-staging.mjs` does). A marker in `app_metadata` does
     not work through the admin API: Auth adds it only after the check.
     Until 2026-09-02 this line claimed the enforcement came from
     `signup_allowed`. It did not. That function was called only from the
     sign-up form — a check in the visitor's own browser — while the trigger
     that grants the membership never consulted it and defaulted to an active
     **staff** account. Anyone could obtain one with a single API call using the
     publishable key.
   - The invitation secret travels in the link's address
     (`/sign-up?invite=…`), so it can appear in the invitee's browser history
     and in the server's access logs for `/sign-up`. It works once, only for
     the invited address, for 14 days, and is removed from the account as
     soon as it is used. Do not send access logs for `/sign-up` to third
     parties. If a link may have leaked, open Admin, Invitations, click
     **New link** on that row, then **Create new link**: the old link stops
     working.
4. Set up the QBBE server and each environment's settings as
   [`hosting.md`](hosting.md) describes: the server, its open ports, the
   GitHub environment variables and secrets (`APP_ENV` holds the app's
   runtime settings), and the **Server setup** workflow. Deploys go only
   through the gated workflow below. Never put `SUPABASE_SERVICE_ROLE_KEY`
   in a `NEXT_PUBLIC_*` variable.
5. Deploy. Sign up the Primary Owner account **first** — the bootstrap
   trigger provisions the organization and mandatory channels.

   On a project that already had invitations before 2026-10-22: those have
   no link, so nobody can create a password account from them. After the
   deploy, list them in the Supabase SQL editor:

   ```sql
   select email, intended_role, expires_at
   from invitation
   where token_hash is null and accepted_at is null
     and revoked_at is null and expires_at > now();
   ```

   For each address, open Admin, Invitations, find the row marked
   **no link yet**, click **New link**, then **Create new link**. You should
   see "Invitation sent to …", or, where email is not set up, the link to pass
   on yourself. Run the query again: when it returns no rows, every open
   invitation has a working link.
6. Set up the nightly encrypted backup of the database **and uploaded files**
   (the **Backup** workflow) and run the hosted restore drill before entering
   pilot data. The one-time setup and the drill are in `backup-recovery.md`;
   until both are done there is no backup. Three things to know first:
   - Apply the `main` protection in "Branches and gates" below **before**
     setup step 7 there. The `backup-production` environment holds
     production's database password and a Supabase secret key that bypasses
     row-level security, with no approval step; its only protection is that
     it accepts runs from `main`.
   - Each of `backup-staging` and `backup-production` needs its own
     `BACKUP_INDEX_KEY` (make it with `openssl rand -base64 32`: one line
     of 44 characters; a key typed by hand is refused).
   - The nightly run backs up production only. Staging is backed up every
     night only when the repository variable `BACKUP_STAGING_NIGHTLY` is
     `on`, to stay inside Supabase's free 5 GB of monthly traffic; otherwise
     run it by hand at least every 30 days.
7. Enroll at least two named TOTP factors for the Primary Owner and every
   Workspace Admin, then complete the hosted MFA checks in
   `staging-provisioning.md`. Application and database enforcement are
   implemented; hosted evidence at the release SHA remains a release gate.
8. Wire the scheduler to the deployment. Nothing runs on a schedule until
   this is done, and Admin → Jobs will say so:

   ```sql
   select app.configure_job_runner('https://<domain>', '<CRON_JOB_SECRET>');
   ```

   The secret must match the `CRON_JOB_SECRET` environment variable and be at
   least 32 characters. Full details in `jobs.md`.

   Skipping this step is easy to miss: pages load and uploads succeed, but no
   file ever passes its security check (so none can be opened) and no
   notification email is sent. The deploy workflow's smoke job now checks it:
   `GET /api/health/jobs` answers `{"jobRunner":"ready"}` (HTTP 200) only when
   the stored URL is this site and the stored secret matches the site's
   `CRON_JOB_SECRET`; anything else (`not_configured`, `other_site`,
   `secret_mismatch`, `app_secret_missing`) fails the deploy with the fix.
   Admin → Jobs shows the same status as a red banner.

9. Switch the project to **asymmetric JWT signing keys** (#138). Until this is
   done the app still works, but the request proxy asks Auth to confirm the
   session on every request, background link prefetches included, which is
   about 40 extra Auth calls per page viewed.

   In the Supabase dashboard for the project: **Project Settings → JWT Keys**.
   Start using JWT signing keys (the dashboard creates a standby ECC P-256
   key), then rotate so the new key becomes the one in use. Existing sessions
   stay valid until they expire. You should see `ES256` listed at
   `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`.
   Do the same on staging and production; never through the MCP.

   What changes: the proxy then verifies the session token locally. A sign-out
   elsewhere is noticed by the proxy only when the token expires (one hour at
   most). Every page still asks Auth live (`requireSession` uses `getUser`),
   and row-level security applies to every read, so a revoked session reaches
   no data. Locally and in CI the same setup comes from
   `scripts/local-signing-key.sh`, which `supabase/config.toml` requires.

## Branches and gates (CICD-001)

`main` is the release branch and the only one production deploys from.

**Current state (pre-launch audit, 2026-10):** a ruleset named `main: require
CI` is applied to `main`, but it requires only **Verify** and **Database
security**: it predates the longer list in `scripts/protect-main.sh`, which
was changed and never re-applied. Until the script is run again, a pull
request can merge with a leaked secret, a high-severity dependency or a broken
Dockerfile, and no approval is required. Check the live rules with
`gh api repos/Chxmdi/QBBE-HUB/rules/branches/main`; once re-applied they list
the seven checks below.

Apply it with:

```sh
GITHUB_TOKEN=<token with administration: write> scripts/protect-main.sh
```

The script is re-runnable, updates in place, and prints the live rules
afterwards so the result is verified rather than assumed. It sets:

- A pull request required before merging.
- Status checks required to pass: **Verify**, **Database security**,
  **Dependency audit**, **CodeQL**, **Secret scan**, **Dependency review** and
  **Container image** (the only check that builds the Dockerfile; it adds 5 to
  10 minutes to every pull request).
- No force pushes, no deletion of `main`.

Two deliberate departures from the specification's wording, both recorded here
rather than left as surprises:

- `required_approving_review_count` is **0**, not 1. CICD-001 asks for review
  before merge, but with effectively one human maintainer, requiring an approval
  nobody can give makes `main` unmergeable rather than protected. Raise it to 1
  as soon as a second maintainer exists; that single change completes CICD-001.
- Branches are **not** required to be up to date before merging
  (`strict_required_status_checks_policy: false`). Strict mode is more correct —
  it tests the actual merge result — and on a low-traffic repository it mostly
  produces rebase churn. Turn it on if two people start landing work in parallel.

The ruleset carries **no bypass actors**, so it applies to administrators too.
That is intentional: the audit found the admin bypass had been used to merge
three times, and an escape hatch nobody records using is how the previous gap
persisted. If an emergency merge is genuinely needed, add a bypass actor
deliberately and remove it afterwards.

Work happens on short-lived branches off `main` and returns through a pull
request. CI runs on every pull request and on every push to `main`. Provider auto-publishing, dashboard permissions, and build hooks must also be
checked before claiming there is no bypass.

Two gates exist specifically to catch drift that only shows up at runtime:

- **Migration filenames are unique and ordered** — a duplicate version prefix
  makes `supabase db push` order ambiguous, and which of the two applies first
  can differ between a laptop and CI. Enforced by
  `tests/unit/migration-filenames.test.ts`, which also pins the naming pattern
  and checks that lexical order matches numeric order. Until 2026-09-01 this
  paragraph described a gate that did not exist. It also fails when a new
  migration's version does not sort after every migration in
  `tests/unit/migration-baseline.json`: applied versions run weeks ahead of the
  calendar, so a file named with today's timestamp would make `db push` refuse
  the deploy. Name a new migration after the newest version on `main` (see
  AGENTS.md, "Migration versions"); never use `db push --include-all`.
- **Every new public table, view, sequence and function states its access** —
  Supabase's automatic grants are off, so an ungranted table answers
  "permission denied" to every signed-in page. Enforced by
  `tests/unit/migration-grants.test.ts`.
- **Every registered job has a handler** — a `job_definition` row without a
  handler is a schedule firing into nothing; a handler without a row never runs.

## Schema changes (ENV-005, REP-004)

- Migrations are append-only once applied to a shared environment. Fix
  forward with a new migration; never edit an applied file.
- If a migration is applied through the Supabase management API rather than
  `supabase db push`, the API records **its own** timestamp, not the one in the
  filename. Rename the repo file to the recorded version before committing —
  otherwise the next `db push` sees an unapplied migration and tries to create
  objects that already exist. Check with:

  ```sql
  select version, name from supabase_migrations.schema_migrations order by version;
  ```
- Ship policies/indexes in the same migration as the tables they protect,
  and the grants: `grant select, insert, update, delete on public.<table> to
  authenticated, service_role` (only what is needed), and for a function
  `revoke all on function public.<f>(...) from public, anon` then `grant
  execute ... to <callers>`.
- `supabase db push` in CI/CD or manually by an admin — no undocumented
  dashboard edits in production.

## Rollback

- App: run the **Rollback** workflow with the previous release's commit
  (release-procedure.md). Check schema compatibility before rollback;
  rehearse on staging.
- Schema: write an inverse migration; for risky changes use
  expand → migrate → contract so old app versions keep working (CICD-002).
  CI enforces the contract step: a migration that drops or renames a table
  or column, or changes a column's type, needs a `-- contract: safe-after
  <sha>` line naming the released commit that stopped using it
  (release-procedure.md).
- Undoing a migration means restoring the backup the Deploy run took right
  before migrating (its summary links the Backup run); see
  backup-recovery.md for the restore, rehearsed on staging first.

## Release checks

`npm run lint && npm run typecheck && npm test && npm run build` must pass
(mirrored in `.github/workflows/ci.yml`). Deployment is a manual GitHub Actions dispatch after verification, described below.

## QA matrix (Part II §16.1)

The Playwright suites, by what each one needs:

| Suite | Command | Needs |
|---|---|---|
| `tests/e2e/public-routes.spec.ts` | `npm run test:a11y` | a built app only — runs in CI |
| `tests/e2e/hello-hub.spec.ts` | `npx playwright test hello-hub` | migrated local Supabase; CI authenticated smoke |
| `tests/e2e/qa-matrix.spec.ts` | `npm run test:qa` | a built app **plus** a seeded database (`npm run db:seed`) |
| `tests/e2e/identity-lifecycle.spec.ts` | `npx playwright test identity-lifecycle` | the same, plus the local mail catcher for the recovery email |
| `tests/e2e/mfa.spec.ts` | `npm run test:e2e:mfa` | the same; destructive only to the synthetic QA Admin's local factors |
| `tests/e2e/realtime-revocation.spec.ts` | `npm run test:e2e:realtime` | seeded local Supabase with Realtime healthy; creates and removes its own private channel fixture |

The public suite covers the auth routes across six widths, both themes,
axe-core WCAG 2.2 A/AA rules, keyboard traversal, focus visibility, reduced
motion, and unauthenticated redirects. Automated rules decide only part of
WCAG 2.2 AA; criteria such as accessible authentication and consistent help
are not machine-checkable and remain a human review step. It runs on every pull request.

The authenticated suite covers all 18 workspace routes at the same widths and
themes, plus 200% zoom, the command palette, the task drawer and deep links,
URL-shareable filters, empty/permission states, and volunteer-vs-staff
authorization boundaries. Run it against a preview deployment or locally:

```bash
QA_BASE_URL=https://<staging host> npm run test:qa
```

It needs a seeded QA database and the five role accounts. `npm run db:seed`
produces one from a clean local reset; `docs/runbooks/qa.md` has the full path
and explains why the seed cannot run during the reset itself. **Never point it
at production** — it writes data. Reset any QA database afterwards.

Colour-contrast regressions are additionally guarded by
`tests/unit/contrast.test.ts`, which runs in the normal unit suite without a
browser.


## Gated deploy workflow

`.github/workflows/deploy.yml` (**Deploy**) is manual and defaults to staging.
The full step-by-step procedure, including rollback, is
[`release-procedure.md`](release-procedure.md); the server it deploys to is
[`hosting.md`](hosting.md). Each run:

1. Re-runs the complete CI workflow on the exact commit, and publishes only
   from `main`.
2. For **production**, requires a green **Release candidate** run on the same
   commit (all browsers, security scans, the 50-user test).
3. Checks the environment fail-closed (`scripts/check-deploy-environment.sh`):
   release enabled, credentials present, the Supabase project is the one
   registered for that environment, and staging and production are different
   projects. It also reads the app settings (`APP_ENV`) and refuses if they
   point at another environment's database or address, lack the keys the app
   needs, or set `WORKSPACE_OS_FLAGS` on production.
4. Builds the environment's container image of the commit on an ARM runner
   and stores it as `ghcr.io/chxmdi/qbbe-hub:<environment>-<commit>`.
5. Only once the image is built: shows the migrations it will apply (dry
   run, in the run summary); when there are any, starts the **Backup**
   workflow for that environment and waits for it to succeed (a failed
   backup stops the deploy before the database changes); applies the
   migrations, and confirms none are left. `supabase db push` stops the
   deploy if the database holds a migration this commit does not have.
   Migrating last keeps short the time the old site runs on the new schema.
6. Releases it on the server (`deploy/server/release.sh`): the new container
   must report healthy within 3 minutes, or the previous image and settings
   are put back and the run fails. The replaced image is the rollback target.
7. Smoke-checks `SITE_URL/sign-in`, that the site reports this commit
   (`/api/health/version`), and that the background jobs reach it.

`ci.yml` also builds the image and starts it on every pull request
(**Container image**), so a broken Dockerfile fails there first.

Create GitHub environments named `staging` and `production`. In each, configure:

| Setting | Location | Purpose |
|---|---|---|
| `DEPLOY_HOST` | environment variable | the QBBE server's public IP |
| `DEPLOY_SSH_KEY` | environment secret | this environment's own deploy key (`qbbe-staging` or `qbbe-production` once `DEPLOY_MODE=isolated`, hosting.md "Deploy access"); never commit it |
| `DEPLOY_KNOWN_HOSTS` | environment secret | the server's pinned SSH host key (from **Server setup**) |
| `APP_ENV` | environment secret | the app's runtime settings, one `NAME=value` per line ([`hosting.md`](hosting.md#the-app_env-secret)) |
| `SUPABASE_PROJECT_REF` | environment variable | this environment's Supabase project ref |
| `SUPABASE_DB_URL` | environment secret | that environment's database address for migrations (session pooler URI); reaches that project only. Replaces `SUPABASE_ACCESS_TOKEN`, which reached every project of the account (hosting.md, "Deploy access") |
| `SUPABASE_DB_PASSWORD` | environment secret | this environment's database password, for migrations |
| `SITE_URL` | environment variable | the environment's public address, `https://<host>` |
| `RELEASE_ENABLED` | environment variable | literal `true` only after readiness review |

And at repository level (Settings, Secrets and variables, Actions, Variables):

| Setting | Purpose |
|---|---|
| `STAGING_SUPABASE_PROJECT_REF` | registered staging project; deploys refuse any other |
| `PRODUCTION_SUPABASE_PROJECT_REF` | registered production project; deploys refuse any other |

Keep `RELEASE_ENABLED` absent/false until migrations are applied, the
environment's settings are verified, and that environment's release
checklist is met. Production additionally requires P0 acceptance, verified email,
backup/restore rehearsal, operational owners and disabled-integration disclosure.
Apply GitHub environment branch restrictions and reviewers where available on
the free plan. The workflow itself refuses publishing from other branches.
Nothing else publishes to the server: it has no Git hook, and the deploy key
lives only in the two GitHub environments.

References: [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting),
[Caddy reverse proxy](https://caddyserver.com/docs/quick-starts/reverse-proxy),
[GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).
