# Epic 03 — Meetings, Events, Comments & Documents: plan to completion

Written 2026-09-21 against `main` at `f60b27a`. Covers issue #13 and its four
children: #32 events, #33 meetings and agendas, #34 comments, #35 documents.

## The situation this plan starts from

Epic 03 is not a greenfield epic. Three of its four surfaces already have
`components`, `services` and `tests` directories under `src/features`, and the
database carries migrations written specifically for them —
`20260914154109_atomic_meeting_completion.sql` and
`20260914154027_secure_document_scanning.sql` among others.

What is missing is not mostly code. It is evidence, and reachability.

- **All 18 PRD rows in this epic read `awaiting verification`** in
  `docs/acceptance-matrix.md` (EVT-01/02, MTG-01..04, AGD-01..06, COM-01..05,
  FIL-01/02). Not one has an acceptance artifact.
- **There is no end-to-end spec for any of it.** `tests/e2e/` contains fourteen
  files and none of them exercises a meeting, an event, a comment or a
  document.
- **`src/features/events` has `services` and nothing else** — no `components`
  directory. An event record that no page renders is what #33's definition of
  done calls a dead schema-only path.

So the shape of the work is: finish the reachable surface where it is missing,
then prove the rest works. That ordering matters, because writing acceptance
evidence for a feature nobody can reach produces a document rather than a
product.

## Sequence

The children are ordered by what the others depend on, not by issue number.

### 1. #35 Documents — first, because two other issues depend on it

P0-FIL-01 external links, P1-FIL-02 uploads.

#34 comments may carry attachments (P0-COM-05) and #32 events store files, so
both inherit whatever file behaviour this issue settles. Doing it last would
mean building those two against a contract that had not been decided.

- Reconcile Storage RLS, `document` rows, the scanner worker and the cleanup
  path against what the migrations already declare.
- Prove the fail-closed states in a browser: pending, clean, rejected, error.
- Test the six named cases — clean file, EICAR, encrypted/unscannable,
  oversized, forbidden type, scanner outage, unauthorized download.

**P1-FIL-02 cannot be closed on this machine.** Its definition of done requires
live QBBE-hosted ClamAV acceptance, and that hosting does not exist yet. The
plan is to implement and test against a local scanner, then leave the row at
`implementing` with the blocker named — not to mark it passed on local evidence.

### 2. #32 Events — smallest, and #33 links to it

P0-EVT-01 record, P0-EVT-02 accountable assignments.

- Build the missing UI. This is the one place in the epic where the gap is
  genuinely a missing surface rather than missing proof.
- Verify every field persists across a reload: program, optional project,
  owner, type, date and time, location or link, status, description,
  preparation checklist, files.
- Verify the seven assignment roles (logistics, communications, volunteers,
  venue, content, registration, follow-up) persist and are scoped.
- Deny cross-scope assignment and invalid references at the database, not only
  in the form.

### 3. #33 Meetings and agendas — the largest, ten PRD rows

P0-MTG-01..03, P1-MTG-04, P0-AGD-01..04, P1-AGD-05..06.

Sub-ordered so the risky parts land early:

1. **Atomic action conversion (P0-MTG-02).** A migration for this already
   exists; the work is proving it holds under a failed or retried completion,
   and that a retry cannot produce a duplicated summary or a duplicated action.
2. **Agenda builder and submissions (AGD-01..03).** Ordering, time-boxing,
   purpose classification, and the organizer's accept/combine/defer/reorder/
   decline path.
3. **Context links (AGD-04)** to project, task, milestone, RAID, event and CRM
   records.
4. **Summary (P0-MTG-03)** and **carry-forward (P1-AGD-06)**.
5. **Templates (P1-AGD-05)** and **recurrence (P1-MTG-04)**.

**Recurrence here should reuse #31's `task_series`, not copy it.** #31
introduces a series entity with an owner, a `stopped_at` and a
`series_edited_at` marker for safely edited occurrences, plus a unique index
that makes a duplicate occurrence unrecordable. P1-MTG-04 asks for the same
guarantees in the same words. Building a second, parallel mechanism for
meetings would give the product two recurrence models that drift apart. This is
the single largest design decision in the epic and it should be settled before
step 5 is started.

### 4. #34 Comments — last, because it attaches to everything above

P0-COM-01..05.

Comments are polymorphic across projects, tasks, milestones, events, meetings,
agenda items, RAID entries, updates, organizations, contacts and opportunities.
Several of those records only reach their final shape in steps 1–3, so building
the comment surface first would mean revisiting it.

The invariant to prove, from #34's definition of done: **comment visibility can
never exceed parent visibility, and deleting a comment never silently destroys
history.** Both belong in database allow/deny tests, not only in browser tests —
a comment on an inaccessible parent has to be unreadable to a direct API call,
not merely absent from a page.

## What each issue needs before it can close

Unchanged from the standing rule in this repository, restated so the plan is
checkable:

- Implementation reachable in the product — no schema-only paths.
- Database allow **and** deny tests, registered by hand in
  `scripts/test-db.mjs` (there is no glob, on purpose).
- An authenticated browser spec, registered in `.github/workflows/ci.yml`.
- Rows in `docs/acceptance-matrix.md` moved off `awaiting verification` with
  the evidence recorded against an exact commit.
- Entries in `docs/execution-journal.md` and `docs/readiness-report.md`.

## Two risks worth naming now

**The browser suite is the instrument this epic is measured with, and it is
not yet trustworthy.** #79 and #80 are open against exactly that. Roughly
eighteen new end-to-end tests are added by this plan, onto a suite whose
reliability is still being established. #79 should land before #33's browser
work begins, or the new tests will be impossible to distinguish from the
existing instability.

**`src/lib/auth.ts` reports a failed membership read as a deactivated
account.** `getSessionContext` discards the query error and returns `null`, and
`requireSession` turns that `null` into a redirect to `/account-inactive`. A
transient database error therefore tells an active user their account was
deactivated by an administrator. This was observed once during #79 verification
against a user whose membership was `active` in the database at the time. Every
surface in this epic calls `requireSession`, so this affects all of it. It
should be filed and fixed before the epic's browser evidence is collected,
otherwise any spurious occurrence will be recorded as a feature failure.
