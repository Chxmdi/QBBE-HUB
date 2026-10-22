# Hosting: the QBBE server

QBBE Hub runs on one free Oracle Cloud server in Montreal. Staging and
production are two containers on it, next to a shared HTTPS front door
(Caddy) and the document virus scanner (ClamAV). The databases, sign-in and
file storage stay on Supabase; nothing on the server holds data, so a lost
server is rebuilt from scratch without losing anything.

This replaced Netlify in October 2026, when the free Netlify credits ran out
and the sites were paused. Netlify could not run the virus scanner either.

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Server | Oracle Cloud Always Free, region Canada Southeast (Montreal), Ampere A1, 2 processors, 12 GB, Ubuntu 24.04 | $0 within Oracle's Always Free limits |
| HTTPS front door | container `qbbe-caddy` | routes each address to its environment, gets and renews certificates by itself |
| Virus scanner | container `qbbe-clamav` (`clamav/clamav-debian`) | reachable only from the app containers; about 3–4 GB of memory |
| Staging app | container `qbbe-app-staging` | half of production's processor share when both are busy |
| Production app | container `qbbe-app-production` | |
| Database, Auth, Storage | Supabase, one project per environment | unchanged |
| Images | GitHub Container Registry, `ghcr.io/chxmdi/qbbe-hub:<environment>-<commit>` | built per environment, because Next.js writes the public settings into the browser code |

Files on the server, all under `/opt/qbbe`:

| Path | What |
|---|---|
| `base/compose.base.yaml`, `base/Caddyfile` | the shared services, from `deploy/server/` |
| `base/sites/<environment>.caddy` | each environment's address, written by its release |
| `<environment>/app.env` | that environment's settings (the `APP_ENV` secret), readable by the deploy user only |
| `<environment>/current-image`, `previous-image`, `releases.log` | what is live, what it replaced, and every release |

## What the free setup costs you

These are the trade-offs of the $0 choice. Read them once.

- **One machine for both environments.** A heavy staging test (the 50-user
  load test) slows production while it runs; production gets twice
  staging's processor share to limit this. Once "Deploy access" below is
  done, staging's deploy credentials can release staging and nothing else;
  until then, anyone who can deploy staging can reach the machine production
  runs on.
- **No spare machine.** If the server stops, both environments are down until
  it is restarted or rebuilt (about 30 minutes with the steps below).
- **Oracle can change the free tier.** It halved the free Ampere allowance in
  June 2026 without notice. If it shrinks again or Oracle reclaims the
  server, the same files run on any Ubuntu server with 8 GB or more.
- **Oracle reclaims idle free servers.** A server counts as idle only when
  processor, network *and* memory use all stay under 20% for 7 days. The
  scanner alone keeps memory above that, so this server is not idle.
- **Security updates for the server itself are automatic**, with a reboot at
  04:30 UTC (half past midnight in Montreal in summer) on nights an update
  needs one. The site is down for about a minute then.
- **The web server (Caddy) and the virus scanner are not updated by
  themselves.** Their images are pinned to an exact build in
  `deploy/server/compose.base.yaml`, so the server runs what was reviewed.
  Each week Dependabot opens a pull request when a newer build exists. See
  "Updating Caddy and the scanner" below.

## Setting it up (owner steps)

Do these once, in order. Each step says what you should see.

### 1. Create the Oracle Cloud account

1. Go to <https://www.oracle.com/cloud/free/> and choose **Start for free**.
2. Use a QBBE mailbox, not a personal one. For **Home Region**, choose
   **Canada Southeast (Montreal)**. This cannot be changed later.
3. Oracle asks for a card to confirm identity. It does not charge a free
   account. Do **not** upgrade to Pay As You Go; that is what keeps it $0.

You should see the Oracle Cloud console with "Free Tier" at the top.

### 2. Create the server

1. Console menu, **Compute**, **Instances**, **Create instance**.
2. **Name**: `qbbe-hub`.
3. **Image and shape**, **Edit**:
   - **Change image**, **Canonical Ubuntu**, version **24.04**, **Select image**.
   - **Change shape**, **Ampere**, **VM.Standard.A1.Flex**, set **OCPUs: 2**
     and **Memory: 12 GB**, **Select shape**. It should say "Always Free-eligible".
