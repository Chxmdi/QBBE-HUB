# QA runbook

Two suites, split by what they need.

## 1. Public-route QA — runs anywhere, runs in CI

Covers the routes that render without a database round-trip, across the full
§16.1 matrix: six widths (1440/1280/1024/768/390/320), both themes,
horizontal-overflow detection, axe (WCAG 2.2 A + AA — the tag set is `wcag2a/2aa`, `wcag21a/21aa`, `wcag22a/22aa`, which catches the 2.2 criteria axe can decide automatically (target size, focus appearance); the rest of 2.2 AA, such as accessible authentication and consistent help, still needs a human pass), keyboard traversal,
focus visibility, reduced motion, unauthenticated redirects, and the
`/api/jobs/*` secret guard.

```bash
npm run build
npx next start -p 3000 -H 127.0.0.1 &
npm run test:a11y
```

This runs on every pull request via `.github/workflows/ci.yml`.

## 2. Authenticated QA matrix — needs a seeded database, run by hand

`tests/e2e/qa-matrix.spec.ts` covers all 18 authenticated routes at every
width in both themes, axe on each, 200% zoom, the command palette, the task
drawer and its deep links, URL-shareable filters, empty/permission states,
and volunteer-vs-staff authorization boundaries.

It needs a database with QA users and workspace content in it, which a plain
`supabase db reset` does not produce. The seed is deliberately not run by the
reset: `supabase/seed/seed.sql` fills a workspace that must already exist, and
only the bootstrap trigger creates one — when the first user signs up. So
`[db.seed]` stays `enabled = false` in `supabase/config.toml`, and the sign-up
step happens first.

`npm run db:seed` does both halves in the right order: it inserts the five QA
fixture users (the first of which bootstraps the organization), then loads the
workspace seed. It is safe to run repeatedly — it stops early if the workspace
already holds the seed data rather than doubling every record.

To run the matrix against the local stack:

```bash
npx supabase start            # or `npx supabase db reset --local` for a clean one
npm run db:seed               # QA users, then workspace content
cp .env.example .env.local    # local Supabase URL and anon key
npm run build
npx next start -p 3000 -H 127.0.0.1 &
npm run test:qa
```

The matrix is not wired into CI. The authenticated CI job runs `hello-hub`,
`access-impact` and `my-work`, which cover the task surfaces behaviourally;
the matrix covers presentation — every route at six widths in both themes,
with axe on each — which is slower and changes for reasons unrelated to the
code under review. Run it by hand before a release, and after any change to
layout, theme tokens or a shared navigation surface.

### Reruns and the invitation rate limit

`identity-lifecycle.spec.ts` creates a real invitation per scenario, and the
Hub allows 30 an hour per person. Run the suite a few times inside one hour and
the owner meets "You're doing that too quickly. Try again in about 13 minutes"
where an invitation should be, and every test that opens with an invitation
fails together — the limiter working, looking exactly like a broken test.

The spec clears its own bucket in `beforeAll` through `tests/e2e/db.ts`, so it
gives the same answer on the fourth run of the hour as on the first. If you add
a suite that creates invitations, do the same rather than waiting the window
out. The limiter's own behaviour is covered by `tests/unit/rate-limit.test.ts`;
here it is a fixture, not the thing under test.

To run it against a hosted non-production project instead, point `.env.local`
at that project, apply migrations with `supabase link --project-ref <ref> &&
supabase db push`, and load the same two SQL files through its SQL editor.
Never against production: the first sign-up there becomes Primary Owner.

### QA test users

One account per organization role, all with password `QaTest!2026`. Every role
is represented because a permission matrix missing a role is a statement about
the roles it has, not the ones it claims:

| Email | Role | Purpose |
|---|---|---|
| `qa-owner@example.com` | owner | Full-access surfaces |
| `qa-admin@example.com` | admin | Administration without ownership |
| `qa-staff@example.com` | staff | Staff-scoped surfaces |
| `qa-volunteer@example.com` | volunteer | Negative authorization cases |
| `qa-guest@example.com` | guest | The most restricted role |

Because Supabase confirms email by default, insert them directly into
`auth.users` with `email_confirmed_at` set (the bootstrap trigger then
provisions profiles, membership, and mandatory channels). Never create these
in the production project — the first sign-up there becomes Primary Owner.

