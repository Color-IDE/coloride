from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .budget import CHARS_PER_TOKEN, estimate_tokens
from .store import AgentSessionStore

HISTORY_SEARCH_BUDGET_NORMAL = 1
HISTORY_SEARCH_BUDGET_MAX = 2
MAX_RETRIEVAL_TOKENS = 5_000

RETRIEVAL_POLICY = (
    "RETRIEVAL\n"
    "Use this order. Do not skip a level that already answers the user.\n"
    "1. CURRENT TASK and COLORIDE PROJECT MEMORY above.\n"
    "2. Recent spans already in this prompt.\n"
    "3. search_chat_history — budget 1 call this turn (maximum 2 if genuinely "
    "new facts appear). Put every missing topic in queries[]. Do not search "
    "again for events already returned.\n"
    "4. read_tool_output only for a specific spilled log id.\n"
    "If the available task or memory state already covers a recap / what-we-did / where-we-left-off "
    "question, answer now with zero tools."
)

_RECAP = re.compile(
    r"(qu[eé]\s+hemos\s+hecho|"
    r"expl[ií]ca(?:me)?\s+lo\s+que\s+hemos\s+hecho|"
    r"en\s+qu[eé]\s+est[aá]bamos|"
    r"contin[uú]a(?:r)?\s+(?:donde|where)|"
    r"res[uú]me(?:me)?\s+(?:esta\s+|this\s+)?(?:sesi[oó]n|session|chat)|"
    r"what\s+(?:have\s+we|did\s+we|we've)\s+(?:done|been\s+doing)|"
    r"explain\s+what\s+we(?:'ve| have)\s+done|"
    r"where\s+(?:were|are|did)\s+we\s+(?:leave|left|off|at)|"
    r"catch\s+me\s+up|"
    r"\brecap\b|"
    r"contin[uú]e\s+where\s+(?:we|i)\s+left)",
    re.IGNORECASE,
)


@dataclass(slots=True)
class TurnRetrievalState:
    session_id: str
    searched_queries: list[str] = field(default_factory=list)
    retrieved_indexes: set[int] = field(default_factory=set)
    retrieved_ranges: list[tuple[int, int]] = field(default_factory=list)
    retrieved_files: list[str] = field(default_factory=list)
    scanned_events: int = 0
    search_calls: int = 0
    retrieval_tokens: int = 0
    max_calls: int = HISTORY_SEARCH_BUDGET_MAX
    max_tokens: int = MAX_RETRIEVAL_TOKENS

    def already_have_query(self, query: str) -> bool:
        needle = _normalize_query(query)
        return bool(needle) and needle in self.searched_queries

    def budget_remaining(self) -> bool:
        return self.search_calls < self.max_calls and self.retrieval_tokens < self.max_tokens

    def remember(
        self,
        queries: list[str],
        hits: list[dict[str, Any]],
        scanned: int,
        *,
        tokens: int = 0,
        files: list[str] | None = None,
    ) -> None:
        self.search_calls += 1
        self.scanned_events = max(self.scanned_events, scanned)
        self.retrieval_tokens += max(0, tokens)
        for query in queries:
            key = _normalize_query(query)
            if key and key not in self.searched_queries:
                self.searched_queries.append(key)
        indexes = sorted(
            {
                int(hit["index"])
                for hit in hits
                if isinstance(hit.get("index"), int)
            }
        )
        self.retrieved_indexes.update(indexes)
        self.retrieved_ranges = _index_ranges(sorted(self.retrieved_indexes))
        for path in files or []:
            cleaned = str(path).strip()
            if cleaned and cleaned not in self.retrieved_files:
                self.retrieved_files.append(cleaned)


def classify_user_intent(message: str) -> str:
    text = " ".join(str(message or "").split())
    if not text:
        return "other"
    if _RECAP.search(text):
        return "recap"
    return "other"