4. **Networking**: keep **Create new virtual cloud network** and **Assign a
   public IPv4 address** ticked.
5. **Add SSH keys**: **Generate a key pair for me**, then **Save private
   key**. Keep that file safe; it is the deploy key.
6. **Create**.

You should see the instance turn from Provisioning to **Running** within a few
minutes. Copy its **Public IP address** from the instance page.

If it says **Out of capacity for shape VM.Standard.A1.Flex**: Oracle has no
free Ampere machine in Montreal at that moment. Try again later the same day
or the next; capacity frees up as others delete theirs.

### 3. Open the web ports

1. On the instance page, under **Primary VNIC**, open the **Subnet** link,
   then **Security Lists**, then the **Default Security List**.
2. **Add Ingress Rules**: Source CIDR `0.0.0.0/0`, IP protocol **TCP**,
   destination port range `80`. **Add Ingress Rules**.
3. Repeat for port `443`.

You should see two new rules for 80 and 443 next to the existing one for 22.
The server's own firewall is opened by the setup workflow in step 6.

### 4. Choose the two addresses

Each environment needs a host name that points at the public IP.

- **With a QBBE domain** (recommended): at the domain's DNS provider, add two
  **A** records, for example `hub` and `hub-staging`, both pointing at the
  public IP. You should see them resolve within an hour.
- **Without one, to start**: use the free `sslip.io` names, which resolve to
  the address written in them. For IP `203.0.113.10`:
  `staging.203-0-113-10.sslip.io` and `hub.203-0-113-10.sslip.io`.
  Nothing to set up. Move to a QBBE domain before inviting staff.

### 5. Put the settings into GitHub

Repository **Settings**, **Environments**, then **staging**, and afterwards
**production** with production's own values.

In each, under **Deployment branches and tags**, choose **Selected branches
and tags** and add `main`. This is what stops a run from another branch from
using the environment's keys; the workflows' own "runs from main only" check
is only a clear message. You should see "main" listed under the rule.

**Variables** (Environment variables, **Add variable**):

| Name | Value |
|---|---|
| `DEPLOY_HOST` | the server's public IP (the same for both environments) |
| `SITE_URL` | `https://` plus that environment's host name from step 4 |
| `SUPABASE_PROJECT_REF` | that environment's Supabase project ref (already set) |
| `RELEASE_ENABLED` | `true` for staging; production stays `false` until it is certified |
| `SMOKE_EMAIL` | that environment's smoke user (staging-provisioning.md); Deploy signs in as it after each release |

**Secrets** (Environment secrets, **Add secret**):

| Name | Value |
|---|---|
| `DEPLOY_SSH_KEY` | the whole private key file from step 2, including the BEGIN and END lines (the same for both environments) |
| `APP_ENV` | that environment's app settings, one `NAME=value` per line; see "The APP_ENV secret" below |
| `SUPABASE_DB_URL` | that environment's database address for migrations: Supabase, the project, **Connect**, **Session pooler** URI, with the database password filled in. It reaches this project only, unlike a personal access token |
| `SUPABASE_DB_PASSWORD` | that environment's database password (already set) |
| `DEPLOY_KNOWN_HOSTS` | added in step 6 |
| `SMOKE_PASSWORD` | the smoke user's password |

Then delete the Netlify leftovers from both environments: `NETLIFY_SITE_ID`
and `NETLIFY_AUTH_TOKEN`.

**Warning:** check every `APP_ENV` value against the right Supabase project
before saving. The deploy refuses a production `APP_ENV` that points at
staging's database, and the reverse, but it cannot tell two keys apart.

### 6. Prepare the server

1. **Actions**, **Server setup**, **Run workflow** (it runs from the
   `server-admin` environment, see "Deploy access"), tick **Only print the
   server's SSH host key**, **Run workflow**.
2. Open the run. Its summary shows one line starting with the IP address and
   `ssh-ed25519`. Copy the whole line into a new secret
   `DEPLOY_KNOWN_HOSTS` on `server-admin`, staging and production.
3. On `server-admin`, add the variable `ACME_EMAIL`: a QBBE mailbox someone
   reads (for example the IT contact). Let's Encrypt, which issues the
   site's certificates, writes there if a certificate cannot be renewed.
   Until it is set, Server setup stops with "Set the ACME_EMAIL variable on
   server-admin" and changes nothing on the server.
