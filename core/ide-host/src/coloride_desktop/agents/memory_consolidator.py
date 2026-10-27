from __future__ import annotations

import hashlib
import json
import re
import shlex
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Any

from .domain import AgentSession
from .memory import ConversationMemory
from .project_memory import (
    MemoryKind,
    MemorySource,
    ProjectIdentity,
    ProjectMemoryStore,
    ToolObservation,
)
from .store import AgentSessionStore
from .task import AgentTask

_SECRET = re.compile(
    r"(?i)(authorization\s*[:=]\s*(?:bearer\s+)?|bearer\s+|api[_-]?key\s*[:=]\s*|[A-Z0-9_]*token\s*[:=]\s*|password\s*[:=]\s*|secret\s*[:=]\s*)[^\s,;]+"
)
_ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_VARIABLE_NOISE = re.compile(
    r"\b(?:pid[=: ]*)?\d{4,}\b|\b\d{4}-\d{2}-\d{2}[T ][0-9:.+-Z]+\b",
    re.IGNORECASE,
)
_DECISION = re.compile(
    r"\b(?:quiero|prefiero|debe|deberia|should|must|always|never|use|utiliza|keep|mant[eé]n)\b",
    re.IGNORECASE,
)
_MANIFESTS = {
    "package.json": "node",
    "pyproject.toml": "python",
    "requirements.txt": "python",
    "Cargo.toml": "rust",
    "go.mod": "go",
    "pom.xml": "java",
    "docker-compose.yml": "docker-compose",
    "compose.yml": "docker-compose",
}


