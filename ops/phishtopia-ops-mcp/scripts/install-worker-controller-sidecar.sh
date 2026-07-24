#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || { echo "worker/controller install requires root" >&2; exit 1; }
[ "$#" -eq 2 ] || { echo "usage: install-worker-controller-sidecar.sh COMMIT_SHA PACKAGE_SHA256" >&2; exit 2; }
release=$1
package_digest=$2
case "$release" in *[!0-9a-f]*|'') exit 2 ;; esac
case "$package_digest" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#release}" -eq 40 ] && [ "${#package_digest}" -eq 64 ] || exit 2

exec 9>/run/phishtopia-ops-worker-controller-install.lock
/usr/bin/flock 9
stage=preflight

source_root=/var/lib/phishtopia-ops-worker-controller-source
source_dir="$source_root/$release"
input_archive=/var/lib/phishtopia-ops-worker-controller-input/$release.tar.gz
release_root=/opt/phishtopia-ops-worker-controller-releases
candidate="$release_root/$release"
worker_current=/opt/phishtopia-ops-worker-code
controller_current=/opt/phishtopia-ops-controller
state=/var/lib/phishtopia-ops-worker-controller-install-active
last_good=/var/lib/phishtopia-ops-worker-controller-last-good
worker_unit=/etc/systemd/system/phishtopia-ops-worker.service
controller_unit=/etc/systemd/system/phishtopia-ops-controller.service
controller_env=/etc/phishtopia-ops-controller.env
rollback_helper=/usr/local/sbin/phishtopia-ops-worker-controller-rollback-last-good
worker_socket=/run/phishtopia-ops-worker/worker.sock
worker_state=/var/lib/phishtopia-ops-worker
mcp_current=/opt/phishtopia-ops-mcp
tunnel_unit=/etc/systemd/system/phishtopia-ops-mcp-tunnel.service
tunnel_launcher=/usr/local/libexec/phishtopia-ops-mcp-tunnel-launch

[ -d "$source_dir/controller" ] && [ -d "$source_dir/worker" ] || { echo "worker/controller package source missing" >&2; exit 1; }
[ -f "$source_dir/systemd/phishtopia-ops-worker-standalone.service" ] || { echo "worker service source missing" >&2; exit 1; }
[ -f "$source_dir/systemd/phishtopia-ops-controller-standalone.service" ] || { echo "controller service source missing" >&2; exit 1; }
[ -f "$source_dir/scripts/rollback-worker-controller-sidecar.sh" ] || { echo "rollback source missing" >&2; exit 1; }
[ -f "$input_archive" ] || { echo "worker/controller package archive missing" >&2; exit 1; }
[ "$(sha256sum "$input_archive" | cut -d' ' -f1)" = "$package_digest" ] || { echo "worker/controller package digest mismatch" >&2; exit 1; }
[ ! -e "$state" ] && [ ! -e "$last_good" ] || { echo "worker/controller transaction or rollback baseline exists" >&2; exit 1; }
[ ! -e "$candidate" ] || { echo "worker/controller release already exists" >&2; exit 1; }
[ -d "$mcp_current" ] && [ -f "$tunnel_unit" ] && [ -x "$tunnel_launcher" ] || { echo "existing tunnel baseline missing" >&2; exit 1; }
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
[ ! -e "$worker_unit" ] && [ ! -L "$worker_unit" ] && [ ! -e /usr/local/lib/phishtopia-ops-worker ] && [ ! -L /usr/local/lib/phishtopia-ops-worker ] && [ ! -e "$worker_socket" ] || { echo "unexpected existing worker installation" >&2; exit 1; }
[ ! -e "$worker_current" ] && [ ! -L "$worker_current" ] && [ ! -e "$controller_current" ] && [ ! -L "$controller_current" ] || { echo "unexpected existing sidecar code path" >&2; exit 1; }
getent passwd phishtopia-mcp >/dev/null
getent group phishtopia-mcp >/dev/null