4. **Run workflow** again, the box **not** ticked.

You should see the run finish green, with `qbbe-caddy` and `qbbe-clamav`
listed as running. The scanner downloads its signatures for a few minutes
after the first start.

If it fails with "Could not sign in": `ADMIN_SSH_KEY` on `server-admin` is
not the key from step 2, or `DEPLOY_HOST` is wrong. If it fails on the host key, print the key
again (point 1 of this step); the server was probably recreated.

### 7. Tell Supabase the new addresses

In each environment's Supabase project: **Authentication**, **URL
Configuration**. Set **Site URL** to that environment's `SITE_URL`, and add
`<SITE_URL>/auth/callback` under **Redirect URLs**. Remove the old
`netlify.app` entries. If Google sign-in is on, add the new callback in the
Google OAuth client too (google-sign-in.md).

### 8. Deploy staging, then wire its background jobs

1. **Actions**, **Deploy**, **Run workflow**, environment `staging`.
2. The first run stops at **Smoke check**, step "Background jobs reach this
   site", with `not_configured`. That is expected the first time.
3. In staging's Supabase **SQL Editor**, run, with staging's address and the
   `CRON_JOB_SECRET` from staging's `APP_ENV`:
   ```sql
   select app.configure_job_runner('https://<staging host>', '<CRON_JOB_SECRET>');
   ```
4. In the Deploy run, **Re-run failed jobs**.

You should see every job green, and staging's address showing the sign-in
page with a valid padlock.

### 9. Production

The same as step 8 with environment `production`, after a green **Release
candidate** run on the commit (release-procedure.md). Set production's
`RELEASE_ENABLED` to `true` only then.

### 10. Close Netlify

Once both environments run here: in Netlify, delete the two QBBE sites
(**Site configuration**, **Delete this site**), then revoke the Netlify
access token.

## Deploy access

Staging and production each have their own deploy user on the server
(`qbbe-staging`, `qbbe-production`) with its own SSH key, held only in that
environment's `DEPLOY_SSH_KEY`. Their keys are in root-owned files
(`/etc/ssh/authorized_keys/<user>`), and whatever they ask for, the server
runs `/usr/local/sbin/qbbe-ssh-gate`, which allows only the release wrapper:
no shell, no file copy, no forwarding. Neither user is in the docker group or
has sudo, except to run `/usr/local/sbin/qbbe-release` for its own
environment (`deploy/server/sudoers.qbbe`). The wrapper uses only the
server's own copies of the release files (`/opt/qbbe/bin`), installed by
**Server setup**, and releases only this repository's images. So a change to
`release.sh`, `compose.app.yaml` or `site.caddy.template` reaches the server
with the next **Server setup** run, not with a deploy. The apps sit on
separate Docker networks that only Caddy and the scanner join. **Server
setup** itself runs from its own `server-admin` environment with the
administrator key.

Until the switch below is done, deploys use the old shared deploy user (the
`ubuntu` key in both environments), which can read both environments'
settings and has root through sudo. The switch keeps that path working until
the new one has deployed both environments once.

One gap remains by design: both apps use the same virus scanner, so a
compromised staging image could stop it for production too (uploads then stay
"Security check pending" until it restarts). Running a second scanner would
need about 4 GB more memory.

### Before the next deploy after this change (owner steps)

The deploy now needs two things the old one did not. Do both before running
**Deploy** for either environment, or it stops at its first check (nothing
live is touched).

1. In each environment (staging, production): add the secret
   `SUPABASE_DB_URL`. In Supabase: the project, **Connect**, **Session
   pooler**, copy the URI, and put the database password in place of
   `[YOUR-PASSWORD]`. Use the session pooler (port 5432), not the direct
   connection: GitHub's runners cannot reach the direct address. You should
   see the next Deploy's first job pass "Check environment readiness".
