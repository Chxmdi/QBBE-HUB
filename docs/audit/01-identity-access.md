# Audit 01 — Identity, access control, administration, governance, people, volunteers

<!-- progress: 10 of 40 assessed -->

Families in scope: `AUTH-001..009` (9), `SEC-001..010` (10), `P0-ADM-01..05` +
`P1-ADM-06..08` (8), `P0-GOV-01..05` + `P1-GOV-06` (6), `P0-PPL-01..03` +
`P1-PPL-04` (4), `P0-VOL-01/02` + `P1-VOL-03` (3) — **40 requirement IDs**,
enumerated by grepping the specification for each prefix.

All paths are relative to `/home/user/QBBE-HUB`.

---

## AUTH — identity and authorization

### AUTH-001 — Supabase Auth is the identity provider
**Verdict:** Complete
**Requirement:** Supabase Auth is the primary identity provider unless a later org-wide SSO decision supersedes it.
**Evidence:** All three clients are `@supabase/ssr`/`supabase-js` auth clients — `src/lib/supabase/server.ts:14`, `src/lib/supabase/client.ts:6`, `src/lib/supabase/middleware.ts:21`. Sign-in is `supabase.auth.signInWithPassword` (`src/app/(auth)/sign-in/sign-in-form.tsx:23`), sign-up is `supabase.auth.signUp` (`src/app/(auth)/sign-up/sign-up-form.tsx:38`), sign-out is a route handler at `src/app/auth/sign-out/route.ts`. Session refresh runs on every non-static request through the Next 16 proxy (`proxy.ts:4`, matcher at `:8-14`) calling `updateSession` (`src/lib/supabase/middleware.ts:13`). No competing identity provider exists: `grep` for `signInWithOAuth|signInWithOtp|sso` across `src/` returns nothing.

### AUTH-002 — Authorization modelled as membership, roles, scoped memberships, permissions
**Verdict:** Complete
**Requirement:** Authorization comes from organization membership, role assignments, scoped memberships and explicit permissions — not from email domain.
**Evidence:** `supabase/migrations/0001_core.sql:48-60` `organization_membership(organization_id, user_id, role org_role, status)`; `org_role` is a five-value enum at `:11`; `membership_status` at `:12`. Scoped memberships exist at every level: `team_member` (`:85`), `program_membership` (`:110`), `project_membership` (`:143`), `channel_member` (`supabase/migrations/0002_communication.sql`, with `role`/`is_mandatory`), `meeting_attendee`. Explicit per-channel permissions are columns on `channel` (`posting_policy`, `reply_policy`, `privacy`) consumed by `app.can_post_in_channel` (`supabase/migrations/20260902002201_scope_membership_join_policies.sql:51-69`). The application layer reads role from membership only (`src/lib/auth.ts:31-46`).
**Note:** No email-domain shortcut exists anywhere — `signup_allowed` (`supabase/migrations/0009_production_hardening.sql:3`) gates on an outstanding `invitation` row, not a domain.

### AUTH-003 — Object-level authorization on every query
**Verdict:** Complete
**Requirement:** Every request/query is authorized at object level; knowing a record ID must not grant access.
**Evidence:** The boundary is RLS, not the route. Request-path clients use the anon key only (`src/lib/supabase/server.ts:14-16`, `src/lib/supabase/client.ts:8-10`), so a `select ... eq('id', x)` is still filtered by policy. Deny-by-default is the stated convention (`supabase/migrations/0001_core.sql:3`) and every user-facing table carries `enable row level security`. Route guards (`requireStaff`, `requireAdmin` — `src/lib/auth.ts:66,73`) are explicitly documented as convenience gates on top of RLS, not the boundary. `supabase/tests/rls.sql` asserts the deny direction by ID for cross-organization rows (e.g. `:1288` "guest cannot read another organization task"), and runs in CI as the required `Database security` job (`.github/workflows/ci.yml:60,80`).

