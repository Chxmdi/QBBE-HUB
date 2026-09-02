# Requirement coverage audit — shared briefing

Read this first. It is the same for every auditor.

## What you are doing

QBBE Hub is a Next.js 16 + Supabase management app for the Quebec Board of
Black Educators, at `/home/user/QBBE-HUB`. It has been built over several
weeks against a **build brief** (`docs/master-spec.md`), not against the
governing specification the brief refers to.

That specification has now been recovered. It defines **308 requirement IDs**.
Only 58 have ever been cited anywhere in the repository, and 254 have never
been assessed either way — they are not known-missing, they are unexamined.

Your job is to classify your assigned requirements against the actual code.

## The specification

`docs/audit/.spec-source.md` (3,553 lines). It is staged locally and
deliberately **not committed** — this repository is public and the spec is an
internal document. Do not copy long passages of it into your report, do not
commit it, and do not move it.

Find your requirements by grepping for their IDs, e.g.
`grep -n "AUTH-006" docs/audit/.spec-source.md`, then read the surrounding
section for the full requirement text.

## How to classify

For each requirement, decide:

- **Complete** — implemented, and you can point at the code that does it.
- **Partial** — some of it exists; say precisely which part is missing.
- **Missing** — nothing implements it.
- **Not applicable** — the requirement is about process, an external account,
  or something outside the codebase. Say why.
- **Unverifiable here** — needs a live account, a browser, or an environment
  this container cannot reach. Say what would settle it.

**Evidence is mandatory for Complete.** Cite `file:line`. A claim with no
citation is a Partial at best. Do not infer from a filename that a feature
works — open the file. This project has repeatedly been bitten by claims that
were never checked: an RLS suite recorded as "passes" that had never once run,
a cron config that could never fire, a required CI check whose name did not
exist. Assume nothing is true until you have seen it.

Be sceptical in both directions. If something is better than the docs claim,
say so — one earlier audit finding was a false *negative*.

## Where the code lives

- `src/app/` — routes (Next.js App Router; `(workspace)` is the signed-in area)
- `src/features/<domain>/` — components, services (`*.queries.ts`,
  `*.commands.ts`), schemas
- `src/components/ui/` — design-system primitives
- `src/lib/` — env, supabase clients, observability
- `supabase/migrations/*.sql` — schema and RLS policies (57 files, append-only)
- `supabase/tests/rls.sql` — 172 allow/deny assertions, runs in CI
- `tests/unit/`, `src/**/tests/` — vitest (322 tests)
- `tests/e2e/` — Playwright; `public-routes` runs in CI, `qa-matrix` does not

Useful existing context, but **treat both as claims to check, not as truth**:
`docs/spec-coverage.md` and `docs/production-readiness-audit.md`.

## Constraints

- **Read-only on the codebase.** Do not edit, create or delete any file except
  your own report. Do not run `git` at all — no commits, no branches, no stash.
- Do **not** run `npm run test:db` (needs a Docker daemon; unavailable).
- Do **not** try to reach `*.supabase.co` or Google/Resend APIs — egress policy
  blocks them. `npm test`, `npm run lint`, `npm run typecheck` all work.
- Do not put any AI or model name in your report.

## Output — write incrementally, this matters

Append to your report file **as you finish each requirement**. Do not buffer
results and write at the end. Auditors in this project have been killed
mid-run by rate limits before, and anything held in memory was lost. If you
die after 30 of 40 requirements, those 30 must already be on disk.

Your file starts with a heading and this line, which you update as you go:

    <!-- progress: N of M assessed -->

Then one section per requirement:

    ### <ID> — <short requirement title>
    **Verdict:** Complete | Partial | Missing | Not applicable | Unverifiable
    **Requirement:** one or two sentences, in your own words.
    **Evidence:** `path/to/file.ts:123` — what is actually there.
    **Gap:** what is missing, or omit this line if nothing is.

Keep each entry tight — a few lines. The value is in the verdict and the
citation, not in prose.

Finish with a short summary block: counts per verdict, and the three findings
you would most want a maintainer to see first.
