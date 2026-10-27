from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
from dataclasses import dataclass, field
from typing import Any, Iterable

from .task import ProgressState

SOFT_REPLAN_SCORE = 6
HARD_STOP_SCORE = 10
MIN_NO_PROGRESS = 3
POST_REPLAN_NO_PROGRESS = 2

_ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_TIMESTAMP_RE = re.compile(
    r"\b(?:\d{4}-\d{2}-\d{2}[T ][0-9:.+-Z]+|\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)\b"
)
_PID_RE = re.compile(r"\b(?:pid|process)\s*[=:]?\s*\d+\b", re.IGNORECASE)
_SECRET_RE = re.compile(
    r"(?i)(token|password|passwd|secret|api[_-]?key|authorization)(\s*[=:]\s*)([^\s,;]+)"
)
_ABS_PATH_RE = re.compile(r"(?<![\w./-])/(?:[^\s:'\"]+/)*[^\s:'\"]*")
_FAILURE_PATTERNS = (
    re.compile(r"(?i)(\d+)\s+failed"),
    re.compile(r"(?i)tests?:\s*(\d+)\s+failed"),
    re.compile(r"(?i)failures?:\s*(\d+)"),
)


@dataclass(slots=True, frozen=True)
class ActionFingerprint:
    value: str
    tool: str
    target: str = ""


@dataclass(slots=True, frozen=True)
class ResultFingerprint:
    value: str
    error_signature: str = ""
    test_failures: int | None = None


@dataclass(slots=True)
class ToolObservation:
    action: ActionFingerprint
    result: ResultFingerprint
    progress_reasons: list[str] = field(default_factory=list)
    duplicate_reasons: list[str] = field(default_factory=list)
    diff_hash: str = ""

    @property
    def made_progress(self) -> bool:
        return bool(self.progress_reasons)


@dataclass(slots=True)
class LoopAssessment:
    observation: ToolObservation
    action: str = "CONTINUE"
    loop_score: int = 0
    no_progress_iterations: int = 0
    strategy_id: int = 1


@dataclass(slots=True)
class LoopFinding:
    """Compatibility shape for diagnostics that used the old passive detector."""

    kind: str
    summary: str
    count: int
    fingerprint: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "summary": self.summary,
            "count": self.count,
            "fingerprint": self.fingerprint,
        }


