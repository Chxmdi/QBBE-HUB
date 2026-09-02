# QBBE Hub

QBBE Hub is the **Quebec Board of Black Educators' internal operating and
communication system**: work management, Slack-style communication,
announcements with acknowledgment, meetings and agendas, events, calendar and
master schedule, unified inbox, relationship CRM, reporting, people and
access administration — one product, one data model, one permission system.

Built as a feature-first modular monolith against the **QBBE Hub Master
Product, UI/UX & Development Specification v1.0**, which is held outside this
repository. What is versioned here is the build brief derived from it —
[`docs/master-spec.md`](docs/master-spec.md) — so the spec identifiers quoted
in the runbooks cannot be resolved from the repository alone. That file's
header explains the consequence for anyone auditing coverage.

## Stack

| Layer | Choice |
|---|---|
| Web app | Next.js (App Router) · React · strict TypeScript |
| Styling | Tailwind CSS v4 with QBBE design tokens (`src/design-system`) |
| Backend | Supabase — Postgres, Auth, Row Level Security, Realtime |
| Authorization | Postgres RLS is the final boundary on every table; UI gates are UX only |
| Validation | Zod schemas at every server-action trust boundary |
| Testing | Vitest (unit) · Playwright (e2e scaffold) |
| Hosting | Vercel (app) + Supabase (data), QBBE-owned accounts |

**Runtime:** Node.js 20.9 or newer is required. The production build uses
Next.js 16's supported Webpack opt-out (`next build --webpack`) while the
development server retains Turbopack by default.

## Getting started

1. **Create a Supabase project** (QBBE-owned org). In the SQL editor or via
   the CLI, apply the migrations in order:

   ```bash
   supabase link --project-ref <ref>
   supabase db push          # applies supabase/migrations/*.sql
   ```

2. **Configure environment** — copy `.env.example` to `.env.local` and fill:

   ```
   NEXT_PUBLIC_SUPABASE_URL=…
   NEXT_PUBLIC_SUPABASE_ANON_KEY=…
   ```

3. **Run**:

   ```bash
   npm install
   npm run dev
   ```

4. **First sign-up bootstraps the workspace**: the first account becomes
   Primary Owner and the mandatory `#announcements` + `#general` channels are
   provisioned automatically. Later sign-ups join as Staff — or with the role
   from a pending Admin invitation.

5. **Optional dev seed** — after the first sign-up, run
   `supabase/seed/seed.sql` against your *development* database to populate
   realistic synthetic programs, projects, tasks, channels, and CRM records.
   Never run seeds against production (§6.2 of the spec).

> **Production note:** disable open self-serve signup in Supabase Auth
> settings and rely on Admin invitations, or restrict signup to the QBBE
> email domain. See `docs/runbooks/deployment.md`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local development server |
| `npm run build` | Production build (must pass before merge) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Strict TypeScript check |
| `npm test` | Vitest unit tests |
| `npm run test:db` | Local Supabase RLS allow/deny (`supabase start` required) |
| `npm run test:a11y` | Playwright public-route a11y (CI) |
| `npm run test:qa` | Authenticated 18-screen matrix (seeded QA DB) |
| `npm run db:types` | Regenerate DB types from a linked Supabase project |

## Repository map

```
src/app/              routes — thin composition over features (REP-002)
src/features/<name>/  feature-owned components, services (commands/queries)
src/components/ui/    accessible visual primitives
src/components/layout/ shell: sidebar, topbar, command palette
src/design-system/    tokens + global styles (single source of brand)
src/lib/              supabase clients, auth helpers, utils
supabase/migrations/  schema, RLS policies, triggers, search (append-only)
supabase/seed/        development/test fixtures only
docs/adr/             architecture decision records
docs/runbooks/        deployment, integrations, backup, privacy, launch-gate
```

## Security model (summary)

- Every user-facing table has **RLS enabled, deny-by-default**; helper
  predicates live in the `app` schema (`app.is_member`, `app.is_admin`,
  `app.is_channel_member`, …).
- Private channels and DMs are invisible to non-members through every path —
  queries, realtime, and the `global_search` RPC (SECURITY INVOKER, so RLS
  filters results).
- The mandatory announcements channel enforces restricted posting and
  non-leavable membership at the database layer.
- Audit events record access changes, channel and announcement actions,
  report generation/approval/export, and destructive actions.
- The browser only ever holds the publishable/anon key. Server-only
  integration workers use the service role for narrowly scoped token and sync
  operations; it is never exposed to a client.

## Feature status vs. the master specification

**Screens (Part II §10)** — all 18 implemented: Home/Operations Dashboard,
My Work, Board, Programs & Projects directory, Project command centre
(tabbed), Channels, Announcements, Unified Inbox, Calendar (week + month +
mobile agenda), Master Schedule, Meetings & Agendas, People, CRM, Reports,
Documents & Resources, Notifications/Search/Command surfaces, Admin &
Settings, Authentication & Onboarding.

**Component system (Part II §9)** — button, input/textarea/select, avatar,
badge, tabs, drawer (mobile sheet), modal, dropdown menu, toast, data table
(sticky header, selection, sorting), empty state, skeleton, message item,
announcement, task row/card.

**P0 product requirements** — see `docs/spec-coverage.md` for the unit-by-unit
matrix (implemented / gated / tests). Highlights that are live: auth and
invitations with honest “email not sent” when no provider is configured;
programs and projects (including milestone create/complete); canonical task
statuses on board and list; private channel membership; DMs in nav with
message permalinks; teams; volunteer-simplified Home; snapshot reports with
CSV **and** PDF export; RLS allow+deny harness.

External integrations require QBBE-owned credentials before they can be
validated in a real environment: Gmail OAuth/sync/watch, Google Calendar
overlay and linked-meeting lifecycle, Google Drive metadata sync, Volunteer
Management System sync, and production transactional email. Until configured,
the UI stays **Not connected** and never substitutes fake operational data.
ADR-003 (plain-text messages) remains.

Deliberately out of first release (P2): native mobile apps, collaborative
docs, built-in video, autonomous AI, presence, opportunity forecasting, Slack
bridge, service-user/case records.

## License

Internal QBBE product. All rights reserved.
