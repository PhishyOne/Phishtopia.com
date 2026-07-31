#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || {
  echo "worker bridge rollback requires root" >&2
  exit 1
}

state=/var/lib/phishtopia-ops-worker-sidecar-bridge-last-good
release_root=/opt/phishtopia-ops-worker-controller-releases
worker_current=/opt/phishtopia-ops-worker-code
worker_unit=/etc/systemd/system/phishtopia-ops-worker.service
worker_socket=/run/phishtopia-ops-worker/worker.sock
worker_state=/var/lib/phishtopia-ops-worker
release_manifest="$worker_state/releases.json"
rollback_helper=/usr/local/sbin/phishtopia-ops-worker-sidecar-bridge-rollback

[ -d "$state" ] || {
  echo "worker bridge rollback baseline missing" >&2
  exit 1
}
release=$(sed -n '1p' "$state/new-release")
case "$release" in *[!0-9a-f]*|'') exit 1 ;; esac
[ "${#release}" -eq 40 ] || exit 1
candidate="$release_root/$release"
[ -L "$worker_current" ] || {
  echo "worker bridge current pointer missing" >&2
  exit 1
}
previous_target=$(sed -n '1p' "$state/worker-current.target")
current_target=$(readlink -f "$worker_current")
if [ "$current_target" != "$candidate" ] &&
  [ "$current_target" != "$previous_target" ]; then
  echo "worker bridge release is no longer current" >&2
  exit 1
fi

exec 9>/run/phishtopia-ops-worker-controller-install.lock
/usr/bin/flock 9

/usr/bin/python3 - "$worker_state/jobs.sqlite3" <<'PY'
import pathlib
import sqlite3
import sys

database = pathlib.Path(sys.argv[1])
if not database.is_file():
    raise SystemExit("worker job database missing")
connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=5)
try:
    count = connection.execute(
        "SELECT COUNT(*) FROM jobs "
        "WHERE state IN ('queued','running','cancelling')"
    ).fetchone()[0]
finally:
    connection.close()
if count:
    print(f"worker_bridge_active_jobs={count}", file=sys.stderr)
    raise SystemExit(1)
PY

systemctl stop phishtopia-ops-worker.service
install -o root -g root -m 0644 "$state/worker.unit" "$worker_unit"
rm -f "$worker_current"
ln -s "$(sed -n '1p' "$state/worker-current.target")" "$worker_current"
if [ -f "$state/release-manifest.present" ]; then
  install -o root -g root -m 0600 "$state/releases.json" "$release_manifest"
else
  rm -f "$release_manifest"
fi

systemctl daemon-reload
systemctl start phishtopia-ops-worker.service

attempts=0
while [ "$attempts" -le 20 ]; do
  active=$(systemctl show phishtopia-ops-worker.service --property=ActiveState --value)
  sub=$(systemctl show phishtopia-ops-worker.service --property=SubState --value)
  restarts=$(systemctl show phishtopia-ops-worker.service --property=NRestarts --value)
  if [ "$active" = active ] &&
    [ "$sub" = running ] &&
    [ "$restarts" = 0 ] &&
    [ -S "$worker_socket" ]; then
    break
  fi
  if [ "$active" = failed ] ||
    [ "$active" = inactive ] ||
    [ "$sub" = auto-restart ] ||
    [ "$restarts" != 0 ]; then
    echo "worker bridge rollback service failed" >&2
    exit 1
  fi
  [ "$attempts" -lt 20 ] || {
    echo "worker bridge rollback socket timeout" >&2
    exit 1
  }
  attempts=$((attempts + 1))
  sleep 1
done
[ "$(stat -c '%U:%G:%a' "$worker_socket")" = "root:phishtopia-mcp:660" ]

/usr/bin/setpriv \
  --reuid=phishtopia-mcp \
  --regid=phishtopia-mcp \
  --init-groups \
  --no-new-privs \
  -- \
  /usr/bin/python3 -B - "$worker_socket" <<'PY'
import json
import socket
import sys

path = sys.argv[1]
request = json.dumps(
    {"operation": "get_contract", "payload": {}},
    separators=(",", ":"),
).encode() + b"\n"
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
    connection.settimeout(5)
    connection.connect(path)
    connection.sendall(request)
    response = b""
    while not response.endswith(b"\n"):
        chunk = connection.recv(4096)
        if not chunk:
            break
        response += chunk
value = json.loads(response)
expected = [
    "canary_and_promote",
    "deploy_verified_release",
    "restart_phishtopia_service",
    "rollback_release",
    "rotate_session_secret",
    "run_tested_migration",
    "update_dns_with_rollback",
    "upgrade_ops_release",
]
contract = {
    "ok": True,
    "contract": {
        "version": "issue15-v1",
        "actions": expected,
        "singleFlight": "production_mutation",
    },
}
if value != contract:
    raise SystemExit("worker bridge rollback contract rejected")
PY

systemctl is-active --quiet phishtopia-ops-controller.service
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
status=$(
  /usr/bin/curl \
    --proto '=https' \
    --tlsv1.2 \
    --fail \
    --silent \
    --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --connect-timeout 10 \
    --max-time 20 \
    https://phishtopia.com/health
)
[ "$status" = 200 ]

rm -rf "$candidate"
rm -rf "$state"
rm -f "$rollback_helper"
sync -f /var/lib
/usr/bin/flock -u 9
printf '%s\n' 'worker_sidecar_bridge_rollback=success'
