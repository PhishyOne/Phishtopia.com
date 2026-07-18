from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import stat
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .allowlist import DEADLINES_SECONDS, resource_for


def now() -> datetime:
    return datetime.now(timezone.utc)


def timestamp(value: datetime | None = None) -> str:
    return (value or now()).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class StoreError(RuntimeError):
    pass


class JobStore:
    MAX_JOBS = 10_000
    MAX_STORAGE_BYTES = 64 * 1024 * 1024

    def __init__(self, database: Path, audit: Path):
        self.database = database
        self.audit = audit
        database.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(database.parent, 0o700)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                  job_id TEXT PRIMARY KEY,
                  idempotency_key TEXT NOT NULL UNIQUE,
                  request_hash TEXT NOT NULL,
                  action_type TEXT NOT NULL,
                  resource TEXT NOT NULL,
                  action_json TEXT NOT NULL,
                  state TEXT NOT NULL CHECK(state IN
                    ('queued','running','succeeded','failed','cancelling','cancelled')),
                  progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100),
                  result_code TEXT,
                  observations_json TEXT NOT NULL DEFAULT '[]',
                  baseline_json TEXT,
                  checkpoint_json TEXT,
                  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  deadline_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_job_per_resource
                  ON jobs(resource)
                  WHERE state IN ('queued','running','cancelling');
                CREATE TABLE IF NOT EXISTS audit_events (
                  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                  entry_json TEXT NOT NULL,
                  flushed INTEGER NOT NULL DEFAULT 0 CHECK(flushed IN (0,1))
                );
                """
            )
            connection.execute("BEGIN IMMEDIATE")
            interrupted = connection.execute(
                "SELECT job_id FROM jobs WHERE state IN ('running','cancelling')"
            ).fetchall()
            connection.execute(
                "UPDATE jobs SET state='queued', progress=MIN(progress, 90), "
                "result_code='in_progress', updated_at=? WHERE state IN ('running','cancelling')",
                (timestamp(),),
            )
            for item in interrupted:
                row = connection.execute(
                    "SELECT * FROM jobs WHERE job_id=?", (item["job_id"],)
                ).fetchone()
                assert row is not None
                self._queue_audit(connection, row, "recovered")
            connection.execute("COMMIT")
        os.chmod(self.database, 0o600)
        self._flush_audit()

    @staticmethod
    def _request_hash(action: dict[str, Any]) -> str:
        encoded = json.dumps(action, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()

    def start(self, idempotency_key: str, action: dict[str, Any]) -> dict[str, Any]:
        request_hash = self._request_hash(action)
        resource = resource_for(action)
        created = now()
        deadline = created + timedelta(seconds=DEADLINES_SECONDS[action["type"]])
        job_id = str(uuid.uuid4())
        preview = self._preview(action, resource)
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                "SELECT * FROM jobs WHERE idempotency_key=?", (idempotency_key,)
            ).fetchone()
            if existing is not None:
                if existing["request_hash"] != request_hash:
                    connection.execute("ROLLBACK")
                    raise StoreError("idempotency_conflict")
                connection.execute("COMMIT")
                return self._public(existing)
            count = connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
            database_size = self.database.stat().st_size if self.database.exists() else 0
            audit_size = self.audit.stat().st_size if self.audit.exists() else 0
            if count >= self.MAX_JOBS or database_size + audit_size >= self.MAX_STORAGE_BYTES:
                connection.execute("ROLLBACK")
                raise StoreError("job_storage_capacity_reached")
            try:
                connection.execute(
                    """INSERT INTO jobs
                    (job_id,idempotency_key,request_hash,action_type,resource,action_json,
                     state,progress,result_code,observations_json,created_at,updated_at,deadline_at)
                    VALUES(?,?,?,?,?,?,'queued',0,'accepted',?,?,?,?)""",
                    (
                        job_id,
                        idempotency_key,
                        request_hash,
                        action["type"],
                        resource,
                        json.dumps(action, sort_keys=True, separators=(",", ":")),
                        json.dumps(preview, separators=(",", ":")),
                        timestamp(created),
                        timestamp(created),
                        timestamp(deadline),
                    ),
                )
            except sqlite3.IntegrityError as error:
                connection.execute("ROLLBACK")
                raise StoreError("resource_busy") from error
            row = connection.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            assert row is not None
            self._queue_audit(connection, row, "accepted")
            connection.execute("COMMIT")
        self._flush_audit()
        return self._public(row)

    def get(self, job_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
        if row is None:
            raise StoreError("not_found")
        return self._public(row)

    def raw(self, job_id: str) -> sqlite3.Row:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
        if row is None:
            raise StoreError("not_found")
        return row

    def completed_recovery_material(self) -> list[tuple[dict[str, Any], dict[str, Any]]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT action_json,baseline_json FROM jobs "
                "WHERE state='succeeded' AND action_type='rotate_session_secret' "
                "AND baseline_json IS NOT NULL"
            ).fetchall()
        return [
            (json.loads(row["action_json"]), json.loads(row["baseline_json"]))
            for row in rows
        ]

    def next_job(self) -> sqlite3.Row | None:
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM jobs WHERE state='queued' ORDER BY created_at LIMIT 1"
            ).fetchone()
            if row is None:
                connection.execute("COMMIT")
                return None
            connection.execute(
                "UPDATE jobs SET state='running',result_code='in_progress',updated_at=? "
                "WHERE job_id=? AND state='queued'",
                (timestamp(), row["job_id"]),
            )
            updated = connection.execute(
                "SELECT * FROM jobs WHERE job_id=?", (row["job_id"],)
            ).fetchone()
            assert updated is not None
            self._queue_audit(connection, updated, "running")
            connection.execute("COMMIT")
        self._flush_audit()
        return updated

    def cancel(self, job_id: str) -> dict[str, Any]:
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            if row is None:
                connection.execute("ROLLBACK")
                raise StoreError("not_found")
            changed = False
            if row["state"] == "queued":
                connection.execute(
                    "UPDATE jobs SET state='cancelled',cancel_requested=1,progress=100,"
                    "result_code='cancelled_and_rolled_back',updated_at=? WHERE job_id=?",
                    (timestamp(), job_id),
                )
                changed = True
            elif row["state"] == "running":
                connection.execute(
                    "UPDATE jobs SET state='cancelling',cancel_requested=1,"
                    "result_code='cancel_requested',updated_at=? WHERE job_id=?",
                    (timestamp(), job_id),
                )
                changed = True
            updated = connection.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            assert updated is not None
            if changed:
                self._queue_audit(connection, updated, "cancel_requested")
            connection.execute("COMMIT")
        self._flush_audit()
        return self._public(updated)

    @staticmethod
    def _preview(action: dict[str, Any], resource: str) -> list[dict[str, str]]:
        preview = [
            {"name": "resource", "value": resource[:64]},
            {"name": "requested_action", "value": str(action["type"])[:64]},
        ]
        commit = action.get("commit") or action.get("release")
        if isinstance(commit, str):
            preview.append({"name": "release", "value": commit[:12]})
        service = action.get("service")
        if isinstance(service, str):
            preview.append({"name": "service", "value": service[:64]})
        target = action.get("target")
        if isinstance(target, str):
            preview.append({"name": "target", "value": target[:64]})
        revision = action.get("revision")
        if isinstance(revision, str):
            preview.append({"name": "revision", "value": revision[:64]})
        migration = action.get("migrationId")
        if isinstance(migration, str):
            preview.append({"name": "migration", "value": migration[:64]})
        percentages = action.get("percentages")
        if isinstance(percentages, list) and all(type(value) is int for value in percentages):
            preview.append(
                {"name": "stages", "value": ",".join(str(value) for value in percentages)[:64]}
            )
        hostname = action.get("hostname")
        if isinstance(hostname, str):
            preview.append({"name": "hostname", "value": hostname[:64]})
        return preview[:6]

    def transition(
        self,
        job_id: str,
        *,
        state: str | None = None,
        progress: int | None = None,
        result_code: str | None = None,
        observations: list[dict[str, str]] | None = None,
        baseline: dict[str, Any] | None = None,
        checkpoint: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        fields: list[str] = ["updated_at=?"]
        values: list[Any] = [timestamp()]
        for name, value in (("state", state), ("progress", progress), ("result_code", result_code)):
            if value is not None:
                fields.append(f"{name}=?")
                values.append(value)
        if observations is not None:
            fields.append("observations_json=?")
            values.append(json.dumps(observations[:12], separators=(",", ":")))
        if baseline is not None:
            fields.append("baseline_json=?")
            values.append(json.dumps(baseline, sort_keys=True, separators=(",", ":")))
        if checkpoint is not None:
            fields.append("checkpoint_json=?")
            values.append(json.dumps(checkpoint, sort_keys=True, separators=(",", ":")))
        values.append(job_id)
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(f"UPDATE jobs SET {','.join(fields)} WHERE job_id=?", values)
            row = connection.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            if row is not None and state is not None:
                self._queue_audit(connection, row, state)
            connection.execute("COMMIT")
        if row is None:
            raise StoreError("not_found")
        if state is not None:
            self._flush_audit()
        return self._public(row)

    def cancellation_requested(self, job_id: str) -> bool:
        row = self.raw(job_id)
        return bool(row["cancel_requested"])

    def succeed(self, job_id: str, observations: list[dict[str, str]]) -> bool:
        """Commit success only if cancellation has not won the race.

        The state predicate and cancel flag are checked in the same SQLite write
        transaction.  A concurrent cancel therefore either happens before this
        update (and forces rollback) or after the job is already terminal.
        """
        encoded = json.dumps(observations[:12], separators=(",", ":"))
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "UPDATE jobs SET state='succeeded',progress=100,result_code='completed',"
                "observations_json=?,updated_at=? WHERE job_id=? AND state='running' "
                "AND cancel_requested=0",
                (encoded, timestamp(), job_id),
            )
            row = connection.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            if cursor.rowcount == 1:
                assert row is not None
                self._queue_audit(connection, row, "succeeded")
            connection.execute("COMMIT")
        if row is None:
            raise StoreError("not_found")
        if cursor.rowcount != 1:
            return False
        self._flush_audit()
        return True

    def _public(self, row: sqlite3.Row) -> dict[str, Any]:
        observations = json.loads(row["observations_json"] or "[]")[:12]
        return {
            "jobId": row["job_id"],
            "action": row["action_type"],
            "state": row["state"],
            "progress": row["progress"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "deadlineAt": row["deadline_at"],
            "resultCode": row["result_code"],
            "observations": observations,
        }

    @staticmethod
    def _queue_audit(
        connection: sqlite3.Connection, row: sqlite3.Row, event: str
    ) -> None:
        value = {
                "at": timestamp(),
                "job_id": row["job_id"],
                "action": row["action_type"],
                "resource": row["resource"],
                "event": event,
                "state": row["state"],
                "result_code": row["result_code"],
            }
        try:
            observations = json.loads(row["observations_json"] or "[]")
        except json.JSONDecodeError:
            observations = []
        for name in ("error_code", "rollback_error_code"):
            error_codes = [
                item.get("value")
                for item in observations
                if isinstance(item, dict) and item.get("name") == name
            ]
            if (
                len(error_codes) == 1
                and isinstance(error_codes[0], str)
                and error_codes[0].replace("_", "").isalnum()
            ):
                value[name] = error_codes[0]
        entry = json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
        )
        connection.execute(
            "INSERT INTO audit_events(entry_json,flushed) VALUES(?,0)", (entry,)
        )

    def _flush_audit(self) -> None:
        with self._lock, self._connect() as connection:
            pending = connection.execute(
                "SELECT event_id,entry_json FROM audit_events WHERE flushed=0 "
                "ORDER BY event_id LIMIT 1000"
            ).fetchall()
            if not pending:
                return
        flags = os.O_APPEND | os.O_CREAT | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self.audit, flags, 0o600)
        try:
            details = os.fstat(descriptor)
            if (
                not stat.S_ISREG(details.st_mode)
                or details.st_nlink != 1
                or details.st_uid != os.geteuid()
                or details.st_mode & 0o077
                or details.st_size >= self.MAX_STORAGE_BYTES
            ):
                raise StoreError("unsafe_audit_target")
            for item in pending:
                os.write(descriptor, item["entry_json"].encode() + b"\n")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.executemany(
                "UPDATE audit_events SET flushed=1 WHERE event_id=?",
                ((item["event_id"],) for item in pending),
            )
            connection.execute("COMMIT")
