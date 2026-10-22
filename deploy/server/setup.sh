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
#   - creates /opt/qbbe and starts the shared services (Caddy, ClamAV);
#   - creates one deploy user per environment (qbbe-staging,
#     qbbe-production), outside the docker group and with no sudo except the
#     release wrapper for its own environment (sudoers.qbbe, qbbe-release);
#   - installs the server's own copies of the release files in /opt/qbbe/bin.
# Each environment's app is installed later by release.sh, from a deploy.
#
# Deploy access (docs/runbooks/hosting.md, "Deploy access"):
#   STAGING_DEPLOY_PUBKEY, PRODUCTION_DEPLOY_PUBKEY
#       each environment's deploy public key (one line); installed for its
#       own user only. Empty leaves that user without a key.
#   IMAGE_REPOSITORY
#       the only image repository the wrapper releases from
#       (ghcr.io/<owner>/<repo>); required.
#   DEPLOY_USER
#       the old shared deploy user (default: the user running sudo).
#   REMOVE_LEGACY_DEPLOY_ACCESS=1 with ADMIN_PUBKEY
#       once both environments have deployed through the wrapper: takes the
#       old shared deploy user out of the docker group, replaces the
#       administrator's SSH keys with ADMIN_PUBKEY (the old key was held by
#       both environments), and gives the environment folders to root. The
#       server remembers it (/etc/qbbe/legacy-deploy-access-removed), so a
#       later run cannot put the old access back. Until then the old path
#       keeps working.

set -euo pipefail

SRC="${1:?usage: sudo bash setup.sh <folder with compose.base.yaml and Caddyfile>}"
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-ubuntu}}"
REMOVE_LEGACY="${REMOVE_LEGACY_DEPLOY_ACCESS:-0}"
LEGACY_MARKER=/etc/qbbe/legacy-deploy-access-removed
# Once removed, always removed: an ordinary later run must not restore it.
[ -f "$LEGACY_MARKER" ] && REMOVE_LEGACY=1
ADMIN_USER="${SUDO_USER:-ubuntu}"
ADMIN_PUBKEY="${ADMIN_PUBKEY:-}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-}"
ROOT="${QBBE_ROOT:-/opt/qbbe}"
ACME_EMAIL="${ACME_EMAIL:-}"

