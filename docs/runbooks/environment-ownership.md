# QBBE Hub — Environment Ownership & Isolation

Issue: #52

## Hosting inventory

Since October 2026 both environments run on the QBBE server, one Oracle Cloud
Always Free machine in Montreal ([`hosting.md`](hosting.md)), as containers
`qbbe-app-staging` and `qbbe-app-production`. The Netlify sites
(`qbbe-hub-staging`, `qbbe-hub-production`, the review site `qbbe-hub-review`)
are retired and are to be deleted once both environments run on the server.

The deployment workflow selects a GitHub Environment (`staging` or
`production`) and reads the server credentials, the app settings (`APP_ENV`)
and `RELEASE_ENABLED` from that environment only.

## Required GitHub Environment bindings

### staging
- `DEPLOY_HOST`, secrets `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`: the QBBE server
- secret `APP_ENV`: staging-only Supabase URL/keys and all staging integration credentials
- `RELEASE_ENABLED=false` until #55 is ready to certify staging

### production
- the same three server settings
- secret `APP_ENV`: production-only values; never `WORKSPACE_OS_FLAGS`
- `RELEASE_ENABLED=false` until #21 staging certification has passed

## Supabase isolation requirement

The repository currently contains a production public Supabase URL for project ref `xvxahcbwydsnllqbjnlr`. The currently connected Supabase account does not expose that project and only exposes unrelated inactive projects, so ownership/isolation cannot be verified from this session.

Before #52 may close:
1. QBBE-controlled Supabase organization/project ownership must be verified.
2. Separate staging and production Supabase projects (or an explicitly accepted isolated branching model) must exist.
3. Staging and production must use different project refs/URLs/keys.
4. Staging service-role credentials must never authenticate against production.
5. Database migrations must be applied independently and verified in both environments.

## Provider custody register

The register itself is `provider-custody.md`, with a row per provider ready to
fill in. For every production-critical provider record:
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

Providers in scope: GitHub, Oracle Cloud (the QBBE server), Supabase, Google Workspace/OAuth, transactional email, malware scanning, monitoring/alerting, backup storage.

## Isolation verification

Before release, prove all of the following:
- staging's `APP_ENV` points at the staging Supabase project and address, production's at production's (the deploy check refuses otherwise)
- staging and production Supabase refs differ
- no staging/preview environment contains production service-role/OAuth/email secrets
- production publishing remains disabled until #21 passes
- a staging write cannot mutate production data
- QBBE custodians can access/recover each production-critical provider account

A created resource or written runbook is not sufficient acceptance evidence. Provider/admin views and an actual isolation test are required.

## Standing staging up

`staging-provisioning.md` is the ordered procedure for provisioning the staging
environment and deploying one frozen commit to it, with the smoke checks that
prove a staging write cannot reach production.