class AgentLoopDetector:
    """Progress-aware controller. It stores only stable hashes, never raw content."""

    def __init__(self, progress: ProgressState | None = None) -> None:
        self.progress = progress or ProgressState()
        self._pair_counts = self.progress.action_result_counts
        self._soft_replan_iteration = self.progress.soft_replan_no_progress_at
        self._last_action = ""

    def observe(
        self,
        name: str,
        arguments: dict[str, Any] | None,
        *,
        output: str = "",
        diff: str = "",
        metadata: dict[str, Any] | None = None,
        error: str = "",
        workspace: str = "",
    ) -> LoopAssessment:
        action = fingerprint_action(name, arguments or {}, workspace=workspace)
        result = fingerprint_result(output, error=error, workspace=workspace)
        pair = _hash_text(f"{action.value}:{result.value}")
        same_pair_count = self._pair_counts.get(pair, 0) + 1
        self._pair_counts[pair] = same_pair_count

        observation = ToolObservation(action=action, result=result)
        target = action.target
        tool = str(name or "").strip().lower()
        diff_hash = _hash_text(normalize_result_text(diff, workspace=workspace)) if diff else ""
        observation.diff_hash = diff_hash

        if target and tool in {"list_files", "search_files"} and target not in self.progress.files_discovered:
            self.progress.files_discovered.append(target)
            observation.progress_reasons.append("new_target")
        elif target and tool in {"read_file", "read_tool_output", "fetch_url"} and target not in self.progress.files_read:
            self.progress.files_read.append(target)
            observation.progress_reasons.append("new_information")

        if diff_hash:
            if diff_hash not in self.progress.diff_hashes:
                self.progress.diff_hashes.append(diff_hash)
                if target and target not in self.progress.files_modified:
                    self.progress.files_modified.append(target)
                observation.progress_reasons.append("diff_changed")
            else:
                observation.duplicate_reasons.append("known_diff")

        failures = result.test_failures
        if failures is not None:
            previous = self.progress.last_test_failures
            if previous is not None and failures < previous:
                observation.progress_reasons.append("tests_improved")
            elif previous is not None and failures >= previous:
                observation.duplicate_reasons.append("tests_not_improved")
            self.progress.last_test_failures = failures

        explicit = metadata or {}
        call_id = str(explicit.get("callId") or "").strip()
        if explicit.get("hypothesisDiscarded"):
            observation.progress_reasons.append("hypothesis_discarded")
        if explicit.get("planStepCompleted"):
            observation.progress_reasons.append("plan_step_completed")
        if explicit.get("newSymbol") or explicit.get("newFile"):
            observation.progress_reasons.append("new_artifact")

        if result.error_signature:
            if result.error_signature not in self.progress.error_signatures:
                self.progress.error_signatures.append(result.error_signature)
            else:
                observation.duplicate_reasons.append("same_error")

        if result.value in self.progress.result_fingerprints:
            observation.duplicate_reasons.append("same_result")
        else:
            self.progress.result_fingerprints.append(result.value)
            # New output alone is weak evidence. Count it only for information-seeking tools.
            if tool in {"read_file", "list_files", "search_files", "get_diagnostics", "fetch_url"}:
                observation.progress_reasons.append("new_result")

        if action.value in self.progress.avoid_action_fingerprints:
            observation.duplicate_reasons.append("abandoned_strategy_action")

        # A failed lookup is not a discovered file, and varying the error text
        # must not reset recovery forever. Keep error hashes for diagnostics.
        if error:
            observation.progress_reasons.clear()

        if observation.made_progress:
            self.progress.progress_events += 1
            self.progress.no_progress_iterations = 0
            self.progress.loop_score = max(
                0,
                self.progress.loop_score - (3 if "tests_improved" in observation.progress_reasons else 2),
            )
            self._soft_replan_iteration = None
            self.progress.soft_replan_no_progress_at = None
            self.progress.recent_no_progress_call_ids.clear()
        else:
            self.progress.no_progress_iterations += 1
            score = 1
            if same_pair_count > 1:
                score += 2
            if "same_error" in observation.duplicate_reasons:
                score += 2
            if "known_diff" in observation.duplicate_reasons:
                score += 2
            if "abandoned_strategy_action" in observation.duplicate_reasons:
                score += 3
            self.progress.loop_score += score
            if call_id and call_id not in self.progress.recent_no_progress_call_ids:
                self.progress.recent_no_progress_call_ids.append(call_id)

        self._last_action = action.value
        self._trim()

        decision = "CONTINUE"
        repeated_three_times = same_pair_count >= 3
        if (
            self.progress.loop_score >= SOFT_REPLAN_SCORE
            and (self.progress.no_progress_iterations >= MIN_NO_PROGRESS or repeated_three_times)
            and self._soft_replan_iteration is None
        ):
            decision = "SOFT_REPLAN"
            self.progress.soft_replans += 1
            self._soft_replan_iteration = self.progress.no_progress_iterations
            self.progress.soft_replan_no_progress_at = self._soft_replan_iteration
        elif (
            self.progress.loop_score >= HARD_STOP_SCORE
            and self._soft_replan_iteration is not None
            and self.progress.no_progress_iterations - self._soft_replan_iteration
            >= POST_REPLAN_NO_PROGRESS
        ):
            decision = "HARD_TRAJECTORY_STOP"

        return LoopAssessment(
            observation=observation,
            action=decision,
            loop_score=self.progress.loop_score,
            no_progress_iterations=self.progress.no_progress_iterations,
            strategy_id=self.progress.strategy_id,
        )

    def abandon_strategy(self) -> int:
        if self._last_action and self._last_action not in self.progress.avoid_action_fingerprints:
            self.progress.avoid_action_fingerprints.append(self._last_action)
        self.progress.hard_stops += 1
        self.progress.strategy_id += 1
        self.progress.require_new_strategy_action = True
        for call_id in self.progress.recent_no_progress_call_ids:
            if call_id not in self.progress.superseded_call_ids:
                self.progress.superseded_call_ids.append(call_id)
        self.progress.recent_no_progress_call_ids.clear()
        self.progress.loop_score = 0
        self.progress.no_progress_iterations = 0
        self._soft_replan_iteration = None
        self.progress.soft_replan_no_progress_at = None
        self._pair_counts.clear()
        self._trim()
        return self.progress.strategy_id

    def reject_abandoned_first_action(
        self,
        name: str,
        arguments: dict[str, Any] | None,
        *,
        workspace: str = "",
    ) -> bool:
        """Reject only the first action after a hard stop when it repeats that strategy."""
        if not self.progress.require_new_strategy_action:
            return False
        self.progress.require_new_strategy_action = False
        action = fingerprint_action(name, arguments or {}, workspace=workspace)
        return action.value in self.progress.avoid_action_fingerprints

    def note_tool(self, name: str, arguments: dict[str, Any], *, failed: bool = False) -> LoopFinding | None:
        assessment = self.observe(
            name,
            arguments,
            output="failed" if failed else "ok",
            error="failed" if failed else "",
        )
        if assessment.action == "CONTINUE":
            return None
        return LoopFinding(
            kind=assessment.action.lower(),
            summary="Repeated action without deterministic progress",
            count=assessment.no_progress_iterations,
            fingerprint=assessment.observation.action.value,
        )

    def note_iteration(self, _iteration: int) -> list[LoopFinding]:
        # Iterations are not failures. Only concrete tool observations may
        # increase the score, so long useful tasks remain unlimited.
        return []

    def _trim(self) -> None:
        self.progress.files_discovered[:] = self.progress.files_discovered[-64:]
        self.progress.files_read[:] = self.progress.files_read[-64:]
        self.progress.files_modified[:] = self.progress.files_modified[-64:]
        self.progress.result_fingerprints[:] = self.progress.result_fingerprints[-64:]
        self.progress.diff_hashes[:] = self.progress.diff_hashes[-32:]
        self.progress.error_signatures[:] = self.progress.error_signatures[-32:]
        self.progress.avoid_action_fingerprints[:] = self.progress.avoid_action_fingerprints[-16:]
        self.progress.action_result_counts = dict(list(self._pair_counts.items())[-64:])
        self.progress.recent_no_progress_call_ids[:] = self.progress.recent_no_progress_call_ids[-32:]
        self.progress.superseded_call_ids[:] = self.progress.superseded_call_ids[-128:]


