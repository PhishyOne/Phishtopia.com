#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || { echo "controller rollback requires root" >&2; exit 1; }
[ "$#" -eq 0 ] || { echo "usage: phishtopia-ops-controller-rollback-last-good" >&2; exit 2; }

exec 9>/run/phishtopia-ops-controller-install.lock
/usr/bin/flock 9

state=/var/lib/phishtopia-ops-controller-last-good
current=/opt/phishtopia-ops-controller
unit=/etc/systemd/system/phishtopia-ops-controller.service
env_file=/etc/phishtopia-ops-controller.env
rollback_helper=/usr/local/sbin/phishtopia-ops-controller-rollback-last-good
mcp_current=/opt/phishtopia-ops-mcp
worker_unit=/etc/systemd/system/phishtopia-ops-worker.service
tunnel_unit=/etc/systemd/system/phishtopia-ops-mcp-tunnel.service
tunnel_launcher=/usr/local/libexec/phishtopia-ops-mcp-tunnel-launch
worker_socket=/run/phishtopia-ops-worker/worker.sock

[ -d "$state" ] && [ -f "$state/install-complete" ] || { echo "controller rollback baseline missing" >&2; exit 1; }
release=$(sed -n '1p' "$state/new-release")
case "$release" in *[!0-9a-f]*|'') exit 1 ;; esac
[ "${#release}" -eq 40 ] || exit 1
candidate="/opt/phishtopia-ops-controller-releases/$release"

systemctl stop phishtopia-ops-controller.service 2>/dev/null || true
systemctl disable phishtopia-ops-controller.service >/dev/null 2>&1 || true
rm -f "$unit" "$env_file" "$current"

if [ -f "$state/unit.present" ]; then cp -a "$state/controller.unit" "$unit"; fi
if [ -f "$state/env.present" ]; then cp -a "$state/controller.env" "$env_file"; fi
if [ -f "$state/current.symlink" ]; then ln -s "$(sed -n '1p' "$state/current.target")" "$current"; fi

systemctl daemon-reload
if [ "$(sed -n '1p' "$state/controller.enabled")" = enabled ] && [ -f "$unit" ]; then
  systemctl enable phishtopia-ops-controller.service >/dev/null
else
  systemctl disable phishtopia-ops-controller.service >/dev/null 2>&1 || true
fi
if [ "$(sed -n '1p' "$state/controller.active")" = active ] && [ -f "$unit" ] && [ -f "$env_file" ]; then
  systemctl start phishtopia-ops-controller.service
  systemctl is-active --quiet phishtopia-ops-controller.service
fi

[ "$(readlink -f "$mcp_current")" = "$(sed -n '1p' "$state/mcp-target")" ]
[ "$(sha256sum "$worker_unit" | cut -d' ' -f1)" = "$(sed -n '1p' "$state/worker-unit.sha256")" ]
[ "$(sha256sum "$tunnel_unit" | cut -d' ' -f1)" = "$(sed -n '1p' "$state/tunnel-unit.sha256")" ]
[ "$(sha256sum "$tunnel_launcher" | cut -d' ' -f1)" = "$(sed -n '1p' "$state/tunnel-launcher.sha256")" ]
systemctl is-active --quiet phishtopia-ops-worker.service
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
[ "$(stat -c '%U:%G:%a' "$worker_socket")" = "root:phishtopia-mcp:660" ]

rm -rf "$candidate"
if [ -f "$state/rollback-helper.present" ]; then
  helper_next="$rollback_helper.next"
  cp -a "$state/rollback.helper" "$helper_next"
  mv -f "$helper_next" "$rollback_helper"
else
  rm -f "$rollback_helper"
fi
rm -rf "$state"
sync -f /var/lib
/usr/bin/flock -u 9
printf 'controller_relay_rollback=success\n'
printf 'controller_relay_removed_release=%s\n' "$release"
