#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || {
  echo "worker bridge install requires root" >&2
  exit 1
}
[ "$#" -eq 3 ] || {
  echo "usage: install-worker-sidecar-bridge.sh COMMIT_SHA PACKAGE_SHA256 REPOSITORY_ARCHIVE_SHA256" >&2
  exit 2
}
release=$1
package_digest=$2
repository_digest=$3
case "$release" in *[!0-9a-f]*|'') exit 2 ;; esac
case "$package_digest" in *[!0-9a-f]*|'') exit 2 ;; esac
case "$repository_digest" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#release}" -eq 40 ] || exit 2
[ "${#package_digest}" -eq 64 ] || exit 2
[ "${#repository_digest}" -eq 64 ] || exit 2

exec 9>/run/phishtopia-ops-worker-controller-install.lock
/usr/bin/flock 9

stage=preflight
source_dir="/var/lib/phishtopia-ops-worker-bridge-source/$release/ops"
input_archive="/var/lib/phishtopia-ops-worker-bridge-input/$release.tar.gz"
release_root=/opt/phishtopia-ops-worker-controller-releases
candidate="$release_root/$release"
worker_current=/opt/phishtopia-ops-worker-code
worker_unit=/etc/systemd/system/phishtopia-ops-worker.service
worker_socket=/run/phishtopia-ops-worker/worker.sock
worker_state=/var/lib/phishtopia-ops-worker
release_manifest="$worker_state/releases.json"
reexec_flag="$worker_state/worker-reexec-requested"
controller_unit=/etc/systemd/system/phishtopia-ops-controller.service
controller_current=/opt/phishtopia-ops-controller
mcp_current=/opt/phishtopia-ops-mcp
tunnel_unit=/etc/systemd/system/phishtopia-ops-mcp-tunnel.service
tunnel_launcher=/usr/local/libexec/phishtopia-ops-mcp-tunnel-launch
state=/var/lib/phishtopia-ops-worker-sidecar-bridge-active
state_next=/var/lib/phishtopia-ops-worker-sidecar-bridge-active.next
last_good=/var/lib/phishtopia-ops-worker-sidecar-bridge-last-good
rollback_helper=/usr/local/sbin/phishtopia-ops-worker-sidecar-bridge-rollback

service_property() {
  value=$(/usr/bin/systemctl show "$1" "--property=$2" --value 2>/dev/null || true)
  value=$(printf '%s' "$value" | tr -cd 'A-Za-z0-9_.:-' | cut -c1-128)
  [ -n "$value" ] || value=unknown
  printf '%s' "$value"
}

public_health() {
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
}

assert_no_active_jobs() {
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
}

