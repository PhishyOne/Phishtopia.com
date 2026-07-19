#!/usr/bin/python3
from __future__ import annotations

import ipaddress
import os
import socket
import sys
from pathlib import Path
from typing import Iterable

REGISTRY_HOST = "registry.npmjs.org"
REGISTRY_PORT = 443
EXPECTED_HOSTS_PATH = Path("/var/lib/phishtopia-ops-bootstrap-active/npm.hosts")
MAX_TOTAL_ADDRESSES = 32
MAX_ADDRESSES_PER_FAMILY = 16


def fail() -> None:
    raise SystemExit("registry address policy rejected")


def normalize_registry_addresses(values: Iterable[str]) -> tuple[str, ...]:
    try:
        addresses = {ipaddress.ip_address(value) for value in values}
    except ValueError:
        fail()

    family_counts = {
        version: sum(address.version == version for address in addresses)
        for version in (4, 6)
    }
    if (
        not addresses
        or len(addresses) > MAX_TOTAL_ADDRESSES
        or any(count > MAX_ADDRESSES_PER_FAMILY for count in family_counts.values())
        or any(not address.is_global for address in addresses)
    ):
        fail()

    ordered = sorted(addresses, key=lambda address: (address.version, int(address)))
    return tuple(str(address) for address in ordered)


def resolve_registry_addresses() -> tuple[str, ...]:
    return normalize_registry_addresses(
        result[4][0]
        for result in socket.getaddrinfo(
            REGISTRY_HOST,
            REGISTRY_PORT,
            type=socket.SOCK_STREAM,
        )
    )


def render_hosts(addresses: Iterable[str]) -> bytes:
    return b"127.0.0.1 localhost\n::1 localhost\n" + b"".join(
        f"{address} {REGISTRY_HOST}\n".encode() for address in addresses
    )


def write_hosts(path: Path, addresses: tuple[str, ...]) -> None:
    if path != EXPECTED_HOSTS_PATH:
        raise SystemExit("registry hosts path rejected")

    descriptor = os.open(
        path,
        os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    try:
        os.write(descriptor, render_hosts(addresses))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("registry hosts path rejected")
    path = Path(sys.argv[1])
    if path != EXPECTED_HOSTS_PATH:
        raise SystemExit("registry hosts path rejected")

    addresses = resolve_registry_addresses()
    write_hosts(path, addresses)
    for address in addresses:
        print(address)


if __name__ == "__main__":
    main()
