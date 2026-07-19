#!/usr/bin/python3
from __future__ import annotations

import ipaddress
import os
import socket
import sys
from pathlib import Path

if len(sys.argv) != 2 or Path(sys.argv[1]) != Path("/var/lib/phishtopia-ops-bootstrap-active/npm.hosts"):
    raise SystemExit("registry hosts path rejected")

addresses = {
    str(ipaddress.ip_address(result[4][0]))
    for result in socket.getaddrinfo("registry.npmjs.org", 443, type=socket.SOCK_STREAM)
}
if not addresses or len(addresses) > 16 or any(
    not ipaddress.ip_address(address).is_global for address in addresses
):
    raise SystemExit("registry address policy rejected")

path = Path(sys.argv[1])
descriptor = os.open(
    path,
    os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0),
    0o600,
)
try:
    os.write(
        descriptor,
        b"127.0.0.1 localhost\n::1 localhost\n"
        + b"".join(
            f"{address} registry.npmjs.org\n".encode() for address in sorted(addresses)
        ),
    )
    os.fsync(descriptor)
finally:
    os.close(descriptor)
for address in sorted(addresses):
    print(address)
