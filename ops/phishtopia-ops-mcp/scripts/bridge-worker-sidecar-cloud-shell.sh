#!/bin/sh
set -eu
umask 077

[ "$#" -eq 2 ] || {
  echo "usage: bridge-worker-sidecar-cloud-shell.sh MERGED_COMMIT REPOSITORY_ARCHIVE_SHA256" >&2
  exit 2
}
release=$1
repository_digest=$2
case "$release" in *[!0-9a-f]*|'') exit 2 ;; esac
case "$repository_digest" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#release}" -eq 40 ] && [ "${#repository_digest}" -eq 64 ] || exit 2

PROJECT_ID='project-43a8be4b-69a7-4d52-805'
ZONE='us-east1-b'
VM_NAME='phishtopia-vm'
REPOSITORY='PhishyOne/Phishtopia.com'

for command in gcloud curl python3 tar sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "missing required command: $command" >&2
    exit 1
  }
done

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
archive="$temporary/phishtopia-$release.tar.gz"
repository_root="$temporary/repository"
package_root="$temporary/package"
package="$temporary/phishtopia-ops-worker-bridge-$release.tar.gz"
remote="$temporary/phishtopia-ops-worker-bridge-$release-remote.sh"

printf '%s\n' '==> Verify fixed project and VM'
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null
gcloud compute instances describe "$VM_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --format='value(name)' >/dev/null

printf '%s\n' '==> Download and verify immutable GitHub archive'
curl --fail --location --silent --show-error \
  "https://github.com/$REPOSITORY/archive/$release.tar.gz" \
  --output "$archive"
[ "$(sha256sum "$archive" | cut -d' ' -f1)" = "$repository_digest" ] || {
  echo "repository archive digest mismatch" >&2
  exit 1
}

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
    if not 1 <= len(members) <= 30_000:
        raise SystemExit("repository archive file count rejected")
    if sum(member.size for member in members if member.isfile()) > 512_000_000:
        raise SystemExit("repository archive size rejected")
    seen = set()
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if (
            path.is_absolute()
            or not path.parts
            or any(part in {"", ".", ".."} for part in path.parts)
            or path.as_posix() in seen
            or member.isdev()
            or member.issym()
            or member.islnk()
            or not (member.isdir() or member.isfile())
        ):
            raise SystemExit("repository archive entry rejected")
        seen.add(path.as_posix())
    bundle.extractall(destination, members=members)

roots = [item for item in destination.iterdir() if item.is_dir()]
if len(roots) != 1:
    raise SystemExit("repository archive root rejected")
source = roots[0] / "ops" / "phishtopia-ops-mcp"
required = (
    source / "package-lock.json",
    source / "worker" / "daemon.py",
    source / "worker" / "platform.py",
    source / "controller" / "relay_daemon.py",
    source / "systemd" / "phishtopia-ops-worker-standalone.service",
    source / "scripts" / "install-worker-sidecar-bridge.sh",
    source / "scripts" / "rollback-worker-sidecar-bridge.sh",
)
if (
    not source.is_dir()
    or not all(path.is_file() and not path.is_symlink() for path in required)
):
    raise SystemExit("worker bridge source missing")

target = package / "ops"
shutil.copytree(source, target, symlinks=False)
PY

tar -czf "$package" -C "$package_root" ops
package_digest=$(sha256sum "$package" | cut -d' ' -f1)
case "$package_digest" in *[!0-9a-f]*|'') exit 1 ;; esac
[ "${#package_digest}" -eq 64 ] || exit 1

cat >"$remote" <<EOF
#!/bin/sh
set -eu
umask 077
release='$release'
repository_digest='$repository_digest'
package_digest='$package_digest'
archive='/tmp/phishtopia-ops-worker-bridge-$release.tar.gz'
remote_script='/tmp/phishtopia-ops-worker-bridge-$release-remote.sh'
input_root='/var/lib/phishtopia-ops-worker-bridge-input'
source_root='/var/lib/phishtopia-ops-worker-bridge-source'
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
    "ops/package-lock.json",
    "ops/worker/daemon.py",
    "ops/worker/platform.py",
    "ops/controller/relay_daemon.py",
    "ops/systemd/phishtopia-ops-worker-standalone.service",
    "ops/scripts/install-worker-sidecar-bridge.sh",
    "ops/scripts/rollback-worker-sidecar-bridge.sh",
}
files = set()
with tarfile.open(archive, "r:gz") as bundle:
    members = bundle.getmembers()
    if not 1 <= len(members) <= 512:
        raise SystemExit("worker bridge package file count rejected")
    if sum(member.size for member in members if member.isfile()) > 32_000_000:
        raise SystemExit("worker bridge package size rejected")
    seen = set()
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if (
            path.is_absolute()
            or not path.parts
            or path.parts[0] != "ops"
            or any(part in {"", ".", ".."} for part in path.parts)
            or path.as_posix() in seen
            or member.isdev()
            or member.issym()
            or member.islnk()
            or not (member.isdir() or member.isfile())
        ):
            raise SystemExit("worker bridge package entry rejected")
        seen.add(path.as_posix())
        if member.isfile():
            files.add(path.as_posix())
    if not required.issubset(files):
        raise SystemExit("worker bridge package contents rejected")
    bundle.extractall(destination, members=members)
PY
chown -R root:root "\$source_dir"
find "\$source_dir" -type d -exec chmod 0700 {} +
find "\$source_dir" -type f -exec chmod 0600 {} +
/bin/sh "\$source_dir/ops/scripts/install-worker-sidecar-bridge.sh" \
  "\$release" "\$package_digest" "\$repository_digest"
echo 'worker_sidecar_bridge_remote=success'
EOF
chmod 0700 "$remote"

printf '%s\n' '==> Transfer bounded worker bridge package'
gcloud compute scp --quiet \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  "$package" \
  "$remote" \
  "$VM_NAME:/tmp/"
gcloud compute ssh --quiet \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  "$VM_NAME" \
  --command="sudo /bin/sh /tmp/$(basename "$remote")"

printf '\n%s\n' 'PHISHTOPIA_OPS_WORKER_BRIDGE=success'
printf 'PHISHTOPIA_OPS_WORKER_BRIDGE_RELEASE=%s\n' "$release"
printf 'PHISHTOPIA_OPS_WORKER_BRIDGE_ARCHIVE_SHA256=%s\n' "$repository_digest"
printf 'PHISHTOPIA_OPS_WORKER_BRIDGE_PACKAGE_SHA256=%s\n' "$package_digest"