mcp_target_before=$(readlink -f "$mcp_current")
tunnel_unit_before=$(sha256sum "$tunnel_unit" | cut -d' ' -f1)
tunnel_launcher_before=$(sha256sum "$tunnel_launcher" | cut -d' ' -f1)

rollback() {
  rollback_status=$1
  [ "$rollback_status" -ne 0 ] || rollback_status=1
  trap - EXIT HUP INT TERM
  set +e
  echo "worker_controller_failed_stage=$stage" >&2
  systemctl stop phishtopia-ops-controller.service phishtopia-ops-worker.service 2>/dev/null || true
  systemctl disable phishtopia-ops-controller.service phishtopia-ops-worker.service >/dev/null 2>&1 || true
  rm -f "$worker_unit" "$controller_unit" "$controller_env" "$worker_current" "$controller_current"
  if [ -d "$state" ]; then
    if [ -f "$state/worker-unit.present" ]; then cp -a "$state/worker.unit" "$worker_unit"; fi
    if [ -f "$state/controller-unit.present" ]; then cp -a "$state/controller.unit" "$controller_unit"; fi
    if [ -f "$state/controller-env.present" ]; then cp -a "$state/controller.env" "$controller_env"; fi
    if [ -f "$state/worker-current.present" ]; then ln -s "$(sed -n '1p' "$state/worker-current.target")" "$worker_current"; fi
    if [ -f "$state/controller-current.present" ]; then ln -s "$(sed -n '1p' "$state/controller-current.target")" "$controller_current"; fi
    if [ -f "$state/rollback-helper.present" ]; then cp -a "$state/rollback.helper" "$rollback_helper"; else rm -f "$rollback_helper"; fi
    systemctl daemon-reload
    if [ -f "$worker_unit" ] && [ "$(sed -n '1p' "$state/worker.enabled")" = enabled ]; then systemctl enable phishtopia-ops-worker.service >/dev/null 2>&1 || true; fi
    if [ -f "$controller_unit" ] && [ "$(sed -n '1p' "$state/controller.enabled")" = enabled ]; then systemctl enable phishtopia-ops-controller.service >/dev/null 2>&1 || true; fi
    if [ -f "$worker_unit" ] && [ "$(sed -n '1p' "$state/worker.active")" = active ]; then systemctl start phishtopia-ops-worker.service >/dev/null 2>&1 || true; fi
    if [ -f "$controller_unit" ] && [ -f "$controller_env" ] && [ "$(sed -n '1p' "$state/controller.active")" = active ]; then systemctl start phishtopia-ops-controller.service >/dev/null 2>&1 || true; fi
    if [ -f "$state/worker-state.absent" ]; then rm -rf "$worker_state"; fi
    rm -rf "$state"
  fi
  rm -rf "$candidate"
  systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service || true
  /usr/bin/flock -u 9
  exit "$rollback_status"
}
trap 'rollback $?' EXIT
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM

stage=snapshot
install -d -o root -g root -m 0700 "$state"
printf '%s\n' "$release" >"$state/new-release"
printf '%s\n' "$mcp_target_before" >"$state/mcp-target"
printf '%s\n' "$tunnel_unit_before" >"$state/tunnel-unit.sha256"
printf '%s\n' "$tunnel_launcher_before" >"$state/tunnel-launcher.sha256"