class ProjectMemoryConsolidator:
    """Deterministic memory writer. It never calls an LLM."""

    def observe_tool(
        self,
        store: ProjectMemoryStore,
        task: AgentTask,
        *,
        tool: str,
        arguments: dict[str, Any],
        output: str,
        diff: str = "",
        metadata: dict[str, Any] | None = None,
        error: str = "",
    ) -> ToolObservation:
        metadata = metadata or {}
        paths = _paths(arguments, metadata)
        command = (
            _normalize_command(arguments.get("command"))
            if tool in {"execute_command", "start_process"}
            else ""
        )
        signature = _error_signature(error or (output if _failed_output(output, metadata) else ""))
        success = not bool(error) and not _failed_output(output, metadata)
        verified = success and tool in {
            "execute_command",
            "start_process",
            "get_diagnostics",
            "browser_snapshot",
            "browser_screenshot",
        }
        summary = _observation_summary(tool, paths, success, output, signature)
        observation = ToolObservation(
            observation_id="obs_"
            + hashlib.sha256(
                (
                    f"{task.task_id}|{tool}|"
                    f"{json.dumps(arguments, sort_keys=True, default=str)}|{summary}"
                ).encode()
            ).hexdigest()[:20],
            tool=tool,
            success=success,
            summary=summary,
            paths=paths,
            etags={
                str(key): str(value)
                for key, value in (metadata.get("etags") or {}).items()
                if str(key) and str(value)
            } if isinstance(metadata.get("etags"), dict) else (
                {paths[0]: str(metadata.get("etag"))} if paths and metadata.get("etag") else {}
            ),
            diff_hash=hashlib.sha256(diff.encode("utf-8")).hexdigest()[:24] if diff else "",
            error_signature=signature,
            command=command,
            output_id=str(metadata.get("outputId") or ""),
            verified=verified,
        )
        task.remember_observation(observation.to_dict())
        self._materialize_observation(store, task, observation)
        return observation

    def consolidate_task(
        self,
        store: ProjectMemoryStore,
        task: AgentTask,
        *,
        user_message: str = "",
    ) -> int:
        written = 0
        for decision in task.decisions[-12:]:
            source = MemorySource(
                source_type="task_decision",
                session_id=task.conversation_id,
                task_id=task.task_id,
            )
            if store.upsert_memory(
                MemoryKind.DECISION,
                _redact(decision),
                source,
                canonical_key=_topic_key(decision),
                importance=0.95,
                confidence=0.9,
            ):
                written += 1
        if user_message and _DECISION.search(user_message):
            cleaned = _redact(user_message)
            if 8 <= len(cleaned) <= 600:
                source = MemorySource(
                    source_type="user_decision",
                    session_id=task.conversation_id,
                    task_id=task.task_id,
                )
                if store.upsert_memory(
                    MemoryKind.DECISION,
                    cleaned,
                    source,
                    canonical_key=_topic_key(cleaned),
                    importance=1.0,
                    confidence=1.0,
                ):
                    written += 1
        observations = [
            ToolObservation(**item)
            for item in task.important_observations
            if isinstance(item, dict) and _valid_observation_dict(item)
        ]
        failures = [item for item in observations if not item.success and item.error_signature]
        successes = [item for item in observations if item.success]
        for failure in failures[-6:]:
            recovery = next(
                (
                    item
                    for item in successes
                    if item.created_at >= failure.created_at
                    and (set(item.paths) & set(failure.paths) or item.tool == failure.tool)
                ),
                None,
            )
            if recovery is None:
                continue
            path = (failure.paths or recovery.paths or [""])[0]
            content = (
                f"When {failure.error_signature} occurred"
                + (f" in {path}" if path else "")
                + f", the verified recovery was: {recovery.summary}"
            )
            source = MemorySource(
                source_type="verified_recovery",
                path=path,
                etag=recovery.etags.get(path, ""),
                error_signature=failure.error_signature,
                command=recovery.command,
                session_id=task.conversation_id,
                task_id=task.task_id,
                output_id=recovery.output_id,
            )
            if store.upsert_memory(
                MemoryKind.EPISODIC,
                content,
                source,
                canonical_key=f"recovery:{_topic_key(failure.error_signature)}:{path}",
                importance=0.72,
                confidence=0.82,
            ):
                written += 1
        verified_commands = [item for item in successes if item.verified and item.command]
        for item in verified_commands[-4:]:
            path = item.paths[0] if item.paths else ""
            content = f"Verified project command: {item.command}"
            if path:
                content += f" (cwd: {path})"
            source = MemorySource(
                source_type="verified_command",
                path=path,
                command=item.command,
                session_id=task.conversation_id,
                task_id=task.task_id,
                output_id=item.output_id,
            )
            if store.upsert_memory(
                MemoryKind.PROCEDURAL,
                content,
                source,
                canonical_key=f"command:{item.command}:{path}",
                importance=0.68,
                confidence=0.9,
            ):
                written += 1
        task.consolidated_observation_count = len(task.important_observations)
        return written

    def migrate_legacy(
        self,
        project: ProjectMemoryStore,
        sessions: AgentSessionStore,
    ) -> dict[str, int]:
        imported = 0
        scanned = 0
        for session in sessions.list_sessions():
            if ProjectIdentity.from_session(session).key != project.identity.key:
                continue
            source_key = f"session:{session.session_id}"
            _cursor, complete = project.migration_cursor(source_key)
            if complete:
                continue
            scanned += 1
            memory = sessions.get_memory(session.session_id)
            if memory is None:
                # Build from the durable transcript only once during lazy migration.
                memory = sessions.load_or_build_memory(session.session_id)
            imported += self._import_conversation_memory(project, session, memory)
            task = sessions.get_task(session.session_id)
            if task is not None:
                imported += self.consolidate_task(project, task)
            project.save_migration_cursor(
                source_key,
                sessions.conversation_item_count(session.session_id),
                completed=True,
            )
        project.set_profile_value("workspaceKind", project.identity.workspace_kind)
        project.set_profile_value("workspacePath", project.identity.cwd)
        return {"sessions": scanned, "memories": imported}

    def prune_tool_outputs(
        self,
        project: ProjectMemoryStore,
        sessions: AgentSessionStore,
        *,
        max_bytes: int = 250 * 1024 * 1024,
        min_age_days: int = 30,
    ) -> dict[str, int]:
        protected = {
            entry.source.output_id
            for entry in project.all_memories(limit=10_000)
            if entry.source.output_id
        }
        candidates: list[tuple[float, int, Path, Path]] = []
        total = 0
        for session in sessions.list_sessions():
            if ProjectIdentity.from_session(session).key != project.identity.key:
                continue
            directory = sessions.tool_outputs_root / session.session_id
            if not directory.exists():
                continue
            task = sessions.get_task(session.session_id)
            if task is not None:
                protected.update(
                    str(item.get("output_id") or "")
                    for item in task.important_observations
                    if isinstance(item, dict) and item.get("output_id")
                )
            for path in directory.glob("*.log"):
                try:
                    stat = path.stat()
                except OSError:
                    continue
                total += int(stat.st_size)
                candidates.append(
                    (stat.st_mtime, int(stat.st_size), path, path.with_suffix(".meta.json"))
                )
        if total <= max_bytes:
            return {"bytesBefore": total, "bytesAfter": total, "deleted": 0}
        cutoff = (datetime.now(UTC) - timedelta(days=min_age_days)).timestamp()
        deleted = 0
        remaining = total
        for modified, size, log_path, meta_path in sorted(candidates):
            output_id = log_path.stem
            if remaining <= max_bytes:
                break
            if modified > cutoff or output_id in protected:
                continue
            try:
                log_path.unlink()
                meta_path.unlink(missing_ok=True)
            except OSError:
                continue
            remaining -= size
            deleted += 1
        return {"bytesBefore": total, "bytesAfter": remaining, "deleted": deleted}

    def _import_conversation_memory(
        self,
        project: ProjectMemoryStore,
        session: AgentSession,
        memory: ConversationMemory,
    ) -> int:
        imported = 0
        source = MemorySource(source_type="legacy_session", session_id=session.session_id)
        for decision in memory.all_decisions[-16:]:
            if project.upsert_memory(
                MemoryKind.DECISION,
                _redact(decision),
                source,
                canonical_key=_topic_key(decision),
                importance=0.85,
                confidence=0.7,
            ):
                imported += 1
        facts = list(dict.fromkeys([*memory.facts, *memory.recent_delta.facts]))
        for fact in facts[-20:]:
            if project.upsert_memory(
                MemoryKind.SEMANTIC,
                _redact(fact),
                source,
                importance=0.55,
                confidence=0.58,
            ):
                imported += 1
        for change in memory.all_changes[-20:]:
            if project.upsert_memory(
                MemoryKind.EPISODIC,
                _redact(change),
                source,
                importance=0.5,
                confidence=0.55,
            ):
                imported += 1
        return imported

    def _materialize_observation(
        self,
        store: ProjectMemoryStore,
        task: AgentTask,
        observation: ToolObservation,
    ) -> None:
        if not observation.success:
            return
        for path in observation.paths:
            name = PurePosixPath(path).name
            project_type = _MANIFESTS.get(name)
            if project_type:
                store.set_profile_value("languages", _merge_profile_value(store, "languages", project_type))
                source = MemorySource(
                    source_type="repository_file",
                    path=path,
                    etag=observation.etags.get(path, ""),
                    session_id=task.conversation_id,
                    task_id=task.task_id,
                )
                store.upsert_memory(
                    MemoryKind.SEMANTIC,
                    f"Project contains {name} ({project_type}).",
                    source,
                    canonical_key=f"manifest:{name}",
                    importance=0.7,
                    confidence=0.95 if source.etag else 0.75,
                )