def fingerprint_action(
    name: str,
    arguments: dict[str, Any],
    *,
    workspace: str = "",
) -> ActionFingerprint:
    tool = str(name or "tool").strip().lower() or "tool"
    normalized: dict[str, Any] = {}
    target = ""
    for key in sorted(arguments):
        value = arguments[key]
        lowered = str(key).lower()
        if any(secret in lowered for secret in ("token", "password", "secret", "api_key", "apikey")):
            normalized[key] = "<redacted>"
            continue
        if lowered in {"path", "cwd", "directory", "file", "target"} and isinstance(value, str):
            value = normalize_path(value, workspace=workspace)
            target = target or value
        elif lowered in {"command", "cmd"} and isinstance(value, str):
            value = normalize_command(value, workspace=workspace)
        else:
            value = _normalize_json_value(value, workspace=workspace)
        normalized[key] = value
    payload = json.dumps({"tool": tool, "arguments": normalized}, sort_keys=True, separators=(",", ":"))
    return ActionFingerprint(value=_hash_text(payload), tool=tool, target=target)


def fingerprint_result(output: str, *, error: str = "", workspace: str = "") -> ResultFingerprint:
    normalized_output = normalize_result_text(output, workspace=workspace)
    normalized_error = normalize_result_text(error, workspace=workspace)
    signature = _hash_text(normalized_error) if normalized_error else ""
    failures = extract_test_failures(f"{normalized_output}\n{normalized_error}")
    return ResultFingerprint(
        value=_hash_text(f"{normalized_output}\n--error--\n{normalized_error}"),
        error_signature=signature,
        test_failures=failures,
    )


def normalize_command(command: str, *, workspace: str = "") -> list[str]:
    cleaned = _SECRET_RE.sub(r"\1\2<redacted>", str(command or ""))
    try:
        tokens = shlex.split(cleaned)
    except ValueError:
        tokens = cleaned.split()
    return [normalize_path(token, workspace=workspace) if token.startswith("/") else token for token in tokens]


def normalize_result_text(value: str, *, workspace: str = "") -> str:
    text = _ANSI_RE.sub("", str(value or ""))
    text = _SECRET_RE.sub(r"\1\2<redacted>", text)
    text = _TIMESTAMP_RE.sub("<time>", text)
    text = _PID_RE.sub("pid=<pid>", text)
    if workspace:
        normalized_workspace = os.path.normpath(workspace)
        text = text.replace(normalized_workspace, "<workspace>")
    text = _ABS_PATH_RE.sub(lambda match: normalize_path(match.group(0), workspace=workspace), text)
    return " ".join(text.split())[:16_000]


def normalize_path(path: str, *, workspace: str = "") -> str:
    raw = str(path or "").strip()
    if not raw:
        return ""
    normalized = os.path.normpath(raw)
    if workspace:
        root = os.path.normpath(workspace)
        try:
            if os.path.commonpath([root, normalized]) == root:
                relative = os.path.relpath(normalized, root)
                return "<workspace>" if relative == "." else f"<workspace>/{relative}"
        except ValueError:
            pass
    return normalized


def extract_test_failures(output: str) -> int | None:
    for pattern in _FAILURE_PATTERNS:
        match = pattern.search(output or "")
        if match:
            return int(match.group(1))
    return None


def analyze_event_records(records: Iterable[dict[str, Any]]) -> list[LoopFinding]:
    detector = AgentLoopDetector()
    findings: list[LoopFinding] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        event_type = str(record.get("type") or "")
        if event_type not in {"tool_call", "tool_result"}:
            continue
        raw_arguments = record.get("arguments")
        arguments = raw_arguments if isinstance(raw_arguments, dict) else {}
        finding = detector.note_tool(
            str(record.get("tool") or record.get("name") or "tool"),
            arguments,
            failed=bool(record.get("error")),
        )
        if finding is not None:
            findings.append(finding)
    return findings


def _normalize_json_value(value: Any, *, workspace: str) -> Any:
    if isinstance(value, str):
        return normalize_result_text(value, workspace=workspace)
    if isinstance(value, dict):
        return {
            str(key): _normalize_json_value(item, workspace=workspace)
            for key, item in sorted(value.items(), key=lambda entry: str(entry[0]))
            if not any(secret in str(key).lower() for secret in ("token", "password", "secret"))
        }
    if isinstance(value, list):
        return [_normalize_json_value(item, workspace=workspace) for item in value]
    return value


def _hash_text(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8", errors="replace")).hexdigest()[:24]