if [ -f "$worker_unit" ] && [ ! -L "$worker_unit" ]; then touch "$state/worker-unit.present"; cp -a "$worker_unit" "$state/worker.unit"; else touch "$state/worker-unit.absent"; fi
if [ -f "$controller_unit" ] && [ ! -L "$controller_unit" ]; then touch "$state/controller-unit.present"; cp -a "$controller_unit" "$state/controller.unit"; else touch "$state/controller-unit.absent"; fi
if [ -f "$controller_env" ] && [ ! -L "$controller_env" ]; then touch "$state/controller-env.present"; cp -a "$controller_env" "$state/controller.env"; else touch "$state/controller-env.absent"; fi
if [ -L "$worker_current" ]; then touch "$state/worker-current.present"; readlink "$worker_current" >"$state/worker-current.target"; elif [ -e "$worker_current" ]; then echo "unsupported worker code path" >&2; exit 1; else touch "$state/worker-current.absent"; fi
if [ -L "$controller_current" ]; then touch "$state/controller-current.present"; readlink "$controller_current" >"$state/controller-current.target"; elif [ -e "$controller_current" ]; then echo "unsupported controller path" >&2; exit 1; else touch "$state/controller-current.absent"; fi
if [ -f "$rollback_helper" ] && [ ! -L "$rollback_helper" ]; then touch "$state/rollback-helper.present"; cp -a "$rollback_helper" "$state/rollback.helper"; else touch "$state/rollback-helper.absent"; fi
if [ -d "$worker_state" ]; then touch "$state/worker-state.present"; else touch "$state/worker-state.absent"; fi
systemctl is-enabled phishtopia-ops-worker.service >"$state/worker.enabled" 2>/dev/null || printf '%s\n' disabled >"$state/worker.enabled"
systemctl is-active phishtopia-ops-worker.service >"$state/worker.active" 2>/dev/null || printf '%s\n' inactive >"$state/worker.active"
systemctl is-enabled phishtopia-ops-controller.service >"$state/controller.enabled" 2>/dev/null || printf '%s\n' disabled >"$state/controller.enabled"
systemctl is-active phishtopia-ops-controller.service >"$state/controller.active" 2>/dev/null || printf '%s\n' inactive >"$state/controller.active"
find "$state" -maxdepth 1 -type f -exec chmod 0600 {} +
sync -f "$state"

stage=package
install -d -o root -g root -m 0755 "$release_root" "$candidate"
cp -a "$source_dir/worker" "$candidate/worker"
cp -a "$source_dir/controller" "$candidate/controller"
chown -R root:root "$candidate"
find "$candidate" -type d -exec chmod 0755 {} +
find "$candidate" -type f -exec chmod 0644 {} +

stage=controller_tests
/usr/bin/systemd-run --wait --collect --quiet --pipe --uid=phishtopia-mcp \
  --unit=phishtopia-ops-controller-sidecar-tests \
  "--working-directory=$candidate" --setenv=PYTHONPATH="$candidate" --setenv=PYTHONDONTWRITEBYTECODE=1 \
  --property=PrivateNetwork=yes --property=PrivateTmp=yes --property=PrivateDevices=yes \
  --property=NoNewPrivileges=yes --property=ProtectSystem=strict --property=ProtectHome=yes \
  --property=RestrictAddressFamilies=AF_UNIX --property=CapabilityBoundingSet= \
  --property=TasksMax=32 --property=MemoryMax=128M --property=RuntimeMaxSec=180 \
  -- /usr/bin/python3 -B -m unittest discover -s controller/test -p 'test_*.py' -v

stage=worker_tests
/usr/bin/systemd-run --wait --collect --quiet --pipe \
  --unit=phishtopia-ops-worker-sidecar-tests \
  "--working-directory=$candidate" --setenv=PYTHONPATH="$candidate" --setenv=PYTHONDONTWRITEBYTECODE=1 \
  --property=PrivateNetwork=yes --property=PrivateTmp=yes --property=PrivateDevices=yes \
  --property=NoNewPrivileges=yes --property=ProtectSystem=strict --property=ProtectHome=yes \
  --property=RestrictAddressFamilies=AF_UNIX --property=CapabilityBoundingSet= \
  --property=TasksMax=64 --property=MemoryMax=384M --property=RuntimeMaxSec=300 \
  -- /usr/bin/python3 -B -m unittest \
  worker.test.test_allowlist worker.test.test_store worker.test.test_daemon worker.test.test_executor -v

stage=install_units
systemctl stop phishtopia-ops-controller.service phishtopia-ops-worker.service 2>/dev/null || true
systemctl disable phishtopia-ops-controller.service phishtopia-ops-worker.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/multi-user.target.wants/phishtopia-ops-controller.service
install -o root -g root -m 0644 "$source_dir/systemd/phishtopia-ops-worker-standalone.service" "$worker_unit"
install -o root -g root -m 0644 "$source_dir/systemd/phishtopia-ops-controller-standalone.service" "$controller_unit"
env_next="$controller_env.next"
rm -f "$env_next"
printf '%s\n' 'PHISHTOPIA_OPS_QUEUE_ISSUE=43' >"$env_next"
chown root:root "$env_next"
chmod 0600 "$env_next"
mv -f "$env_next" "$controller_env"
ln -s "$candidate" "$worker_current"
ln -s "$candidate" "$controller_current"

