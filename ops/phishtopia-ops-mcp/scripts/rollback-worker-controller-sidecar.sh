#!/bin/sh
set -eu

state=/var/lib/phishtopia-ops-worker-controller-last-good
worker_unit=/etc/systemd/system/phishtopia-ops-worker.service
controller_unit=/etc/systemd/system/phishtopia-ops-controller.service
controller_env=/etc/phishtopia-ops-controller.env
worker_current=/opt/phishtopia-ops-worker-code
controller_current=/opt/phishtopia-ops-controller
rollback_helper=/usr/local/sbin/phishtopia-ops-worker-controller-rollback-last-good
worker_state=/var/lib/phishtopia-ops-worker

[ "$(id -u)" -eq 0 ] || { echo "worker/controller rollback requires root" >&2; exit 1; }
[ -d "$state" ] || { echo "worker/controller rollback baseline missing" >&2; exit 1; }
exec 9>/run/phishtopia-ops-worker-controller-install.lock
/usr/bin/flock 9

systemctl stop phishtopia-ops-controller.service phishtopia-ops-worker.service 2>/dev/null || true
systemctl disable phishtopia-ops-controller.service phishtopia-ops-worker.service >/dev/null 2>&1 || true
rm -f "$worker_unit" "$controller_unit" "$controller_env" "$worker_current" "$controller_current"

if [ -f "$state/worker-unit.present" ]; then cp -a "$state/worker.unit" "$worker_unit"; fi
if [ -f "$state/controller-unit.present" ]; then cp -a "$state/controller.unit" "$controller_unit"; fi
if [ -f "$state/controller-env.present" ]; then cp -a "$state/controller.env" "$controller_env"; fi
if [ -f "$state/worker-current.present" ]; then ln -s "$(sed -n '1p' "$state/worker-current.target")" "$worker_current"; fi
if [ -f "$state/controller-current.present" ]; then ln -s "$(sed -n '1p' "$state/controller-current.target")" "$controller_current"; fi

systemctl daemon-reload
if [ -f "$worker_unit" ] && [ "$(sed -n '1p' "$state/worker.enabled")" = enabled ]; then systemctl enable phishtopia-ops-worker.service >/dev/null; fi
if [ -f "$controller_unit" ] && [ "$(sed -n '1p' "$state/controller.enabled")" = enabled ]; then systemctl enable phishtopia-ops-controller.service >/dev/null; fi
if [ -f "$worker_unit" ] && [ "$(sed -n '1p' "$state/worker.active")" = active ]; then systemctl start phishtopia-ops-worker.service; fi
if [ -f "$controller_unit" ] && [ -f "$controller_env" ] && [ "$(sed -n '1p' "$state/controller.active")" = active ]; then systemctl start phishtopia-ops-controller.service; fi

release=$(sed -n '1p' "$state/new-release")
case "$release" in *[!0-9a-f]*|'') exit 1 ;; esac
[ "${#release}" -eq 40 ] || exit 1
rm -rf "/opt/phishtopia-ops-worker-controller-releases/$release"
if [ -f "$state/worker-state.absent" ]; then rm -rf "$worker_state"; fi
rm -rf "$state"
rm -f "$rollback_helper"
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
/usr/bin/flock -u 9
printf 'worker_controller_rollback=success\n'
