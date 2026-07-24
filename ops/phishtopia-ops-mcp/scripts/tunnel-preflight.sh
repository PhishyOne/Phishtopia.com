#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo "tunnel preflight requires root" >&2; exit 1; }
[ "$#" -eq 1 ] || { echo "usage: tunnel-preflight.sh CANDIDATE_LAUNCHER" >&2; exit 1; }
launcher=$1
[ -f "$launcher" ] && [ ! -L "$launcher" ] || { echo "candidate tunnel launcher invalid" >&2; exit 1; }

unit=phishtopia-ops-tunnel-preflight
copy=/run/phishtopia-ops-tunnel-preflight-launch
credential_name='control-plane-api''-key'
credential_path="/etc/credstore/phishtopia-ops-mcp/$credential_name"
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  systemctl stop "$unit.service" 2>/dev/null || true
  rm -f "$copy"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

install -o root -g root -m 0755 "$launcher" "$copy"
systemctl reset-failed "$unit.service" 2>/dev/null || true

/usr/bin/systemd-run --wait --collect --quiet \
  --unit="$unit" --uid=phishtopia-mcp --gid=phishtopia-mcp \
  --working-directory=/opt/phishtopia-ops-mcp \
  --setenv=HOME=/var/lib/phishtopia-ops-mcp \
  --setenv=PATH=/opt/phishtopia-ops-runtime/node/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  --setenv=CLOUDSDK_CONFIG=/var/lib/phishtopia-ops-mcp/.config/gcloud \
  --property="LoadCredential=$credential_name:$credential_path" \
  --property=RuntimeDirectory=phishtopia-ops-tunnel-preflight \
  --property=RuntimeDirectoryMode=0700 \
  --property=StateDirectory=phishtopia-ops-mcp \
  --property=StateDirectoryMode=0700 \
  --property=NoNewPrivileges=yes --property=PrivateTmp=yes --property=PrivateDevices=yes \
  --property=ProtectSystem=strict --property=ProtectHome=yes --property=ProtectClock=yes \
  --property=ProtectHostname=yes --property=ProtectKernelTunables=yes \
  --property=ProtectKernelModules=yes --property=ProtectKernelLogs=yes \
  --property=ProtectControlGroups=yes --property=ProtectProc=invisible --property=ProcSubset=pid \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
  --property=RestrictNamespaces=yes --property=RestrictRealtime=yes \
  --property=RestrictSUIDSGID=yes --property=LockPersonality=yes \
  --property=CapabilityBoundingSet= --property=AmbientCapabilities= \
  --property=RemoveIPC=yes --property=TasksMax=64 --property=LimitNOFILE=1024 \
  --property=UMask=0077 --property=KillMode=mixed --property=TimeoutStopSec=30 \
  --property=MemoryHigh=128M --property=MemoryMax=192M --property=OOMScoreAdjust=500 \
  --property=RuntimeMaxSec=90 --property=StandardOutput=journal --property=StandardError=journal \
  -- /bin/sh "$copy" doctor

echo "tunnel_preflight=passed"
