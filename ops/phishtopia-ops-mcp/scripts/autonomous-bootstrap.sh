#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "autonomous bootstrap requires root" >&2; exit 1; }
[ "$#" -eq 2 ] || { echo "usage: autonomous-bootstrap.sh COMMIT_SHA ARTIFACT_SHA256" >&2; exit 1; }
release=$1
artifact_digest=$2
case "$release" in *[!0-9a-f]*|'') exit 1 ;; esac
case "$artifact_digest" in *[!0-9a-f]*|'') exit 1 ;; esac
[ "${#release}" -eq 40 ] && [ "${#artifact_digest}" -eq 64 ] || exit 1

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
state=/var/lib/phishtopia-ops-bootstrap-active
current=/opt/phishtopia-ops-mcp
runtime=/opt/phishtopia-ops-runtime
diagnostics=/var/lib/phishtopia-ops-bootstrap-diagnostics
recovery_helper=/usr/local/libexec/phishtopia-ops-bootstrap-recover
started_at=$(date -u '+%Y-%m-%d %H:%M:%S UTC')
stage=initializing
baseline=$(mktemp /run/phishtopia-postgres-baseline.XXXXXX)
current_fingerprint=$(mktemp /run/phishtopia-postgres-current.XXXXXX)
chmod 0600 "$baseline" "$current_fingerprint"

capture_failure() {
  status=$1
  set +e
  install -d -o root -g root -m 0700 "$diagnostics"
  next="$diagnostics/latest.next"
  report="$diagnostics/latest.txt"
  {
    printf 'format=phishtopia-ops-bootstrap-diagnostic-v1\n'
    printf 'release=%s\n' "$release"
    printf 'stage=%s\n' "$stage"
    printf 'exit_status=%s\n' "$status"
    printf 'started_at=%s\n' "$started_at"
    printf 'captured_at=%s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    for unit in phishtopia-ops-tunnel-preflight.service phishtopia-ops-worker.service phishtopia-ops-mcp-tunnel.service; do
      printf '\n[unit %s]\n' "$unit"
      systemctl show "$unit" --no-pager \
        --property=LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,NRestarts 2>&1 || true
      printf '[journal %s]\n' "$unit"
      journalctl -u "$unit" --since "$started_at" --no-pager -o short-iso -n 240 2>&1 || true
    done
  } | /usr/bin/python3 "$script_dir/sanitize-bootstrap-diagnostics.py" >"$next"
  chown root:root "$next"
  chmod 0600 "$next"
  mv -f "$next" "$report"
  sync -f "$report" 2>/dev/null || true
}

finish() {
  status=$?
  trap - EXIT HUP INT TERM
  set +e
  if [ "$status" -ne 0 ]; then
    capture_failure "$status"
    if [ -d "$state" ] && [ -x "$recovery_helper" ]; then
      PHISHTOPIA_BOOTSTRAP_SELF_RECOVERY=1 "$recovery_helper" || true
    fi
  fi
  rm -f "$baseline" "$current_fingerprint"
  exit "$status"
}
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

fingerprint() {
  /usr/bin/python3 "$script_dir/postgres-fingerprint.py"
}

compare_database() {
  fingerprint >"$current_fingerprint"
  cmp -s "$baseline" "$current_fingerprint" || {
    echo "canonical PostgreSQL fingerprint changed" >&2
    return 1
  }
}

verify_runtime() {
  systemctl is-active --quiet phishtopia-ops-worker.service
  systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
  finalizer="$current/scripts/finalize-bootstrap.sh"
  [ -f "$finalizer" ] && [ ! -L "$finalizer" ] && [ -x "$finalizer" ]
  [ "$(stat -c '%U:%G:%a' "$finalizer")" = "root:root:755" ]
  "$runtime/node/bin/node" "$current/dist/smoke/protocol-smoke.js"
  /usr/bin/setpriv --reuid=phishtopia-mcp --regid=phishtopia-mcp --init-groups \
    --no-new-privs -- "$runtime/node/bin/node" "$current/dist/smoke/worker-contract-smoke.js"
  /usr/bin/setpriv --reuid=phishtopia-mcp --regid=phishtopia-mcp --init-groups \
    --no-new-privs -- /usr/bin/env HOME=/var/lib/phishtopia-ops-mcp \
    CLOUDSDK_CONFIG=/var/lib/phishtopia-ops-mcp/.config/gcloud \
    PYTHONDONTWRITEBYTECODE=1 "$runtime/node/bin/node" "$current/dist/smoke/live-smoke.js"
  [ "$(stat -c '%U:%G:%a' /run/phishtopia-ops-worker/worker.sock)" = "root:phishtopia-mcp:660" ]
  for path in /var/lib/phishtopia-ops-worker/jobs.sqlite3 /var/lib/phishtopia-ops-worker/audit.jsonl; do
    if [ -e "$path" ]; then
      [ "$(stat -c '%U:%a' "$path")" = "root:600" ]
    fi
  done
  compare_database
}

stage=postgres_baseline
fingerprint >"$baseline"

stage=tunnel_preflight
/bin/sh "$script_dir/tunnel-preflight.sh" "$script_dir/../systemd/phishtopia-ops-mcp-tunnel-launch"

stage=installer
/bin/sh "$script_dir/install-bootstrap.sh" "$release" "$artifact_digest"

stage=staged_verification
verify_runtime

stage=restart_verification
systemctl restart phishtopia-ops-worker.service
systemctl is-active --quiet phishtopia-ops-worker.service
systemctl restart phishtopia-ops-mcp-tunnel.service
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
verify_runtime

stage=finalization
"$current/scripts/finalize-bootstrap.sh"

stage=post_finalization
verify_runtime
[ -d /var/lib/phishtopia-ops-bootstrap-last-good ]
[ ! -e "$state" ]

trap - EXIT HUP INT TERM
rm -f "$baseline" "$current_fingerprint"
echo "autonomous_bootstrap_status=committed"
echo "autonomous_bootstrap_release=$release"
echo "autonomous_bootstrap_rollback=retained_last_known_good"
