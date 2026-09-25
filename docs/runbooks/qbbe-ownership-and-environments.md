# Runbook: QBBE ownership and isolated environments (#52)

Moves production-critical resources out of the personal `Chxmdi` account into
QBBE-controlled accounts, and separates staging from production.

**Measured state, 2026-09-25** (first measured 2026-09-23). Re-check each
line before trusting it; this is what GitHub and the connected Supabase
account reported on that date.

| Thing | State |
|---|---|
| Repository | `Chxmdi/QBBE-HUB`, **public**, personal account, not in an organization |
| GitHub environments | `staging` and `copilot` exist. **`production` does not.** (2026-09-23; the connector cannot read environments) |
| Repository variables | none set (2026-09-23) |
| Secrets the deploy reads | `NETLIFY_AUTH_TOKEN`; since #128 also `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` per environment |
| Deploy gate | `vars.RELEASE_ENABLED` must equal `true`; see `scripts/check-deploy-environment.sh` |
| Netlify site IDs | registered in `scripts/check-deploy-environment.sh` and `rollback-netlify.yml`: staging `2169b17a-8dc3-49de-a466-4281e1285de2`, production `a34499c8-0d84-47d5-bfb2-502c2b9b9071` |
| Supabase | **one** project, `qbbe-hub` (ref `xvxahcbwydsnllqbjnlr`, ca-central-1, healthy), in the Supabase organization **"BMF"**, not a QBBE organization. There is no second project, so staging and production cannot yet be isolated. |
| Hosted schema | 60 migrations applied, newest `20260905062624`. **43 repository migrations are not applied.** No drift: every applied version exists in the repository. |

## Providers to bring under QBBE control

From `.env.example`, which is the authoritative list of what this application
expects:

| Provider | Variables | Blocking |
|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | everything |
| Netlify | `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` | deployment |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_GMAIL_PUBSUB_*` | #43, #44, #45 |
| Email | `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `SMTP_HOST`, `SMTP_PORT` | #47 |
| Malware scanning | `CLAMAV_SOCKET` | #35 P1-FIL-02 |
| VMS | `VMS_API_KEY`, `VMS_API_URL` | #46 |
| Error monitoring | `ERROR_MONITORING_DSN` | #53 |
| Scheduled jobs | `CRON_JOB_SECRET` | job endpoints |

## Order

Inventory first, then create, then transfer, then isolate, then prove. The
transfers are the only irreversible part, and they come after the new homes
already exist.

---

## Phase A — Inventory and custody (no risk, do first)

### A1. Record who owns what today

For each provider above, write down: the account that owns it, the email on that
account, who has admin, and whether multi-factor authentication is on.

Put it in `docs/runbooks/custody.md`. **Names and roles only — never a secret
value, and never part of one.** This repository is public.

*Done when:* every row in the provider table has a named human owner.

*If you cannot determine an owner:* treat that resource as
compromised-by-unknown and plan to recreate it rather than transfer it.

### A2. Decide transfer or recreate, per provider

Transferring keeps identifiers and history. Recreating gives a clean credential
boundary, at the cost of reconfiguration.

Recommended: **transfer** GitHub and Supabase; **recreate** anything holding an
OAuth client or an API key, because otherwise the old credential stays valid in
somebody's personal account.

**If you recreate the Netlify sites their IDs change**, and
`.github/workflows/deploy-netlify.yml` hardcodes both. Deployment will then
refuse with "bound to the wrong Netlify site ID". That guard is doing its job —
update the two values, do not remove it.

---

## Phase B — Create the QBBE homes (additive, still no risk)

### B1. GitHub organization

1. Sign in as the QBBE account, not `Chxmdi`.
2. Go to <https://github.com/organizations/plan> and create the organization.
3. Name it for QBBE, with a QBBE-controlled billing email.
4. Settings → Member privileges → require two-factor authentication.

*Done when:* the organization page loads and 2FA enforcement shows as enabled.

### B2. QBBE-owned provider accounts

Create, under a QBBE-controlled email:

- Supabase organization
- Netlify team
- Google Cloud project for OAuth and Gmail Pub/Sub
- Email provider account
- Error monitoring account

*Done when:* you can sign in to each as QBBE without using a personal login.

**Warning:** use a shared QBBE mailbox or distribution list, not one person's
address. A resource owned by an individual's account is the exact problem being
fixed here.

---

## Phase C — Transfer (irreversible — read the whole phase first)

### C1. Decide public or private before transferring

The repository is public today, and transfer does not change that. Decide
deliberately. If it should be private, change it **before** transferring, so the
window where it sits public under QBBE's name is zero.

### C2. Transfer the repository

