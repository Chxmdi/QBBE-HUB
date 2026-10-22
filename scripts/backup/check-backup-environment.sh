#!/usr/bin/env bash
# Fail-closed checks before the nightly backup reads an environment
# (DATA-001; .github/workflows/backup.yml, docs/runbooks/backup-recovery.md).
#
# The backup runs under its own GitHub environments, backup-staging and
# backup-production. They have no required reviewers, so a nightly run never
# waits for an approval, and they leave out the app's APP_ENV. But they are
# not harmless: each holds its project's database password and a Supabase
# secret (service-role) key, which together read and write every row and
# file, so anyone who can land a commit on main can reach them (runbook,
# setup step 7). Called with one of them's variables and secrets, it
# refuses to continue unless:
#   - every setting the backup needs is present, naming each missing one and
#     where it goes;
#   - the Supabase project is the one registered for that environment
#     (repository variables STAGING_/PRODUCTION_SUPABASE_PROJECT_REF, the
#     same ones scripts/check-deploy-environment.sh enforces for deploys),
#     and staging and production are registered to different projects, so a
#     staging backup can never read production, nor the reverse;
#   - the service-role key belongs to that project (a legacy service_role
#     key names its project; a new sb_secret_ key cannot be checked here);
#   - BACKUP_AGE_RECIPIENT holds only age public keys (a private key pasted
#     there by mistake, in any case and anywhere in the value, is refused,
#     and never echoed);
#   - BACKUP_INDEX_KEY, which signs the unencrypted index, holds at least 32
#     random bytes as hex or base64 (its length is checked; it is never
#     printed);
#   - the backup bucket and the outside check-in address use HTTPS.
# It writes nothing and prints no secret.

set -euo pipefail

fail() { echo "::error::$*"; exit 1; }

environment="${TARGET_ENVIRONMENT:-}"
[[ "$environment" =~ ^(staging|production)$ ]] || fail "Unsupported environment: ${environment:-<empty>}."
github_environment="backup-${environment}"

# Where each setting lives, so a missing one can be named with its place.
secrets=(SUPABASE_DB_PASSWORD SUPABASE_SERVICE_ROLE_KEY BACKUP_AGE_RECIPIENT BACKUP_INDEX_KEY BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_HEALTHCHECK_URL)
variables=(SUPABASE_PROJECT_REF BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_REGION)
repository_variables=(STAGING_SUPABASE_PROJECT_REF PRODUCTION_SUPABASE_PROJECT_REF)
missing=0
for name in "${secrets[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "::error::Missing ${name}: add it as a secret on the ${github_environment} environment (Settings, Environments, ${github_environment}, Environment secrets)."; missing=1; }
done
for name in "${variables[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "::error::Missing ${name}: add it as a variable on the ${github_environment} environment (Settings, Environments, ${github_environment}, Environment variables)."; missing=1; }
done
for name in "${repository_variables[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "::error::Missing ${name}: add it as a repository variable (Settings, Secrets and variables, Actions, Variables)."; missing=1; }
done
(( missing == 0 )) || exit 1

for name in SUPABASE_PROJECT_REF STAGING_SUPABASE_PROJECT_REF PRODUCTION_SUPABASE_PROJECT_REF; do
  [[ "${!name}" =~ ^[a-z]{20}$ ]] \
    || fail "${name} is not a Supabase project ref (20 lowercase letters, from the project's dashboard address)."
done
[[ "$STAGING_SUPABASE_PROJECT_REF" != "$PRODUCTION_SUPABASE_PROJECT_REF" ]] \
  || fail "Refusing: staging and production are registered to the same Supabase project."
case "$environment" in
  staging) expected="$STAGING_SUPABASE_PROJECT_REF" ;;
  production) expected="$PRODUCTION_SUPABASE_PROJECT_REF" ;;
esac
[[ "$SUPABASE_PROJECT_REF" == "$expected" ]] \
  || fail "Refusing: the ${github_environment} environment's SUPABASE_PROJECT_REF is not ${environment}'s registered project."

