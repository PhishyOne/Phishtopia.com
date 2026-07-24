#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || { echo "controller relay install requires root" >&2; exit 1; }
[ "$#" -eq 2 ] || { echo "usage: install-controller-relay-only.sh COMMIT_SHA PACKAGE_SHA256" >&2; exit 2; }

release=$1
package_digest=$2
case "$release" in *[!0-9a-f]*|'') exit 2 ;; esac
case "$package_digest" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#release}" -eq 40 ] && [ "${#package_digest}" -eq 64 ] || exit 2

exec 9>/run/phishtopia-ops-controller-install.lock
/usr/bin/flock 9

source_root=/var/lib/phishtopia-ops-controller-source
source_dir="$source_root/$release"
input_archive=/var/lib/phishtopia-ops-controller-input/$release.tar.gz
release_root=/opt/phishtopia-ops-controller-releases
candidate="$release_root/$release"
current=/opt/phishtopia-ops-controller
state=/var/lib/phishtopia-ops-controller-install-active
last_good=/var/lib/phishtopia-ops-controller-last-good
unit=/etc/systemd/system/phishtopia-ops-controller.service
env_file=/etc/phishtopia-ops-controller.env
rollback_helper=/usr/local/sbin/phishtopia-ops-controller-rollback-last-good
worker_socket=/run/phishtopia-ops-worker/worker.sock
mcp_current=/opt/phishtopia-ops-mcp
worker_unit=/etc/systemd/system/phishtopia-ops-worker.service
tunnel_unit=/etc/systemd/system/phishtopia-ops-mcp-tunnel.service
tunnel_launcher=/usr/local/libexec/phishtopia-ops-mcp-tunnel-launch

[ -d "$source_dir/controller" ] && [ -d "$source_dir/worker" ] || { echo "controller package source missing" >&2; exit 1; }
[ -f "$source_dir/systemd/phishtopia-ops-controller-standalone.service" ] || { echo "controller service source missing" >&2; exit 1; }
[ -f "$source_dir/scripts/rollback-controller-relay-only.sh" ] || { echo "controller rollback source missing" >&2; exit 1; }
[ -f "$input_archive" ] || { echo "controller package archive missing" >&2; exit 1; }
[ "$(sha256sum "$input_archive" | cut -d' ' -f1)" = "$package_digest" ] || { echo "controller package digest mismatch" >&2; exit 1; }
[ ! -e "$state" ] && [ ! -e "$last_good" ] || { echo "controller install transaction or rollback baseline exists" >&2; exit 1; }
[ ! -e "$candidate" ] || { echo "controller release already exists" >&2; exit 1; }
[ -d "$mcp_current" ] && [ -f "$worker_unit" ] && [ -f "$tunnel_unit" ] && [ -x "$tunnel_launcher" ] || { echo "existing Ops baseline missing" >&2; exit 1; }
systemctl is-active --quiet phishtopia-ops-worker.service
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
[ "$(stat -c '%U:%G:%a' "$worker_socket")" = "root:phishtopia-mcp:660" ] || { echo "worker socket contract mismatch" >&2; exit 1; }

mcp_target_before=$(readlink -f "$mcp_current")
worker_unit_before=$(sha256sum "$worker_unit" | cut -d' ' -f1)
tunnel_unit_before=$(sha256sum "$tunnel_unit" | cut -d' ' -f1)
tunnel_launcher_before=$(sha256sum "$tunnel_launcher" | cut -d' ' -f1)

rollback() {
  rollback_status=$1
  [ "$rollback_status" -ne 0 ] || rollback_status=1
  trap - EXIT HUP INT TERM
  set +e
  systemctl stop phishtopia-ops-controller.service 2>/dev/null || true
  rm -f "$unit" "$env_file" "$current"
  if [ -d "$state" ]; then
    if [ -f "$state/unit.present" ]; then cp -a "$state/controller.unit" "$unit"; fi
    if [ -f "$state/env.present" ]; then cp -a "$state/controller.env" "$env_file"; fi
    if [ -f "$state/current.symlink" ]; then ln -s "$(sed -n '1p' "$state/current.target")" "$current"; fi
    if [ -f "$state/rollback-helper.present" ]; then
      cp -a "$state/rollback.helper" "$rollback_helper"
    else
      rm -f "$rollback_helper"
    fi
    systemctl daemon-reload
    if [ "$(sed -n '1p' "$state/controller.enabled")" = enabled ] && [ -f "$unit" ]; then
      systemctl enable phishtopia-ops-controller.service >/dev/null 2>&1 || true
    else
      systemctl disable phishtopia-ops-controller.service >/dev/null 2>&1 || true
    fi
    if [ "$(sed -n '1p' "$state/controller.active")" = active ] && [ -f "$unit" ] && [ -f "$env_file" ]; then
      systemctl start phishtopia-ops-controller.service >/dev/null 2>&1 || true
    fi
    rm -rf "$state"
  fi
  rm -rf "$candidate"
  systemctl is-active --quiet phishtopia-ops-worker.service || true
  systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service || true
  /usr/bin/flock -u 9
  exit "$rollback_status"
}
trap 'rollback $?' EXIT
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM

install -d -o root -g root -m 0700 "$state"
printf '%s\n' "$release" >"$state/new-release"
printf '%s\n' "$mcp_target_before" >"$state/mcp-target"
printf '%s\n' "$worker_unit_before" >"$state/worker-unit.sha256"
printf '%s\n' "$tunnel_unit_before" >"$state/tunnel-unit.sha256"
printf '%s\n' "$tunnel_launcher_before" >"$state/tunnel-launcher.sha256"

