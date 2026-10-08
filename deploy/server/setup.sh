#!/usr/bin/env bash
# Prepares the QBBE server (docs/runbooks/hosting.md). Safe to run again.
#
#   sudo bash setup.sh <folder holding compose.base.yaml and Caddyfile>
#
# Run by the "Server setup" workflow over SSH. It:
#   - installs Docker and the compose plugin from Ubuntu's archive;
#   - turns on automatic security updates (with a reboot at 04:30 when one
#     needs it; the containers restart by themselves);
#   - opens ports 80 and 443 in the host firewall Oracle's images ship with;
#   - adds swap, so ClamAV's daily signature reload cannot exhaust memory;
#   - creates /opt/qbbe and starts the shared services (Caddy, ClamAV).
# Each environment's app is installed later by release.sh, from a deploy.

set -euo pipefail

SRC="${1:?usage: sudo bash setup.sh <folder with compose.base.yaml and Caddyfile>}"
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-ubuntu}}"
ROOT="${QBBE_ROOT:-/opt/qbbe}"
ACME_EMAIL="${ACME_EMAIL:-}"

fail() { echo "setup: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "run as root (sudo)."
id "$DEPLOY_USER" >/dev/null 2>&1 || fail "user ${DEPLOY_USER} does not exist."
for f in compose.base.yaml Caddyfile; do [ -f "${SRC}/${f}" ] || fail "${SRC}/${f} is missing."; done

export DEBIAN_FRONTEND=noninteractive

echo "== Packages"
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 unattended-upgrades ca-certificates curl

echo "== Automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat > /etc/apt/apt.conf.d/52qbbe-upgrades <<'CONF'
// QBBE server: reboot at night when an update needs it (docs/runbooks/hosting.md).
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
CONF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

echo "== Docker"
mkdir -p /etc/docker
desired='{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"5"},"live-restore":true}'
if [ "$(cat /etc/docker/daemon.json 2>/dev/null)" != "$desired" ]; then
  printf '%s\n' "$desired" > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null
usermod -aG docker "$DEPLOY_USER"
docker compose version >/dev/null || fail "the docker compose plugin is not available."

echo "== Host firewall"
# Oracle's Ubuntu images reject everything but SSH in the INPUT chain. Add
# 80 and 443 to the saved rules (so a reboot keeps them) and to the live
# table. The saved file is edited directly rather than with
# `netfilter-persistent save`, which would also store Docker's own rules.
if [ -f /etc/iptables/rules.v4 ]; then
  for port in 80 443; do
    rule="-A INPUT -p tcp -m state --state NEW -m tcp --dport ${port} -j ACCEPT"
    if ! grep -qF -- "$rule" /etc/iptables/rules.v4; then
      # Insert before the first INPUT REJECT, or before COMMIT if there is none.
      awk -v r="$rule" '!done && (/^-A INPUT .*-j REJECT/ || /^COMMIT/) { print r; done=1 } { print }' \
        /etc/iptables/rules.v4 > /etc/iptables/rules.v4.new
      mv /etc/iptables/rules.v4.new /etc/iptables/rules.v4
    fi
  done
fi
for port in 80 443; do
  iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
done

echo "== Swap"
if [ "$(swapon --noheadings | wc -l)" = 0 ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Shared services"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ROOT" "${ROOT}/base" "${ROOT}/base/sites"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "${ROOT}/staging" "${ROOT}/production"
install -m 644 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "${SRC}/compose.base.yaml" "${ROOT}/base/"
# Caddy refuses an empty `email` option, so the line is there only when an
# address was given.
{
  if [ -n "$ACME_EMAIL" ]; then
    printf '{\n\temail %s\n}\n\n' "$ACME_EMAIL"
  fi
  cat "${SRC}/Caddyfile"
} > "${ROOT}/base/Caddyfile"
chown "$DEPLOY_USER:$DEPLOY_USER" "${ROOT}/base/Caddyfile"
docker compose -p qbbe-base -f "${ROOT}/base/compose.base.yaml" up -d --remove-orphans
# A changed Caddyfile is read on reload; an unchanged one makes this a no-op.
docker exec qbbe-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true

echo "== Done"
docker compose -p qbbe-base -f "${ROOT}/base/compose.base.yaml" ps --format 'table {{.Name}}\t{{.Status}}'
echo "ClamAV downloads its signatures on first start (a few minutes) before it answers."
