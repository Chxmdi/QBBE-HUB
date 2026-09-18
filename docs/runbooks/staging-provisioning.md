# Staging provisioning and exact-commit deployment

Issue: #55 (acceptance ID `OPS-DEPLOY`, staging portion). Depends on #52 for
QBBE-owned accounts and on #51 for the release gates.

This is the procedure, start to finish, for standing up staging and deploying
one frozen commit to it. `deployment.md` describes the gated workflow itself;
this describes doing it for real, in order, with what you should see at each
step.

Everything here needs provider accounts that only a QBBE custodian can create.
Nothing in this file can be completed from a developer machine alone.

> **Before you start.** Staging must never be able to write to production.
> Every step that could break that is marked. If you are unsure whether a value
> belongs to staging or production, stop and check the register in
> `provider-custody.md` rather than guessing.

## 1. Freeze the commit

1. Decide the commit to certify and record its full 40-character SHA. Take it
   from `main`, not from a branch:
   ```bash
   git rev-parse origin/main
   ```
2. Confirm CI passed on that exact commit:
   ```bash
   gh run list --branch main --limit 5
   ```
   **You should see** a completed successful run whose head SHA matches. If the
   latest green run is for a different SHA, you are about to certify something
   nobody has tested — go back to step 1.
3. Write the SHA into the acceptance evidence for `OPS-DEPLOY` before you
   deploy, not after. Recording it afterwards makes it a description of what
   happened rather than a commitment to what is being certified.

## 2. Provision the staging Supabase project

1. In the QBBE-owned Supabase organization, create a project named
   `qbbe-hub-staging`. **Do not reuse the production project.**
2. Record its project ref, URL and anon key in `provider-custody.md`.
3. Apply the whole migration chain:
   ```bash
   supabase link --project-ref <staging-ref>
   supabase db push
   ```
   **You should see** every migration in `supabase/migrations/` applied in
   filename order, ending without error.
4. Confirm the chain actually landed:
   ```bash
   supabase migration list
   ```
   **You should see** the local and remote columns matching, with no migration
   present locally but missing remotely.
5. Run the security advisor for that project and resolve anything it reports
   before continuing. A staging environment that starts with advisor findings
   will be certified with them.

**Failure to watch for:** `db push` refusing because the remote has migrations
the repository does not. That means the project is not empty — most likely you
linked production. Stop, run `supabase projects list`, and confirm the ref.

## 3. Create the staging accounts

Staging has no users until somebody signs up, because the first sign-up is what
provisions the organization.

1. Open the staging site and sign up once. That account becomes Primary Owner.
2. Use a QBBE address, not a personal one, and enrol its authenticator
   immediately — owner operations require it.
3. Invite the remaining role accounts from the admin page rather than inserting
   them, so the invite-only path is exercised on the environment being certified.

**Do not** run `supabase/tests/qa-users.sql` against staging. It writes directly
to `auth.users` with a known fixture password, which is acceptable on a local
container and is not acceptable on a hosted environment.

## 4. Bind the GitHub environment

1. In the repository settings, open **Settings → Environments → staging**
   (create it if absent).
2. Set these, exactly as `environment-ownership.md` specifies:

   | Name | Kind | Value |
   |---|---|---|
   | `NETLIFY_SITE_ID` | variable | `2169b17a-8dc3-49de-a466-4281e1285de2` |
   | `NETLIFY_AUTH_TOKEN` | secret | staging-capable deploy token |
   | `RELEASE_ENABLED` | variable | `false` until this runbook is complete |
   | `NEXT_PUBLIC_SUPABASE_URL` | variable | the **staging** project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | secret | the **staging** anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | secret | the **staging** service-role key |

3. **Check every value against the production environment before saving.** A
   production service-role key pasted into staging means a staging deploy can
   rewrite production data, and nothing later in this runbook would notice.

## 5. Deploy the frozen commit

The workflow takes no commit input. It publishes `github.sha` — the head of the
ref it is dispatched on — and its publish job refuses to run unless that ref is
`main`. So the commit is frozen by procedure, not by the workflow: what gets
deployed is whatever `main` points at the moment you dispatch.

1. Confirm `main` still points at the SHA from step 1, and tell anyone who might
   merge that certification is in progress:
   ```bash
   git rev-parse origin/main
   ```
   **You should see** exactly the SHA you recorded. If it has moved, either
   re-record and restart from step 1, or wait until main is back where you want
   it. Do not deploy "close enough" — the SHA in the evidence has to be the SHA
   that ran.
2. Dispatch it:
   ```bash
   gh workflow run deploy-netlify.yml -f environment=staging --ref main
   ```
3. **You should see** the workflow call the full CI workflow from that same
   commit first, then publish. If it publishes without running CI, the gate is
   not working — stop and fix that before certifying anything.
4. Re-check `git rev-parse origin/main` once the run starts, and confirm it is
   still the recorded SHA. If somebody merged between steps 1 and 2, the run is
   certifying a different commit than your evidence claims. Cancel it.
5. Record the resulting deploy URL, the workflow run URL and the Netlify deploy
   ID.

**Known gap, worth fixing before this is done often.** Tagging the commit and
dispatching with `--ref <tag>` would remove the race, but the publish job's
`github.ref == 'refs/heads/main'` condition would then skip publishing. Making
exact-commit deployment a property of the workflow rather than of the operator's
timing is a change to `deploy-netlify.yml`, and belongs with the release gates
in #51.

**If it fails at publish:** the token is the usual cause. Confirm the token
belongs to the QBBE Netlify team and has deploy rights on the staging site
specifically, not merely on the team.

## 6. Smoke-check the deployment

Against the staging URL, in this order. Each has a visible answer.

1. **Availability** — load the sign-in page. You should see the sign-in form,
   not a build error or a blank page.
2. **Database connectivity** — sign in as the owner. You should reach the
   workspace. A spinner that never resolves means the app cannot reach Supabase;
   check the URL and anon key in the environment.
3. **Auth** — sign out, then sign back in. Confirm the authenticator challenge
   appears for the owner. If it does not, MFA enforcement did not follow the
   migration chain.
4. **Recovery** — request a password reset and open the link from the real
   inbox. You should land on the reset form with a working session, on the same
   hostname you started from. Landing on "your recovery session is missing or
   has expired" means the deployment's public hostname differs from what the
   server reports; see `src/lib/request-origin.ts`.
5. **Critical routes** — open `/my-work`, `/board`, `/projects`, `/admin`. Each
   should render its own content.
6. **Write isolation** — create a task on staging with a distinctive title, then
   query production for that title. **You should see zero rows.** This is the
   check that proves the environments are separate; do not skip it because the
   configuration "looks right".

## 7. Record the evidence

For `OPS-DEPLOY` in `docs/acceptance-matrix.md`, record the commit SHA, the
staging URL, the workflow run URL, the migration list output, and the result of
each smoke check above. Attach the same to #55.

Leave `RELEASE_ENABLED` at `false` for production. Staging being certified says
nothing about production being ready; that is #21's decision, not this
runbook's.
