# ADR-002: Postgres RLS is the authorization boundary

Status: Accepted; the service role clause is superseded by
[ADR-004](ADR-004-service-role-uses.md) (2026-10-22)
Date: 2026-08-13
Owners: QBBE Hub engineering

## Context

Permissions are multi-dimensional (org role, program/project membership,
channel membership, DM participation). The spec mandates database-layer
enforcement (P0 §5.1, DB-003, AUTH-003): UI checks improve UX but must never
be the only gate.

## Decision

- Every user-facing table enables RLS with deny-by-default.
- Centralized SECURITY DEFINER predicates in the `app` schema
  (`is_member`, `is_admin`, `is_staff`, `is_channel_member`,
  `can_read_channel`, `can_post_in_channel`, `can_reply_in_channel`,
  `is_conversation_member`) avoid recursive policy evaluation and keep the
  rules auditable in one place (AUTH-009).
- The application uses only the anon key in request handling; service-role
  credentials are reserved for future server-only workers. (Superseded: the
  reviewed exceptions, each with the check that stands in for RLS, are listed
  in [ADR-004](ADR-004-service-role-uses.md).)
- Global search is a SECURITY INVOKER SQL function so RLS filters results —
  search can never leak titles/snippets of unauthorized records (P0-SRC-02).

## Alternatives considered

- Application-layer authorization middleware — rejected as the primary
  boundary: every new query path would need to re-implement checks, and
  realtime subscriptions would bypass it.

## Consequences

Easier: deep links, realtime, exports and search inherit correct scoping.
Harder: policies must be tested with negative cases (TST-003) and any new
table must ship with policies in the same migration.

## Revisit trigger

Measured RLS performance problems on hot paths, or adoption of external
row-security tooling.