fail() { echo "setup: $*" >&2; exit 1; }
# Let's Encrypt writes here when a certificate is about to expire unrenewed:
# without it nobody hears before the site goes down.
[[ "$ACME_EMAIL" =~ ^[^[:space:]\'\"]+@[^[:space:]\'\"]+$ ]] \
  || fail "ACME_EMAIL (the certificate notice address) is required."
[ "$(id -u)" = 0 ] || fail "run as root (sudo)."
id "$DEPLOY_USER" >/dev/null 2>&1 || fail "user ${DEPLOY_USER} does not exist."
case "$DEPLOY_USER" in
  qbbe-*) fail "DEPLOY_USER is the old shared deploy user, not ${DEPLOY_USER}." ;;
esac
[[ "$IMAGE_REPOSITORY" =~ ^ghcr\.io/[a-z0-9._-]+/[a-z0-9._-]+$ ]] \
  || fail "IMAGE_REPOSITORY must be ghcr.io/<owner>/<repo> in lower case."
for f in compose.base.yaml Caddyfile compose.app.yaml site.caddy.template release.sh qbbe-release qbbe-ssh-gate sudoers.qbbe; do
  [ -f "${SRC}/${f}" ] || fail "${SRC}/${f} is missing."
done

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

# The administrator's new key (ADMIN_PUBKEY) is added next to the existing
# ones by every run, so it can be proven before the old ones are removed.
admin_home="$(getent passwd "$ADMIN_USER" | cut -d: -f6)"
admin_key_present() {
  local body
  body="$(printf '%s\n' "$ADMIN_PUBKEY" | awk '{print $1" "$2}')"
  grep -qF -- "$body" "${admin_home}/.ssh/authorized_keys" 2>/dev/null
}
if [ -n "$ADMIN_PUBKEY" ]; then
  printf '%s\n' "$ADMIN_PUBKEY" | ssh-keygen -lf - >/dev/null 2>&1 || fail "ADMIN_PUBKEY is not an SSH public key."
  [ "$(printf '%s\n' "$ADMIN_PUBKEY" | wc -l)" = 1 ] || fail "ADMIN_PUBKEY must be one key on one line."
  if ! admin_key_present; then
    install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "${admin_home}/.ssh"
    printf '%s\n' "$ADMIN_PUBKEY" >> "${admin_home}/.ssh/authorized_keys"
    chown "$ADMIN_USER:$ADMIN_USER" "${admin_home}/.ssh/authorized_keys"
    chmod 600 "${admin_home}/.ssh/authorized_keys"
  fi
fi

echo "== Docker"
mkdir -p /etc/docker
desired='{"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"10"},"live-restore":true}'
if [ "$(cat /etc/docker/daemon.json 2>/dev/null)" != "$desired" ]; then
  printf '%s\n' "$desired" > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null
docker compose version >/dev/null || fail "the docker compose plugin is not available."
# The old shared deploy user: being in the docker group is being root, and
# its key is held by both environments. It stays until both environments
# deploy through the wrapper, then this run takes it out.
if [ "$REMOVE_LEGACY" = 1 ]; then
  user="$DEPLOY_USER"
  gpasswd -d "${user}" docker >/dev/null 2>&1 || true
  # The old key was held by both environments. Whoever kept a copy must not
  # keep a way in. The first removal run leaves ADMIN_PUBKEY as the
  # administrator's only key; it must be the key this run signed in with
  # (hosting.md: the owner switches ADMIN_SSH_KEY and proves it with an
  # ordinary run first), so nobody is locked out. Later runs only make sure
  # ADMIN_PUBKEY is there. A separate old deploy user loses its keys.
  if [ ! -f "$LEGACY_MARKER" ]; then
    [ -n "$ADMIN_PUBKEY" ] || fail "removing the old access needs ADMIN_PUBKEY, a new administrator key (docs/runbooks/hosting.md)."
    admin_key_present || fail "ADMIN_PUBKEY is not installed yet; run Server setup once without removing the old access, switch ADMIN_SSH_KEY to the new key, then try again."
    tmp="$(mktemp)"
    printf '%s\n' "$ADMIN_PUBKEY" > "$tmp"
    install -m 600 -o "$ADMIN_USER" -g "$ADMIN_USER" "$tmp" "${admin_home}/.ssh/authorized_keys"
    rm -f "$tmp" "${admin_home}/.ssh/authorized_keys2"
    if [ "$DEPLOY_USER" != "$ADMIN_USER" ]; then
      legacy_home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
      rm -f "${legacy_home}/.ssh/authorized_keys" "${legacy_home}/.ssh/authorized_keys2"
    fi
    # Remembered at once, so a run that fails after this point cannot hand
    # the old access back on the next attempt.
    install -d -m 755 -o root -g root /etc/qbbe
    touch "$LEGACY_MARKER"
  fi
else
  usermod -aG docker "$DEPLOY_USER"
fi

echo "== Deploy users"
# Their keys live in root-owned files outside their homes: a key file in a
# folder the user owns could be swapped for a link to a system file that
# this script, running as root, would then overwrite.
install -d -m 755 -o root -g root /etc/ssh/authorized_keys
for environment in staging production; do
  user="qbbe-${environment}"
  # /bin/sh: sshd runs the forced command through the login shell, and bash
  # would first run the user's own ~/.bashrc. dash reads no startup file.
  id "$user" >/dev/null 2>&1 || useradd --create-home --shell /bin/sh "qbbe-${environment}"
  usermod --shell /bin/sh "$user"
  # Never in the docker group, whatever happened before.
  gpasswd -d "${user}" docker >/dev/null 2>&1 || true
  key_var="${environment^^}_DEPLOY_PUBKEY"
  key="${!key_var:-}"
  if [ -n "$key" ]; then
    printf '%s\n' "$key" | ssh-keygen -lf - >/dev/null 2>&1 || fail "${key_var} is not an SSH public key."
    [ "$(printf '%s\n' "$key" | wc -l)" = 1 ] || fail "${key_var} must be one key on one line."
    tmp="$(mktemp)"
    printf 'restrict %s\n' "$key" > "$tmp"
    install -m 644 -o root -g root "$tmp" "/etc/ssh/authorized_keys/${user}"
    rm -f "$tmp"
  fi
done

echo "== SSH for the deploy users"
install -m 755 -o root -g root "${SRC}/qbbe-ssh-gate" /usr/local/sbin/qbbe-ssh-gate
# Whatever they ask for, sshd runs the gate, which allows only the release
# wrapper: no shell on the host (from which either app's container is
# reachable directly), no forwarding, no terminal.
sshd_conf=/etc/ssh/sshd_config.d/50-qbbe-deploy.conf
cat > "${sshd_conf}.new" <<'CONF'
# Written by setup.sh (docs/runbooks/hosting.md, "Deploy access").
Match User qbbe-staging,qbbe-production
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    ForceCommand /usr/local/sbin/qbbe-ssh-gate
    AllowTcpForwarding no
    AllowStreamLocalForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
    PermitTunnel no
Match all
CONF
mv "${sshd_conf}.new" "$sshd_conf"
chmod 644 "$sshd_conf"
if ! sshd -t; then
  rm -f "$sshd_conf"
  fail "the SSH settings for the deploy users do not parse; removed them."
fi
systemctl reload ssh 2>/dev/null || systemctl reload sshd

echo "== Release wrapper"
install -m 755 -o root -g root "${SRC}/qbbe-release" /usr/local/sbin/qbbe-release
# sudo ignores files in sudoers.d whose name has a dot, so the new rules are
# checked before they replace the old ones.
install -m 440 -o root -g root "${SRC}/sudoers.qbbe" /etc/sudoers.d/qbbe.new
visudo -cf /etc/sudoers.d/qbbe.new >/dev/null || { rm -f /etc/sudoers.d/qbbe.new; fail "sudoers.qbbe does not parse."; }
mv /etc/sudoers.d/qbbe.new /etc/sudoers.d/qbbe

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
# The release files the wrapper uses: the server's own copies, root-owned.
install -d -m 755 -o root -g root "${ROOT}/bin"
install -m 644 -o root -g root "${SRC}/release.sh" "${SRC}/compose.app.yaml" "${SRC}/site.caddy.template" "${ROOT}/bin/"
# The only repository the wrapper releases images from.
printf '%s\n' "$IMAGE_REPOSITORY" > "${ROOT}/bin/image-repository.new"
install -m 644 -o root -g root "${ROOT}/bin/image-repository.new" "${ROOT}/bin/image-repository"
rm -f "${ROOT}/bin/image-repository.new"
if [ "$REMOVE_LEGACY" = 1 ]; then
  owner=root
  for environment in staging production; do
    install -d -m 700 -o root -g root "${ROOT}/${environment}"
    chown -R root:root "${ROOT}/${environment}"
  done
else
  owner="$DEPLOY_USER"
  install -d -m 700 -o "$owner" -g "$owner" "${ROOT}/staging" "${ROOT}/production"
fi
install -d -m 755 -o "$owner" -g "$owner" "$ROOT" "${ROOT}/base" "${ROOT}/base/sites"
[ "$owner" = root ] && chown -R root:root "${ROOT}/base"
install -m 644 -o "$owner" -g "$owner" "${SRC}/compose.base.yaml" "${ROOT}/base/"
{
  printf '{\n\temail %s\n}\n\n' "$ACME_EMAIL"
  cat "${SRC}/Caddyfile"
} > "${ROOT}/base/Caddyfile"
chown "$owner:$owner" "${ROOT}/base/Caddyfile"
# Pull first: the images are pinned by digest, so this takes exactly the
# versions in compose.base.yaml (a merged Dependabot update included).
docker compose -p qbbe-base -f "${ROOT}/base/compose.base.yaml" pull --quiet
docker compose -p qbbe-base -f "${ROOT}/base/compose.base.yaml" up -d --remove-orphans
# A changed Caddyfile is read on reload; an unchanged one makes this a no-op.
docker exec qbbe-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true

echo "== Done"
docker compose -p qbbe-base -f "${ROOT}/base/compose.base.yaml" ps --format 'table {{.Name}}\t{{.Status}}'
echo "ClamAV downloads its signatures on first start (a few minutes) before it answers."
