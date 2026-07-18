#!/bin/sh
set -eu

state=/var/lib/phishtopia-ops-bootstrap-active
preparing=/var/lib/phishtopia-ops-bootstrap-preparing
current=/opt/phishtopia-ops-mcp
worker=/usr/local/lib/phishtopia-ops-worker
worker_unit=/etc/systemd/system/phishtopia-ops-worker.service
tunnel_unit=/etc/systemd/system/phishtopia-ops-mcp-tunnel.service
tunnel_launcher=/usr/local/libexec/phishtopia-ops-mcp-tunnel-launch
manifest=/var/lib/phishtopia-ops-worker/releases.json
recovery_unit=/etc/systemd/system/phishtopia-ops-bootstrap-recover.service
recovery_helper=/usr/local/libexec/phishtopia-ops-bootstrap-recover
rollback_helper=/usr/local/sbin/phishtopia-ops-rollback-last-good
worker_state=/var/lib/phishtopia-ops-worker
last_good=/var/lib/phishtopia-ops-bootstrap-last-good

[ "$(id -u)" -eq 0 ] || { echo "bootstrap recovery requires root" >&2; exit 1; }
exec 9>/run/phishtopia-ops-bootstrap.lock
/usr/bin/flock 9

for unit in phishtopia-ops-bootstrap-npm phishtopia-ops-bootstrap-test-1 \
  phishtopia-ops-bootstrap-test-2 phishtopia-ops-bootstrap-test-3 \
  phishtopia-ops-bootstrap-test-4 phishtopia-ops-bootstrap-test-5 \
  phishtopia-ops-bootstrap-test-6 phishtopia-ops-bootstrap-test-7; do
  systemctl stop "$unit.service" 2>/dev/null || true
done

if [ ! -d "$state" ]; then
  [ ! -d "$last_good" ] || exit 0
  if [ -d "$preparing" ]; then
    rm -rf "$preparing"
    sync -f /var/lib
  fi
  systemctl disable phishtopia-ops-bootstrap-recover.service 2>/dev/null || true
  rm -f "$recovery_unit" "$recovery_helper" "$rollback_helper"
  systemctl daemon-reload
  exit 0
fi

systemctl stop phishtopia-ops-worker.service phishtopia-ops-mcp-tunnel.service 2>/dev/null || true

if [ -f "$state/worker-dir.present" ] && [ -d "$state/worker.old" ]; then
  rm -rf "$worker"
  mv "$state/worker.old" "$worker"
elif [ -f "$state/worker-dir.absent" ]; then
  rm -rf "$worker"
fi

if [ -f "$state/current.symlink" ]; then
  rm -rf "$current"
  cp -a "$state/current.link" "$current"
elif [ -f "$state/current.legacy" ] && [ -d "$state/current.old" ]; then
  rm -rf "$current"
  mv "$state/current.old" "$current"
fi

if [ -f "$state/worker-unit.present" ]; then
  cp -a "$state/worker.unit" "$worker_unit"
else
  rm -f "$worker_unit"
fi
cp -a "$state/tunnel.unit" "$tunnel_unit"

if [ -f "$state/manifest.present" ]; then
  mkdir -p "$(dirname "$manifest")"
  cp -a "$state/releases.json" "$manifest"
else
  rm -f "$manifest"
fi

if [ -f "$state/worker-state.present" ] && [ -d "$state/worker-state.old" ]; then
  rm -rf "$worker_state"
  mv "$state/worker-state.old" "$worker_state"
elif [ -f "$state/worker-state.absent" ]; then
  rm -rf "$worker_state"
fi

if [ -f "$state/runtime.absent" ]; then
  rm -rf /opt/phishtopia-ops-runtime
fi

release=$(sed -n '1p' "$state/release")
case "$release" in
  *[!0-9a-f]*|'') exit 1 ;;
esac
[ "${#release}" -eq 40 ] || exit 1
rm -rf "/opt/phishtopia-ops-releases/$release"
rm -rf "/opt/phishtopia-ops-releases/.staging-$release"
rm -rf "/opt/phishtopia-ops-releases/.extract-$release"
if [ -f "$state/release-root.absent" ]; then
  rm -rf /opt/phishtopia-ops-releases
fi
if [ -f "$state/app-release-root.absent" ]; then
  rm -rf /opt/phishtopia-app-releases
fi
if [ -f "$state/app-log-root.absent" ]; then
  rm -rf /var/log/phishtopia
fi

systemctl daemon-reload
if [ "$(sed -n '1p' "$state/worker.enabled")" = enabled ]; then
  systemctl enable phishtopia-ops-worker.service
else
  systemctl disable phishtopia-ops-worker.service 2>/dev/null || true
fi
if [ "$(sed -n '1p' "$state/tunnel.enabled")" = enabled ]; then
  systemctl enable phishtopia-ops-mcp-tunnel.service
else
  systemctl disable phishtopia-ops-mcp-tunnel.service 2>/dev/null || true
fi
if [ "$(sed -n '1p' "$state/worker.active")" = active ] && [ -f "$worker_unit" ]; then
  systemctl start phishtopia-ops-worker.service
else
  systemctl stop phishtopia-ops-worker.service 2>/dev/null || true
fi
if [ "$(sed -n '1p' "$state/tunnel.active")" = active ]; then
  systemctl restart phishtopia-ops-mcp-tunnel.service
  systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
else
  systemctl stop phishtopia-ops-mcp-tunnel.service 2>/dev/null || true
fi

[ "$(sed -n '1p' "$state/tunnel-config.sha256")" = "$(sha256sum /etc/phishtopia-ops-mcp/tunnel.yaml | cut -d' ' -f1)" ]
[ "$(sed -n '1p' "$state/tunnel-credential.sha256")" = "$(sha256sum /etc/credstore/phishtopia-ops-mcp/control-plane-api-key | cut -d' ' -f1)" ]
[ "$(sed -n '1p' "$state/tunnel-launcher.sha256")" = "$(sha256sum "$tunnel_launcher" | cut -d' ' -f1)" ]

if [ -f "$state/build-user.absent" ]; then
  userdel phishtopia-build 2>/dev/null || true
  rm -rf /var/lib/phishtopia-build
fi

rm -rf "$state"
sync -f /var/lib
systemctl stop phishtopia-ops-bootstrap-verify-watchdog.timer 2>/dev/null || true
systemctl disable phishtopia-ops-bootstrap-recover.service 2>/dev/null || true
rm -f "$recovery_unit" "$recovery_helper" "$rollback_helper"
systemctl daemon-reload
