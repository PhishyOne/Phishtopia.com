#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "bootstrap must run as root" >&2; exit 1; }
[ "$#" -eq 2 ] || { echo "usage: install-bootstrap.sh COMMIT_SHA ARTIFACT_SHA256" >&2; exit 1; }
exec 9>/run/phishtopia-ops-bootstrap.lock
/usr/bin/flock 9

release=$1
artifact_digest=$2
case "$release" in *[!0-9a-f]*|'') echo "invalid immutable release" >&2; exit 1 ;; esac
case "$artifact_digest" in *[!0-9a-f]*|'') echo "invalid artifact digest" >&2; exit 1 ;; esac
[ "${#release}" -eq 40 ] || { echo "invalid immutable release" >&2; exit 1; }
[ "${#artifact_digest}" -eq 64 ] || { echo "invalid artifact digest" >&2; exit 1; }

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
archive="/var/lib/phishtopia-ops-bootstrap-input/$release.tar.gz"
state=/var/lib/phishtopia-ops-bootstrap-active
preparing=/var/lib/phishtopia-ops-bootstrap-preparing
release_root=/opt/phishtopia-ops-releases
candidate="$release_root/$release"
staging="$release_root/.staging-$release"
current=/opt/phishtopia-ops-mcp
runtime=/opt/phishtopia-ops-runtime
npm_cli="$runtime/node/lib/node_modules/npm/bin/npm-cli.js"
worker=/usr/local/lib/phishtopia-ops-worker
worker_unit=/etc/systemd/system/phishtopia-ops-worker.service
tunnel_unit=/etc/systemd/system/phishtopia-ops-mcp-tunnel.service
tunnel_launcher=/usr/local/libexec/phishtopia-ops-mcp-tunnel-launch
recovery_helper=/usr/local/libexec/phishtopia-ops-bootstrap-recover
recovery_unit=/etc/systemd/system/phishtopia-ops-bootstrap-recover.service
manifest=/var/lib/phishtopia-ops-worker/releases.json
worker_state=/var/lib/phishtopia-ops-worker
last_good=/var/lib/phishtopia-ops-bootstrap-last-good
rollback_helper=/usr/local/sbin/phishtopia-ops-rollback-last-good

[ -f "$archive" ] || { echo "fixed bootstrap archive missing" >&2; exit 1; }
[ ! -e "$state" ] && [ ! -e "$preparing" ] && [ ! -e "$last_good" ] || { echo "unfinished bootstrap transaction or retained baseline exists" >&2; exit 1; }
[ ! -e "$candidate" ] && [ ! -e "$staging" ] || { echo "release destination already exists" >&2; exit 1; }
[ -f "$tunnel_unit" ] && [ -x "$tunnel_launcher" ] && [ -d "$current" ] || { echo "read-only baseline missing" >&2; exit 1; }
memory_available_kib=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)
disk_available=$(df -PB1 /var/lib | awk 'NR == 2 { print $4 }')
[ -n "$memory_available_kib" ] && [ "$memory_available_kib" -ge 625000 ] || { echo "insufficient build memory headroom" >&2; exit 1; }
[ -n "$disk_available" ] && [ "$disk_available" -ge 2000000000 ] || { echo "insufficient build disk headroom" >&2; exit 1; }
enabled_dns_versions=$(/usr/bin/gcloud secrets versions list phishtopia-cloudflare-dns-token \
  --project=project-43a8be4b-69a7-4d52-805 --filter=state=ENABLED \
  '--format=value(name)' 2>/dev/null) || { echo "fixed DNS rollback credential unavailable" >&2; exit 1; }
printf '%s\n' "$enabled_dns_versions" | grep -Eq '(^|/)[0-9]+$' || { echo "fixed DNS rollback credential unavailable" >&2; exit 1; }

rollback() {
  rollback_status=$1
  [ "$rollback_status" -ne 0 ] || rollback_status=1
  trap - EXIT HUP INT TERM
  set +e
  /usr/bin/flock -u 9
  if [ -x "$recovery_helper" ]; then
    PHISHTOPIA_BOOTSTRAP_SELF_RECOVERY=1 "$recovery_helper"
  else
    PHISHTOPIA_BOOTSTRAP_SELF_RECOVERY=1 "$script_dir/recover-bootstrap.sh"
  fi
  exit "$rollback_status"
}
trap 'rollback $?' EXIT
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM
install -m 0755 "$script_dir/recover-bootstrap.sh" "$recovery_helper"
install -m 0755 "$script_dir/rollback-bootstrap-last-good.sh" "$rollback_helper"
install -m 0644 "$script_dir/../systemd/phishtopia-ops-bootstrap-recover.service" "$recovery_unit"
systemctl daemon-reload
systemctl enable phishtopia-ops-bootstrap-recover.service

