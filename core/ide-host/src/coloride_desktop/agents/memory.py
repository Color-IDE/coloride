from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

_ACK = frozenset(
    {
        "ok",
        "okay",
        "yes",
        "no",
        "thanks",
        "thank you",
        "hola",
        "hello",
        "hi",
        "hey",
        "buen",
        "bueno",
        "vale",
        "sure",
        "got it",
        "sigue",
    }
)
_TOPIC_STOP = re.compile(
    r"^(please |por favor |can you |could you |expl[ií]ca(?:me)? |"
    r"resume |resum[eé] |tell me )+",
    re.IGNORECASE,
)
_USER_DECISION = re.compile(
    r"\b(?:quiero|prefiero|elijo|elegimos|hagamos|decidimos|utiliza|usa|mant[eé]n|"
    r"choose|chosen|prefer|must|should|use|keep)\b", re.IGNORECASE,
)
_WRITE_TOOLS = frozenset(
    {
        "write_file",
        "replace_in_file",
        "create_directory",
        "rename_path",
        "move_path",
        "delete_path",
    }
)


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(slots=True)
class MemorySlice:
    """Extractive facts from a stretch of durable history."""

    topics: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    facts: list[str] = field(default_factory=list)
    changes: list[str] = field(default_factory=list)
    pending: list[str] = field(default_factory=list)
    files: list[str] = field(default_factory=list)
    files_inspected: list[str] = field(default_factory=list)
    files_changed: list[str] = field(default_factory=list)
    tools_used: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    completed: list[str] = field(default_factory=list)
    last_user: str = ""
    goal: str = ""

    def empty(self) -> bool:
        return not (
            self.topics
            or self.decisions
            or self.facts
            or self.changes
            or self.pending
            or self.files
            or self.errors
            or self.completed
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "topics": list(self.topics),
            "decisions": list(self.decisions),
            "facts": list(self.facts),
            "changes": list(self.changes),
            "pending": list(self.pending),
            "files": list(self.files),
            "filesInspected": list(self.files_inspected),
            "filesChanged": list(self.files_changed),
            "toolsUsed": list(self.tools_used),
            "errors": list(self.errors),
            "completed": list(self.completed),
            "lastUser": self.last_user,
            "goal": self.goal,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any] | None) -> MemorySlice:
        if not isinstance(value, dict):
            return cls()
        return cls(
            topics=_string_list(value.get("topics"), 12),
            decisions=_string_list(value.get("decisions"), 8),
            facts=_string_list(value.get("facts"), 10),
            changes=_string_list(value.get("changes"), 12),
            pending=_string_list(value.get("pending"), 6),
            files=_string_list(value.get("files"), 16),
            files_inspected=_string_list(value.get("filesInspected") or value.get("files_inspected"), 16),
            files_changed=_string_list(value.get("filesChanged") or value.get("files_changed"), 16),
            tools_used=_string_list(value.get("toolsUsed") or value.get("tools_used"), 16),
            errors=_string_list(value.get("errors"), 6),
            completed=_string_list(value.get("completed"), 8),
            last_user=str(value.get("lastUser") or value.get("last_user") or ""),
            goal=str(value.get("goal") or ""),
        )