if [ -f "$unit" ] && [ ! -L "$unit" ]; then
  touch "$state/unit.present"
  cp -a "$unit" "$state/controller.unit"
else
  touch "$state/unit.absent"
fi
if [ -f "$env_file" ] && [ ! -L "$env_file" ]; then
  touch "$state/env.present"
  cp -a "$env_file" "$state/controller.env"
else
  touch "$state/env.absent"
fi
if [ -L "$current" ]; then
  touch "$state/current.symlink"
  readlink "$current" >"$state/current.target"
elif [ -e "$current" ]; then
  echo "unsupported existing controller path" >&2
  exit 1
else
  touch "$state/current.absent"
fi
if [ -f "$rollback_helper" ] && [ ! -L "$rollback_helper" ]; then
  touch "$state/rollback-helper.present"
  cp -a "$rollback_helper" "$state/rollback.helper"
else
  touch "$state/rollback-helper.absent"
fi
if [ -f "$unit" ] && [ -f "$env_file" ]; then
  systemctl is-enabled phishtopia-ops-controller.service >"$state/controller.enabled" 2>/dev/null || printf '%s\n' disabled >"$state/controller.enabled"
  systemctl is-active phishtopia-ops-controller.service >"$state/controller.active" 2>/dev/null || printf '%s\n' inactive >"$state/controller.active"
else
  printf '%s\n' disabled >"$state/controller.enabled"
  printf '%s\n' inactive >"$state/controller.active"
fi
find "$state" -maxdepth 1 -type f -exec chmod 0600 {} +
sync -f "$state"

install -d -o root -g root -m 0755 "$release_root" "$candidate"
cp -a "$source_dir/controller" "$candidate/controller"
cp -a "$source_dir/worker" "$candidate/worker"
chown -R root:root "$candidate"
find "$candidate" -type d -exec chmod 0755 {} +
find "$candidate" -type f -exec chmod 0644 {} +

/usr/bin/systemd-run --wait --collect --quiet --pipe --uid=phishtopia-mcp \
  --unit=phishtopia-ops-controller-relay-only-tests \
  "--working-directory=$candidate" \
  --setenv=PYTHONPATH="$candidate" \
  --setenv=PYTHONDONTWRITEBYTECODE=1 \
  --property=PrivateNetwork=yes \
  --property=PrivateTmp=yes \
  --property=PrivateDevices=yes \
  --property=NoNewPrivileges=yes \
  --property=ProtectSystem=strict \
  --property=ProtectHome=yes \
  --property=RestrictAddressFamilies=AF_UNIX \
  --property=CapabilityBoundingSet= \
  --property=TasksMax=32 \
  --property=MemoryMax=128M \
  --property=RuntimeMaxSec=180 \
  -- /usr/bin/python3 -B -m unittest discover -s controller/test -p 'test_*.py' -v

systemctl stop phishtopia-ops-controller.service 2>/dev/null || true
systemctl disable phishtopia-ops-controller.service >/dev/null 2>&1 || true
install -o root -g root -m 0644 "$source_dir/systemd/phishtopia-ops-controller-standalone.service" "$unit"
env_next="$env_file.next"
rm -f "$env_next"
printf '%s\n' 'PHISHTOPIA_OPS_QUEUE_ISSUE=43' >"$env_next"
chown root:root "$env_next"
chmod 0600 "$env_next"
mv -f "$env_next" "$env_file"
rm -f "$current.next"
ln -s "$candidate" "$current.next"
mv -Tf "$current.next" "$current"

systemctl daemon-reload
systemctl reset-failed phishtopia-ops-controller.service 2>/dev/null || true
started_at=$(date -u '+%Y-%m-%d %H:%M:%S UTC')
systemctl enable --now phishtopia-ops-controller.service
systemctl is-active --quiet phishtopia-ops-controller.service
sleep 23
systemctl is-active --quiet phishtopia-ops-controller.service
if journalctl -u phishtopia-ops-controller.service --since "$started_at" --no-pager -o cat | grep -Fq 'controller_error='; then
  echo "controller relay transport verification failed" >&2
  exit 1
fi

[ "$(readlink -f "$current")" = "$candidate" ]
[ "$(stat -c '%U:%G:%a' "$unit")" = "root:root:644" ]
[ "$(stat -c '%U:%G:%a' "$env_file")" = "root:root:600" ]
[ "$(sed -n '1p' "$env_file")" = 'PHISHTOPIA_OPS_QUEUE_ISSUE=43' ]
[ "$(readlink -f "$mcp_current")" = "$mcp_target_before" ]
[ "$(sha256sum "$worker_unit" | cut -d' ' -f1)" = "$worker_unit_before" ]
[ "$(sha256sum "$tunnel_unit" | cut -d' ' -f1)" = "$tunnel_unit_before" ]
[ "$(sha256sum "$tunnel_launcher" | cut -d' ' -f1)" = "$tunnel_launcher_before" ]
systemctl is-active --quiet phishtopia-ops-worker.service
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
[ "$(stat -c '%U:%G:%a' "$worker_socket")" = "root:phishtopia-mcp:660" ]

install -o root -g root -m 0755 "$source_dir/scripts/rollback-controller-relay-only.sh" "$rollback_helper"
touch "$state/install-complete"
chmod 0600 "$state/install-complete"
sync -f "$state/install-complete"
mv "$state" "$last_good"
sync -f /var/lib

trap - EXIT HUP INT TERM
/usr/bin/flock -u 9
printf 'controller_relay_install=success\n'
printf 'controller_relay_release=%s\n' "$release"
printf 'controller_relay_rollback=%s\n' "$rollback_helper"
