# AGENTS.md

## Cursor Cloud specific instructions

QBBE Hub is a single Next.js 15 (App Router) app backed by Supabase (Postgres +
Auth + RLS + Realtime). There is one product/service to run. Standard scripts
live in `package.json`; README.md and `docs/runbooks/` cover the rest — prefer
those over duplicating here.

### Services and how to run them

- Web app (dev): `npm run dev` → http://localhost:3000. Requires `.env.local`
  pointing at a Supabase backend (see below). The app is auth-gated: every route
  except `/sign-in`, `/sign-up`, `/auth/*` redirects to `/sign-in` until you are
  signed in.
- Local Supabase (Docker-based): provides Postgres/Auth/Realtime for real
  end-to-end use. Studio is at http://localhost:54323, the API at
  http://127.0.0.1:54321, and the Mailpit test inbox at http://localhost:54324.

### Startup on a fresh VM (non-obvious — do this before `npm run dev`)

Docker and the Supabase CLI are preinstalled in the environment snapshot, but
the Docker daemon does not auto-start and Supabase must be started manually:

1. Start Docker: `sudo service docker start` (once per boot).
2. Start Supabase from the repo root: `sudo -E supabase start`. The daemon
   socket is root-owned, so Supabase/Docker commands need `sudo` (the `ubuntu`
   user is in the `docker` group, so a fresh login shell can drop `sudo`).
3. Ensure `.env.local` exists (it is gitignored). Copy `.env.example` to
   `.env.local` and set the local values. The local anon key is the standard
   Supabase demo key and is stable across restarts:
   - `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=` (get it via `sudo -E supabase status -o env | grep ANON_KEY`)
4. `npm run dev`.

### Database / migrations / seed

- `sudo -E supabase db reset` recreates the DB and re-applies
  `supabase/migrations/*.sql` in order. Use it to get a clean state.
- The **first** sign-up bootstraps the workspace (creates the organization,
  makes that account Primary Owner, provisions the mandatory `#announcements` +
  `#general` channels). Later sign-ups join as Staff. So a clean DB + first
  sign-up is the fastest "hello world".
- Auto-seed is intentionally disabled in `supabase/config.toml` because
  `supabase/seed/seed.sql` requires a signed-up user to already exist. Run it
  manually after the first sign-up if you want synthetic data:
  `sudo -E docker exec -i supabase_db_workspace psql -U postgres -d postgres < supabase/seed/seed.sql`.

### Non-obvious gotchas

- `auto_expose_new_tables = true` is set in `supabase/config.toml`. The
  migrations enable RLS + policies but do **not** issue explicit table GRANTs to
  the API roles, so they rely on Supabase's legacy auto-expose behaviour.
  Without this flag, authenticated queries fail with
  `permission denied for table ...` and every post-login page silently redirects
  back to `/sign-in`. This grant happens at table-creation time, so after
  changing the flag you must `supabase db reset` (a plain restart won't
  retroactively grant existing tables).
- Local Supabase disables email confirmation (`auth.enable_confirmations =
  false`), so sign-up immediately returns a session — no inbox step needed.

### Lint / test / build

- Standard commands are in `package.json`: `npm run lint`, `npm run typecheck`,
  `npm test` (Vitest), `npm run build`.
- Public-route Playwright a11y suite (no DB needed, mirrors CI): build, serve,
  then `npx playwright test public-routes`. Playwright uses the browser from
  `npx playwright install` unless `QA_CHROME_PATH` is set (Cursor Cloud
  sandbox only). GitHub Actions CI does **not** set `QA_CHROME_PATH`.
- Database/RLS tests: `npm run test:db` against local Supabase
  (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`). Requires
  `supabase start` and the QA fixture users from `docs/runbooks/qa.md`.
- The authenticated `qa-matrix` Playwright suite needs seeded QA users and is
  not part of routine setup — see `docs/runbooks/qa.md`.
