# Owner checklist: what only QBBE can do

Everything below needs a QBBE account, a person or a decision. The code for
each item is already built and tested. Work top to bottom: each section
unblocks the next. Tick items off here (or tell Claude and it will).

Where a step has detailed instructions, the runbook is named. Secrets (keys,
passwords, tokens) go into the password manager and the named setting, never
into chat, email or the repository.

As of 2026-09-29.

## 1. Accounts and ownership (#52) — start here

- [ ] **GitHub organization.** Create a QBBE organization on GitHub and transfer
  the `QBBE-HUB` repository to it (Settings → General → Danger Zone → Transfer).
  Until then the code, its protections and its secrets belong to one personal
  account.
- [ ] **Branch protection.** With an admin token, run
  `GITHUB_TOKEN=<token> scripts/protect-main.sh`. It prints the live rules
  afterwards; they should show `Verify` and `Database security` as required
  (#51). See `docs/runbooks/deployment.md`, "Branches and gates".
- [ ] **Supabase organization.** At supabase.com/dashboard, create an
  organization named for QBBE on the Free plan.
- [ ] **Move the existing project.** Tell Claude first whether `qbbe-hub` holds
  any real data. Then open it → Project Settings → General → Transfer project →
  the QBBE organization. It becomes production.
- [ ] **Create staging.** In the QBBE organization: New project,
  `qbbe-hub-staging`, region Canada (Central), generated database password
  saved in the password manager. If Supabase refuses because of the free
  project limit, pause `nulia-dev` or tell Claude.
- [ ] **Netlify.** Confirm the two sites `qbbe-hub-staging`
  (`2169b17a-8dc3-49de-a466-4281e1285de2`) and `qbbe-hub-production`
  (`a34499c8-0d84-47d5-bfb2-502c2b9b9071`) sit in a Netlify team QBBE controls
  (Site configuration → General shows the Site ID). If not, tell Claude.
- [ ] **Custodians.** Fill in `docs/runbooks/provider-custody.md`: for GitHub,
  Supabase, Netlify, Google, email, scanning, monitoring and backups, a primary
  and a backup person, a QBBE recovery address, and MFA enforced.

## 2. Staging (#55)

Follow `docs/runbooks/staging-provisioning.md`. In short:

- [ ] Staging project: copy its Project URL, anon key, service-role key and
  project ref (Project Settings → API), and create a Supabase access token
  (avatar → Account preferences → Access Tokens).
- [ ] GitHub → Settings → Environments → `staging`: the variables and secrets
  in step 4a, with `RELEASE_ENABLED` = `true`.
- [ ] GitHub → Settings → Secrets and variables → Actions → Variables:
  `STAGING_SUPABASE_PROJECT_REF` and `PRODUCTION_SUPABASE_PROJECT_REF` (step 4b).
- [ ] Netlify staging site → Site configuration → Environment variables: the
  app settings in step 4c, including a 32+ character `CRON_JOB_SECRET`.
- [ ] Run the deploy (Actions → Deploy Netlify → `staging`), or ask Claude to.
- [ ] In the staging project's SQL editor, wire background jobs (step 5b).
  `<site>/api/health/jobs` should answer `{"jobRunner":"ready"}`.
- [ ] Switch the staging project, then production, to JWT signing keys
  (`deployment.md` step 9). This removes an Auth call from almost every request.
- [ ] Sign up once on staging with a QBBE address: that account becomes the
  owner. Enrol two authenticator factors, then invite the other role accounts
  from Admin.

## 3. Services the app connects to

- [ ] **Email (#47).** Verify a QBBE sender domain in Resend, then set
  `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_WEBHOOK_SECRET` and, on
  staging, `EMAIL_RECIPIENT_ALLOWLIST` (for example `@qbbe.org`). Choose a test
  recipient.
- [ ] **Google (#16).** A QBBE-owned Google Cloud project with an OAuth client
  and a test account for Calendar, Drive and Gmail.
- [ ] **Volunteer management.** The provider contract and test credentials.
- [ ] **Virus scanning of uploads (#35, #13).** Decide where the scanner runs
  (a small always-on server, for example Oracle Cloud's free tier). Until it
  exists, uploaded files stay "Security check pending" and cannot be opened.
  See `docs/runbooks/document-scanning.md`.
- [ ] **Monitoring (#53).** An error-monitoring account and the people alerts go
  to.
- [ ] **Backups (#54).** Encrypted daily database and file backups to QBBE
  Drive, a named custodian, and one restore rehearsal before real data. See
  `docs/runbooks/backup-recovery.md`.
- [ ] **GitHub Project (#59).** Fields, views and auto-add in the project
  settings.

## 4. The accountant

- [ ] Balances as at 2026-09-30, the fiscal year-end, GST/QST registration and
  filing period, whether the public service body rebate applies, the tax-form
  mapping for the nonprofit returns, and the gift acknowledgement wording.
- [ ] Review the chart of accounts, funds and tax setup before real entries.
- [ ] Two questions from the walkthrough: should interfund "Due from/to other
  funds" be shown net on the statement of financial position; and confirm QBBE
  is a nonprofit, not a registered charity.
- [ ] Confirm record retention periods (at least 6 years for financial records).
- [ ] One month-end run in parallel with the current books, then sign-off on
  the cut-over and its date.
- [ ] Real sample files: one statement from each bank QBBE uses, and one pay-run
  journal from the payroll provider, to confirm the import layouts.

## 5. People, legal and sign-offs

- [ ] **French reviewer (#141).** A fluent French speaker reviews the wording.
- [ ] **Counsel (#144).** Which documents may be signed electronically, and
  whether to build or buy e-signatures; also French-language obligations.
- [ ] **Staff privacy notice (#136).** Confirm it covers the team overview and
  work summaries, and tell staff, before an admin turns on reminders or the
  weekly digest (Admin → Team signals).
- [ ] **Accessibility (#17).** A screen-reader pass with VoiceOver and NVDA.
- [ ] **Brand (#17).** Sign-off against the QBBE identity.
- [ ] **Operator acceptance (#57).** Try it on Safari and a phone, read the
  runbooks, and sign off.

## 6. Production (#58, #22)

After staging is certified and the items above are done: set production's
settings the same way as staging's, set its `RELEASE_ENABLED` to `true`, and
follow `docs/runbooks/release-procedure.md`. Claude runs the release checks and
reconciles the evidence (#56).
