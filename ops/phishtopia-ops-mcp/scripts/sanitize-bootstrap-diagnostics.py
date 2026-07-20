#!/usr/bin/python3
from __future__ import annotations

import re
import sys

MAX_INPUT = 1_000_000
MAX_LINES = 4_000
MAX_LINE = 1_500

ASSIGNMENT = re.compile(
    r"(?i)(authorization|bearer|api[_-]?key|credential|password|secret|token)"
    r"(\s*[:=]\s*)([^\s,;]+)"
)
OPAQUE = re.compile(r"(?<![A-Za-z0-9])[A-Za-z0-9+/_=-]{32,}(?![A-Za-z0-9])")
HEX_DIGEST = re.compile(r"^[0-9a-f]{40}$|^[0-9a-f]{64}$", re.I)


def sanitize_line(value: str) -> str:
    if re.fullmatch(r"release=[0-9a-f]{40}", value, re.I):
        return value
    value = ASSIGNMENT.sub(
        lambda match: match.group(1) + match.group(2) + "[REDACTED]", value
    )

    def opaque(match: re.Match[str]) -> str:
        candidate = match.group(0)
        return candidate if HEX_DIGEST.fullmatch(candidate) else "[REDACTED]"

    return OPAQUE.sub(opaque, value)[:MAX_LINE]


def sanitize(value: str) -> str:
    lines = value[:MAX_INPUT].splitlines()[:MAX_LINES]
    return "\n".join(sanitize_line(line) for line in lines) + "\n"


def main() -> None:
    data = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(data) > MAX_INPUT:
        data = data[:MAX_INPUT] + b"\n[diagnostic input truncated]\n"
    sys.stdout.write(sanitize(data.decode("utf8", errors="replace")))


if __name__ == "__main__":
    main()
