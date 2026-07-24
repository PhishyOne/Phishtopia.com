#!/bin/sh
set -eu
umask 077

[ "$#" -eq 1 ] || { echo "usage: activate-external-controller-cloud-shell.sh MERGED_COMMIT" >&2; exit 2; }
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
archive="$tmp/phishtopia-ops-$release.tar.gz"
source_tar="$tmp/phishtopia-ops-$release-source.tar.gz"
remote="$tmp/phishtopia-ops-$release-remote.sh"

printf '%s\n' '==> Verify fixed project and VM'
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null
gcloud compute instances describe "$VM_NAME" --project="$PROJECT_ID" --zone="$ZONE" --format='value(name)' >/dev/null

printf '%s\n' '==> Download immutable GitHub archive'
curl --fail --location --silent --show-error \
  "https://github.com/$REPOSITORY/archive/$release.tar.gz" \
  --output "$archive"
digest=$(sha256sum "$archive" | cut -d' ' -f1)
case "$digest" in *[!0-9a-f]*|'') exit 1 ;; esac
[ "${#digest}" -eq 64 ] || exit 1

python3 - "$archive" "$tmp/repository" <<'PY'
import pathlib
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
destination.mkdir(mode=0o700)
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
    source / "scripts" / "autonomous-bootstrap.sh",
    source / "scripts" / "install-bootstrap-with-controller.sh",
    source / "systemd" / "phishtopia-ops-controller.service",
]
if not source.is_dir() or not all(path.is_file() and not path.is_symlink() for path in required):
    raise SystemExit("controller activation source missing")
print(source)
PY
source=$(find "$tmp/repository" -mindepth 3 -maxdepth 3 -type d -path '*/ops/phishtopia-ops-mcp' -print -quit)
[ -n "$source" ] && [ -d "$source" ] || { echo "controller activation source missing" >&2; exit 1; }
if find "$source" -type l -print -quit | grep -q .; then
  echo "controller activation source contains a symlink" >&2
  exit 1
fi
tar -czf "$source_tar" -C "$source" .

cat >"$remote" <<EOF
#!/bin/sh
set -eu
umask 077
release='$release'
digest='$digest'
archive='/tmp/phishtopia-ops-$release.tar.gz'
source_archive='/tmp/phishtopia-ops-$release-source.tar.gz'
remote_script='/tmp/phishtopia-ops-$release-remote.sh'
input_root='/var/lib/phishtopia-ops-bootstrap-input'
source_root='/var/lib/phishtopia-ops-bootstrap-source'
source_dir="\$source_root/\$release"
cleanup() {
  rm -f "\$archive" "\$source_archive" "\$remote_script"
  rm -rf "\$source_dir"
}
trap cleanup EXIT HUP INT TERM
install -d -o root -g root -m 0700 "\$input_root" "\$source_root"
install -o root -g root -m 0600 "\$archive" "\$input_root/\$release.tar.gz"
[ "\$(sha256sum "\$input_root/\$release.tar.gz" | cut -d' ' -f1)" = "\$digest" ]
rm -rf "\$source_dir"
install -d -o root -g root -m 0700 "\$source_dir"
tar -xzf "\$source_archive" -C "\$source_dir" --no-same-owner --no-same-permissions
chown -R root:root "\$source_dir"
find "\$source_dir" -type d -exec chmod 0700 {} +
find "\$source_dir" -type f -perm /111 -exec chmod 0700 {} +
find "\$source_dir" -type f ! -perm /111 -exec chmod 0600 {} +
/bin/sh "\$source_dir/scripts/autonomous-bootstrap.sh" "\$release" "\$digest"
rm -f "\$input_root/\$release.tar.gz"
echo 'external_controller_activation=success'
EOF
chmod 0700 "$remote"

printf '%s\n' '==> Transfer verified activation inputs to the fixed VM'
gcloud compute scp --quiet --project="$PROJECT_ID" --zone="$ZONE" \
  "$archive" "$source_tar" "$remote" \
  "$VM_NAME:/tmp/"

gcloud compute ssh --quiet --project="$PROJECT_ID" --zone="$ZONE" "$VM_NAME" \
  --command="sudo /bin/sh /tmp/$(basename "$remote")"

printf '\n%s\n' 'PHISHTOPIA_OPS_EXTERNAL_CONTROLLER=success'
printf 'PHISHTOPIA_OPS_RELEASE=%s\n' "$release"
printf 'PHISHTOPIA_OPS_ARCHIVE_SHA256=%s\n' "$digest"
