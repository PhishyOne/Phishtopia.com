#!/bin/sh
set -eu

state=/var/lib/phishtopia-ops-bootstrap-active
last_good=/var/lib/phishtopia-ops-bootstrap-last-good
recovery_unit=/etc/systemd/system/phishtopia-ops-bootstrap-recover.service
[ "$(id -u)" -eq 0 ] || { echo "bootstrap finalization requires root" >&2; exit 1; }
exec 9>/run/phishtopia-ops-bootstrap.lock
/usr/bin/flock 9
[ -d "$state" ] || { echo "no staged bootstrap transaction" >&2; exit 1; }
[ ! -e "$last_good" ] || { echo "retained rollback baseline already exists" >&2; exit 1; }
[ -f "$state/installer-complete" ] || { echo "installer transaction incomplete" >&2; exit 1; }
systemctl is-active --quiet phishtopia-ops-worker.service
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
/usr/bin/setpriv --reuid=phishtopia-mcp --regid=phishtopia-mcp --init-groups \
  --no-new-privs -- /opt/phishtopia-ops-runtime/node/bin/node \
  /opt/phishtopia-ops-mcp/dist/smoke/worker-contract-smoke.js
[ "$(sed -n '1p' "$state/tunnel-config.sha256")" = "$(sha256sum /etc/phishtopia-ops-mcp/tunnel.yaml | cut -d' ' -f1)" ]
[ "$(sed -n '1p' "$state/tunnel-credential.sha256")" = "$(sha256sum /etc/credstore/phishtopia-ops-mcp/control-plane-api-key | cut -d' ' -f1)" ]
[ "$(sed -n '1p' "$state/tunnel-launcher.sha256")" = "$(sha256sum /usr/local/libexec/phishtopia-ops-mcp-tunnel-launch | cut -d' ' -f1)" ]
systemctl stop phishtopia-ops-bootstrap-verify-watchdog.timer 2>/dev/null || true
mv "$state" "$last_good"
sync -f /var/lib
systemctl disable phishtopia-ops-bootstrap-recover.service 2>/dev/null || true
rm -f "$recovery_unit"
systemctl daemon-reload
echo "ops_bootstrap_status=committed"
echo "ops_bootstrap_rollback=retained_last_known_good"