**Warning: this changes the repository URL and breaks every existing clone's
remote. Tell anyone holding one before you do it.**

1. `https://github.com/Chxmdi/QBBE-HUB/settings` → Danger Zone → Transfer
   ownership.
2. Enter the QBBE organization as the new owner and confirm.
3. Update your own remote:
   `git remote set-url origin https://github.com/<qbbe-org>/QBBE-HUB.git`
4. Verify with `git remote -v`, then confirm `git fetch origin` succeeds.

*Done when:* `gh repo view` shows the QBBE organization as owner.

**Verify rather than assume, straight after the transfer:**

- secrets and variables — `gh secret list`, `gh variable list`
- environments — `gh api repos/<qbbe-org>/QBBE-HUB/environments`
- branch protection on `main` is still enabled
- the `staging` environment's protection rules survived

Repository settings do not always carry across a transfer intact. Re-create
anything missing before going further.

### C3. Transfer Supabase

1. Supabase dashboard → project → Settings → General → Transfer project.
2. Target the QBBE organization.
3. Check the project URL afterwards. If it changed, every environment holding
   `NEXT_PUBLIC_SUPABASE_URL` must be updated, including local `.env.local`.

*If transfer is not available on your plan:* create the project fresh under
QBBE, apply the schema with `npx supabase db push`, and treat it as a new
environment rather than patching the old one.

---

## Phase D — Isolation and secrets

### D1. Create the missing `production` environment

`staging` exists; `production` does not, and the deploy workflow requires it.

1. Repository → Settings → Environments → New environment → `production`.
2. Add required reviewers — a production deploy should need a human.
3. Restrict it to the `main` branch only.

*Done when:* `gh api repos/<owner>/QBBE-HUB/environments` lists `production`.

### D2. Review the stray `copilot` environment

A `copilot` environment exists and nothing in the workflows references it.
Confirm what it is for and delete it if it is not needed — an environment can
hold secrets.

### D3. Set per-environment values

For **each** of `staging` and `production`, separately:

| Kind | Name |
|---|---|
| Variable | `NETLIFY_SITE_ID` — that environment's site, matching the workflow's expected ID |
| Variable | `RELEASE_ENABLED` — **`false` for production until #21 certifies staging** |
| Secret | `NETLIFY_AUTH_TOKEN` — a QBBE-owned token |
| Secret | every runtime value from the provider table |

**The two environments must not share a Supabase project, a storage bucket, a
database or an email sender.** That separation is the requirement itself, not a
refinement of it.

### D4. Rotate every credential that ever lived in a personal account

**Warning: rotating `SUPABASE_SERVICE_ROLE_KEY` immediately breaks everything
still holding the old one — local `.env.local`, any running test server, CI.
Do it when you can update every holder in the same sitting.**

Rotate: the Supabase service-role and anon keys, `NETLIFY_AUTH_TOKEN`, the
Google OAuth client secret, the email provider key, `CRON_JOB_SECRET` and
`VMS_API_KEY`.

A credential that was ever in a personal account stays a personal credential
until it is rotated. Transferring the resource does not rotate its keys.

*Done when:* the old values fail and the new ones work.

---

## Phase E — Prove it, then write it down

### E1. Prove staging cannot write production

This is the acceptance criterion, so it needs a demonstration rather than an
assertion.

1. Deploy to staging: Actions → Deploy Netlify → Run workflow → `staging`.
2. Create a recognisable record in staging — a program named
   `ISOLATION-TEST-<date>`.
3. Open production and confirm the record is absent.
4. Confirm staging's `NEXT_PUBLIC_SUPABASE_URL` differs from production's.

*Done when:* the record exists in exactly one environment.

*If it appears in both:* stop. The environments share a database, and nothing
else in this runbook is safe to continue.

### E2. Confirm production publishing is still gated

With `RELEASE_ENABLED` unset or `false` for production, run the deploy workflow
against `production`.

*Expected:* it fails with "Release is disabled. Complete the environment release
checklist first."

*If it succeeds:* the gate is not working, and #21 cannot be relied on until it
does.

### E3. Record custody and update the evidence

1. Complete `docs/runbooks/custody.md` — every resource, its QBBE owner, and
   where its secrets live. Names only, no values.
2. Update the blocked rows in `docs/readiness-report.md`.
3. Close #52 against its acceptance criteria, naming the E1 demonstration as the
   evidence.

---

## What this unblocks

#55 staging certification, which 28 of the 83 requirement rows in
`docs/acceptance-matrix.md` name as their outstanding evidence. #35's
`CLAMAV_SOCKET` and #47's email provider also stop being blocked once those
accounts exist under QBBE.