2. Run **Server setup** once, as in step 3 below (it creates each
   environment's own Docker networks). Without it the release step stops with
   "network ... could not be found" and leaves the running site alone.

### Switching over (owner steps)

**Before you start:** do this when nobody needs a deploy for an hour. Step 8
changes who can reach the server; if a step fails, stop and keep the old
path (leave `DEPLOY_MODE` unset) rather than improvising.

1. On your computer, make three new key pairs, one at a time:
   `ssh-keygen -t ed25519 -N "" -C qbbe-staging -f qbbe-staging`, then the
   same with `qbbe-production` and `qbbe-admin`. Each makes a private key file
   and a `.pub` file. You should see three pairs of files.
2. In GitHub: **Settings**, **Environments**, **New environment**, name
   `server-admin`. Under **Deployment protection rules** tick **Required
   reviewers** and add yourself; under **Deployment branches and tags**
   choose **Selected branches and tags** and add `main`. Add to it:
   - secrets `ADMIN_SSH_KEY` (for now, the private key in `DEPLOY_SSH_KEY`
     today) and `DEPLOY_KNOWN_HOSTS` (the same line as now);
   - variables `DEPLOY_HOST` (the server's IP), `STAGING_DEPLOY_PUBKEY` (the
     one line in `qbbe-staging.pub`), `PRODUCTION_DEPLOY_PUBKEY` (the line in
     `qbbe-production.pub`) and `ADMIN_PUBKEY` (the line in
     `qbbe-admin.pub`). If the old deploy user is not `ubuntu`, also
     `DEPLOY_USER` with its name.
3. **Actions**, **Server setup**, **Run workflow**, box **not** ticked. You
   should see it finish green. If it fails with "Could not sign in", check
   `ADMIN_SSH_KEY` and `DEPLOY_HOST` on `server-admin`.
4. In the **staging** environment: replace `DEPLOY_SSH_KEY` with the private
   key file `qbbe-staging` (the whole file) and add the variable
   `DEPLOY_MODE` with the value `isolated`. Then run **Deploy** for staging.
   You should see the Release job sign in as `qbbe-staging` and finish green,
   and the smoke check pass. If it fails, delete `DEPLOY_MODE` and put the
   old key back in `DEPLOY_SSH_KEY`: the old path works again.
5. Do the same for **production** with `qbbe-production`, then deploy
   production (it asks for the usual approval).
6. Delete the secret `SUPABASE_ACCESS_TOKEN` from both environments, and
   revoke that token in Supabase (avatar, **Account preferences**, **Access
   Tokens**).
7. Prove the new administrator key before anything is removed: replace the
   `server-admin` secret `ADMIN_SSH_KEY` with the private key file
   `qbbe-admin` (the whole file), then run **Server setup** with the box
   **not** ticked. (Step 3 already added `ADMIN_PUBKEY` next to the old key.)
   You should see it sign in and finish green. If it cannot sign in, put the
   old key back in `ADMIN_SSH_KEY` and check that `ADMIN_PUBKEY` matches
   `qbbe-admin`; nothing has been removed yet.
8. **Server setup** again, ticking **Remove the old shared deploy access**.
   This takes the old user out of the docker group, gives the environment
   folders to root and **leaves `ADMIN_PUBKEY` as the administrator's only
   key**: the old key, which both environments held, stops working
   everywhere. It refuses to run unless `ADMIN_PUBKEY` is already installed
   (step 7). The server remembers this, so later runs keep it that way.
   **This is hard to undo:** from now on the `qbbe-admin` key is the only way
   in. If that file is lost, the server can only be reached through the
   Oracle Cloud console (the instance's **Console connection**; to confirm on
   QBBE's account). To rotate the administrator key later, add the new key
   as `ADMIN_PUBKEY`, run Server setup (it adds it), switch `ADMIN_SSH_KEY`,
   then remove the old line from the server by hand.
9. Keep the three private key files only in the QBBE password manager, and
   delete them from your computer.

To check it worked, the security finding's test: an SSH session as
`qbbe-staging` (with its key) is refused a shell, and its only permitted
command cannot read `/opt/qbbe/production/app.env`, run `docker ps` or
`sudo -n true`. The old key no longer signs in as `ubuntu`.

After step 8, a later change can drop the old `qbbe-edge` and `qbbe-scan`
networks from `compose.base.yaml`; nothing uses them once both environments
have been deployed through the wrapper.

## The APP_ENV secret

One `NAME=value` per line, no quotes needed. Each environment has its own
values; never copy production's into staging. A value containing `$` must be
wrapped in single quotes (`NAME='va$lue'`), or the server reads `$` as the
start of a variable name.

```
NEXT_PUBLIC_SUPABASE_URL=https://<this environment's project ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<that project's anon or publishable key>
SUPABASE_SERVICE_ROLE_KEY=<that project's service role or secret key>
NEXT_PUBLIC_APP_URL=<the same as SITE_URL>
CRON_JOB_SECRET=<32+ random characters: openssl rand -base64 48>
EMAIL_PROVIDER_API_KEY=<Resend key, when email is set up>
EMAIL_FROM_ADDRESS=QBBE Hub <hub@your-domain>
EMAIL_RECIPIENT_ALLOWLIST=<staging only: the test addresses>
WORKSPACE_OS_FLAGS=all
```

- `WORKSPACE_OS_FLAGS` is for **staging only**. A production deploy refuses
  to run while its `APP_ENV` has that line at all.
- Optional integrations (`GOOGLE_*`, `VMS_*`, `ZEFFY_API_KEY`, `ZEFFY_WEBHOOK_SECRET`, `ERROR_MONITORING_DSN`,
  `NEXT_PUBLIC_GOOGLE_SIGN_IN`) go here too, as `.env.example` lists them.
- Leave out `CLAMAV_HOST`, `CLAMAV_PORT` and `CLAMAV_SOCKET`: the server
  always points the app at its own scanner.
- A change takes effect at the next Deploy run. The `NEXT_PUBLIC_*` values are
  built into the image, so they need a Deploy, not just a restart.

## Day to day

- **Release, roll back**: release-procedure.md. Rollback takes a commit SHA
  and restores that release's image in about a minute.
- **A failed release** (the new container never reports healthy) puts the
  previous image back by itself, but that environment is down while it
  waits, up to about 2 minutes. The other environment is not affected.
- **Look at the logs** (needs the deploy key on your computer):
  ```
  ssh -i <key file> ubuntu@<server IP>
  docker logs --tail 100 qbbe-app-production
  docker logs --tail 100 qbbe-clamav
  ```
- **Restart one environment**: `docker restart qbbe-app-staging`.
- **What is live**: `cat /opt/qbbe/production/current-image`, or open
  `<SITE_URL>/api/health/version`, which shows the commit.
- **Disk**: each environment keeps its five newest images; older ones are
  removed at each release. Each container keeps at most 200 MB of logs (ten
  files of 20 MB); the oldest file is deleted when a new one starts.

## Logs

- **Access log** (`docker logs qbbe-caddy`): one JSON line per request with
  the time, the visitor's IP address, the method, the address asked for,
  the status, the duration and a request ID. Values of sign-in codes, tokens,
  invitation codes and signatures in the address are removed before the line
  is written; the rest of the address is kept. Cookies and the Authorization
  header are never written.
- **Request ID**: Caddy gives every request an ID, passes it to the app as
  `X-Request-Id` and sends it back in the response. To trace a complaint, ask
  for the time and, if possible, the ID shown in the browser's network tab,
  then search both logs for it:
  `docker logs qbbe-caddy 2>&1 | grep <id>`.
- **App logs** (`docker logs qbbe-app-<environment>`): the app's own errors
  and job runs.
- **How long**: logs are kept by size, not by date (200 MB per container,
  usually several weeks on this traffic). They are removed when the server is
  rebuilt. How long IP addresses may be kept is a QBBE decision, recorded in
  privacy.md.

## Updating Caddy and the scanner

1. When Dependabot opens a pull request titled like "Bump caddy" or "Bump
   clamav/clamav-debian", check that CI is green and merge it.
2. **Actions**, **Server setup**, **Run workflow**. It downloads the new
   image before restarting anything; if the download fails, the old one keeps
   running and the run fails.
3. You should see the run finish green with `qbbe-caddy` and `qbbe-clamav`
   running, and the site answering. If the site does not answer, revert the
   merged pull request and run **Server setup** again.

Do this within a week of the pull request for Caddy (it faces the internet);
the scanner's virus signatures update by themselves, so its image can wait
for the next convenient run.

## Rebuilding the server

If the server is lost: do steps 2, 3 and 6 again (a new server has a new IP
and a new host key: update `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`, `SITE_URL`
if it used `sslip.io`, and the DNS records), then run **Deploy** for staging
and production. No data needs restoring; it all lives in Supabase.
