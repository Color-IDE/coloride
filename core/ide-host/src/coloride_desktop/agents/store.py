from __future__ import annotations

import hashlib
import json
import os
import re
from collections import deque
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from .domain import (
    AgentApproval,
    AgentEvent,
    AgentPlan,
    AgentPlanStatus,
    AgentSession,
    AgentSessionState,
    ApprovalState,
    utc_now,
)
from .memory import ConversationMemory
from .task import AgentTask

_SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")


class AgentSessionStore:
    """Private, append-only storage for local agent history and approvals."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path.home() / ".coloride" / "desktop" / "agent-sessions"
        self.approvals_root = self.root / "approvals"
        self.plans_root = self.root / "plans"
        self.tasks_root = self.root / "tasks"
        self.memory_root = self.root / "memory"
        self.context_snapshots_root = self.root / "context_snapshots"
        self.tool_outputs_root = self.root / "tool_outputs"
        self._event_sequences: dict[str, int] = {}
        self._history_text_cache: dict[str, tuple[tuple[int, int], str, str, str]] = {}
        self._ensure_directory(self.root)
        self._ensure_directory(self.approvals_root)
        self._ensure_directory(self.plans_root)
        self._ensure_directory(self.tasks_root)
        self._ensure_directory(self.memory_root)
        self._ensure_directory(self.context_snapshots_root)
        self._ensure_directory(self.tool_outputs_root)
        self._recover_interrupted_sessions()

    def save_session(self, session: AgentSession) -> None:
        session.updated_at = utc_now()
        self._write_json(self._session_path(session.session_id), session.to_dict())

    def get_session(self, session_id: str) -> AgentSession | None:
        path = self._session_path(session_id)
        if not path.exists():
            return None
        try:
            return AgentSession.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError, KeyError):
            return None

    def list_sessions(self) -> list[AgentSession]:
        sessions: list[AgentSession] = []
        for path in self.root.glob("sess_*.json"):
            session = self.get_session(path.stem)
            if session is not None:
                sessions.append(session)
        return sorted(sessions, key=lambda item: item.updated_at, reverse=True)

    def history_details(self, session_id: str, query: str = "") -> dict[str, Any]:
        """Index conversation text without sending tools, reasoning or entire logs to the UI."""
        path = self._events_path(session_id)
        try:
            stat = path.stat()
            stamp = (stat.st_mtime_ns, stat.st_size)
        except OSError:
            stamp = (0, 0)
        cached = self._history_text_cache.get(session_id)
        if cached is None or cached[0] != stamp:
            messages: list[str] = []
            first = ""
            previous_type = ""
            if stamp != (0, 0):
                with path.open(encoding="utf-8") as handle:
                    for line in handle:
                        try:
                            event = json.loads(line)
                            kind = event.get("type")
                            data = event.get("data") or {}
                            if kind not in {"user_message", "text", "text_delta"} or data.get("hidden"):
                                continue
                            text = data.get("text") or data.get("delta") or ""
                            if not isinstance(text, str) or not text:
                                continue
                            if kind == "user_message":
                                if not first:
                                    first = text
                                messages.append(text)
                            elif previous_type in {"text", "text_delta"} and messages:
                                messages[-1] += text
                            else:
                                messages.append(text)
                            previous_type = kind
                        except (ValueError, TypeError, AttributeError):
                            continue
            transcript = "\n".join(messages)
            preview = " ".join(messages[-1].split())[:240] if messages else ""
            cached = (stamp, " ".join(first.split())[:160], preview, transcript)
            if len(transcript) <= 2_000_000:
                if len(self._history_text_cache) >= 32:
                    self._history_text_cache.pop(next(iter(self._history_text_cache)))
                self._history_text_cache[session_id] = cached
        _, first, preview, transcript = cached
        index = transcript.casefold().find(query.casefold()) if query else -1
        snippet = " ".join(transcript[max(0, index - 50):index + 180].split()) if index >= 0 else ""
        return {"sessionId": session_id, "firstMessage": first, "preview": preview, "snippet": snippet, "matches": index >= 0}

    def fork_session(self, source_id: str) -> AgentSession:
        """Copy session metadata, timeline events, and model history into a new idle chat."""
        source = self.get_session(source_id)
        if source is None:
            raise ValueError("Agent session not found")
        fork = AgentSession.create(
            agent=source.agent,
            cwd=source.cwd,
            mode=source.mode,
            access_level=source.access_level,
            task=source.task,
            budget_usd=source.budget_usd,
            reasoning_effort=source.reasoning_effort,
            workspace_kind=source.workspace_kind,
            connection_id=source.connection_id,
            filesystem_scope=source.filesystem_scope,
        )
        fork.state = AgentSessionState.IDLE
        fork.model = source.model
        fork.spent_usd = source.spent_usd
        fork.preferred_linux_user = source.preferred_linux_user
        fork.active_turn_id = None
        fork.provider_thread_id = None
        fork.last_error = None
        fork.archived = False
        fork.active_plan_id = None
        self.save_session(fork)

        events_src = self._events_path(source_id)
        last_sequence = 0
        if events_src.exists():
            dest = self._events_path(fork.session_id)
            with events_src.open("r", encoding="utf-8") as handle, dest.open(
                "w",
                encoding="utf-8",
            ) as output:
                for line in handle:
                    if not line.strip():
                        continue
                    try:
                        event = AgentEvent.from_dict(json.loads(line))
                    except (ValueError, TypeError, KeyError):
                        continue
                    cloned = AgentEvent.create(
                        session_id=fork.session_id,
                        sequence=event.sequence,
                        type=event.type,
                        data=dict(event.data),
                    )
                    cloned.created_at = event.created_at
                    last_sequence = max(last_sequence, event.sequence)
                    output.write(json.dumps(cloned.to_dict(), ensure_ascii=True, separators=(",", ":")))
                    output.write("\n")
            os.chmod(dest, 0o600)
        if last_sequence:
            self._event_sequences[fork.session_id] = last_sequence

        conversation_src = self._conversation_path(source_id)
        if conversation_src.exists():
            dest = self._conversation_path(fork.session_id)
            dest.write_bytes(conversation_src.read_bytes())
            os.chmod(dest, 0o600)

        plan = self.get_session_plan(source_id)
        if plan is not None and plan.status != AgentPlanStatus.DISMISSED:
            copied = AgentPlan.create(
                session_id=fork.session_id,
                title=plan.title,
                steps=list(plan.steps),
                summary=plan.summary,
                status=plan.status,
            )
            self.save_plan(copied)
            fork.active_plan_id = copied.plan_id
            self.save_session(fork)

        return fork

    def append_event(self, session_id: str, event_type: str, data: dict[str, Any]) -> AgentEvent:
        sequence = self._next_sequence(session_id)
        event = AgentEvent.create(
            session_id=session_id,
            sequence=sequence,
            type=event_type,
            data=data,
        )
        path = self._events_path(session_id)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event.to_dict(), ensure_ascii=True, separators=(",", ":")))
            handle.write("\n")
        os.chmod(path, 0o600)
        return event

    def list_events(
        self,
        session_id: str,
        limit: int = 5_000,
        *,
        before_sequence: int | None = None,
        turn_limit: int | None = None,
    ) -> list[AgentEvent]:
        path = self._events_path(session_id)
        if not path.exists():
            return []
        # Read the full append-only log, then compact streaming deltas so long chats
        # still return from the first user message (a raw 20k tail drops early turns).
        try:
            events: list[AgentEvent] = []
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    try:
                        events.append(AgentEvent.from_dict(json.loads(line)))
                    except (ValueError, TypeError, KeyError):
                        # Skip a single corrupt line instead of dropping the whole chat.
                        continue
            compacted = _compact_history_events(events)
            if before_sequence is not None:
                compacted = [event for event in compacted if event.sequence < before_sequence]
            if turn_limit is not None:
                remaining = max(1, min(turn_limit, 100))
                start = 0
                for index in range(len(compacted) - 1, -1, -1):
                    event = compacted[index]
                    if event.type != "user_message" or bool((event.data or {}).get("hidden")):
                        continue
                    remaining -= 1
                    if remaining == 0:
                        start = index
                        break
                compacted = compacted[start:]
            cap = max(1, min(limit, 20_000))
            if len(compacted) > cap:
                # Prefer keeping a full leading user turn when we must trim.
                trimmed = compacted[-cap:]
                for index, event in enumerate(trimmed):
                    if event.type == "user_message" and not bool((event.data or {}).get("hidden")):
                        return trimmed[index:]
                return trimmed
            return compacted
        except OSError:
            return []

    def raw_event_records(self, session_id: str) -> list[dict[str, Any]]:
        """Every event line on disk — no delta compaction, no cap."""
        path = self._events_path(session_id)
        if not path.exists():
            return []
        records: list[dict[str, Any]] = []
        try:
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    try:
                        value = json.loads(line)
                    except (ValueError, TypeError):
                        records.append({"_unparsed": line.rstrip("\n")})
                        continue
                    if isinstance(value, dict):
                        records.append(value)
                    else:
                        records.append({"_value": value})
        except OSError:
            return records
        return records

    def append_conversation_items(
        self,
        session_id: str,
        items: list[dict[str, Any]] | tuple[dict[str, Any], ...],
    ) -> None:
        """Persist provider-neutral model input items for durable task history."""
        if not items:
            return
        path = self._conversation_path(session_id)
        with path.open("a", encoding="utf-8") as handle:
            for item in items:
                handle.write(json.dumps(item, ensure_ascii=True, separators=(",", ":")))
                handle.write("\n")
        os.chmod(path, 0o600)

    def list_conversation_items(
        self,
        session_id: str,
        limit: int | None = 400,
    ) -> list[dict[str, Any]]:
        """Read provider-neutral history.

        A finite limit returns the newest items. ``None`` returns the complete
        durable transcript. There is deliberately no hidden 2,000-item cap:
        context compaction and history retrieval must be able to account for
        every stored turn.
        """
        if limit is None:
            return [item for _, item in self.iter_conversation_items(session_id)]
        path = self._conversation_path(session_id)
        if not path.exists():
            return []
        rows: deque[str] = deque(maxlen=max(1, int(limit)))
        try:
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if line.strip():
                        rows.append(line)
            values = [json.loads(line) for line in rows]
            return [value for value in values if isinstance(value, dict)]
        except (OSError, ValueError, TypeError):
            return []

    def iter_conversation_items(
        self,
        session_id: str,
        *,
        start: int = 0,
    ) -> Iterator[tuple[int, dict[str, Any]]]:
        """Stream valid conversation items with stable absolute indexes."""
        path = self._conversation_path(session_id)
        if not path.exists():
            return
        first = max(0, int(start))
        valid_index = 0
        try:
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    try:
                        value = json.loads(line)
                    except (ValueError, TypeError):
                        continue
                    if not isinstance(value, dict):
                        continue
                    index = valid_index
                    valid_index += 1
                    if index >= first:
                        yield index, value
        except OSError:
            return

    def conversation_item_count(self, session_id: str) -> int:
        return sum(1 for _index, _item in self.iter_conversation_items(session_id))

    def replace_conversation_items(
        self,
        session_id: str,
        items: list[dict[str, Any]],
    ) -> None:
        """Atomically replace compacted history without exposing partial state."""
        path = self._conversation_path(session_id)
        temporary = path.with_suffix(f"{path.suffix}.tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            for item in items:
                handle.write(json.dumps(item, ensure_ascii=True, separators=(",", ":")))
                handle.write("\n")
        os.chmod(temporary, 0o600)
        temporary.replace(path)
        os.chmod(path, 0o600)
        # A rewrite changes absolute item boundaries. Any summary derived from
        # the old append-only transcript is no longer safe to reuse.
        self.delete_context_snapshot(session_id)
        memory_path = self._memory_path(session_id)
        try:
            memory_path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            pass

    def close_orphan_function_calls(
        self,
        session_id: str,
        *,
        reason: str = "Cancelled by user",
    ) -> list[str]:
        """Append synthetic outputs for function_calls missing a matching output.

        Pause/stop mid-tool leaves open calls that break the next provider turn.
        Returns the call_ids that were closed.
        """
        items = self.list_conversation_items(session_id, limit=2_000)
        open_calls: dict[str, str] = {}
        for item in items:
            item_type = str(item.get("type") or "")
            if item_type == "function_call":
                call_id = str(item.get("call_id") or item.get("id") or "").strip()
                if call_id:
                    open_calls[call_id] = str(item.get("name") or "tool")
            elif item_type == "function_call_output":
                call_id = str(item.get("call_id") or "").strip()
                if call_id:
                    open_calls.pop(call_id, None)
        if not open_calls:
            return []
        payload = json.dumps(
            {"ok": False, "error": reason, "cancelled": True},
            ensure_ascii=True,
            separators=(",", ":"),
        )
        self.append_conversation_items(
            session_id,
            [
                {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": payload,
                }
                for call_id in open_calls
            ],
        )
        return list(open_calls.keys())

    def write_tool_output(
        self,
        session_id: str,
        call_id: str,
        output: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Persist a full tool body next to the session so the prompt can spill it."""
        output_id = self._tool_output_id(call_id)
        directory = self._tool_outputs_dir(session_id)
        self._ensure_directory(directory)
        path = directory / f"{output_id}.log"
        path.write_text(output, encoding="utf-8")
        os.chmod(path, 0o600)
        meta_path = directory / f"{output_id}.meta.json"
        payload = {
            "id": output_id,
            "tool": str((metadata or {}).get("tool") or ""),
            "exit_code": (metadata or {}).get("exit_code"),
            "bytes": len(output),
            "lines": output.count("\n") + (1 if output else 0),
            "duration_ms": (metadata or {}).get("duration_ms"),
            "sha256": _sha256_text(output),
        }
        if metadata:
            for key, value in metadata.items():
                if key not in payload and value is not None:
                    payload[key] = value
        try:
            meta_path.write_text(
                json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            os.chmod(meta_path, 0o600)
        except OSError:
            pass
        return output_id

    def read_tool_output(
        self,
        session_id: str,
        output_id: str,
        *,
        offset: int = 0,
        limit: int = 80,
    ) -> dict[str, Any]:
        """Return a slice of a spilled tool log. Offset is 0-based line index."""
        path = self._tool_output_path(session_id, output_id)
        if not path.exists():
            raise FileNotFoundError(f"Tool output not found: {output_id}")
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        start = max(0, int(offset))
        count = max(1, min(int(limit), 400))
        slice_lines = lines[start : start + count]
        return {
            "id": output_id,
            "path": str(path),
            "bytes": len(text),
            "lines": len(lines),
            "offset": start,
            "limit": count,
            "text": "\n".join(slice_lines),
            "truncated": start + count < len(lines),
        }

    def search_chat_history(
        self,
        session_id: str,
        query: str,
        *,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Substring scan of durable conversation items (not the prompt view)."""
        needle = " ".join(str(query or "").split()).strip().lower()
        if not needle:
            return []
        hits: list[dict[str, Any]] = []
        cap = max(1, min(int(limit), 50))
        for index, item in self.iter_conversation_items(session_id):
            haystack = _conversation_item_search_text(item).lower()
            if needle not in haystack:
                continue
            snippet = _search_snippet(haystack, needle)
            hits.append(
                {
                    "index": index,
                    "role": str(item.get("role") or ""),
                    "type": str(item.get("type") or "message"),
                    "name": str(item.get("name") or ""),
                    "callId": str(item.get("call_id") or ""),
                    "snippet": snippet,
                }
            )
            if len(hits) >= cap:
                break
        return hits

    def save_approval(self, approval: AgentApproval) -> None:
        self._write_json(self._approval_path(approval.approval_id), approval.to_dict())

    def get_approval(self, approval_id: str) -> AgentApproval | None:
        path = self._approval_path(approval_id)
        if not path.exists():
            return None
        try:
            return AgentApproval.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError, KeyError):
            return None

    def list_approvals(self, session_id: str, *, pending_only: bool = False) -> list[AgentApproval]:
        approvals: list[AgentApproval] = []
        for path in self.approvals_root.glob("approval_*.json"):
            approval = self.get_approval(path.stem)
            if approval is None or approval.session_id != session_id:
                continue
            if pending_only and approval.state != ApprovalState.PENDING:
                continue
            approvals.append(approval)
        return sorted(approvals, key=lambda item: item.created_at)

    def save_plan(self, plan: AgentPlan) -> None:
        plan.updated_at = utc_now()
        self._write_json(self._plan_path(plan.plan_id), plan.to_dict())
        # Also index by session for fast lookup of the active plan.
        self._write_json(self._session_plan_path(plan.session_id), plan.to_dict())

    def get_plan(self, plan_id: str) -> AgentPlan | None:
        path = self._plan_path(plan_id)
        if not path.exists():
            return None
        try:
            return AgentPlan.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError, KeyError):
            return None

    def get_session_plan(self, session_id: str) -> AgentPlan | None:
        path = self._session_plan_path(session_id)
        if not path.exists():
            return None
        try:
            return AgentPlan.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError, KeyError):
            return None

    def save_task(self, task: AgentTask) -> None:
        task.updated_at = utc_now()
        self._write_json(self._task_path(task.conversation_id), task.to_dict())

    def get_task(self, session_id: str) -> AgentTask | None:
        path = self._task_path(session_id)
        if not path.exists():
            return None
        try:
            return AgentTask.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError, KeyError):
            return None

    def ensure_task(
        self,
        session: AgentSession,
        *,
        goal: str | None = None,
    ) -> AgentTask:
        workspace_id = session.connection_id or session.cwd
        task = self.get_task(session.session_id)
        if task is None:
            task = AgentTask.create(
                conversation_id=session.session_id,
                workspace_id=workspace_id,
                goal=goal or session.task or "",
                cost_budget_usd=session.budget_usd,
            )
        else:
            task.workspace_id = workspace_id
            if goal and goal.strip():
                task.goal = goal.strip()
            if session.budget_usd is not None:
                task.cost_budget_usd = session.budget_usd
        self.save_task(task)
        return task

    def save_memory(self, session_id: str, memory: ConversationMemory) -> None:
        self._write_json(self._memory_path(session_id), memory.to_dict())

    def save_context_snapshot(self, session_id: str, value: dict[str, Any]) -> None:
        self._write_json(self._context_snapshot_path(session_id), value)

    def get_context_snapshot(self, session_id: str) -> dict[str, Any] | None:
        path = self._context_snapshot_path(session_id)
        if not path.exists():
            return None
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else None
        except (OSError, ValueError, TypeError):
            return None

    def delete_context_snapshot(self, session_id: str) -> None:
        try:
            self._context_snapshot_path(session_id).unlink()
        except FileNotFoundError:
            pass
        except OSError:
            pass

    def clear_context_snapshots(self) -> None:
        for path in self.context_snapshots_root.glob("session_*.json"):
            try:
                path.unlink()
            except OSError:
                continue

    def get_memory(self, session_id: str) -> ConversationMemory | None:
        path = self._memory_path(session_id)
        if not path.exists():
            return None
        try:
            return ConversationMemory.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError, KeyError):
            return None

    def load_or_build_memory(self, session_id: str) -> ConversationMemory:
        """Projection of durable history. Always fold unseen items into recent_delta."""
        total_items = self.conversation_item_count(session_id)
        stored = self.get_memory(session_id)
        if stored is None:
            items = self.list_conversation_items(session_id, limit=None)
            memory = ConversationMemory.from_items(items)
            if memory.covered_items:
                self.save_memory(session_id, memory)
            return memory
        if stored.covered_items > total_items:
            # The transcript was externally replaced or repaired.
            items = self.list_conversation_items(session_id, limit=None)
            memory = ConversationMemory.from_items(items)
            if memory.covered_items:
                self.save_memory(session_id, memory)
            return memory
        if stored.covered_items < total_items:
            unseen = [
                item
                for _index, item in self.iter_conversation_items(
                    session_id,
                    start=stored.covered_items,
                )
            ]
            stored.apply_items(unseen)
            stored.event_count = total_items
            self.save_memory(session_id, stored)
            return stored
        stored.event_count = max(stored.event_count, total_items)
        return stored

    def clear_session_plan(self, session_id: str) -> None:
        path = self._session_plan_path(session_id)
        if path.exists():
            try:
                path.unlink()
            except OSError:
                pass

    def _next_sequence(self, session_id: str) -> int:
        current = self._event_sequences.get(session_id)
        if current is None:
            # Need the true last sequence, not a truncated window of 1 if file is huge —
            # list_events(limit=1) already returns only the tail via deque.
            events = self.list_events(session_id, limit=1)
            current = events[-1].sequence if events else 0
        current += 1
        self._event_sequences[session_id] = current
        return current

    def _recover_interrupted_sessions(self) -> None:
        interrupted = {
            AgentSessionState.STARTING,
            AgentSessionState.RUNNING,
            AgentSessionState.WAITING_APPROVAL,
        }
        for path in self.root.glob("sess_*.json"):
            try:
                session = AgentSession.from_dict(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError, TypeError, KeyError):
                continue
            if session.state in interrupted:
                session.state = AgentSessionState.IDLE
                session.active_turn_id = None
                self.save_session(session)
        for path in self.approvals_root.glob("approval_*.json"):
            try:
                approval = AgentApproval.from_dict(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError, TypeError, KeyError):
                continue
            if approval.state == ApprovalState.PENDING:
                approval.state = ApprovalState.EXPIRED
                approval.resolved_at = utc_now()
                self.save_approval(approval)
                # Events are the durable source for the renderer timeline.  Merely
                # updating the approval JSON leaves its original
                # `approval_required` event looking pending after a restart, which
                # produces an Allow card that no live agent can resume.
                self.append_event(
                    approval.session_id,
                    "approval_resolved",
                    {"approvalId": approval.approval_id, "decision": "expired"},
                )

    def _session_path(self, session_id: str) -> Path:
        return self.root / f"{self._safe_id(session_id)}.json"

    def _events_path(self, session_id: str) -> Path:
        return self.root / f"{self._safe_id(session_id)}.jsonl"

    def _conversation_path(self, session_id: str) -> Path:
        return self.root / f"{self._safe_id(session_id)}.messages.jsonl"

    def _tool_outputs_dir(self, session_id: str) -> Path:
        return self.tool_outputs_root / self._safe_id(session_id)

    def _tool_output_path(self, session_id: str, output_id: str) -> Path:
        return self._tool_outputs_dir(session_id) / f"{self._tool_output_id(output_id)}.log"

    def _approval_path(self, approval_id: str) -> Path:
        return self.approvals_root / f"{self._safe_id(approval_id)}.json"

    def _plan_path(self, plan_id: str) -> Path:
        return self.plans_root / f"{self._safe_id(plan_id)}.json"

    def _session_plan_path(self, session_id: str) -> Path:
        return self.plans_root / f"session_{self._safe_id(session_id)}.json"

    def _task_path(self, session_id: str) -> Path:
        return self.tasks_root / f"session_{self._safe_id(session_id)}.json"

    def _memory_path(self, session_id: str) -> Path:
        return self.memory_root / f"session_{self._safe_id(session_id)}.json"

    def _context_snapshot_path(self, session_id: str) -> Path:
        return self.context_snapshots_root / f"session_{self._safe_id(session_id)}.json"

    @staticmethod
    def _safe_id(value: str) -> str:
        if not _SAFE_ID.fullmatch(value):
            raise ValueError("Invalid agent storage identifier")
        return value

    @staticmethod
    def _tool_output_id(value: str) -> str:
        cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(value or "").strip())[:128].strip("_")
        if not cleaned:
            raise ValueError("Invalid agent storage identifier")
        return cleaned

    @staticmethod
    def _ensure_directory(path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(path, 0o700)

    @staticmethod
    def _write_json(path: Path, value: dict[str, Any]) -> None:
        temporary = path.with_suffix(f"{path.suffix}.tmp")
        temporary.write_text(
            json.dumps(value, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        os.chmod(temporary, 0o600)
        temporary.replace(path)
        os.chmod(path, 0o600)


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


_STREAM_DELTA_TYPES = frozenset({"text_delta", "text", "reasoning_delta", "plan_delta"})


def _compact_history_events(events: list[AgentEvent]) -> list[AgentEvent]:
    """Merge consecutive streaming deltas so long chats fit in the API window.

    Disk keeps every delta for live replay; the UI only needs coalesced text.
    Without this, a 20k-line tail often starts mid-assistant and drops early turns.
    """
    if not events:
        return []
    # Progressive file writes are snapshots (each event contains the newest
    # partial file), not additive deltas. For an active call return only its
    # newest snapshot; once the finalized tool_call exists, omit the snapshots
    # entirely because the normal tool/diff events are the durable UI record.
    finalized_write_ids = {
        str((event.data or {}).get("itemId") or "")
        for event in events
        if event.type == "tool_call"
    }
    latest_write_delta: dict[str, int] = {}
    for index, event in enumerate(events):
        if event.type != "file_write_delta":
            continue
        item_id = str((event.data or {}).get("itemId") or "")
        if item_id:
            latest_write_delta[item_id] = index
    compacted: list[AgentEvent] = []
    for index, event in enumerate(events):
        if event.type == "file_write_delta":
            item_id = str((event.data or {}).get("itemId") or "")
            if item_id and (item_id in finalized_write_ids or latest_write_delta.get(item_id) != index):
                continue
        if event.type in _STREAM_DELTA_TYPES and compacted:
            previous = compacted[-1]
            if previous.type == event.type and previous.data.get("activityId") == event.data.get("activityId"):
                previous_text = str((previous.data or {}).get("text") or "")
                next_text = str((event.data or {}).get("text") or "")
                if next_text:
                    previous.data = {**(previous.data or {}), "text": previous_text + next_text}
                # Keep the earliest sequence/id; bump created_at to the latest chunk.
                previous.created_at = event.created_at
                continue
        compacted.append(
            AgentEvent(
                event_id=event.event_id,
                session_id=event.session_id,
                sequence=event.sequence,
                type=event.type,
                data=dict(event.data or {}),
                created_at=event.created_at,
            )
        )
    return compacted


def _conversation_item_search_text(item: dict[str, Any]) -> str:
    parts: list[str] = []
    content = item.get("content")
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(str(part["text"]))
    output = item.get("output")
    if isinstance(output, str):
        parts.append(output)
    arguments = item.get("arguments")
    if isinstance(arguments, str):
        parts.append(arguments)
    name = item.get("name")
    if isinstance(name, str) and name:
        parts.append(name)
    return "\n".join(parts)


def _search_snippet(haystack: str, needle: str, *, radius: int = 90) -> str:
    index = haystack.find(needle)
    if index < 0:
        return " ".join(haystack.split())[:180]
    start = max(0, index - radius)
    end = min(len(haystack), index + len(needle) + radius)
    snippet = haystack[start:end]
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(haystack) else ""
    return f"{prefix}{' '.join(snippet.split())}{suffix}"