@dataclass(slots=True)
class ConversationMemory:
    """Projection of durable history — never the source of truth.

    compacted_* fields cover items [0, covers_until).
    recent_delta covers items [covers_until, covered_items) that arrived
    after the last compaction (or the whole chat if none yet).
    """

    goal: str = ""
    last_user: str = ""
    session_topics: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    facts: list[str] = field(default_factory=list)
    changes: list[str] = field(default_factory=list)
    pending: list[str] = field(default_factory=list)
    files: list[str] = field(default_factory=list)
    files_inspected: list[str] = field(default_factory=list)
    files_changed: list[str] = field(default_factory=list)
    tools_used: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    completed: list[str] = field(default_factory=list)
    event_count: int = 0
    covered_items: int = 0
    covers_until: int = 0
    summary_version: int = 0
    created_at: str = field(default_factory=_utc_now)
    recent_delta: MemorySlice = field(default_factory=MemorySlice)

    @property
    def all_topics(self) -> list[str]:
        return _merge_lists(self.session_topics, self.recent_delta.topics, 12)

    @property
    def all_decisions(self) -> list[str]:
        return _merge_lists(self.decisions, self.recent_delta.decisions, 8)

    @property
    def all_changes(self) -> list[str]:
        return _merge_lists(self.changes, self.recent_delta.changes, 12)

    def sufficient_for_recap(self) -> bool:
        return (
            len(self.all_topics) >= 2
            or len(self.all_decisions) >= 2
            or len(self.all_changes) >= 1
        )

    def prompt_block(self) -> str:
        topics = (
            _bullets(_merge_lists(self.session_topics, self.recent_delta.topics, 12))
            or "- (none yet)"
        )
        decisions = (
            _bullets(_merge_lists(self.decisions, self.recent_delta.decisions, 8))
            or "- (none recorded)"
        )
        changes = (
            _bullets(_merge_lists(self.changes, self.recent_delta.changes, 12))
            or "- (none recorded)"
        )
        pending = (
            _bullets(_merge_lists(self.pending, self.recent_delta.pending, 6))
            or "- Continue from the last user ask."
        )
        last_user = self.recent_delta.last_user or self.last_user
        goal = self.goal or self.recent_delta.goal
        header = "CONVERSATION MEMORY"
        if self.summary_version:
            header += (
                f" (summary_v{self.summary_version}"
                f" · covers events 1–{self.covers_until}"
                f" · recent {self.covers_until + 1}–{self.covered_items})"
                if self.covers_until
                else f" (summary_v{self.summary_version})"
            )
        body = (
            f"{header}\n"
            f"Goal: {goal or '(not stated)'}\n"
            f"Last user ask: {last_user or '(none)'}\n"
            f"Topics:\n{topics}\n"
            f"Decisions:\n{decisions}\n"
            f"Changes:\n{changes}\n"
            f"Pending:\n{pending}"
        )
        if not self.recent_delta.empty() and self.covers_until:
            delta_topics = _bullets(self.recent_delta.topics) or "- (none)"
            delta_changes = _bullets(self.recent_delta.changes) or "- (none)"
            body += (
                "\n\nRECENT MEMORY DELTA (since last compact)\n"
                f"Topics:\n{delta_topics}\n"
                f"Changes:\n{delta_changes}"
            )
        return body

    def structured_summary(self) -> dict[str, Any]:
        return {
            "summary_version": self.summary_version,
            "covers_until_event_id": self.covers_until,
            "created_at": self.created_at,
            "goal": self.goal or self.recent_delta.goal,
            "topics": _merge_lists(self.session_topics, self.recent_delta.topics, 12),
            "decisions": _merge_lists(self.decisions, self.recent_delta.decisions, 8),
            "facts": _merge_lists(self.facts, self.recent_delta.facts, 10),
            "files_inspected": _merge_lists(self.files_inspected, self.recent_delta.files_inspected, 16),
            "files_changed": _merge_lists(self.files_changed, self.recent_delta.files_changed, 16),
            "errors": _merge_lists(self.errors, self.recent_delta.errors, 6),
            "completed": _merge_lists(self.completed, self.recent_delta.completed, 8),
            "pending": _merge_lists(self.pending, self.recent_delta.pending, 6),
        }

    def compact_text(self, limit: int) -> str:
        # Compacted prefix only — recent_delta stays verbatim in recent spans.
        sections = [
            (
                f"summary_v{self.summary_version}"
                f" · covers events 1–{self.covers_until or self.covered_items}"
                f" · {self.created_at}"
            ),
            f"Goal: {self.goal or '(not stated)'}",
            "Decisions:\n" + (_bullets(self.decisions) or "- (none recorded)"),
            "Topics:\n" + (_bullets(self.session_topics) or "- (none recorded)"),
            "Facts:\n" + (_bullets(self.facts) or "- (none recorded)"),
            "Files inspected:\n" + (_bullets(self.files_inspected) or "- (none recorded)"),
            "Files changed:\n" + (_bullets(self.files_changed) or "- (none recorded)"),
            "Errors:\n" + (_bullets(self.errors) or "- (none recorded)"),
            "Completed:\n" + (_bullets(self.completed) or "- (none recorded)"),
            "Pending:\n" + (_bullets(self.pending) or "- Continue from the last user ask."),
        ]
        body = "\n\n".join(sections)
        if len(body) <= limit:
            return body
        kept: list[str] = []
        used = 0
        footer = "\n\n- Additional earlier context was compacted."
        budget = max(64, limit - len(footer))
        for section in sections:
            extra = (2 if kept else 0) + len(section)
            if used + extra > budget:
                break
            kept.append(section)
            used += extra
        if not kept:
            return body[:budget].rstrip() + footer
        return "\n\n".join(kept) + footer

    def apply_items(self, items: list[dict[str, Any]]) -> None:
        """Fold new durable items into recent_memory_delta. Does not compact."""
        if not items:
            return
        incoming = extract_slice(items)
        if incoming.goal and not self.goal:
            self.goal = incoming.goal
        if incoming.last_user:
            self.last_user = incoming.last_user
        self.pending = incoming.pending or self.pending
        delta = self.recent_delta
        if incoming.goal and not delta.goal:
            delta.goal = incoming.goal
        if incoming.last_user:
            delta.last_user = incoming.last_user
        delta.topics = _merge_lists(delta.topics, incoming.topics, 12)
        delta.decisions = _merge_lists(delta.decisions, incoming.decisions, 8)
        delta.facts = _merge_lists(delta.facts, incoming.facts, 10)
        delta.changes = _merge_lists(delta.changes, incoming.changes, 12)
        delta.pending = incoming.pending or delta.pending
        delta.files = _merge_lists(delta.files, incoming.files, 16)
        delta.files_inspected = _merge_lists(delta.files_inspected, incoming.files_inspected, 16)
        delta.files_changed = _merge_lists(delta.files_changed, incoming.files_changed, 16)
        delta.tools_used = _merge_lists(delta.tools_used, incoming.tools_used, 16)
        delta.errors = _merge_lists(delta.errors, incoming.errors, 6)
        delta.completed = _merge_lists(delta.completed, incoming.completed, 8)
        self.covered_items += len(items)
        self.event_count = max(self.event_count, self.covered_items)

    def fold_delta(self, *, covers_until: int | None = None) -> None:
        """compacted_memory += recent_delta; recent_delta = empty."""
        incoming = self.recent_delta
        if incoming.goal and not self.goal:
            self.goal = incoming.goal
        if incoming.last_user:
            self.last_user = incoming.last_user
        self.session_topics = _merge_lists(self.session_topics, incoming.topics, 12)
        self.decisions = _merge_lists(self.decisions, incoming.decisions, 8)
        self.facts = _merge_lists(self.facts, incoming.facts, 10)
        self.changes = _merge_lists(self.changes, incoming.changes, 12)
        self.pending = incoming.pending or self.pending
        self.files = _merge_lists(self.files, incoming.files, 16)
        self.files_inspected = _merge_lists(self.files_inspected, incoming.files_inspected, 16)
        self.files_changed = _merge_lists(self.files_changed, incoming.files_changed, 16)
        self.tools_used = _merge_lists(self.tools_used, incoming.tools_used, 16)
        self.errors = _merge_lists(self.errors, incoming.errors, 6)
        self.completed = _merge_lists(self.completed, incoming.completed, 8)
        self.recent_delta = MemorySlice()
        self.summary_version += 1
        self.covers_until = self.covered_items if covers_until is None else max(0, covers_until)
        self.created_at = _utc_now()

    def to_dict(self) -> dict[str, Any]:
        return {
            "goal": self.goal,
            "lastUser": self.last_user,
            "sessionTopics": list(self.session_topics),
            "decisions": list(self.decisions),
            "facts": list(self.facts),
            "changes": list(self.changes),
            "pending": list(self.pending),
            "files": list(self.files),
            "filesInspected": list(self.files_inspected),
            "filesChanged": list(self.files_changed),
            "toolsUsed": list(self.tools_used),
            "errors": list(self.errors),
            "completed": list(self.completed),
            "eventCount": self.event_count,
            "coveredItems": self.covered_items,
            "coversUntil": self.covers_until,
            "summaryVersion": self.summary_version,
            "createdAt": self.created_at,
            "recentDelta": self.recent_delta.to_dict(),
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> ConversationMemory:
        return cls(
            goal=str(value.get("goal") or ""),
            last_user=str(value.get("lastUser") or value.get("last_user") or ""),
            session_topics=_string_list(value.get("sessionTopics") or value.get("session_topics"), 12),
            decisions=_string_list(value.get("decisions"), 8),
            facts=_string_list(value.get("facts"), 10),
            changes=_string_list(value.get("changes"), 12),
            pending=_string_list(value.get("pending"), 6),
            files=_string_list(value.get("files"), 16),
            files_inspected=_string_list(value.get("filesInspected") or value.get("files_inspected"), 16),
            files_changed=_string_list(value.get("filesChanged") or value.get("files_changed"), 16),
            tools_used=_string_list(value.get("toolsUsed") or value.get("tools_used"), 16),
            errors=_string_list(value.get("errors"), 6),
            completed=_string_list(value.get("completed"), 8),
            event_count=_int(value.get("eventCount") or value.get("event_count"), 0),
            covered_items=_int(value.get("coveredItems") or value.get("covered_items"), 0),
            covers_until=_int(value.get("coversUntil") or value.get("covers_until"), 0),
            summary_version=_int(value.get("summaryVersion") or value.get("summary_version"), 0),
            created_at=str(value.get("createdAt") or value.get("created_at") or _utc_now()),
            recent_delta=MemorySlice.from_dict(value.get("recentDelta") or value.get("recent_delta")),
        )

    @classmethod
    def from_items(cls, items: list[dict[str, Any]]) -> ConversationMemory:
        extracted = extract_slice(items)
        return cls(
            goal=extracted.goal,
            last_user=extracted.last_user,
            pending=list(extracted.pending),
            event_count=len(items),
            covered_items=len(items),
            covers_until=0,
            summary_version=0,
            recent_delta=extracted,
        )


def extract_slice(items: list[dict[str, Any]]) -> MemorySlice:
    goal = ""
    last_user = ""
    topics: list[str] = []
    decisions: list[str] = []
    user_decisions: list[str] = []
    facts: list[str] = []
    changes: list[str] = []
    pending: list[str] = []
    files: list[str] = []
    files_inspected: list[str] = []
    files_changed: list[str] = []
    tools_used: list[str] = []
    errors: list[str] = []
    completed: list[str] = []
    seen_topics: set[str] = set()
    seen_files: set[str] = set()
    seen_tools: set[str] = set()

    for item in items:
        role = str(item.get("role") or "")
        text = _message_text(item.get("content")) if role else ""
        if role == "user" and text:
            line = _single_line(text, 280)
            if not goal and line.lower().strip("!.? ") not in _ACK:
                goal = line
            if _USER_DECISION.search(text):
                user_decisions.append(line)
            last_user = line
            topic = _topic_from_user(text)
            key = topic.lower()
            if topic and key not in seen_topics and len(topics) < 12:
                seen_topics.add(key)
                topics.append(topic)
        elif role == "assistant" and text:
            line = _single_line(text, 220)
            if line and len(decisions) < 8:
                decisions.append(line)
            fact = _single_line(text, 160)
            if fact and len(facts) < 10 and fact not in facts:
                facts.append(fact)
        item_type = str(item.get("type") or "")
        if item_type == "function_call":
            name = str(item.get("name") or "tool")
            if name not in seen_tools and len(tools_used) < 16:
                seen_tools.add(name)
                tools_used.append(name)
            paths = _paths_from_arguments(item.get("arguments"))
            for path in paths:
                if path not in seen_files and len(files) < 16:
                    seen_files.add(path)
                    files.append(path)
                if path not in files_inspected and len(files_inspected) < 16:
                    files_inspected.append(path)
                if name in _WRITE_TOOLS:
                    change = f"{name}: {path}"
                    if change not in changes and len(changes) < 12:
                        changes.append(change)
                    if path not in files_changed and len(files_changed) < 16:
                        files_changed.append(path)
        elif item_type == "function_call_output":
            raw = str(item.get("output") or "")
            lowered = raw.lower()
            if any(marker in lowered for marker in ("error", "failed", "traceback", "errno")):
                snippet = _single_line(raw, 180)
                if snippet and len(errors) < 6:
                    errors.append(snippet)
            for path in _paths_mentioned(raw):
                if path not in seen_files and len(files) < 16:
                    seen_files.add(path)
                    files.append(path)

    if last_user:
        pending = [last_user]
    return MemorySlice(
        topics=topics,
        decisions=list(dict.fromkeys([*user_decisions[-8:], *decisions]))[:8],
        facts=facts,
        changes=changes,
        pending=pending,
        files=files,
        files_inspected=files_inspected,
        files_changed=files_changed,
        tools_used=tools_used,
        errors=errors,
        completed=completed,
        last_user=last_user,
        goal=goal,
    )


def _topic_from_user(text: str) -> str:
    line = _single_line(text, 80)
    if len(line) < 12:
        return ""
    if line.lower().strip("!.?") in _ACK:
        return ""
    cleaned = _TOPIC_STOP.sub("", line).strip(" -:.,")
    return cleaned[:72] if len(cleaned) >= 12 else ""


def _message_text(value: object) -> str:
    if isinstance(value, str):
        return value
    if not isinstance(value, list):
        return ""
    parts: list[str] = []
    for part in value:
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            parts.append(str(part["text"]))
    return "".join(parts)


def _paths_from_arguments(arguments: object) -> list[str]:
    raw = arguments
    if isinstance(arguments, str):
        try:
            raw = json.loads(arguments)
        except (TypeError, ValueError):
            return _paths_mentioned(arguments)
    if not isinstance(raw, dict):
        return []
    found: list[str] = []
    for key in ("path", "old_path", "new_path", "target", "file", "cwd"):
        value = raw.get(key)
        if isinstance(value, str) and _looks_like_path(value):
            found.append(value.strip())
    return found


def _paths_mentioned(text: str) -> list[str]:
    found: list[str] = []
    for token in text.replace(",", " ").replace(":", " ").split():
        cleaned = token.strip("\"'`")
        if _looks_like_path(cleaned) and cleaned not in found:
            found.append(cleaned)
        if len(found) >= 8:
            break
    return found


def _looks_like_path(value: str) -> bool:
    if len(value) < 3 or len(value) > 240:
        return False
    if " " in value or "\n" in value:
        return False
    if value.startswith(("/", "./", "../")):
        return True
    return "/" in value and "." in value.rsplit("/", 1)[-1]


def _single_line(value: str, limit: int) -> str:
    return " ".join(value.split())[:limit]


def _bullets(values: list[str]) -> str:
    return "\n".join(f"- {item}" for item in values if item)


def _merge_lists(left: list[str], right: list[str], limit: int) -> list[str]:
    seen: set[str] = set()
    merged: list[str] = []
    for item in [*left, *right]:
        key = item.strip()
        if not key:
            continue
        folded = key.lower()
        if folded in seen:
            continue
        seen.add(folded)
        merged.append(key)
        if len(merged) >= limit:
            break
    return merged


def _string_list(value: object, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    items = [str(item).strip() for item in value if str(item).strip()]
    return items[:limit]


def _int(value: object, default: int) -> int:
    try:
        if isinstance(value, (int, float, str)):
            return int(value)
        return default
    except (TypeError, ValueError):
        return default