def normalize_search_queries(
    query: object = None,
    queries: object = None,
) -> list[str]:
    values: list[str] = []
    if isinstance(query, str) and query.strip():
        values.append(query)
    if isinstance(queries, list):
        values.extend(str(item) for item in queries if str(item).strip())
    elif isinstance(queries, str) and queries.strip():
        values.append(queries)
    seen: set[str] = set()
    unique: list[str] = []
    for raw in values:
        cleaned = " ".join(str(raw).split()).strip()
        if not cleaned:
            continue
        key = _normalize_query(cleaned)
        if key in seen:
            continue
        seen.add(key)
        unique.append(cleaned[:120])
        if len(unique) >= 8:
            break
    return unique


def search_conversation(
    store: AgentSessionStore,
    session_id: str,
    queries: list[str] | None = None,
    *,
    query: object = None,
    limit: int = 20,
    state: TurnRetrievalState | None = None,
) -> dict[str, Any]:
    needles = normalize_search_queries(query=query, queries=queries)
    scanned = _conversation_size(store, session_id)
    if not needles:
        return {
            "queries": [],
            "hits": [],
            "topics": [],
            "scanned": scanned,
            "already": False,
            "duplicate_queries": [],
            "budget_exhausted": False,
        }

    if state is not None and not state.budget_remaining():
        return {
            "queries": needles,
            "hits": [],
            "topics": [],
            "scanned": scanned,
            "already": True,
            "duplicate_queries": needles,
            "budget_exhausted": True,
            "retrievedRanges": list(state.retrieved_ranges),
        }

    duplicate = [item for item in needles if state is not None and state.already_have_query(item)]
    fresh = [item for item in needles if item not in duplicate]
    if not fresh:
        return {
            "queries": needles,
            "hits": [],
            "topics": [],
            "scanned": scanned,
            "already": True,
            "duplicate_queries": duplicate,
            "budget_exhausted": False,
            "retrievedRanges": list(state.retrieved_ranges) if state is not None else [],
        }

    cap = max(1, min(int(limit), 50))
    hits: list[dict[str, Any]] = []
    seen_indexes: set[int] = set()
    already_indexes = set(state.retrieved_indexes) if state is not None else set()
    new_count = 0
    remaining_tokens = (
        max(0, state.max_tokens - state.retrieval_tokens)
        if state is not None
        else MAX_RETRIEVAL_TOKENS
    )
    used_tokens = 0
    for item in fresh:
        for hit in store.search_chat_history(session_id, item, limit=cap):
            index = int(hit.get("index") or -1)
            if index < 0 or index in seen_indexes:
                continue
            seen_indexes.add(index)
            row = dict(hit)
            row["query"] = item
            row["already"] = index in already_indexes
            snippet = str(row.get("snippet") or "")
            cost = max(1, estimate_tokens(len(snippet) + 48))
            if not row["already"]:
                if used_tokens + cost > remaining_tokens and hits:
                    break
                used_tokens += cost
                new_count += 1
            hits.append(row)
            if len(hits) >= cap:
                break
        if len(hits) >= cap:
            break

    if hits and new_count == 0:
        if state is not None:
            state.remember(fresh, [], scanned, tokens=0)
        return {
            "queries": needles,
            "hits": hits,
            "topics": group_hits_by_topic(hits),
            "scanned": scanned,
            "already": True,
            "duplicate_queries": fresh + duplicate,
            "budget_exhausted": False,
            "retrievedRanges": list(state.retrieved_ranges) if state is not None else [],
        }

    files = _files_from_hits(hits)
    if state is not None:
        state.remember(
            fresh,
            [hit for hit in hits if not hit.get("already")],
            scanned,
            tokens=used_tokens,
            files=files,
        )

    return {
        "queries": needles,
        "hits": hits,
        "topics": group_hits_by_topic(hits),
        "scanned": scanned,
        "already": False,
        "duplicate_queries": duplicate,
        "budget_exhausted": False,
        "retrievalTokens": used_tokens,
        "retrievedRanges": list(state.retrieved_ranges) if state is not None else [],
    }


