#!/usr/bin/env bash
# Fail-closed checks before a deploy touches an environment (#51, #52).
#
# Called by .github/workflows/deploy-netlify.yml with the target environment's
# variables. Refuses to continue unless:
#   - the environment is released for publishing (RELEASE_ENABLED=true);
#   - every credential the deploy needs is present;
#   - the Netlify site is the one registered for that environment;
#   - the Supabase project is the one registered for that environment, and
#     staging and production are different projects. A staging deploy can
#     therefore never migrate, or point a site at, the production database.

set -euo pipefail

fail() { echo "::error::$*"; exit 1; }

[[ "${RELEASE_ENABLED:-}" == "true" ]] \
  || fail "Release is disabled for ${TARGET_ENVIRONMENT:-?}. Complete the environment release checklist first."

for name in NETLIFY_SITE_ID NETLIFY_AUTH_TOKEN SUPABASE_PROJECT_REF SUPABASE_ACCESS_TOKEN \
            SUPABASE_DB_PASSWORD STAGING_SUPABASE_REF PRODUCTION_SUPABASE_REF; do
  [[ -n "${!name:-}" ]] || fail "Missing ${name} for ${TARGET_ENVIRONMENT:-?}."
done

case "${TARGET_ENVIRONMENT:-}" in
  staging)
    expected_site_id='2169b17a-8dc3-49de-a466-4281e1285de2'
    expected_ref="${STAGING_SUPABASE_REF}"
    ;;
  production)
    expected_site_id='a34499c8-0d84-47d5-bfb2-502c2b9b9071'
    expected_ref="${PRODUCTION_SUPABASE_REF}"
    ;;
  *) fail "Unsupported environment: ${TARGET_ENVIRONMENT:-<empty>}" ;;
esac

[[ "${NETLIFY_SITE_ID}" == "${expected_site_id}" ]] \
  || fail "Refusing deployment: ${TARGET_ENVIRONMENT} is bound to the wrong Netlify site ID."

[[ "${STAGING_SUPABASE_REF}" != "${PRODUCTION_SUPABASE_REF}" ]] \
  || fail "Refusing deployment: staging and production are registered to the same Supabase project."

[[ "${SUPABASE_PROJECT_REF}" == "${expected_ref}" ]] \
  || fail "Refusing deployment: ${TARGET_ENVIRONMENT} is bound to Supabase project ${SUPABASE_PROJECT_REF}, not its registered project."

echo "Environment ${TARGET_ENVIRONMENT}: Netlify site and Supabase project match their registrations."