mkdir -m 0700 "$preparing"
state=$preparing
printf '%s\n' "$release" >"$state/release"
sha256sum /etc/phishtopia-ops-mcp/tunnel.yaml | cut -d' ' -f1 >"$state/tunnel-config.sha256"
sha256sum /etc/credstore/phishtopia-ops-mcp/control-plane-api-key | cut -d' ' -f1 >"$state/tunnel-credential.sha256"
sha256sum "$tunnel_launcher" | cut -d' ' -f1 >"$state/tunnel-launcher.sha256"
systemctl is-enabled phishtopia-ops-mcp-tunnel.service >"$state/tunnel.enabled" 2>/dev/null || printf '%s\n' disabled >"$state/tunnel.enabled"
systemctl is-active phishtopia-ops-mcp-tunnel.service >"$state/tunnel.active" 2>/dev/null || printf '%s\n' inactive >"$state/tunnel.active"
if [ -f "$worker_unit" ]; then
  touch "$state/worker-unit.present"
  cp -a "$worker_unit" "$state/worker.unit"
else
  touch "$state/worker-unit.absent"
fi
systemctl is-enabled phishtopia-ops-worker.service >"$state/worker.enabled" 2>/dev/null || printf '%s\n' disabled >"$state/worker.enabled"
systemctl is-active phishtopia-ops-worker.service >"$state/worker.active" 2>/dev/null || printf '%s\n' inactive >"$state/worker.active"
cp -a "$tunnel_unit" "$state/tunnel.unit"
if [ -d "$worker" ]; then
  touch "$state/worker-dir.present"
  cp -a "$worker" "$state/worker.old"
else
  touch "$state/worker-dir.absent"
fi
if [ -L "$current" ]; then
  touch "$state/current.symlink"
  cp -a "$current" "$state/current.link"
else
  touch "$state/current.legacy"
  cp -a "$current" "$state/current.old"
fi
if [ -f "$manifest" ]; then
  touch "$state/manifest.present"
  cp -a "$manifest" "$state/releases.json"
else
  touch "$state/manifest.absent"
fi
if [ -d "$worker_state" ]; then
  touch "$state/worker-state.present"
  cp -a "$worker_state" "$state/worker-state.old"
else
  touch "$state/worker-state.absent"
fi
if [ ! -d "$runtime" ]; then touch "$state/runtime.absent"; fi
if [ ! -d "$release_root" ]; then touch "$state/release-root.absent"; fi
if [ ! -d /opt/phishtopia-app-releases ]; then touch "$state/app-release-root.absent"; fi
if [ ! -d /var/log/phishtopia ]; then touch "$state/app-log-root.absent"; fi
if ! getent passwd phishtopia-build >/dev/null; then touch "$state/build-user.absent"; fi
find "$state" -maxdepth 1 -type f -exec chmod 0600 {} +
sync -f "$state"
mv "$preparing" /var/lib/phishtopia-ops-bootstrap-active
state=/var/lib/phishtopia-ops-bootstrap-active
sync -f /var/lib

if ! getent passwd phishtopia-build >/dev/null; then
  useradd --system --user-group --home-dir /var/lib/phishtopia-build --shell /usr/sbin/nologin phishtopia-build
fi
build_uid=$(id -u phishtopia-build)
build_gid=$(id -g phishtopia-build)
[ "$build_uid" -gt 0 ]
[ "$(getent passwd phishtopia-build | cut -d: -f6-7)" = "/var/lib/phishtopia-build:/usr/sbin/nologin" ]
install -d -m 0700 -o phishtopia-build -g phishtopia-build /var/lib/phishtopia-build /var/lib/phishtopia-build/npm-cache

mkdir -p "$release_root" "$runtime" /opt/phishtopia-app-releases
chmod 0755 "$release_root" "$runtime" /opt/phishtopia-app-releases
install -d -m 0750 -o codespace -g codespace /var/log/phishtopia
if [ ! -x "$runtime/node/bin/node" ]; then
  [ -d "$current/.tools/node" ] && [ ! -L "$current/.tools/node" ] || {
    echo "installed Node runtime is not a real directory" >&2
    exit 1
  }
  cp -a --no-preserve=ownership "$current/.tools/node" "$runtime/node"
  chown -R root:root "$runtime/node"