## 3. Permission matrix — runs in CI against a local database

`supabase/tests/rls.sql` is the allow/deny matrix, run by the
**Database security** CI job against a freshly migrated local Supabase
(`npm run test:db`). It covers all five roles and, for each new table, the
recipe is one allow case and one deny case in the same pull request as the
policy.

```bash
supabase start        # migrations applied to a fresh local database
npm run test:db       # qa-users.sql + rls.sql through psql
```

The administrative assertions seed a row first, so "an admin can read this"
means they saw something rather than counting zero — and that block
deliberately has no exception handler, because an admin denied their own
administration surface is a failure, not a differently-worded pass.

Two rules the matrix now pins that are easy to lose in a refactor: only the
person named on an `approval_request` can answer it, and a volunteer cannot
file a `project_request` in somebody else's name.

**Recipe when you add a table:** ship indexes and RLS in the same migration as
the table, then add one allow and one deny assertion here in the same pull
request. Coverage status lives in `docs/spec-coverage.md`.

## 4. Contrast regression guard — always on

`tests/unit/contrast.test.ts` computes WCAG contrast for every colored-text
token against surface, canvas, and soft-surface in **both** themes, plus
white-on-fill for buttons. It runs with `npm test`, so a token edit that
would fail the browser accessibility matrix fails in CI first.

If it fails, adjust the `--color-*-fg` tokens in
`src/design-system/styles/globals.css`. Fill tokens (`--color-brand`,
`--color-danger`, …) keep the exact Part II §2.2 brand values; only the
`-fg` text variants are tuned for contrast, as Appendix A permits.

## 5. Background jobs and email — always on

`tests/unit/drain-notifications.test.ts` and `tests/unit/job-handlers.test.ts`
run the real job handlers against an in-memory Supabase double
(`tests/support/fake-supabase.ts`) that reproduces unique-index violations,
queue visibility timeouts, and archiving. They cover crash recovery,
exactly-once delivery, dead-lettering after the attempt limit, quiet-hours
deferral, the mandatory-delivery carve-out, and digest assembly.

The database side of those same guarantees — the enqueue trigger, the dedupe
index, pgmq's redelivery and archive behaviour — is verified directly against
Postgres. See the verification table in `jobs.md`.

## 6. Still manual before launch

- Screen-reader smoke test (VoiceOver / NVDA) of: post a message, move a
  task, acknowledge an announcement, complete a meeting.
- Real-device touch check on iOS Safari and Android Chrome.
- Load/performance measurement with representative data volume (§20.5).
- Backup restore rehearsal (see `backup-recovery.md`).
- Privacy / retention review (`privacy.md`).
- Launch-gate ticks (`launch-gate.md`).

## 7. Certify a release candidate — one run, every gate, evidence written

The release-candidate workflow (#116) runs every automated gate at one commit
and writes down what passed. Use it before any release, and for staging
certification once #55 exists.

1. Pick the commit to certify and give it a tag, so the evidence names
   something stable: `git tag rc-2026-10-01 <sha> && git push origin rc-2026-10-01`.
   You should see the tag under **Code → Tags** on GitHub.
2. On GitHub, open **Actions → Release candidate → Run workflow**, choose the
   tag in **Use workflow from**, and click **Run workflow**.
   A run appears with four jobs: **CI (all browsers)**, **Security**,
   **Performance** and **Evidence**. It takes about 45 minutes.
3. When it finishes, open the run. The summary page shows a table headed
   **QA evidence for <sha>** with one row per gate and its result. The same
   file is attached to the run as `qa-evidence-<sha>`.
4. If every row says **pass**, copy the table into the `QA-FINAL` row of
   `docs/acceptance-matrix.md` with the run link.
   If any row shows a failure, the **Evidence** job is red. Open the failed job,
   fix the cause in a pull request, and certify the new commit from step 1.
   Never re-run the same candidate hoping for green: a gate that fails once
   is a finding.

What the run does not cover, and is still owed by a person: the screen-reader
pass, real iPhone and Android handsets (OPS-SIGNOFF), and anything that needs
staging (#55).

