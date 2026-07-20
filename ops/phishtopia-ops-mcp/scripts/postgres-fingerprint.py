#!/usr/bin/python3
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from collections.abc import Iterable
from typing import BinaryIO

DATABASE = "phishtopia"
EXCLUDED_RUNTIME_TABLES = frozenset({("public", "session")})
BASE_ENV = {
    "PATH": "/usr/sbin:/usr/bin:/sbin:/bin",
    "HOME": "/var/lib/postgresql",
    "NO_COLOR": "1",
    "PGAPPNAME": "phishtopia-ops-fingerprint",
}
SET_PRIV = (
    "/usr/bin/setpriv",
    "--reuid=postgres",
    "--regid=postgres",
    "--init-groups",
    "--no-new-privs",
    "--",
)


def _postgres_command(*arguments: str) -> list[str]:
    return [*SET_PRIV, *arguments]


def _run(arguments: list[str], *, timeout: int = 120) -> bytes:
    completed = subprocess.run(
        arguments,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=BASE_ENV,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError("postgres_fingerprint_command_failed")
    return completed.stdout


def normalize_schema_lines(lines: Iterable[bytes]) -> Iterable[bytes]:
    """Remove only pg_dump transport metadata, never SQL statements."""
    for raw in lines:
        line = raw.rstrip(b"\r\n")
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith(b"--"):
            continue
        if stripped.startswith(b"\\restrict ") or stripped.startswith(b"\\unrestrict "):
            continue
        yield line + b"\n"


def _schema_digest() -> str:
    process = subprocess.Popen(
        _postgres_command(
            "/usr/bin/pg_dump",
            "--schema-only",
            "--no-owner",
            "--no-privileges",
            "--restrict-key=PhishtopiaOpsFingerprint1",
            "-d",
            DATABASE,
        ),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=BASE_ENV,
    )
    assert process.stdout is not None
    digest = hashlib.sha256()
    try:
        for line in normalize_schema_lines(process.stdout):
            digest.update(line)
    finally:
        process.stdout.close()
    if process.wait(timeout=180) != 0:
        raise RuntimeError("postgres_schema_fingerprint_failed")
    return digest.hexdigest()


def quote_identifier(value: str) -> str:
    if "\x00" in value:
        raise ValueError("invalid_postgres_identifier")
    return '"' + value.replace('"', '""') + '"'


def _table_list() -> list[tuple[str, str]]:
    sql = """
SELECT json_build_object('schema', n.nspname, 'table', c.relname)::text
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_toast'
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C";
""".strip()
    output = _run(
        _postgres_command(
            "/usr/bin/psql",
            "-X",
            "--no-psqlrc",
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
            "-d",
            DATABASE,
            "-c",
            sql,
        ),
        timeout=60,
    )
    result: list[tuple[str, str]] = []
    for raw in output.splitlines():
        value = json.loads(raw)
        schema, table = value.get("schema"), value.get("table")
        if not isinstance(schema, str) or not isinstance(table, str):
            raise RuntimeError("postgres_table_metadata_invalid")
        if (schema, table) not in EXCLUDED_RUNTIME_TABLES:
            result.append((schema, table))
    return result


def _hash_stream(digest: "hashlib._Hash", stream: BinaryIO) -> None:
    while chunk := stream.read(1_048_576):
        digest.update(chunk)


def _protected_data_digest() -> tuple[str, int]:
    digest = hashlib.sha256()
    tables = _table_list()
    for schema, table in tables:
        marker = json.dumps(
            {"schema": schema, "table": table},
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf8")
        digest.update(b"table\0" + marker + b"\0")
        qualified = f"{quote_identifier(schema)}.{quote_identifier(table)}"
        sql = (
            "COPY (SELECT row_to_json(t)::text FROM ONLY "
            + qualified
            + ' AS t ORDER BY row_to_json(t)::text COLLATE "C") TO STDOUT;'
        )
        process = subprocess.Popen(
            _postgres_command(
                "/usr/bin/psql",
                "-X",
                "--no-psqlrc",
                "-v",
                "ON_ERROR_STOP=1",
                "-d",
                DATABASE,
                "-c",
                sql,
            ),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=BASE_ENV,
        )
        assert process.stdout is not None
        try:
            _hash_stream(digest, process.stdout)
        finally:
            process.stdout.close()
        if process.wait(timeout=300) != 0:
            raise RuntimeError("postgres_data_fingerprint_failed")
        digest.update(b"\0end-table\0")
    return digest.hexdigest(), len(tables)


def fingerprint() -> dict[str, object]:
    data_digest, table_count = _protected_data_digest()
    return {
        "format": "phishtopia-postgres-fingerprint-v1",
        "schema_sha256": _schema_digest(),
        "protected_data_sha256": data_digest,
        "protected_table_count": table_count,
        "excluded_runtime_tables": ["public.session"],
    }


def main() -> None:
    if os.geteuid() != 0 or len(sys.argv) != 1:
        raise SystemExit("postgres fingerprint requires root and no arguments")
    print(json.dumps(fingerprint(), sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
