# Live staging checks — 14 October 2026

Origin: https://qbbe-hub-staging.lexgency.chatgpt.site

Sites access now reports **public**, reflecting an access change made after the original private publication. This work preserves that audience. Application-level Supabase sign-in remains required for protected pages.

| Unauthenticated check | Observed result |
|---|---|
| `/` | 307 redirect to `/sign-in?next=%2F` |
| `/sign-in` | 200, rendered HTML |
| `/api/health/version` | 200 |
| `/manifest.webmanifest` | 200 |
| Sign-in CSS and two JavaScript assets | 200 for all three sampled assets |
| CSP | 54/54 rendered script tags carry a nonce; response includes nonce-based CSP |
| `/api/v1/me` | Initially 500; privileged client initialization occurs outside error handling |
| GET `/api/jobs/document-scan` | 405; this does not verify an authenticated job run |

The API initialization fix adds a safe, non-cacheable JSON 503 when server configuration is missing. Unexpected initialization errors remain generic JSON 500 responses. The API's feature flag, authentication, scope checks and rate limits are unchanged when client initialization succeeds.

Validation: API regression suite includes missing-configuration and unexpected-initialization-error cases. These tests prove error handling, not working token authorization against the live database.

Remaining blockers: `SUPABASE_SERVICE_ROLE_KEY` is not configured for privileged operations; job secret, scanner endpoint/transport, enabled provider credentials and OAuth callback configuration require completion. Do not generate replacement credentials or reroute existing job schedules as a workaround. No authenticated browser workflow, editor persistence, realtime session, file scan or full feature-parity test has been performed. Browser-control tooling required by the Sites managed-preview workflow is unavailable in this session.

HTTP observations use curl. Python urllib requests initially received 403 responses, so those were not treated as application failures; curl obtained the application responses recorded above.