def _merge_profile_value(store: ProjectMemoryStore, key: str, value: str) -> list[str]:
    existing = store.project_profile().get(key)
    values = [str(item) for item in existing] if isinstance(existing, list) else []
    if value not in values:
        values.append(value)
    return values


def _paths(arguments: dict[str, Any], metadata: dict[str, Any]) -> list[str]:
    values = [
        arguments.get("path"), arguments.get("old_path"), arguments.get("new_path"),
        arguments.get("cwd"), metadata.get("path"), metadata.get("oldPath"),
        metadata.get("newPath"), metadata.get("cwd"),
    ]
    return list(dict.fromkeys(str(value).strip() for value in values if str(value or "").strip()))[:12]


def _normalize_command(value: object) -> str:
    command = _redact(str(value or ""))
    if not command:
        return ""
    try:
        parts = shlex.split(command)
    except ValueError:
        parts = command.split()
    if not parts:
        return ""
    # Persist the executable and semantic arguments, but omit inline assignments
    # and values that resemble credentials.
    safe: list[str] = []
    for part in parts[:16]:
        if "=" in part and not part.startswith(("--", "-D")):
            name = part.split("=", 1)[0]
            safe.append(f"{name}=<redacted>")
        elif len(part) > 180:
            safe.append("<long-argument>")
        else:
            safe.append(part)
    return " ".join(safe)[:500]


def _error_signature(value: str) -> str:
    cleaned = _redact(_ANSI.sub("", str(value or "")))
    cleaned = re.sub(r"\b0x[0-9a-f]+\b", "<addr>", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b\d{4,}\b", "<n>", cleaned)
    return " ".join(cleaned.split())[:260]


def _observation_summary(
    tool: str,
    paths: list[str],
    success: bool,
    output: str,
    signature: str,
) -> str:
    target = f" {paths[0]}" if paths else ""
    if not success:
        return f"{tool}{target} failed: {signature or 'unknown error'}"[:600]
    first = next((line.strip() for line in str(output or "").splitlines() if line.strip()), "")
    first = _redact(first)
    return f"{tool}{target} succeeded" + (f": {first[:320]}" if first else "")


def _failed_output(output: str, metadata: dict[str, Any]) -> bool:
    code = metadata.get("exitCode", metadata.get("exit_code"))
    if isinstance(code, int) and code != 0:
        return True
    return str(output or "").lstrip().lower().startswith("error:")


def _redact(value: str) -> str:
    return _SECRET.sub(lambda match: f"{match.group(1)}<redacted>", str(value or ""))[:4_000]


def _topic_key(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9_./:-]+", " ", str(value).casefold())
    return hashlib.sha256(" ".join(normalized.split()).encode("utf-8")).hexdigest()[:24]


def _valid_observation_dict(value: dict[str, Any]) -> bool:
    required = {"observation_id", "tool", "success", "summary"}
    return required.issubset(value)