### AUTH-004 — Explicit policies on sensitive records
**Verdict:** Complete
**Requirement:** Private channels, leadership records, audit data and integration tokens each need explicit authorization policies.
**Evidence:** Private channels: `channel_read` admits a non-member only for `privacy = 'public'` within the same organization (`supabase/migrations/20260902002148_scope_remaining_policies_to_organization.sql:52-58`), and `message_read` delegates to `app.can_read_channel`, whose definer body carries the same test (`20260902002201:34-49`). Audit data: `audit_event` is admin-read, scoped to the row's organization (`supabase/migrations/20260818081240_scope_task_and_activity_policies_to_organization.sql:50-51`). Integration tokens: `integration_connection` is admin-only, organization-scoped (`supabase/migrations/20260818081500_scope_crm_reporting_integration_policies_to_organization.sql:32`), plus an owner-of-the-connection policy (`0008_spec_delivery.sql:82`); and the email ledger — recipient plus subject — is admin-only and organization-scoped (`20260902002148:104-107`). `supabase/tests/rls.sql` asserts the guest-denied direction on `email_delivery` (`:1268`), `workflow_execution` (`:1256`), `rate_limit_counter` (`:1279`) and the job queue (`:1302-1310`).
**Note:** HR/finance modules are named in the requirement as *future*; none exists, so there is nothing to police there yet.

