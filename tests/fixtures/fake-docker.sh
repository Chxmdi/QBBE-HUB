#!/usr/bin/env bash
# A stand-in for `docker` in tests/unit/self-hosting.test.ts, so release.sh
# can be run end to end without Docker. It logs every call to
# $FAKE_DOCKER_LOG and makes `compose ... up --wait` fail when the image in
# the compose env file is $FAKE_DOCKER_UNHEALTHY (a release whose container
# never reports healthy). `pull` fails for $FAKE_DOCKER_PULL_FAIL.
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_DOCKER_LOG:-/dev/null}"
case "${1:-}" in
  compose)
    env_file=""
    args=("$@")
    for ((i = 0; i < ${#args[@]}; i++)); do
      [ "${args[$i]}" = --env-file ] && env_file="${args[$((i + 1))]}"
    done
    if [[ " $* " == *" up "* ]]; then
      image="$(sed -n 's/^QBBE_IMAGE=//p' "$env_file")"
      [ -n "${FAKE_DOCKER_UNHEALTHY:-}" ] && [ "$image" = "$FAKE_DOCKER_UNHEALTHY" ] && exit 1
    fi
    exit 0 ;;
  pull)
    for arg in "$@"; do
      [ -n "${FAKE_DOCKER_PULL_FAIL:-}" ] && [ "$arg" = "$FAKE_DOCKER_PULL_FAIL" ] && exit 1
    done
    exit 0 ;;
  exec | logout | login) exit 0 ;;
  image)
    # `image ls` lists nothing; `image rm` succeeds.
    exit 0 ;;
  *) exit 0 ;;
esac
