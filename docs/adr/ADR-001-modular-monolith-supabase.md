# ADR-001: Modular monolith on Next.js + Supabase

Status: Accepted
Date: 2026-08-13
Owners: QBBE Hub engineering

## Context

QBBE Hub spans many product modules (work management, communication,
meetings, CRM, reporting) that share one identity, permission, and data
model. The master specification (Part IV, ENG-001/§2) requires one web
application and one primary data platform with strong feature boundaries.

## Decision

- One Next.js App Router application, strict TypeScript, feature-first
  folders (`src/features/<domain>`), thin route files.
- Supabase managed Postgres as the canonical store, with Supabase Auth for
  identity and Supabase Realtime for message/notification signals.
- Server actions (`services/*.commands.ts`) are the write path; every action
  validates input with Zod and relies on RLS for authorization.

## Alternatives considered

- **Microservices** — rejected: duplicates auth/deploy/observability for a
  ~50-user organization (spec's own trigger list for extraction not met).
- **Custom Node/Postgres backend** — rejected: Supabase provides managed
  auth, RLS, realtime, and backups that QBBE would otherwise operate itself.

## Consequences

Easier: one deploy, one schema, shared permission predicates, local dev via
Supabase CLI. Harder: long-running background workers need Supabase Edge
Functions/Cron when notification email delivery and Gmail sync are enabled.

## Revisit trigger

A domain needs independent scaling/isolation (e.g. Gmail sync worker), or
organization-wide SSO supersedes Supabase Auth.
