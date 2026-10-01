---
name: verify
description: Run the QBBE Hub app locally against the local Supabase stack and drive it in a real browser to verify a change.
---

# Verify QBBE Hub at runtime

## Build and start (local stack only; never the hosted project)

1. Create the local Auth signing key once (`bash scripts/local-signing-key.sh`; `supabase start` refuses to run without it), then start the local stack: `npx supabase start -x studio,edge-runtime,logflare,vector,supavisor,imgproxy`
2. `npx supabase db reset && npm run db:seed` (seed prints `qa-owner@example.com / QaTest!2026`).
3. Export the app variables from `npx supabase status -o env` **before building**:
   `NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000`.
   Without these exports the build has no Supabase URL and every sign-in fails
   with "Failed to fetch". Confirm with
   `grep -rl 127.0.0.1:54321 .next/static | wc -l` (must be > 0).
4. `npm run build`, then `npx next start -p 3000 -H 127.0.0.1`.

## Drive it

- Launch Chromium with `executablePath: "/opt/pw-browsers/chromium"` and
  `args: ["--no-proxy-server"]` (the container's HTTPS proxy otherwise sits in
  front of 127.0.0.1).
- QA accounts: `qa-<owner|admin|staff|volunteer|guest|lead|pm|contributor|readonly>@example.com`,
  password `QaTest!2026`. Owner and admin enroll TOTP on first sign-in: read the
  secret from the "Can’t scan the QR code?" field and compute the code as in
  `tests/e2e/auth.ts`.
- French: set cookie `qbbe-locale=fr-CA` after signing in (the sign-in page
  itself follows the browser language, so its labels change too).
- Don't `pkill -f "next start"` from a command whose own text contains that
  phrase; it kills the shell running it.

## Known local limits

- Background jobs (virus scans, notification email, Gmail sync) are fired by
  the database's cron through `app.configure_job_runner(url, secret)`, and the
  database container cannot reach 127.0.0.1:3000, so they never fire locally.
  Run one by hand instead: start the site with `CRON_JOB_SECRET=<32+ chars>`
  and `CRON_JOB_SECRET=<same> npm run jobs:run -- <job>`.
- Uploads stay "Security check pending" until `scan-documents` (receipts:
  `scan-receipts`; forms: `scan-form-files`) has a scanner. Locally run
  `docker run --rm -p 3310:3310 clamav/clamav` (it needs to download
  signatures once) and start the site with `CLAMAV_HOST=127.0.0.1`, then run
  the job. Without a scanner the file stays pending, by design.
- The seed has no fiscal year and an unapproved chart of accounts, so ledger
  posting, statements and fund releases need setup before they show data.
