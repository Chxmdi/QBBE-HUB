# QBBE Hub

QBBE Hub is the **Quebec Board of Black Educators' internal operating and
communication system**: work management, Slack-style communication,
announcements with acknowledgment, meetings and agendas, events, calendar and
master schedule, unified inbox, relationship CRM, reporting, people and
access administration — one product, one data model, one permission system.

Built from the **QBBE Hub Master Product, UI/UX & Development Specification
v1.0** as a feature-first modular monolith.

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
docs/runbooks/        deployment, integrations, backup & recovery
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
- No service-role key is used in request handling; the browser only ever
  holds the anon key.

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

**P0 product requirements** — auth, invitations with role pre-assignment,
role administration; programs; projects (lifecycle, health discipline,
structured status updates, milestones, activity, closure surfacing
unresolved work); tasks (board/list parity, My Work with URL-shareable
filters, task drawer with deep links, bulk actions, blocked-reason rule,
comments); channels (public/private, directory, join policies, restricted
posting, archive/restore, pinned resources); messages (threads, reactions,
server-parsed mentions, edit, delete with audit marker, permalinks, unread
cursors, realtime with reconnect state); mandatory announcements with
acknowledgment tracking and admin progress; DMs/group DMs; message →
task / agenda item / decision conversion; meetings (agenda builder,
decision log, actions → tasks, channel summary handoff); events with
per-area role assignments; unified calendar; master schedule; notification
centre grouped actionable vs informational with dedupe keys; people
directory with workload; CRM with duplicate detection and follow-up queue;
versioned report snapshots with approval + CSV export; documents with
private storage and signed URLs; admin (users, invitations, integrations,
audit viewer); permission-safe global search + ⌘K palette + dedicated
results view; light/dark themes; mobile bottom navigation; display density.

Deliberately staged (per roadmap Phases 4–6), shown honestly as
not-connected in the UI: Gmail/Google Calendar OAuth sync, volunteer-system
integration, email delivery/digests, workflow automation rules, scheduled
announcements, opportunity pipeline forecasting.

## License

Internal QBBE product. All rights reserved.
