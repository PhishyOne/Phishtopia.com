#!/bin/sh
set -eu

repository_root=$(git rev-parse --show-toplevel)
files=$(git -C "$repository_root" ls-files --cached --others --exclude-standard ops)
forbidden_files=$(printf '%s\n' "$files" | \
  grep -E '(^|/)(\.env|\.npmrc|__pycache__|[^/]*\.(pem|key|p12|sqlite[^/]*|db|log|py[co])|[^/]*credential[^/]*|token\.json|service-account\.json)$' || true)
if [ -n "$forbidden_files" ]; then
  echo "forbidden credential/runtime file detected"
  exit 1
fi

patterns='-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,}|xox[baprs]-[0-9A-Za-z-]{20,}|AKIA[0-9A-Z]{16}'
printf '%s\n' "$files" | while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in
    ops/phishtopia-ops-mcp/scripts/secret-scan.sh) continue ;;
  esac
  if [ -f "$repository_root/$file" ] && grep -IlE -e "$patterns" "$repository_root/$file" >/dev/null 2>&1; then
    echo "credential-shaped value detected in ops source"
    exit 1
  fi
done

if printf '%s\n' "$files" | grep -Eq '(^|/)(dist|node_modules|\.tools|state|logs?|__pycache__)/'; then
  echo "generated dependency/runtime directory is tracked"
  exit 1
fi

echo "ops_secret_scan=passed"