### AUTH-005 — Service-role credentials are server-only
**Verdict:** Complete
**Requirement:** The service-role key is never exposed to the browser.
**Evidence:** `src/lib/supabase/service.ts:20` reads the key through `serviceRoleKey()` (`src/lib/env.ts:33`), an un-prefixed variable, so Next.js inlines it as `undefined` rather than leaking it if a client bundle ever imported it — the file says so at `env.ts:6-9`. Only `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are public (`.env.example:8-15`). Every one of the ten `createSupabaseServiceClient` call sites is a route handler or a server service module; none is a `"use client"` file. `x-qbbe-actor: job-runner` is attached to its traffic (`service.ts:27`).
**Note:** The module's own contract comment (`service.ts:14-19`) says "only from `/api/jobs/*` handlers and the services they call" — and that is no longer true. It is also used by `src/app/api/exports/[id]/download/route.ts:70`, `src/features/admin/services/admin.commands.ts:143`, `src/features/inbox/services/gmail.commands.ts:34,93` and `src/features/calendar/services/google-calendar-write.ts:85,132,173`, all reachable from user-controlled requests. The requirement as written (never in the browser) is still met; the comment is stale and understates how widely the RLS bypass is reachable. The export route is the model to copy — it authorizes with the *user's* client first and uses the service role only to mint the signed URL (`download/route.ts:41-46,70`).

### AUTH-006 — MFA for admin/owner; documented account recovery
**Verdict:** Partial
**Requirement:** Owner/admin accounts use MFA before production rollout, and account recovery is documented and controlled by QBBE.
**Evidence:** MFA is carried as an explicit operator step — `docs/runbooks/deployment.md:35-36` ("Turn on MFA for the Primary Owner and Workspace Admin accounts (AUTH-006)"), tracked on the launch gate (`docs/runbooks/launch-gate.md:14`) and re-checked in the privacy review (`docs/runbooks/privacy.md:33`). It is a Supabase project setting, so there is nothing in this repository to enforce it; `docs/runbooks/launch-gate.md:31` honestly records the production project as **Not verified**.
**Gap:** **Account recovery is not documented at all.** `grep -rni "recover" docs/` returns only *data* recovery (`backup-recovery.md`) and the reactivate-a-deactivated-member path (`privacy.md:10`). There is no written procedure for a locked-out owner, a lost MFA factor, or transferring control of the Supabase account itself. The application also has no self-service password reset: `grep -rn "resetPassword|forgot" src/` returns nothing, so the only path is a Supabase dashboard action by whoever holds the project. **What would settle it:** a recovery section in `deployment.md` naming who at QBBE holds the break-glass credential and the lost-factor procedure, plus dashboard confirmation that MFA is enforced.

### AUTH-007 — Invitation record shape and audit evidence
**Verdict:** Partial
**Requirement:** An invitation carries expiration, inviter, target email, intended role/team, `accepted_at`, `revoked_at`, and audit evidence.
**Evidence:** `supabase/migrations/0001_core.sql:62-74` — `invitation(organization_id, email, intended_role, invited_by, token, expires_at default now() + 14 days, accepted_at, revoked_at, created_at)`. Creation is admin-gated and rate-limited (`src/features/admin/services/admin.commands.ts:26-28`) and writes an `audit_event` with `action: "user_invited"` and the email + intended role in metadata (`:48-57`). Revoke sets `revoked_at` and refuses an already-accepted invitation via `.is("accepted_at", null)` (`:161-168`). Acceptance is closed by the signup trigger, which honours only a non-accepted, non-revoked, unexpired invitation (`supabase/migrations/0003_operations.sql:376-385`) and gates open signup through `signup_allowed` (`0009_production_hardening.sql:3-21`). The table is admin-only and organization-scoped (`20260818080439:114`).
**Gap:** Two things. (1) **Intended team is absent** — the table has `intended_role` but no team column, and `inviteSchema` (`admin.commands.ts:10-13`) accepts only email and role, so an invitee cannot be pre-placed on a team. (2) **Revocation is not audited.** `revokeInvitation` (`:161-172`) writes no `audit_event`, unlike invite, role change, deactivate and ownership transfer around it — so "who cancelled that invitation" is unanswerable. Note also `inviteUser` always returns `emailSent: false` (`:61`): the invitation is a database row, and nothing emails the invitee.

### AUTH-008 — Impersonation (only if operationally necessary)
**Verdict:** Not applicable
**Requirement:** Provide impersonation only if operationally necessary; if implemented, restrict it to designated admins, show a persistent banner and audit every session.
**Evidence:** Not implemented, and the requirement is conditional on choosing to implement it. `grep -rni "impersonat"` across `src/`, `supabase/` and `docs/` returns two unrelated hits — a fixture string in `supabase/tests/rls.sql:799` and a coverage-ledger line about acting-as-another-user *denial* in the intake queue. No admin surface offers a "view as" control: `src/app/(workspace)/admin/page.tsx` (600 lines) has Members, Background jobs, Invitations, Integrations, Teams, Workflow rules and Audit history sections and nothing else.
**Note:** Declining to build it is the conservative reading and leaves no banner/audit obligation open. It is worth recording as a deliberate choice rather than an omission, since nothing in the repository states it.

### AUTH-009 — Centralized permission predicates, mirrored by typed UI helpers
**Verdict:** Complete
**Requirement:** Permission checks are centralized into reusable server/database predicates and mirrored by typed UI capability helpers, rather than scattered role-name conditionals.
**Evidence:** Database side: a dedicated `app` schema of `SECURITY DEFINER` predicates, introduced under this requirement by name (`supabase/migrations/0001_core.sql:317-320`) and now numbering ~20 — `is_org_member`, `is_org_admin`, `is_org_staff`, `can_read_team`, `can_manage_team`, `can_read_profile`, `can_read_program`, `can_manage_program`, `can_read_project`, `can_manage_project`, `can_read_meeting`, `can_manage_meeting`, `can_read_event`, `can_manage_event`, `can_read_channel`, `can_post_in_channel`, `can_reply_in_channel`, `is_channel_member`, `is_conversation_member`. Policies call them rather than restating the join. Application side: `SessionContext` exposes typed `isAdmin`/`isStaff` booleans derived once (`src/lib/auth.ts:44-45`) plus three route gates (`:53,66,73`); those two names carry **149** of the checks in `src/`. Navigation is data-driven with a typed `access: "member" | "staff" | "admin"` field per item, filtered in one place (`src/config/navigation.ts:25-31,94-96`).
**Note:** Raw role-string comparisons number **12** across the whole of `src/`, and every one is a genuine special case the coarse helpers cannot express — the `owner` exceptions in `admin.commands.ts:85,124,180`, the nav tier comparison, and `channel.posting_policy`/`document.visibility` value tests that are not role checks at all. This is better than `docs/production-readiness-audit.md` implies by omission: the mirroring the requirement asks for is genuinely in place.

---

## SEC — security baseline

### SEC-001 — OWASP ASVS-style verification baseline
**Verdict:** Missing
**Requirement:** Adopt an ASVS-style verification baseline covering authentication, authorization, input handling, session behaviour, file uploads, secrets, logging and data protection.
**Evidence:** `grep -rni "asvs|owasp"` across `docs/`, `src/` and `.github/` returns **zero** hits. There is no verification checklist keyed to those eight areas, no ASVS level chosen, and no per-release security sign-off artefact. The closest existing document is `docs/runbooks/launch-gate.md`, which is a launch checklist covering MFA, backups, privacy and integrations — useful, but not a verification standard and not organised by the ASVS chapters the requirement names.
**Gap:** The individual controls SEC-002..010 are largely present (see below), which is what makes this a documentation gap rather than a security one: the practices exist but nothing states the baseline they are being verified against, so nobody can say which requirements were checked at which release. **What would settle it:** an ASVS L1/L2 checklist in `docs/runbooks/` mapping each chapter to the control and test that satisfies it.
