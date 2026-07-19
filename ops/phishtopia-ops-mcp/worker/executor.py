from __future__ import annotations

import math
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from .allowlist import DEADLINES_SECONDS
from .platform import (
    Cancelled,
    DeadlineExceeded,
    PlatformError,
    RealPlatform,
    WorkerHandoffRequested,
)
from .store import JobStore


class JobContext:
    def __init__(self, store: JobStore, row: Any):
        self.store = store
        self.job_id = row["job_id"]
        self.deadline = datetime.fromisoformat(row["deadline_at"].replace("Z", "+00:00"))
        try:
            checkpoint = json.loads(row["checkpoint_json"] or "{}")
        except json.JSONDecodeError:
            checkpoint = {}
        self.mutation_started = bool(
            isinstance(checkpoint, dict) and checkpoint.get("mutationStarted") is True
        )

    def check(self) -> None:
        if self.store.cancellation_requested(self.job_id):
            raise Cancelled("cancel_requested")
        if datetime.now(timezone.utc) >= self.deadline:
            raise DeadlineExceeded("deadline_exceeded")

    def __call__(self) -> None:
        self.check()

    def remaining_seconds(self, maximum: int) -> int:
        self.check()
        remaining = (self.deadline - datetime.now(timezone.utc)).total_seconds()
        return max(1, min(maximum, math.ceil(remaining)))

    def progress(self, value: int, stage: str) -> None:
        self.check()
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", stage):
            raise PlatformError("unsafe_progress_stage")
        self.store.transition(
            self.job_id,
            progress=max(1, min(99, int(value))),
            result_code="in_progress",
            observations=[{"name": "stage", "value": stage}],
            checkpoint={"stage": stage, "mutationStarted": self.mutation_started},
        )

    def mark_mutation_started(self) -> None:
        self.check()
        self.store.transition(
            self.job_id,
            checkpoint={"stage": "mutation_started", "mutationStarted": True},
        )
        self.mutation_started = True


class RollbackGuard:
    """A cancellation-independent, bounded budget for safety recovery."""

    def __init__(self, seconds: int = 600):
        self.deadline = datetime.now(timezone.utc) + timedelta(seconds=seconds)

    def __call__(self) -> None:
        if datetime.now(timezone.utc) >= self.deadline:
            raise DeadlineExceeded("rollback_deadline_exceeded")

    def remaining_seconds(self, maximum: int) -> int:
        self()
        remaining = (self.deadline - datetime.now(timezone.utc)).total_seconds()
        return max(1, min(maximum, math.ceil(remaining)))