def group_hits_by_topic(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    order: list[str] = []
    for hit in hits:
        topic = str(hit.get("query") or "history").strip() or "history"
        if topic not in grouped:
            grouped[topic] = []
            order.append(topic)
        grouped[topic].append(hit)
    topics: list[dict[str, Any]] = []
    for topic in order:
        rows = grouped[topic]
        indexes = sorted(int(row["index"]) for row in rows if isinstance(row.get("index"), int))
        snippets = [
            str(row.get("snippet") or "").strip()
            for row in rows
            if str(row.get("snippet") or "").strip()
        ]
        topics.append(
            {
                "topic": topic,
                "events": _index_ranges(indexes),
                "hitCount": len(rows),
                "summary": _topic_summary(snippets),
            }
        )
    return topics


def format_search_report(result: dict[str, Any]) -> str:
    if result.get("budget_exhausted"):
        return (
            "History search budget exhausted for this turn "
            f"({HISTORY_SEARCH_BUDGET_MAX} calls / {MAX_RETRIEVAL_TOKENS} tokens).\n"
            "Use CONVERSATION MEMORY and events already retrieved. Do not search again."
        )
    if result.get("already") and not result.get("hits"):
        queries = ", ".join(
            f'"{item}"' for item in result.get("duplicate_queries") or result.get("queries") or []
        )
        ranges = result.get("retrievedRanges") or []
        extra = f" events {ranges}" if ranges else ""
        return (
            "Already available in current working context.\n"
            f"Previously searched: {queries or '(same queries)'}{extra}\n"
            "Use CONVERSATION MEMORY and the previous search result. Do not search again."
        )
    topics = result.get("topics") or []
    scanned = int(result.get("scanned") or 0)
    hits = result.get("hits") or []
    if not hits and not topics:
        queries = ", ".join(f'"{item}"' for item in result.get("queries") or [])
        return f"No chat-history matches for {queries or 'the given queries'}."
    lines = [
        f"Searched {scanned} previous events · {len(topics)} topic(s) · {len(hits)} unique hit(s)."
    ]
    if result.get("already"):
        lines.append("Those events were already retrieved this turn — not re-injected.")
    for topic in topics:
        ranges = _format_ranges(topic.get("events") or [])
        lines.append("")
        lines.append(f"Topic: {topic.get('topic')}")
        lines.append(f"events: {ranges or '(none)'}")
        lines.append(f"summary: {topic.get('summary') or '(no snippet)'}")
    return "\n".join(lines).strip()


def _conversation_size(store: AgentSessionStore, session_id: str) -> int:
    return store.conversation_item_count(session_id)


def _normalize_query(value: str) -> str:
    return " ".join(str(value or "").split()).strip().lower()


def _index_ranges(indexes: list[int]) -> list[tuple[int, int]]:
    if not indexes:
        return []
    ranges: list[tuple[int, int]] = []
    start = prev = indexes[0]
    for index in indexes[1:]:
        if index <= prev + 2:
            prev = index
            continue
        ranges.append((start, prev))
        start = prev = index
    ranges.append((start, prev))
    return ranges


def _format_ranges(ranges: object) -> str:
    if not isinstance(ranges, list) or not ranges:
        return ""
    parts: list[str] = []
    for item in ranges:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            start, end = int(item[0]), int(item[1])
            parts.append(str(start) if start == end else f"{start}-{end}")
        elif isinstance(item, int):
            parts.append(str(item))
    return ", ".join(parts)


def _topic_summary(snippets: list[str]) -> str:
    if not snippets:
        return ""
    first = " ".join(snippets[0].split())
    if len(snippets) == 1:
        return first[:180]
    return first[:160]


def _files_from_hits(hits: list[dict[str, Any]]) -> list[str]:
    found: list[str] = []
    for hit in hits:
        snippet = str(hit.get("snippet") or "")
        for token in snippet.replace(",", " ").split():
            cleaned = token.strip("\"'`")
            if "/" in cleaned and cleaned not in found:
                found.append(cleaned)
    return found[:16]


# Keep the character constant imported so tests / callers can reason about
# retrieval token caps without reaching into context internals.
assert CHARS_PER_TOKEN > 0
