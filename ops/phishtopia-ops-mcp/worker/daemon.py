from __future__ import annotations

import grp
import json
import os
import pwd
import signal
import socket
import socketserver
import struct
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from .allowlist import (
    ACTION_NAMES,
    ValidationError,
    validate_action,
    validate_idempotency_key,
    validate_job_id,
)
from .executor import JobExecutor
from .platform import RealPlatform
from .platform import WORKER_REEXEC_FLAG
from .store import JobStore, StoreError

STATE_ROOT = Path("/var/lib/phishtopia-ops-worker")
SOCKET_PATH = Path("/run/phishtopia-ops-worker/worker.sock")
BOOTSTRAP_ACTIVE = Path("/var/lib/phishtopia-ops-bootstrap-active")
MAX_REQUEST = 32_768


class WorkerApplication:
    def __init__(self, store: JobStore, executor: JobExecutor):
        self.store = store
        self.executor = executor
        self.platform = getattr(executor, "platform", None)
        self.stop_event = threading.Event()
        self._admission_lock = threading.Lock()
        self._job_starts: deque[float] = deque()

    def _admit_job_start(self) -> None:
        cutoff = time.monotonic() - 60
        with self._admission_lock:
            while self._job_starts and self._job_starts[0] < cutoff:
                self._job_starts.popleft()
            if len(self._job_starts) >= 30:
                raise ValidationError("start_rate_limited")
            self._job_starts.append(time.monotonic())

    def handle(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict) or set(value) != {"operation", "payload"}:
            raise ValidationError("invalid_request")
        operation, payload = value["operation"], value["payload"]
        if operation == "get_contract":
            if payload != {}:
                raise ValidationError("invalid_contract_payload")
            return {
                "ok": True,
                "contract": {
                    "version": "issue15-v1",
                    "actions": sorted(ACTION_NAMES),
                    "singleFlight": "production_mutation",
                },
            }
        if operation == "get_runtime_preflight":
            if payload != {} or self.platform is None:
                raise ValidationError("invalid_runtime_preflight_payload")
            return {
                "ok": True,
                "preflight": self.platform.runtime_preflight_contract(),
            }
        if operation == "start_job":
            if BOOTSTRAP_ACTIVE.exists():
                raise ValidationError("bootstrap_not_committed")
            if not isinstance(payload, dict) or set(payload) != {"idempotencyKey", "action"}:
                raise ValidationError("invalid_start_payload")
            key = validate_idempotency_key(payload["idempotencyKey"])
            action = validate_action(payload["action"])
            self._admit_job_start()
            return {"ok": True, "job": self.store.start(key, action)}
        if operation in {"get_job_status", "cancel_job"}:
            if not isinstance(payload, dict) or set(payload) != {"jobId"}:
                raise ValidationError("invalid_job_payload")
            job_id = validate_job_id(payload["jobId"])
            job = self.store.get(job_id) if operation == "get_job_status" else self.store.cancel(job_id)
            return {"ok": True, "job": job}
        raise ValidationError("invalid_operation")

    def run_jobs(self) -> None:
        while not self.stop_event.is_set():
            row = self.store.next_job()
            if row is None:
                self.stop_event.wait(0.25)
                continue
            self.executor.execute(row)
            if WORKER_REEXEC_FLAG.exists():
                self.stop_event.set()
                return


class RequestHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        application: WorkerApplication = self.server.application  # type: ignore[attr-defined]
        try:
            self.request.settimeout(5)
            self._verify_peer()
            data = self.rfile.readline(MAX_REQUEST + 1)
            if not data.endswith(b"\n") or len(data) > MAX_REQUEST:
                raise ValidationError("request_too_large")
            value = json.loads(data)
            response = application.handle(value)
        except (ValidationError, StoreError, json.JSONDecodeError):
            response = {"ok": False, "error": "request_rejected"}
        except Exception:
            response = {"ok": False, "error": "worker_unavailable"}
        encoded = json.dumps(response, separators=(",", ":")).encode() + b"\n"
        if len(encoded) > 65_536:
            encoded = b'{"ok":false,"error":"worker_unavailable"}\n'
        self.wfile.write(encoded)

    def _verify_peer(self) -> None:
        if not hasattr(socket, "SO_PEERCRED"):
            raise ValidationError("peer_credentials_unavailable")
        credentials = self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
        _pid, uid, _gid = struct.unpack("3i", credentials)
        allowed = {0, pwd.getpwnam("phishtopia-mcp").pw_uid}
        if uid not in allowed:
            raise ValidationError("peer_not_allowed")


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    allow_reuse_address = False
    request_queue_size = 16

    def __init__(self, path: str, handler: type[RequestHandler], application: WorkerApplication):
        self.application = application
        self._slots = threading.BoundedSemaphore(16)
        super().__init__(path, handler)

    def process_request(self, request: socket.socket, client_address: Any) -> None:
        if not self._slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request: socket.socket, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()


def main() -> None:
    os.umask(0o077)
    if os.geteuid() != 0:
        raise SystemExit("worker must run as root")
    # A flag present at process start means systemd already restarted us after
    # the symlink switch. Consume it so only the old process requests reexec.
    WORKER_REEXEC_FLAG.unlink(missing_ok=True)
    STATE_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    store = JobStore(STATE_ROOT / "jobs.sqlite3", STATE_ROOT / "audit.jsonl")
    platform = RealPlatform()
    for action, baseline in store.completed_recovery_material():
        platform.cleanup(action, baseline)
    application = WorkerApplication(store, JobExecutor(store, platform))
    SOCKET_PATH.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    SOCKET_PATH.unlink(missing_ok=True)
    server = Server(str(SOCKET_PATH), RequestHandler, application)
    os.chown(SOCKET_PATH, 0, grp.getgrnam("phishtopia-mcp").gr_gid)
    os.chmod(SOCKET_PATH, 0o660)

    def stop(_signum: int, _frame: Any) -> None:
        application.stop_event.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    worker_failed = threading.Event()

    def run_worker() -> None:
        try:
            application.run_jobs()
        except BaseException:
            worker_failed.set()
            application.stop_event.set()
            server.shutdown()
        else:
            server.shutdown()

    worker = threading.Thread(target=run_worker, daemon=False)
    worker.start()
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        application.stop_event.set()
        worker.join(timeout=30)
        server.server_close()
        SOCKET_PATH.unlink(missing_ok=True)
    if worker_failed.is_set():
        raise RuntimeError("job worker failed; requesting systemd restart")
    if WORKER_REEXEC_FLAG.exists():
        WORKER_REEXEC_FLAG.unlink()
        os.execv("/usr/bin/python3", ["/usr/bin/python3", "-m", "worker.daemon"])


if __name__ == "__main__":
    main()
