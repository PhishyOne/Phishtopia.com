#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "controller-aware bootstrap requires root" >&2; exit 1; }
[ "$#" -eq 2 ] || { echo "usage: install-bootstrap-with-controller.sh COMMIT_SHA ARTIFACT_SHA256" >&2; exit 1; }

release=$1
artifact_digest=$2
case "$release" in *[!0-9a-f]*|'') exit 1 ;; esac
case "$artifact_digest" in *[!0-9a-f]*|'') exit 1 ;; esac
[ "${#release}" -eq 40 ] && [ "${#artifact_digest}" -eq 64 ] || exit 1

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
state=/var/lib/phishtopia-ops-bootstrap-active
preparing=/var/lib/phishtopia-ops-bootstrap-preparing
last_good=/var/lib/phishtopia-ops-bootstrap-last-good
retired_root=/var/lib/phishtopia-ops-bootstrap-retired
current=/opt/phishtopia-ops-mcp
controller_unit=/etc/systemd/system/phishtopia-ops-controller.service
controller_env=/etc/phishtopia-ops-controller.env
controller_wants=/etc/systemd/system/multi-user.target.wants/phishtopia-ops-controller.service
recovery_helper=/usr/local/libexec/phishtopia-ops-bootstrap-recover
retired_path=''

[ ! -e "$state" ] && [ ! -e "$preparing" ] || { echo "unfinished bootstrap transaction exists" >&2; exit 1; }

restore_retired() {
  if [ -n "$retired_path" ] && [ -d "$retired_path" ] && [ ! -e "$last_good" ]; then
    mv "$retired_path" "$last_good"
    sync -f /var/lib
  fi
}

rollback() {
  status=$?
  trap - EXIT HUP INT TERM
  set +e
  if [ -d "$state" ] && [ -x "$recovery_helper" ]; then
    PHISHTOPIA_BOOTSTRAP_SELF_RECOVERY=1 "$recovery_helper" || true
  fi
  restore_retired
  exit "$status"
}
trap rollback EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ ! -f "$controller_unit" ] && [ ! -f "$controller_env" ]; then
  systemctl disable phishtopia-ops-controller.service 2>/dev/null || true
  rm -f "$controller_wants"
  systemctl daemon-reload
fi

if [ -d "$last_good" ]; then
  prior_release=$(sed -n '1p' "$last_good/release" 2>/dev/null || true)
  case "$prior_release" in *[!0-9a-f]*|'') echo "retained rollback baseline is invalid" >&2; exit 1 ;; esac
  [ "${#prior_release}" -eq 40 ] || { echo "retained rollback baseline is invalid" >&2; exit 1; }
  install -d -o root -g root -m 0700 "$retired_root"
  retired_path="$retired_root/$prior_release"
  [ ! -e "$retired_path" ] || { echo "retired rollback archive already exists" >&2; exit 1; }
  mv "$last_good" "$retired_path"
  sync -f /var/lib
fi

/bin/sh "$script_dir/run-install-bootstrap-with-launcher-compat.sh" "$release" "$artifact_digest"
[ -d "$state" ] || { echo "bootstrap state missing after staged install" >&2; exit 1; }

if [ -f "$controller_unit" ]; then
  touch "$state/controller-unit.present"
  cp -a "$controller_unit" "$state/controller.unit"
else
  touch "$state/controller-unit.absent"
fi
if [ -f "$controller_env" ]; then
  touch "$state/controller-env.present"
  cp -a "$controller_env" "$state/controller.env"
else
  touch "$state/controller-env.absent"
fi
systemctl is-enabled phishtopia-ops-controller.service >"$state/controller.enabled" 2>/dev/null || printf '%s\n' disabled >"$state/controller.enabled"
systemctl is-active phishtopia-ops-controller.service >"$state/controller.active" 2>/dev/null || printf '%s\n' inactive >"$state/controller.active"
find "$state" -maxdepth 1 -type f -exec chmod 0600 {} +
sync -f "$state"

/usr/bin/systemd-run --wait --collect --quiet --pipe --uid=phishtopia-mcp \
  --unit=phishtopia-ops-controller-tests \
  "--working-directory=$current" \
  --setenv=HOME=/var/lib/phishtopia-ops-mcp \
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

install -o root -g root -m 0644 "$current/systemd/phishtopia-ops-controller.service" "$controller_unit"
env_next="$controller_env.next"
rm -f "$env_next"
printf '%s\n' 'PHISHTOPIA_OPS_QUEUE_ISSUE=43' >"$env_next"
chown root:root "$env_next"
chmod 0600 "$env_next"
mv -f "$env_next" "$controller_env"

systemctl daemon-reload
systemctl enable --now phishtopia-ops-controller.service
systemctl is-active --quiet phishtopia-ops-controller.service
[ "$(stat -c '%U:%G:%a' "$controller_unit")" = "root:root:644" ]
[ "$(stat -c '%U:%G:%a' "$controller_env")" = "root:root:600" ]
[ "$(sed -n '1p' "$controller_env")" = 'PHISHTOPIA_OPS_QUEUE_ISSUE=43' ]

touch "$state/controller-installer-complete"
chmod 0600 "$state/controller-installer-complete"
sync -f "$state/controller-installer-complete"
sync -f "$state"

trap - EXIT HUP INT TERM
echo "ops_controller_bootstrap_status=staged_pending_external_verification"
echo "ops_controller_queue_issue=43"
