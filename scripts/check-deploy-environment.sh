#!/usr/bin/env bash
# Fail-closed checks before a deploy touches an environment (#51, #52).
#
# Called by .github/workflows/deploy.yml with the target environment's
# variables and secrets. Refuses to continue unless:
#   - the environment is released for publishing (RELEASE_ENABLED=true);
#   - every credential and setting the deploy needs is present;
#   - the Supabase project is the one registered for that environment, and
#     staging and production are different projects;
#   - the app's settings (APP_ENV, written to the server as app.env) point
#     at that same project and at this environment's own address, carry the
#     keys the app cannot run without, and, on production, do not switch on
#     unfinished Workspace OS modules (WORKSPACE_OS_FLAGS).
# A staging deploy can therefore never migrate, or point the app at, the
# production database, and the reverse.

set -euo pipefail

fail() { echo "::error::$*"; exit 1; }

# The value of NAME in the APP_ENV dotenv text: last assignment wins, with
# surrounding quotes and a trailing carriage return removed.
app_env() {
  local line value
  line=$(printf '%s\n' "${APP_ENV:-}" | tr -d '\r' | grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" | tail -n 1 || true)
  [ -n "$line" ] || return 0
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}
app_env_has() {
  printf '%s\n' "${APP_ENV:-}" | tr -d '\r' | grep -qE "^[[:space:]]*(export[[:space:]]+)?$1="
}

[[ "${RELEASE_ENABLED:-}" == "true" ]] \
  || fail "Release is disabled for ${TARGET_ENVIRONMENT:-?}. Complete the environment release checklist first."

for name in SUPABASE_PROJECT_REF SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD \
            STAGING_SUPABASE_REF PRODUCTION_SUPABASE_REF \
            DEPLOY_HOST DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS SITE_URL APP_ENV; do
  [[ -n "${!name:-}" ]] || fail "Missing ${name} for ${TARGET_ENVIRONMENT:-?}."
done

# A project ref is 20 lowercase letters. Anything else (a placeholder such as
# "staging ref", a pasted URL) would otherwise pass as long as both copies of
# it match, and only fail later, further into the deploy.
for name in SUPABASE_PROJECT_REF STAGING_SUPABASE_REF PRODUCTION_SUPABASE_REF; do
  [[ "${!name}" =~ ^[a-z]{20}$ ]] \
    || fail "${name} for ${TARGET_ENVIRONMENT:-?} is not a Supabase project ref (20 lowercase letters, from the project's dashboard address)."
done

case "${TARGET_ENVIRONMENT:-}" in
  staging) expected_ref="${STAGING_SUPABASE_REF}" ;;
  production) expected_ref="${PRODUCTION_SUPABASE_REF}" ;;
  *) fail "Unsupported environment: ${TARGET_ENVIRONMENT:-<empty>}" ;;
esac

[[ "${STAGING_SUPABASE_REF}" != "${PRODUCTION_SUPABASE_REF}" ]] \
  || fail "Refusing deployment: staging and production are registered to the same Supabase project."

[[ "${SUPABASE_PROJECT_REF}" == "${expected_ref}" ]] \
  || fail "Refusing deployment: ${TARGET_ENVIRONMENT} is bound to Supabase project ${SUPABASE_PROJECT_REF}, not its registered project."

site="${SITE_URL%/}"
[[ "$site" =~ ^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] \
  || fail "SITE_URL for ${TARGET_ENVIRONMENT} must be https://<host name> with no path (got ${SITE_URL})."

url="$(app_env NEXT_PUBLIC_SUPABASE_URL)"
url="${url%/}"
[[ "$url" == "https://${expected_ref}.supabase.co" ]] \
  || fail "Refusing deployment: APP_ENV's NEXT_PUBLIC_SUPABASE_URL is not ${TARGET_ENVIRONMENT}'s Supabase project (${expected_ref})."

app_url="$(app_env NEXT_PUBLIC_APP_URL)"
[[ "${app_url%/}" == "$site" ]] \
  || fail "APP_ENV's NEXT_PUBLIC_APP_URL must be this environment's address, ${site}."

for name in NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  [[ -n "$(app_env "$name")" ]] || fail "APP_ENV for ${TARGET_ENVIRONMENT} has no ${name}."
done
secret="$(app_env CRON_JOB_SECRET)"
(( ${#secret} >= 32 )) \
  || fail "APP_ENV for ${TARGET_ENVIRONMENT} needs a CRON_JOB_SECRET of at least 32 characters (openssl rand -base64 48)."

# WORKSPACE_OS_FLAGS turns unfinished modules on without touching the
# feature_flag table (src/lib/feature-flags.ts). Staging only. Present at all
# counts on production, even empty.
if [[ "${TARGET_ENVIRONMENT}" == "production" ]] && app_env_has WORKSPACE_OS_FLAGS; then
  fail "Refusing deployment: APP_ENV for production sets WORKSPACE_OS_FLAGS. Remove that line from the production environment's APP_ENV secret."
fi

echo "Environment ${TARGET_ENVIRONMENT}: Supabase project and app settings match their registrations."