# A legacy service_role key is a JWT whose payload names its project and
# role. Decoded locally; nothing is printed but the verdict.
key_check=$(node -e '
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const expected = process.argv[1];
  if (/^sb_secret_/.test(key)) { console.log("secret"); process.exit(0); }
  if (/^sb_publishable_/.test(key)) { console.log("publishable"); process.exit(0); }
  const parts = key.split(".");
  if (parts.length !== 3) { console.log("unknown"); process.exit(0); }
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { console.log("unknown"); process.exit(0); }
  if (claims.role !== "service_role") console.log("not-service-role");
  else if (claims.ref !== expected) console.log("other-project");
  else console.log("ok");
' "$expected")
case "$key_check" in
  ok | secret) ;;
  other-project) fail "Refusing: ${github_environment}'s SUPABASE_SERVICE_ROLE_KEY belongs to another Supabase project." ;;
  not-service-role | publishable) fail "${github_environment}'s SUPABASE_SERVICE_ROLE_KEY is not a service-role (or secret) key. Use the project's service_role key (Project Settings, API Keys)." ;;
  *) fail "${github_environment}'s SUPABASE_SERVICE_ROLE_KEY is not a Supabase key." ;;
esac

# The whole value first, in any case: a pasted age-keygen file starts with
# comment lines, and its private key must be named as such.
if grep -qi 'AGE-SECRET-KEY-' <<< "$BACKUP_AGE_RECIPIENT"; then
  fail "BACKUP_AGE_RECIPIENT holds a private key. Delete that secret now, treat the key as exposed, make a new key pair, and put only the public key (age1…) here."
fi
count=0
read -r -a recipients <<< "$(tr ',\r\n\t' '    ' <<< "$BACKUP_AGE_RECIPIENT")"
for recipient in "${recipients[@]}"; do
  [[ "$recipient" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] \
    || fail "BACKUP_AGE_RECIPIENT has an entry that is not an age public key (age1 followed by 58 characters)."
  count=$(( count + 1 ))
done
(( count > 0 )) || fail "BACKUP_AGE_RECIPIENT has no age public key."

# Decoded locally; only the number of bytes (and of different byte values)
# is ever printed.
# shellcheck disable=SC2016 # JavaScript, not shell, expands ${…} here.
index_key_bytes=$(node -e '
  const v = (process.env.BACKUP_INDEX_KEY || "").trim();
  let b = null;
  if (/^[0-9a-fA-F]+$/.test(v) && v.length % 2 === 0) b = Buffer.from(v, "hex");
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) b = Buffer.from(v, "base64");
  console.log(b === null ? "not-encoded" : `${b.length} ${new Set(b).size}`);
')
read -r index_key_bytes index_key_distinct <<< "$index_key_bytes"
[[ "$index_key_bytes" != not-encoded ]] \
  || fail "${github_environment}'s BACKUP_INDEX_KEY is neither hex nor base64. Make one with: openssl rand -base64 32"
(( index_key_bytes >= 32 )) \
  || fail "${github_environment}'s BACKUP_INDEX_KEY holds ${index_key_bytes} bytes; it must hold at least 32 random bytes. Make one with: openssl rand -base64 32"
# 32 random bytes hold about 30 different values; all zero bytes, or a
# pattern typed by hand, hold a few (lib.mjs parseIndexKey refuses them too).
(( index_key_distinct >= 16 )) \
  || fail "${github_environment}'s BACKUP_INDEX_KEY does not look random (it repeats the same few byte values). Make one with: openssl rand -base64 32"

[[ "$BACKUP_S3_ENDPOINT" =~ ^https://[^/]+/?$ ]] \
  || fail "BACKUP_S3_ENDPOINT must be https://<host> with no path."
[[ "$BACKUP_S3_BUCKET" =~ ^[A-Za-z0-9._-]{1,255}$ ]] \
  || fail "BACKUP_S3_BUCKET is not a bucket name (letters, numbers, dots, dashes, underscores)."
[[ "$BACKUP_HEALTHCHECK_URL" =~ ^https://[^[:space:]]+$ ]] \
  || fail "BACKUP_HEALTHCHECK_URL must be the https:// ping address of the outside check (runbook, setup step 6)."

echo "Backup settings for ${environment}: registered project, its own service-role key, ${count} custodian key(s), an index key of ${index_key_bytes} bytes, bucket and check-in over HTTPS."
