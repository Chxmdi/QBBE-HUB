#!/usr/bin/env bash
# Puts one image live for one environment (docs/runbooks/hosting.md).
#
#   release.sh <staging|production> <image> <site host>
#
# Run on the server by the Deploy and Rollback workflows, as the deploy user,
# from /opt/qbbe/<environment>/ where the workflow has just uploaded this
# script, compose.app.yaml, site.caddy.template and (Deploy only) app.env.new.
#
# The new container must report healthy within 3 minutes. If it does not, the
# previous image and settings are put back and the release fails, so a bad
# image never stays live. Only this environment's container and address are
# touched; the other environment keeps running.
#
# Prints ROLLBACK_TARGET=<the image this release replaced>.

set -euo pipefail

ENVIRONMENT="${1:-}"
IMAGE="${2:-}"
HOST="${3:-}"
ROOT="${QBBE_ROOT:-/opt/qbbe}"

fail() { echo "release: $*" >&2; exit 1; }

case "$ENVIRONMENT" in
  staging) OTHER=production; CPU_SHARES=512; MEM_LIMIT=2g; HEAP_MB=1024 ;;
  production) OTHER=staging; CPU_SHARES=1024; MEM_LIMIT=3g; HEAP_MB=1536 ;;
  *) fail "environment must be staging or production, not '${ENVIRONMENT}'." ;;
esac
# Images are tagged <environment>-<commit>: a staging build (staging's
# public keys inside) can never be released to production, or the reverse.
[[ "$IMAGE" =~ ^[a-z0-9][a-z0-9._/:-]*:${ENVIRONMENT}-[0-9a-f]{7,40}$ ]] \
  || fail "image '${IMAGE}' is not a ${ENVIRONMENT} image (<name>:${ENVIRONMENT}-<commit>)."
[[ "$HOST" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] \
  || fail "'${HOST}' is not a host name."

DIR="${ROOT}/${ENVIRONMENT}"
SITES="${ROOT}/base/sites"
for f in compose.app.yaml site.caddy.template; do
  [ -f "${DIR}/${f}" ] || fail "${DIR}/${f} is missing."
done
[ -d "$SITES" ] || fail "${SITES} is missing; run the Server setup workflow first."
if [ -f "${SITES}/${OTHER}.caddy" ] && grep -q "^${HOST//./\\.} {" "${SITES}/${OTHER}.caddy"; then
  fail "${HOST} is already ${OTHER}'s address."
fi

# A new settings file replaces the current one only for this release; the
# old one is kept so a failed release puts both image and settings back.
if [ -f "${DIR}/app.env.new" ]; then
  [ -f "${DIR}/app.env" ] && cp -p "${DIR}/app.env" "${DIR}/app.env.previous"
  mv "${DIR}/app.env.new" "${DIR}/app.env"
  chmod 600 "${DIR}/app.env"
  NEW_SETTINGS=1
else
  NEW_SETTINGS=0
fi
[ -f "${DIR}/app.env" ] || fail "${DIR}/app.env is missing; a Deploy run uploads it."

previous="$(cat "${DIR}/current-image" 2>/dev/null || true)"

write_env() {
  cat > "${DIR}/.env" <<CONF
QBBE_ENV=${ENVIRONMENT}
QBBE_IMAGE=$1
QBBE_APP_ENV_FILE=${DIR}/app.env
QBBE_CPU_SHARES=${CPU_SHARES}
QBBE_MEM_LIMIT=${MEM_LIMIT}
QBBE_NODE_HEAP_MB=${HEAP_MB}
CONF
}
compose() { docker compose -p "qbbe-${ENVIRONMENT}" -f "${DIR}/compose.app.yaml" --env-file "${DIR}/.env" "$@"; }

if [ "${QBBE_SKIP_PULL:-0}" != 1 ]; then
  docker pull --quiet "$IMAGE" >/dev/null
fi

write_env "$IMAGE"
if ! compose up -d --wait --wait-timeout 180; then
  echo "release: ${IMAGE} did not become healthy. Its last log lines:" >&2
  compose logs --tail 60 app >&2 || true
  if [ "$NEW_SETTINGS" = 1 ] && [ -f "${DIR}/app.env.previous" ]; then
    mv "${DIR}/app.env.previous" "${DIR}/app.env"
  fi
  if [ -n "$previous" ]; then
    echo "release: putting ${previous} back." >&2
    write_env "$previous"
    compose up -d --wait --wait-timeout 180 || echo "release: the previous image did not come back healthy either." >&2
  fi
  exit 1
fi

# Route the address to this environment's container.
sed -e "s/__ENV__/${ENVIRONMENT}/g" -e "s/__HOST__/${HOST}/g" "${DIR}/site.caddy.template" > "${SITES}/${ENVIRONMENT}.caddy.tmp"
mv "${SITES}/${ENVIRONMENT}.caddy.tmp" "${SITES}/${ENVIRONMENT}.caddy"
docker exec qbbe-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

printf '%s\n' "$IMAGE" > "${DIR}/current-image"
if [ -n "$previous" ] && [ "$previous" != "$IMAGE" ]; then
  printf '%s\n' "$previous" > "${DIR}/previous-image"
fi
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$IMAGE" >> "${DIR}/releases.log"
rm -f "${DIR}/app.env.previous"

# Keep this environment's five newest images for rollback; older ones go.
repo="${IMAGE%:*}"
docker image ls "$repo" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' \
  | grep -F ":${ENVIRONMENT}-" | sort -r | tail -n +6 | cut -f2 \
  | xargs -r docker image rm >/dev/null 2>&1 || true

echo "Released ${IMAGE} to ${ENVIRONMENT} at https://${HOST}."
echo "ROLLBACK_TARGET=${previous:-none}"
