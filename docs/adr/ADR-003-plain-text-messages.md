# ADR-003: Plain-text message bodies with server-parsed mentions

Status: Accepted
Date: 2026-08-13
Owners: QBBE Hub engineering

## Context

MSG-003 forbids persisting unsanitized HTML from the browser. MSG-005
requires mentions to be parsed and persisted server-side so notification
delivery cannot be bypassed by inconsistent clients.

## Decision

- Message bodies are stored as plain text (UTF-8, max 10k chars) and
  rendered with React text nodes (`whitespace-pre-wrap`), which escapes
  markup by construction — no sanitizer dependency, no XSS surface.
- Mentions use the convention `@Full Name`; the send action matches tokens
  against active members server-side, writes `message_mention` rows, and
  creates deduplicated notifications.
- A future rich-text upgrade should store a portable structured format
  (e.g. TipTap/ProseMirror JSON) plus a plain-text projection for search,
  behind a new migration — not raw HTML.

## Consequences

Easier: zero injection surface, trivial search vector, small composer.
Harder: no inline formatting/links preview until the rich-text upgrade.

## Revisit trigger

Pilot feedback showing formatting is a real adoption blocker.