fi
"$runtime/node/bin/node" --version
[ -f "$runtime/node/lib/node_modules/npm/bin/npm-cli.js" ]
[ ! -L "$runtime/node/bin/node" ]
if find "$runtime/node" -xdev -perm /022 -print -quit | grep -q .; then
  echo "installed Node runtime is group/world writable" >&2
  exit 1
fi

python3 "$script_dir/verify-bootstrap-archive.py" "$archive" "$staging" "$release" "$artifact_digest"
chown -R phishtopia-build:phishtopia-build "$staging"
python3 "$script_dir/registry-policy.py" "$state/npm.hosts" >"$state/npm.addresses"
chmod 0644 "$state/npm.hosts"

set -- /usr/bin/systemd-run --wait --collect --quiet --pipe --uid=phishtopia-build \
  --unit=phishtopia-ops-bootstrap-npm \
  "--working-directory=$staging" --setenv=HOME=/var/lib/phishtopia-build --setenv=NO_COLOR=1 \
  --setenv=PYTHONDONTWRITEBYTECODE=1 \
  --property=PrivateTmp=yes --property=PrivateDevices=yes --property=NoNewPrivileges=yes \
  --property=ProtectSystem=strict --property=ProtectHome=yes --property=ProtectKernelTunables=yes \
  --property=ProtectKernelModules=yes --property=ProtectKernelLogs=yes --property=ProtectControlGroups=yes \
  --property=RestrictSUIDSGID=yes --property=LockPersonality=yes --property=CapabilityBoundingSet= \
  --property=IPAddressDeny=any --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
  --property=TasksMax=64 --property=MemoryMax=384M --property=LimitFSIZE=64M \
  --property=RuntimeMaxSec=900 "--property=ReadWritePaths=$staging" \
  --property=ReadWritePaths=/var/lib/phishtopia-build/npm-cache \
  "--property=BindReadOnlyPaths=$state/npm.hosts:/etc/hosts"
while IFS= read -r address; do set -- "$@" "--property=IPAddressAllow=$address"; done <"$state/npm.addresses"
set -- "$@" -- "$runtime/node/bin/node" "$npm_cli" ci --ignore-scripts --userconfig=/dev/null \
  --registry=https://registry.npmjs.org --cache=/var/lib/phishtopia-build/npm-cache --no-audit --no-fund
"$@"

sandbox() {
  sandbox_index=$((sandbox_index + 1))
  /usr/bin/systemd-run --wait --collect --quiet --pipe --uid=phishtopia-build \
    "--unit=phishtopia-ops-bootstrap-test-$sandbox_index" \
    "--working-directory=$staging" --setenv=HOME=/var/lib/phishtopia-build --setenv=NO_COLOR=1 \
    --setenv=PYTHONDONTWRITEBYTECODE=1 \
    --property=PrivateNetwork=yes --property=PrivateTmp=yes --property=PrivateDevices=yes \
    --property=NoNewPrivileges=yes --property=ProtectSystem=strict --property=ProtectHome=yes \
    --property=ProtectKernelTunables=yes --property=ProtectKernelModules=yes --property=ProtectKernelLogs=yes \
    --property=ProtectControlGroups=yes --property=RestrictSUIDSGID=yes --property=LockPersonality=yes \
    --property=CapabilityBoundingSet= --property=RestrictAddressFamilies=AF_UNIX --property=TasksMax=64 \
    --property=MemoryMax=384M --property=LimitFSIZE=64M --property=RuntimeMaxSec=600 \
    "--property=ReadWritePaths=$staging" -- "$@"
}

sandbox_index=0
sandbox "$runtime/node/bin/node" "$staging/node_modules/prettier/bin/prettier.cjs" --check .
sandbox "$runtime/node/bin/node" "$staging/node_modules/typescript/bin/tsc" --noEmit -p tsconfig.json
sandbox "$runtime/node/bin/node" "$staging/node_modules/typescript/bin/tsc" -p tsconfig.json
sandbox /usr/bin/python3 -B -m unittest discover -s worker/test -p 'test_*.py' -v
sandbox /bin/sh -c 'exec "$1" --test dist/test/*.test.js' bootstrap-test "$runtime/node/bin/node"
sandbox "$runtime/node/bin/node" "$staging/dist/smoke/protocol-smoke.js"