wait_for_worker_socket() {
  expected_invocation=$1
  attempts=0
  while [ "$attempts" -le 20 ]; do
    if [ "$expected_invocation" = unknown ]; then
      expected_invocation=$(
        service_property phishtopia-ops-worker.service InvocationID
      )
    fi
    active=$(service_property phishtopia-ops-worker.service ActiveState)
    sub=$(service_property phishtopia-ops-worker.service SubState)
    restarts=$(service_property phishtopia-ops-worker.service NRestarts)
    invocation=$(service_property phishtopia-ops-worker.service InvocationID)
    if [ "$active" = active ] &&
      [ "$sub" = running ] &&
      [ "$restarts" = 0 ] &&
      [ "$invocation" = "$expected_invocation" ] &&
      [ -S "$worker_socket" ]; then
      [ "$(stat -c '%U:%G:%a' "$worker_socket")" = "root:phishtopia-mcp:660" ]
      return
    fi
    if [ "$active" = failed ] ||
      [ "$active" = inactive ] ||
      [ "$sub" = auto-restart ] ||
      [ "$restarts" != 0 ]; then
      return 1
    fi
    [ "$attempts" -lt 20 ] || break
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

verify_worker_contract() {
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
    raise SystemExit("worker contract rejected")
PY
}

nginx_sandbox_test() {
  if ! /usr/bin/systemd-run \
    --wait \
    --collect \
    --quiet \
    --pipe \
    --unit=phishtopia-ops-worker-bridge-nginx-test \
    --uid=root \
    --working-directory=/opt/phishtopia-ops-worker-code \
    --setenv=PYTHONDONTWRITEBYTECODE=1 \
    --property=PrivateTmp=yes \
    --property=PrivateDevices=yes \
    --property=NoNewPrivileges=yes \
    --property=ProtectSystem=strict \
    --property=ProtectHome=read-only \
    --property=ProtectClock=yes \
    --property=ProtectHostname=yes \
    --property=ProtectKernelTunables=yes \
    --property=ProtectKernelModules=yes \
    --property=ProtectKernelLogs=yes \
    --property=ProtectControlGroups=yes \
    --property=ProtectProc=invisible \
    --property='ReadWritePaths=/var/lib/phishtopia-ops-worker /run/phishtopia-ops-worker -/var/log/phishtopia -/var/log/nginx /opt /home/codespace' \
    --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK' \
    --property=RestrictNamespaces=yes \
    --property=RestrictRealtime=yes \
    --property=LockPersonality=yes \
    --property='CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER CAP_SETGID CAP_SETUID' \
    --property=RemoveIPC=yes \
    --property='SystemCallFilter=@system-service @resources' \
    --property=TasksMax=160 \
    --property=MemoryMax=720M \
    --property=RuntimeMaxSec=30 \
    -- /usr/sbin/nginx -t >/dev/null 2>&1; then
    printf '%s\n' 'worker_bridge_nginx_sandbox=failed' >&2
    return 1
  fi
}

restore_snapshot() {
  rollback_ok=1
  systemctl stop phishtopia-ops-worker.service >/dev/null 2>&1 || rollback_ok=0
  rm -f "$worker_unit.next" "$worker_current.next"
  if ! install -o root -g root -m 0644 "$state/worker.unit" "$worker_unit"; then
    rollback_ok=0
  fi
  rm -f "$worker_current"
  if ! ln -s "$(sed -n '1p' "$state/worker-current.target")" "$worker_current"; then
    rollback_ok=0
  fi
  if [ -f "$state/release-manifest.present" ]; then
    if ! install -o root -g root -m 0600 "$state/releases.json" "$release_manifest"; then
      rollback_ok=0
    fi
  else
    rm -f "$release_manifest"
  fi
  systemctl daemon-reload || rollback_ok=0
  if [ "$(sed -n '1p' "$state/worker.active")" = active ]; then
    systemctl start phishtopia-ops-worker.service || rollback_ok=0
    invocation=$(service_property phishtopia-ops-worker.service InvocationID)
    wait_for_worker_socket "$invocation" || rollback_ok=0
    verify_worker_contract || rollback_ok=0
  fi
  systemctl is-active --quiet phishtopia-ops-controller.service || rollback_ok=0
  systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service || rollback_ok=0
  public_health || rollback_ok=0
  [ "$rollback_ok" -eq 1 ]
}

rollback() {
  rollback_status=$1
  [ "$rollback_status" -ne 0 ] || rollback_status=1
  trap - EXIT HUP INT TERM
  set +e
  printf 'worker_bridge_failed_stage=%s\n' "$stage" >&2
  if restore_snapshot; then
    rm -rf "$candidate"
    rm -rf "$state"
    rm -f "$rollback_helper"
    printf '%s\n' 'worker_bridge_rollback=success' >&2
  else
    printf '%s\n' 'worker_bridge_rollback=failed' >&2
    printf '%s\n' 'worker_bridge_recovery_state=preserved' >&2
  fi
  /usr/bin/flock -u 9
  exit "$rollback_status"
}

[ -d "$source_dir/worker" ] || {
  echo "worker bridge source missing" >&2
  exit 1
}
[ -f "$source_dir/package-lock.json" ] || {
  echo "worker bridge package lock missing" >&2
  exit 1
}
[ -f "$source_dir/systemd/phishtopia-ops-worker-standalone.service" ] || {
  echo "worker bridge unit missing" >&2
  exit 1
}
[ -f "$source_dir/scripts/rollback-worker-sidecar-bridge.sh" ] || {
  echo "worker bridge rollback helper missing" >&2
  exit 1
}
[ -f "$input_archive" ] || {
  echo "worker bridge package archive missing" >&2
  exit 1
}
[ "$(sha256sum "$input_archive" | cut -d' ' -f1)" = "$package_digest" ] || {
  echo "worker bridge package digest mismatch" >&2
  exit 1
}
[ ! -e "$state" ] && [ ! -e "$state_next" ] && [ ! -e "$last_good" ] || {
  echo "worker bridge transaction or rollback baseline exists" >&2
  exit 1
}
[ ! -e "$candidate" ] && [ ! -L "$candidate" ] || {
  echo "worker bridge release already exists" >&2
  exit 1
}
[ -d "$release_root" ] && [ ! -L "$release_root" ] || {
  echo "worker bridge release root rejected" >&2
  exit 1
}
[ ! -e "$worker_unit.next" ] && [ ! -L "$worker_unit.next" ] || {
  echo "worker bridge unit temporary exists" >&2
  exit 1
}
[ ! -e "$worker_current.next" ] && [ ! -L "$worker_current.next" ] || {
  echo "worker bridge pointer temporary exists" >&2
  exit 1
}
[ -L "$worker_current" ] && [ -d "$worker_current" ] || {
  echo "existing worker pointer missing" >&2
  exit 1
}
previous_target=$(readlink -f "$worker_current")
case "$previous_target" in
  "$release_root"/*) ;;
  *) echo "existing worker pointer rejected" >&2; exit 1 ;;
esac
[ -f "$worker_unit" ] && [ ! -L "$worker_unit" ] || {
  echo "existing worker unit rejected" >&2
  exit 1
}
[ -L "$controller_current" ] && [ -f "$controller_unit" ] || {
  echo "existing controller baseline missing" >&2
  exit 1
}
[ -d "$mcp_current" ] && [ -f "$tunnel_unit" ] && [ -x "$tunnel_launcher" ] || {
  echo "existing tunnel baseline missing" >&2
  exit 1
}
[ ! -e "$reexec_flag" ] || {
  echo "worker reexec already pending" >&2
  exit 1
}
[ ! -L "$release_manifest" ] || {
  echo "worker release manifest rejected" >&2
  exit 1
}
systemctl is-active --quiet phishtopia-ops-worker.service
systemctl is-active --quiet phishtopia-ops-controller.service
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
[ "$(stat -c '%U:%G:%a' "$worker_socket")" = "root:phishtopia-mcp:660" ]
assert_no_active_jobs
verify_worker_contract
public_health

python3 - \
  "$worker_unit" \
  "$source_dir/systemd/phishtopia-ops-worker-standalone.service" <<'PY'
import pathlib
import sys

installed = pathlib.Path(sys.argv[1]).read_bytes()
candidate = pathlib.Path(sys.argv[2]).read_bytes()
allowance = b" -/var/log/nginx"
if (
    installed.count(allowance) != 0
    or candidate.count(allowance) != 1
    or candidate.replace(allowance, b"", 1) != installed
):
    raise SystemExit("worker bridge unit delta rejected")
line = next(
    item for item in candidate.decode().splitlines()
    if item.startswith("ReadWritePaths=")
)
if "/var/log" in line.split() or "-/var/log/nginx" not in line.split():
    raise SystemExit("worker bridge write-path scope rejected")
PY
/usr/bin/systemd-analyze verify \
  "$source_dir/systemd/phishtopia-ops-worker-standalone.service" >/dev/null
nginx_sandbox_test

controller_invocation=$(service_property phishtopia-ops-controller.service InvocationID)
controller_restarts=$(service_property phishtopia-ops-controller.service NRestarts)
tunnel_invocation=$(service_property phishtopia-ops-mcp-tunnel.service InvocationID)
tunnel_restarts=$(service_property phishtopia-ops-mcp-tunnel.service NRestarts)
mcp_target=$(readlink -f "$mcp_current")
tunnel_unit_digest=$(sha256sum "$tunnel_unit" | cut -d' ' -f1)
tunnel_launcher_digest=$(sha256sum "$tunnel_launcher" | cut -d' ' -f1)

stage=snapshot
install -d -o root -g root -m 0700 "$state_next"
printf '%s\n' "$release" >"$state_next/new-release"
printf '%s\n' "$repository_digest" >"$state_next/repository-archive.sha256"
printf '%s\n' "$package_digest" >"$state_next/package.sha256"
printf '%s\n' "$previous_target" >"$state_next/worker-current.target"
cp -a "$worker_unit" "$state_next/worker.unit"
if [ -f "$release_manifest" ] && [ ! -L "$release_manifest" ]; then
  touch "$state_next/release-manifest.present"
  cp -a "$release_manifest" "$state_next/releases.json"
else
  touch "$state_next/release-manifest.absent"
fi
systemctl is-enabled phishtopia-ops-worker.service >"$state_next/worker.enabled" 2>/dev/null ||
  printf '%s\n' disabled >"$state_next/worker.enabled"
systemctl is-active phishtopia-ops-worker.service >"$state_next/worker.active" 2>/dev/null ||
  printf '%s\n' inactive >"$state_next/worker.active"
find "$state_next" -maxdepth 1 -type f -exec chmod 0600 {} +
sync -f "$state_next"
mv "$state_next" "$state"

trap 'rollback $?' EXIT
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM

stage=stage_release
install -d -o root -g root -m 0755 "$release_root" "$candidate"
cp -a "$source_dir/." "$candidate/"
chown -R root:root "$candidate"
find "$candidate" -type d -exec chmod 0755 {} +
find "$candidate" -type f -exec chmod 0644 {} +

stage=controller_tests
/usr/bin/systemd-run \
  --wait \
  --collect \
  --quiet \
  --pipe \
  --uid=phishtopia-mcp \
  --unit=phishtopia-ops-worker-bridge-controller-tests \
  "--working-directory=$candidate" \
  --setenv=PYTHONPATH="$candidate" \
  --setenv=PYTHONDONTWRITEBYTECODE=1 \
  --setenv=HOME=/tmp \
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
  -- /usr/bin/python3 -B -m unittest discover \
  -s controller/test \
  -p 'test_*.py' \
  -v

stage=worker_tests
/usr/bin/systemd-run \
  --wait \
  --collect \
  --quiet \
  --pipe \
  --unit=phishtopia-ops-worker-bridge-worker-tests \
  "--working-directory=$candidate" \
  --setenv=PYTHONPATH="$candidate" \
  --setenv=PYTHONDONTWRITEBYTECODE=1 \
  --setenv=HOME=/tmp \
  --property=PrivateNetwork=yes \
  --property=PrivateTmp=yes \
  --property=PrivateDevices=yes \
  --property=NoNewPrivileges=yes \
  --property=ProtectSystem=strict \
  --property=ProtectHome=yes \
  --property=RestrictAddressFamilies=AF_UNIX \
  --property=CapabilityBoundingSet= \
  --property=TasksMax=64 \
  --property=MemoryMax=512M \
  --property=RuntimeMaxSec=420 \
  -- /usr/bin/python3 -B -m unittest discover \
  -s worker/test \
  -p 'test_*.py' \
  -v

stage=mutation_preflight
assert_no_active_jobs
systemctl is-active --quiet phishtopia-ops-controller.service
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
[ "$(service_property phishtopia-ops-controller.service InvocationID)" = "$controller_invocation" ]
[ "$(service_property phishtopia-ops-controller.service NRestarts)" = "$controller_restarts" ]
[ "$(service_property phishtopia-ops-mcp-tunnel.service InvocationID)" = "$tunnel_invocation" ]
[ "$(service_property phishtopia-ops-mcp-tunnel.service NRestarts)" = "$tunnel_restarts" ]
public_health

stage=install_worker
systemctl stop phishtopia-ops-worker.service
install -o root -g root -m 0644 \
  "$candidate/systemd/phishtopia-ops-worker-standalone.service" \
  "$worker_unit.next"
mv -f "$worker_unit.next" "$worker_unit"
ln -s "$candidate" "$worker_current.next"
mv -Tf "$worker_current.next" "$worker_current"
systemctl daemon-reload
systemctl reset-failed phishtopia-ops-worker.service 2>/dev/null || true
systemctl start phishtopia-ops-worker.service
worker_invocation=$(service_property phishtopia-ops-worker.service InvocationID)

stage=verify_worker
wait_for_worker_socket "$worker_invocation"
verify_worker_contract
[ "$(readlink -f "$worker_current")" = "$candidate" ]
cmp -s \
  "$candidate/systemd/phishtopia-ops-worker-standalone.service" \
  "$worker_unit"
nginx_sandbox_test
assert_no_active_jobs

stage=record_release
PYTHONPATH="$candidate" PYTHONDONTWRITEBYTECODE=1 \
  /usr/bin/python3 -B - "$release" "$repository_digest" <<'PY'
import sys

from worker.platform import RealPlatform

release = sys.argv[1]
digest = sys.argv[2]
platform = RealPlatform.__new__(RealPlatform)
manifest = platform._release_manifest()
if (
    set(manifest) != {"phishtopia_app", "phishtopia_ops"}
    or not isinstance(manifest["phishtopia_app"], dict)
    or not isinstance(manifest["phishtopia_ops"], dict)
):
    raise SystemExit("release manifest rejected")
manifest["phishtopia_ops"] = {}
platform._write_release_manifest(manifest)
platform._record_release("phishtopia_ops", release, digest)
PY

stage=final_verification
assert_no_active_jobs
[ "$(service_property phishtopia-ops-worker.service InvocationID)" = "$worker_invocation" ]
[ "$(service_property phishtopia-ops-worker.service NRestarts)" = 0 ]
[ "$(service_property phishtopia-ops-controller.service InvocationID)" = "$controller_invocation" ]
[ "$(service_property phishtopia-ops-controller.service NRestarts)" = "$controller_restarts" ]
[ "$(service_property phishtopia-ops-mcp-tunnel.service InvocationID)" = "$tunnel_invocation" ]
[ "$(service_property phishtopia-ops-mcp-tunnel.service NRestarts)" = "$tunnel_restarts" ]
[ "$(readlink -f "$mcp_current")" = "$mcp_target" ]
[ "$(sha256sum "$tunnel_unit" | cut -d' ' -f1)" = "$tunnel_unit_digest" ]
[ "$(sha256sum "$tunnel_launcher" | cut -d' ' -f1)" = "$tunnel_launcher_digest" ]
systemctl is-active --quiet phishtopia-ops-worker.service
systemctl is-active --quiet phishtopia-ops-controller.service
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
public_health

stage=commit
install -o root -g root -m 0755 \
  "$candidate/scripts/rollback-worker-sidecar-bridge.sh" \
  "$rollback_helper"
sync -f "$rollback_helper"
trap - EXIT HUP INT TERM
mv "$state" "$last_good"
sync -f /var/lib

/usr/bin/flock -u 9
printf '%s\n' 'worker_sidecar_bridge=success'
printf 'worker_sidecar_bridge_release=%s\n' "$release"
printf 'worker_sidecar_bridge_archive_sha256=%s\n' "$repository_digest"
printf 'worker_sidecar_bridge_rollback=%s\n' "$rollback_helper"
