#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "bootstrap rollback requires root" >&2; exit 1; }
active=/var/lib/phishtopia-ops-bootstrap-active
last_good=/var/lib/phishtopia-ops-bootstrap-last-good
recovery_helper=/usr/local/libexec/phishtopia-ops-bootstrap-recover
worker_state=/var/lib/phishtopia-ops-worker
retired_state=/var/lib/phishtopia-ops-worker-post-bootstrap-audit

exec 9>/run/phishtopia-ops-bootstrap.lock
/usr/bin/flock 9
[ ! -e "$active" ] || { echo "active bootstrap transaction exists" >&2; exit 1; }
[ -d "$last_good" ] || { echo "retained rollback baseline missing" >&2; exit 1; }
[ -x "$recovery_helper" ] || { echo "fixed recovery helper missing" >&2; exit 1; }
[ ! -e "$retired_state" ] || { echo "post-bootstrap audit archive already exists" >&2; exit 1; }
worker_was_active=false
recovery_started=false
mv "$last_good" "$active"
sync -f /var/lib
restore_retained_on_failure() {
  restore_status=$1
  [ "$restore_status" -ne 0 ] || restore_status=1
  trap - EXIT HUP INT TERM
  set +e
  if [ "$recovery_started" = false ] && [ -d "$active" ] && [ ! -e "$last_good" ]; then
    mv "$active" "$last_good"
    sync -f /var/lib
    if [ "$worker_was_active" = true ]; then
      systemctl start phishtopia-ops-worker.service
    fi
  fi
  /usr/bin/flock -u 9
  exit "$restore_status"
}
trap 'restore_retained_on_failure $?' EXIT
trap 'restore_retained_on_failure 129' HUP
trap 'restore_retained_on_failure 130' INT
trap 'restore_retained_on_failure 143' TERM
if systemctl is-active --quiet phishtopia-ops-worker.service; then
  worker_was_active=true
fi
if ! systemctl stop phishtopia-ops-worker.service; then
  echo "could not quiesce ops worker" >&2
  exit 1
fi
if ! /usr/bin/python3 - "$worker_state/jobs.sqlite3" <<'PY'
import os
import sqlite3
import stat
import sys

path = sys.argv[1]
if not os.path.exists(path):
    raise SystemExit(0)
details = os.stat(path, follow_symlinks=False)
if not stat.S_ISREG(details.st_mode) or details.st_uid != 0 or details.st_mode & 0o077:
    raise SystemExit(2)
connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
try:
    connection.execute("PRAGMA query_only=ON")
    active = connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
finally:
    connection.close()
raise SystemExit(0 if active == 0 else 3)
PY
then
  echo "durable job history blocks retained baseline rollback" >&2
  exit 1
fi
if [ -L /home/codespace/phishtopia ] || \
   [ -n "$(find /opt/phishtopia-app-releases -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
  echo "post-bootstrap application release state blocks retained baseline rollback" >&2
  exit 1
fi
if [ -d "$worker_state" ]; then
  cp -a "$worker_state" "$retired_state"
  sync
fi
/usr/bin/flock -u 9
recovery_started=true
"$recovery_helper"
trap - EXIT HUP INT TERM