rm -rf "$staging"
python3 "$script_dir/verify-bootstrap-archive.py" "$archive" "$staging" "$release" "$artifact_digest"
chown -R phishtopia-build:phishtopia-build "$staging"
"$@"
sandbox "$runtime/node/bin/node" "$staging/node_modules/typescript/bin/tsc" -p tsconfig.json

chown -R root:root "$staging"
find "$staging" -type d -exec chmod 0755 {} +
find "$staging" -type f -exec chmod 0644 {} +
mkdir -p "$staging/.tools"
ln -s "$runtime/node" "$staging/.tools/node"
mv "$staging" "$candidate"
[ "$(sha256sum "$candidate/systemd/phishtopia-ops-mcp-tunnel-launch" | cut -d' ' -f1)" = "$(sed -n '1p' "$state/tunnel-launcher.sha256")" ]

cp -a "$candidate/systemd/phishtopia-ops-worker.service" "$worker_unit"
cp -a "$candidate/systemd/phishtopia-ops-mcp-tunnel.service" "$tunnel_unit"
rm -rf "$current"
ln -s "$candidate" "$current"

mkdir -p /var/lib/phishtopia-ops-worker
chmod 0700 /var/lib/phishtopia-ops-worker
python3 - "$release" "$artifact_digest" <<'PY'
import hashlib
import json
import os
import stat
import sys
from pathlib import Path

release = Path("/opt/phishtopia-ops-releases") / sys.argv[1]
digest = hashlib.sha256()
for path in sorted(release.rglob("*")):
    relative = path.relative_to(release).as_posix()
    details = path.lstat()
    digest.update(relative.encode() + b"\0" + str(stat.S_IFMT(details.st_mode)).encode() + b"\0")
    if stat.S_ISLNK(details.st_mode):
        digest.update(os.readlink(path).encode())
    elif stat.S_ISREG(details.st_mode):
        with path.open("rb") as handle:
            while chunk := handle.read(1_048_576): digest.update(chunk)
    digest.update(b"\0")
path = Path("/var/lib/phishtopia-ops-worker/releases.json")
value = {"phishtopia_app": {}, "phishtopia_ops": {}}
if path.exists():
    parsed = json.loads(path.read_text(encoding="utf8"))
    if not isinstance(parsed, dict): raise SystemExit("release manifest rejected")
    value = parsed
value.setdefault("phishtopia_app", {})
value.setdefault("phishtopia_ops", {})[sys.argv[1]] = {"sha256": sys.argv[2], "treeSha256": digest.hexdigest()}
temporary = path.with_suffix(".next")
descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
try:
    os.write(descriptor, json.dumps(value, sort_keys=True, separators=(",", ":")).encode())
    os.fsync(descriptor)
finally:
    os.close(descriptor)
os.replace(temporary, path)
directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
try:
    os.fsync(directory)
finally:
    os.close(directory)
PY

systemctl daemon-reload
systemctl enable --now phishtopia-ops-worker.service
systemctl restart phishtopia-ops-mcp-tunnel.service
systemctl is-active --quiet phishtopia-ops-worker.service
systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service
"$runtime/node/bin/node" "$current/dist/smoke/protocol-smoke.js"
/usr/bin/setpriv --reuid=phishtopia-mcp --regid=phishtopia-mcp --init-groups \
  --no-new-privs -- "$runtime/node/bin/node" "$current/dist/smoke/worker-contract-smoke.js"
[ "$(sed -n '1p' "$state/tunnel-config.sha256")" = "$(sha256sum /etc/phishtopia-ops-mcp/tunnel.yaml | cut -d' ' -f1)" ]
[ "$(sed -n '1p' "$state/tunnel-credential.sha256")" = "$(sha256sum /etc/credstore/phishtopia-ops-mcp/control-plane-api-key | cut -d' ' -f1)" ]
[ "$(sed -n '1p' "$state/tunnel-launcher.sha256")" = "$(sha256sum "$tunnel_launcher" | cut -d' ' -f1)" ]

systemd-run --unit=phishtopia-ops-bootstrap-verify-watchdog --on-active=15m "$recovery_helper"
touch "$state/installer-complete"
chmod 0600 "$state/installer-complete"
sync -f "$state/installer-complete"
sync -f "$state"
trap - EXIT HUP INT TERM
/usr/bin/flock -u 9
echo "ops_bootstrap_release=$release"
echo "ops_bootstrap_status=staged_pending_external_verification"
