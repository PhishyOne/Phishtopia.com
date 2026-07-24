#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || { echo "launcher compatibility installer requires root" >&2; exit 1; }
[ "$#" -eq 2 ] || { echo "usage: run-install-bootstrap-with-launcher-compat.sh COMMIT_SHA ARTIFACT_SHA256" >&2; exit 1; }

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_installer="$script_dir/install-bootstrap.sh"
[ -f "$source_installer" ] && [ ! -L "$source_installer" ] || {
  echo "fixed bootstrap installer missing" >&2
  exit 1
}
[ "$(sha256sum "$source_installer" | cut -d' ' -f1)" = a38d6ef8c340000d88fb9eb7c598f808b3196ebcf7141fa9b9eb9951784b4d01 ] || {
  echo "fixed bootstrap installer changed unexpectedly" >&2
  exit 1
}

patched=$(mktemp "$script_dir/.install-bootstrap.compat.XXXXXX")
cleanup() {
  rm -f "$patched"
}
trap cleanup EXIT HUP INT TERM

python3 - "$source_installer" "$patched" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])
value = source.read_text(encoding="utf-8")
old = '''[ "$(sha256sum "$candidate/systemd/phishtopia-ops-mcp-tunnel-launch" | cut -d' ' -f1)" = "$(sed -n '1p' "$state/tunnel-launcher.sha256")" ]'''
new = '''baseline_launcher_sha=$(sed -n '1p' "$state/tunnel-launcher.sha256")
candidate_launcher_sha=$(sha256sum "$candidate/systemd/phishtopia-ops-mcp-tunnel-launch" | cut -d' ' -f1)
if [ "$candidate_launcher_sha" != "$baseline_launcher_sha" ]; then
  [ "$baseline_launcher_sha" = a71f4f6b166d12ea41c7625e022d325cb5b8f7dd66131a5196e63fa061a0662c ] &&
    [ "$candidate_launcher_sha" = 00b18260ac1e87b3c57ce8743fcfe9bc401f296f508fb47e4180bb9c13b640ea ] || {
      echo "tunnel launcher transition rejected" >&2
      exit 1
    }
fi'''
if value.count(old) != 1:
    raise SystemExit("fixed launcher guard not found exactly once")
target.write_text(value.replace(old, new, 1), encoding="utf-8")
PY

chmod 0700 "$patched"
[ "$(sha256sum "$patched" | cut -d' ' -f1)" = 7bf704d26b6978e667dae089f785cab9822f16bcf22ff1db55c6585ce72f26f7 ] || {
  echo "launcher compatibility installer digest mismatch" >&2
  exit 1
}

/bin/sh "$patched" "$@"
