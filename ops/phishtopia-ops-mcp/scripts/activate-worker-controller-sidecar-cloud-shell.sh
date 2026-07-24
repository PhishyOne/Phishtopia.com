#!/bin/sh
set -eu
umask 077

[ "$#" -eq 1 ] || { echo "usage: activate-worker-controller-sidecar-cloud-shell.sh MERGED_COMMIT" >&2; exit 2; }
release=$1
case "$release" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#release}" -eq 40 ] || exit 2

PROJECT_ID='project-43a8be4b-69a7-4d52-805'
ZONE='us-east1-b'
VM_NAME='phishtopia-vm'
REPOSITORY='PhishyOne/Phishtopia.com'

for command in gcloud curl python3 tar sha256sum; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing required command: $command" >&2; exit 1; }
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
archive="$tmp/phishtopia-$release.tar.gz"
repository_root="$tmp/repository"
package_root="$tmp/worker-controller-package"
package="$tmp/phishtopia-ops-worker-controller-$release.tar.gz"
remote="$tmp/phishtopia-ops-worker-controller-$release-remote.sh"

printf '%s\n' '==> Verify fixed project and VM'
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null
gcloud compute instances describe "$VM_NAME" --project="$PROJECT_ID" --zone="$ZONE" --format='value(name)' >/dev/null

printf '%s\n' '==> Download immutable GitHub archive'
curl --fail --location --silent --show-error \
  "https://github.com/$REPOSITORY/archive/$release.tar.gz" --output "$archive"

python3 - "$archive" "$repository_root" "$package_root" <<'PY'
import pathlib
import shutil
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
package = pathlib.Path(sys.argv[3])
destination.mkdir(mode=0o700)
package.mkdir(mode=0o700)
with tarfile.open(archive, "r:gz") as bundle:
    members = bundle.getmembers()
    if not 1 <= len(members) <= 30000:
        raise SystemExit("repository archive file count rejected")
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts) or member.isdev() or member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
            raise SystemExit("repository archive entry rejected")
    bundle.extractall(destination, members=members)
roots = [item for item in destination.iterdir() if item.is_dir()]
if len(roots) != 1:
    raise SystemExit("repository archive root rejected")
source = roots[0] / "ops" / "phishtopia-ops-mcp"
required = [
    source / "worker" / "daemon.py",
    source / "worker" / "allowlist.py",
    source / "worker" / "executor.py",
    source / "worker" / "platform.py",
    source / "worker" / "store.py",
    source / "controller" / "relay_daemon.py",
    source / "controller" / "test" / "test_controller.py",
    source / "systemd" / "phishtopia-ops-worker-standalone.service",
    source / "systemd" / "phishtopia-ops-controller-standalone.service",
    source / "scripts" / "install-worker-controller-sidecar.sh",
    source / "scripts" / "rollback-worker-controller-sidecar.sh",
]
if not source.is_dir() or not all(path.is_file() and not path.is_symlink() for path in required):
    raise SystemExit("worker/controller activation source missing")
for directory in ("worker", "controller"):
    shutil.copytree(source / directory, package / directory, symlinks=False)
for relative in (
    "systemd/phishtopia-ops-worker-standalone.service",
    "systemd/phishtopia-ops-controller-standalone.service",
    "scripts/install-worker-controller-sidecar.sh",
    "scripts/rollback-worker-controller-sidecar.sh",
):
    original = source / relative
    target = package / relative
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copy2(original, target, follow_symlinks=False)
PY

tar -czf "$package" -C "$package_root" worker controller systemd scripts
package_digest=$(sha256sum "$package" | cut -d' ' -f1)
case "$package_digest" in *[!0-9a-f]*|'') exit 1 ;; esac
[ "${#package_digest}" -eq 64 ] || exit 1

cat >"$remote" <<EOF
#!/bin/sh
set -eu
umask 077
release='$release'
package_digest='$package_digest'
archive='/tmp/phishtopia-ops-worker-controller-$release.tar.gz'
remote_script='/tmp/phishtopia-ops-worker-controller-$release-remote.sh'
input_root='/var/lib/phishtopia-ops-worker-controller-input'
source_root='/var/lib/phishtopia-ops-worker-controller-source'
source_dir="\$source_root/\$release"
cleanup() {
  rm -f "\$archive" "\$remote_script" "\$input_root/\$release.tar.gz"
  rm -rf "\$source_dir"
}
trap cleanup EXIT HUP INT TERM
install -d -o root -g root -m 0700 "\$input_root" "\$source_root"
install -o root -g root -m 0600 "\$archive" "\$input_root/\$release.tar.gz"
[ "\$(sha256sum "\$input_root/\$release.tar.gz" | cut -d' ' -f1)" = "\$package_digest" ]
rm -rf "\$source_dir"
install -d -o root -g root -m 0700 "\$source_dir"
python3 - "\$input_root/\$release.tar.gz" "\$source_dir" <<'PY'
import pathlib
import sys
import tarfile
archive = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
required = {
    "worker/daemon.py",
    "worker/allowlist.py",
    "worker/executor.py",
    "worker/platform.py",
    "worker/store.py",
    "controller/relay_daemon.py",
    "controller/test/test_controller.py",
    "systemd/phishtopia-ops-worker-standalone.service",
    "systemd/phishtopia-ops-controller-standalone.service",
    "scripts/install-worker-controller-sidecar.sh",
    "scripts/rollback-worker-controller-sidecar.sh",
}
files = set()
with tarfile.open(archive, "r:gz") as bundle:
    members = bundle.getmembers()
    if not 1 <= len(members) <= 256:
        raise SystemExit("worker/controller package file count rejected")
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or not path.parts or path.parts[0] not in {"worker", "controller", "systemd", "scripts"} or any(part in {"", ".", ".."} for part in path.parts) or member.isdev() or member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
            raise SystemExit("worker/controller package entry rejected")
        if member.isfile():
            files.add(path.as_posix())
    if not required.issubset(files):
        raise SystemExit("worker/controller package contents rejected")
    bundle.extractall(destination, members=members)
PY
chown -R root:root "\$source_dir"
find "\$source_dir" -type d -exec chmod 0700 {} +
find "\$source_dir" -type f -exec chmod 0600 {} +
/bin/sh "\$source_dir/scripts/install-worker-controller-sidecar.sh" "\$release" "\$package_digest"
echo 'external_worker_controller_activation=success'
EOF
chmod 0700 "$remote"

printf '%s\n' '==> Transfer bounded worker-and-relay activation package'
gcloud compute scp --quiet --project="$PROJECT_ID" --zone="$ZONE" "$package" "$remote" "$VM_NAME:/tmp/"
gcloud compute ssh --quiet --project="$PROJECT_ID" --zone="$ZONE" "$VM_NAME" --command="sudo /bin/sh /tmp/$(basename "$remote")"

printf '\n%s\n' 'PHISHTOPIA_OPS_WORKER_CONTROLLER=success'
printf 'PHISHTOPIA_OPS_WORKER_CONTROLLER_RELEASE=%s\n' "$release"
printf 'PHISHTOPIA_OPS_WORKER_CONTROLLER_PACKAGE_SHA256=%s\n' "$package_digest"
