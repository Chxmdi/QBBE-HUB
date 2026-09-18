# QBBE Hub — Environment Ownership & Isolation

Issue: #52

## Verified hosting inventory

- Staging Netlify site: `qbbe-hub-staging`
  - Site ID: `2169b17a-8dc3-49de-a466-4281e1285de2`
  - SSO team login required for all project access.
- Production Netlify site: `qbbe-hub-production`
  - Site ID: `a34499c8-0d84-47d5-bfb2-502c2b9b9071`
  - SSO team login required for all project access.
- Legacy/review site: `qbbe-hub-review`
  - Site ID: `7d5806f5-e16c-48a6-a5af-605504f02159`
  - Treat as review-only. It is not the canonical staging or production target.

The deployment workflow already selects a GitHub Environment (`staging` or `production`) and reads `NETLIFY_SITE_ID`, `NETLIFY_AUTH_TOKEN`, and `RELEASE_ENABLED` from that environment. Each GitHub Environment must therefore point only at its matching Netlify site.

## Required GitHub Environment bindings

### staging
- `NETLIFY_SITE_ID=2169b17a-8dc3-49de-a466-4281e1285de2`
- secret `NETLIFY_AUTH_TOKEN`: staging-capable deploy token
- `RELEASE_ENABLED=false` until #55 is ready to certify staging
- staging-only Supabase URL/key and all staging integration credentials

### production
- `NETLIFY_SITE_ID=a34499c8-0d84-47d5-bfb2-502c2b9b9071`
- secret `NETLIFY_AUTH_TOKEN`: production-capable deploy token
- `RELEASE_ENABLED=false` until #21 staging certification has passed
- production-only Supabase URL/key and production integration credentials

## Supabase isolation requirement

The repository currently contains a production public Supabase URL for project ref `xvxahcbwydsnllqbjnlr`. The currently connected Supabase account does not expose that project and only exposes unrelated inactive projects, so ownership/isolation cannot be verified from this session.

Before #52 may close:
1. QBBE-controlled Supabase organization/project ownership must be verified.
2. Separate staging and production Supabase projects (or an explicitly accepted isolated branching model) must exist.
3. Staging and production must use different project refs/URLs/keys.
4. Staging service-role credentials must never authenticate against production.
5. Database migrations must be applied independently and verified in both environments.

## Provider custody register

For every production-critical provider record:
- provider/service
- QBBE organizational owner
- named primary custodian
- named backup custodian
- recovery contact
- MFA status
- staging resource identifier
- production resource identifier
- secret location (never the secret value)
- rotation date / policy

Providers in scope: GitHub, Netlify, Supabase, Google Workspace/OAuth, transactional email, malware scanning, monitoring/alerting, backup storage.

## Isolation verification

Before release, prove all of the following:
- staging deploy uses the staging Netlify site ID
- production deploy uses the production Netlify site ID
- staging and production Supabase refs differ
- no staging/preview environment contains production service-role/OAuth/email secrets
- production publishing remains disabled until #21 passes
- a staging write cannot mutate production data
- QBBE custodians can access/recover each production-critical provider account

A created resource or written runbook is not sufficient acceptance evidence. Provider/admin views and an actual isolation test are required.