class JobExecutor:
    def __init__(self, store: JobStore, platform: RealPlatform):
        self.store = store
        self.platform = platform

    def execute(self, row: Any) -> None:
        context = JobContext(self.store, row)
        action = json.loads(row["action_json"])
        baseline = (
            json.loads(row["baseline_json"])
            if row["baseline_json"]
            else None
        )
        bind_guard = getattr(self.platform, "bind_guard", None)
        if callable(bind_guard):
            bind_guard(context)
        try:
            if baseline is not None:
                checkpoint = json.loads(row["checkpoint_json"] or "{}")
                if (
                    action.get("type") in {"upgrade_ops_release", "rollback_release"}
                    and isinstance(checkpoint, dict)
                    and checkpoint.get("stage") == "worker_handoff_pending"
                    and checkpoint.get("mutationStarted") is True
                ):
                    context.check()
                    observations = self.platform.complete_ops_handoff(
                        action, baseline, context.check
                    )
                    context.check()
                    if not self.store.succeed(
                        context.job_id,
                        self._sanitize_observations(observations),
                    ):
                        raise Cancelled("cancel_won_completion_race")
                    return
                self._finish_with_rollback(
                    action,
                    context.job_id,
                    baseline,
                    cancelled=bool(row["cancel_requested"]),
                    failure_code="interrupted_recovery",
                )
                return
            context.check()
            self.platform.preflight(action, context.check)
            context.progress(5, "preflight_passed")
            baseline = self.platform.capture(action, context.job_id)
            self.store.transition(context.job_id, baseline=baseline)
            context.progress(10, "baseline_captured")
            observations = self.platform.perform(
                action,
                context.job_id,
                baseline,
                context.check,
                context.progress,
                context.mark_mutation_started,
            )
            context.check()
            if not self.store.succeed(
                context.job_id,
                self._sanitize_observations(observations),
            ):
                raise Cancelled("cancel_won_completion_race")
            cleanup = getattr(self.platform, "cleanup", None)
            if callable(cleanup):
                try:
                    cleanup(action, baseline)
                except Exception:
                    # The job is already durably successful. Startup retries
                    # cleanup of root-only recovery material without mutating
                    # the completed result or production state.
                    pass
        except WorkerHandoffRequested:
            # The durable baseline and handoff checkpoint intentionally remain
            # non-terminal. The daemon reexecs from the switched, verified
            # release; startup recovery then completes or rolls back the job.
            return
        except Cancelled:
            self._finish_with_rollback(
                action,
                context.job_id,
                baseline,
                cancelled=True,
                failure_code="cancel_requested",
            )
        except DeadlineExceeded:
            self._finish_with_rollback(
                action,
                context.job_id,
                baseline,
                cancelled=False,
                failure_code="deadline_exceeded",
            )
        except Exception as error:
            failure_code = self._failure_code(error)
            if baseline is None:
                self.store.transition(
                    context.job_id,
                    state="failed",
                    progress=100,
                    result_code="preflight_rejected",
                    observations=[
                        {"name": "safety", "value": "failed_closed"},
                        {"name": "error_code", "value": failure_code},
                    ],
                )
            else:
                self._finish_with_rollback(
                    action,
                    context.job_id,
                    baseline,
                    cancelled=False,
                    failure_code=failure_code,
                )
        finally:
            cleanup_staging = getattr(self.platform, "cleanup_staging", None)
            if callable(cleanup_staging):
                try:
                    cleanup_staging(action)
                except Exception:
                    pass
            if callable(bind_guard):
                bind_guard(None)

    def _finish_with_rollback(
        self,
        action: dict[str, Any],
        job_id: str,
        baseline: dict[str, Any] | None,
        *,
        cancelled: bool,
        failure_code: str,
    ) -> None:
        mutation_started = False
        if baseline is not None:
            try:
                checkpoint = json.loads(
                    self.store.raw(job_id)["checkpoint_json"] or "{}"
                )
            except json.JSONDecodeError:
                checkpoint = {}
            mutation_started = bool(
                isinstance(checkpoint, dict)
                and checkpoint.get("mutationStarted") is True
            )
        if baseline is None or not mutation_started:
            state = "cancelled" if cancelled else "failed"
            result = (
                "cancelled_and_rolled_back" if cancelled else "failed_without_mutation"
            )
            self.store.transition(
                job_id,
                state=state,
                progress=100,
                result_code=result,
                observations=[
                    {"name": "rollback", "value": "not_required"},
                    {"name": "error_code", "value": failure_code},
                ],
            )
            return
        bind_guard = getattr(self.platform, "bind_guard", None)
        if callable(bind_guard):
            bind_guard(RollbackGuard(DEADLINES_SECONDS[action["type"]]))
        try:
            self.platform.rollback(action, baseline)
        except Exception as rollback_error:
            observations = self._failure_observations(
                job_id, failure_code, "operator_attention_required"
            )
            observations.append(
                {
                    "name": "rollback_error_code",
                    "value": self._failure_code(rollback_error),
                }
            )
            self.store.transition(
                job_id,
                state="failed",
                progress=100,
                result_code="rollback_failed",
                observations=observations,
            )
            return
        finally:
            if callable(bind_guard):
                bind_guard(None)
        self.store.transition(
            job_id,
            state="cancelled" if cancelled else "failed",
            progress=100,
            result_code=(
                "cancelled_and_rolled_back" if cancelled else "failed_and_rolled_back"
            ),
            observations=self._failure_observations(job_id, failure_code, "verified"),
        )

    def _failure_observations(
        self, job_id: str, failure_code: str, rollback: str
    ) -> list[dict[str, str]]:
        values = [
            {"name": "rollback", "value": rollback},
            {"name": "error_code", "value": failure_code},
        ]
        row = self.store.raw(job_id)
        try:
            checkpoint = json.loads(row["checkpoint_json"] or "{}")
        except json.JSONDecodeError:
            checkpoint = {}
        stage = checkpoint.get("stage") if isinstance(checkpoint, dict) else None
        if isinstance(stage, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", stage):
            values.append({"name": "last_stage", "value": stage})
        return values

    @staticmethod
    def _failure_code(error: Exception) -> str:
        if isinstance(error, PlatformError):
            value = str(error)
            if re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value):
                return value
            return "platform_error"
        return "internal_error"

    @staticmethod
    def _sanitize_observations(values: Any) -> list[dict[str, str]]:
        if not isinstance(values, list):
            return []
        result: list[dict[str, str]] = []
        forbidden_assignment = re.compile(
            r"(?:authorization|api[_-]?key|token|password|cookie|credential)\s*[=:]\s*[^\s,;]+",
            re.I,
        )
        forbidden_uri = re.compile(r"(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|https?)://[^\s\"']+", re.I)
        for item in values[:12]:
            if not isinstance(item, dict) or set(item) != {"name", "value"}:
                continue
            name, value = item["name"], item["value"]
            if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", name):
                continue
            if not isinstance(value, str):
                continue
            value = re.sub(r"[\x00-\x1f\x7f]", " ", value)
            value = forbidden_assignment.sub("[redacted]", value)
            value = forbidden_uri.sub("[redacted]", value)
            result.append({"name": name, "value": " ".join(value.split())[:160]})
        return result
