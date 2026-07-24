#!/bin/sh
set -eu
umask 077

[ "$#" -eq 1 ] || { echo "usage: activate-controller-relay-only-cloud-shell.sh MERGED_COMMIT" >&2; exit 2; }
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
package_root="$tmp/controller-package"
package="$tmp/phishtopia-ops-controller-$release.tar.gz"
remote="$tmp/phishtopia-ops-controller-$release-remote.sh"

printf '%s\n' '==> Verify fixed project and VM'
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null
gcloud compute instances describe "$VM_NAME" --project="$PROJECT_ID" --zone="$ZONE" --format='value(name)' >/dev/null

printf '%s\n' '==> Download immutable GitHub archive'
curl --fail --location --silent --show-error \
  "https://github.com/$REPOSITORY/archive/$release.tar.gz" \
  --output "$archive"

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
        if (
            path.is_absolute()
            or not path.parts
            or any(part in {"", ".", ".."} for part in path.parts)
            or member.isdev()
            or member.issym()
            or member.islnk()
            or not (member.isdir() or member.isfile())
        ):
            raise SystemExit("repository archive entry rejected")
    bundle.extractall(destination, members=members)
roots = [item for item in destination.iterdir() if item.is_dir()]
if len(roots) != 1:
    raise SystemExit("repository archive root rejected")
source = roots[0] / "ops" / "phishtopia-ops-mcp"
required = [
    "controller/__init__.py",
    "controller/policy.py",
    "controller/pubsub.py",
    "controller/pubsub_rest.py",
    "controller/relay.py",
    "controller/relay_daemon.py",
    "controller/test/test_controller.py",
    "worker/__init__.py",
    "worker/allowlist.py",
    "systemd/phishtopia-ops-controller-standalone.service",
    "scripts/install-controller-relay-only.sh",
    "scripts/rollback-controller-relay-only.sh",
]
for relative in required:
    original = source / relative
    if not original.is_file() or original.is_symlink():
        raise SystemExit(f"controller package source rejected: {relative}")
    target = package / relative
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copy2(original, target, follow_symlinks=False)
PY

tar -czf "$package" -C "$package_root" controller worker systemd scripts
package_digest=$(sha256sum "$package" | cut -d' ' -f1)
case "$package_digest" in *[!0-9a-f]*|'') exit 1 ;; esac
[ "${#package_digest}" -eq 64 ] || exit 1

cat >"$remote" <<EOF
#!/bin/sh
set -eu
umask 077
release='$release'
package_digest='$package_digest'
archive='/tmp/phishtopia-ops-controller-$release.tar.gz'
remote_script='/tmp/phishtopia-ops-controller-$release-remote.sh'
input_root='/var/lib/phishtopia-ops-controller-input'
source_root='/var/lib/phishtopia-ops-controller-source'
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
expected = {
    "controller/__init__.py",
    "controller/policy.py",
    "controller/pubsub.py",
    "controller/pubsub_rest.py",
    "controller/relay.py",
    "controller/relay_daemon.py",
    "controller/test/test_controller.py",
    "worker/__init__.py",
    "worker/allowlist.py",
    "systemd/phishtopia-ops-controller-standalone.service",
    "scripts/install-controller-relay-only.sh",
    "scripts/rollback-controller-relay-only.sh",
}
files = set()
with tarfile.open(archive, "r:gz") as bundle:
    members = bundle.getmembers()
    if not 1 <= len(members) <= 64:
        raise SystemExit("controller package file count rejected")
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if (
            path.is_absolute()
            or not path.parts
            or any(part in {"", ".", ".."} for part in path.parts)
            or member.isdev()
            or member.issym()
            or member.islnk()
            or not (member.isdir() or member.isfile())
        ):
            raise SystemExit("controller package entry rejected")
        if member.isfile():
            files.add(path.as_posix())
    if files != expected:
        raise SystemExit("controller package contents rejected")
    bundle.extractall(destination, members=members)
PY
chown -R root:root "\$source_dir"
find "\$source_dir" -type d -exec chmod 0700 {} +
find "\$source_dir" -type f -exec chmod 0600 {} +
/bin/sh "\$source_dir/scripts/install-controller-relay-only.sh" "\$release" "\$package_digest"
echo 'external_controller_relay_only_activation=success'
EOF
chmod 0700 "$remote"

printf '%s\n' '==> Transfer bounded relay-only activation package'
gcloud compute scp --quiet --project="$PROJECT_ID" --zone="$ZONE" \
  "$package" "$remote" \
  "$VM_NAME:/tmp/"

gcloud compute ssh --quiet --project="$PROJECT_ID" --zone="$ZONE" "$VM_NAME" \
  --command="sudo /bin/sh /tmp/$(basename "$remote")"

printf '\n%s\n' 'PHISHTOPIA_OPS_CONTROLLER_RELAY=success'
printf 'PHISHTOPIA_OPS_CONTROLLER_RELEASE=%s\n' "$release"
printf 'PHISHTOPIA_OPS_CONTROLLER_PACKAGE_SHA256=%s\n' "$package_digest"