stage=start_worker
systemctl daemon-reload
systemctl reset-failed phishtopia-ops-worker.service phishtopia-ops-controller.service 2>/dev/null || true
systemctl enable --now phishtopia-ops-worker.service
systemctl is-active --quiet phishtopia-ops-worker.service
[ "$(systemctl show phishtopia-ops-worker.service -p NRestarts --value)" = 0 ]
[ "$(stat -c '%U:%G:%a' "$worker_socket")" = "root:phishtopia-mcp:660" ]

/usr/bin/setpriv --reuid=phishtopia-mcp --regid=phishtopia-mcp --init-groups --no-new-privs -- \
  /usr/bin/python3 -B - "$worker_socket" <<'PY'
import json
import socket
import sys
path = sys.argv[1]
request = json.dumps({"operation": "get_contract", "payload": {}}, separators=(",", ":")).encode() + b"\n"
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
expected = ["canary_and_promote", "deploy_verified_release", "restart_phishtopia_service", "rollback_release", "rotate_session_secret", "run_tested_migration", "update_dns_with_rollback", "upgrade_ops_release"]
if value != {"ok": True, "contract": {"version": "issue15-v1", "actions": expected, "singleFlight": "production_mutation"}}:
    raise SystemExit("worker contract rejected")
PY

stage=start_controller
started_at=$(date -u '+%Y-%m-%d %H:%M:%S UTC')
systemctl enable --now phishtopia-ops-controller.service
systemctl is-active --quiet phishtopia-ops-controller.service
sleep 23
systemctl is-active --quiet phishtopia-ops-controller.service
[ "$(systemctl show phishtopia-ops-controller.service -p NRestarts --value)" = 0 ]
if journalctl -u phishtopia-ops-controller.service --since "$started_at" --no-pager -o cat | grep -Fq 'controller_error='; then
  echo "controller relay transport verification failed" >&2
  exit 1
fi

stage=final_verification
[ "$(readlink -f "$worker_current")" = "$candidate" ]
[ "$(readlink -f "$controller_current")" = "$candidate" ]
[ "$(stat -c '%U:%G:%a' "$worker_unit")" = "root:root:644" ]
[ "$(stat -c '%U:%G:%a' "$controller_unit")" = "root:root:644" ]
[ "$(stat -c '%U:%G:%a' "$controller_env")" = "root:root:600" ]
[ "$(sed -n '1p' "$controller_env")" = 'PHISHTOPIA_OPS_QUEUE_ISSUE=43' ]
[ "$(readlink -f "$mcp_current")" = "$mcp_target_before" ]
[ "$(sha256sum "$tunnel_unit" | cut -d' ' -f1)" = "$tunnel_unit_before" ]
[ "$(sha256sum "$tunnel_launcher" | cut -d' ' -f1)" = "$tunnel_launcher_before" ]
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
systemctl is-active --quiet phishtopia-ops-worker.service
systemctl is-active --quiet phishtopia-ops-controller.service
[ "$(stat -c '%U:%G:%a' "$worker_socket")" = "root:phishtopia-mcp:660" ]

stage=commit
install -o root -g root -m 0755 "$source_dir/scripts/rollback-worker-controller-sidecar.sh" "$rollback_helper"
touch "$state/install-complete"
chmod 0600 "$state/install-complete"
sync -f "$state/install-complete"
mv "$state" "$last_good"
sync -f /var/lib

trap - EXIT HUP INT TERM
/usr/bin/flock -u 9
printf 'worker_controller_install=success\n'
printf 'worker_controller_release=%s\n' "$release"
printf 'worker_controller_rollback=%s\n' "$rollback_helper"
