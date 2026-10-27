#!/usr/bin/env python3
"""Reproducible local benchmark for Agent Memory V1 context and FTS retrieval."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PACKAGE_ROOT / "src"))

from coloride_desktop.agents.context import AgentContextManager  # noqa: E402
from coloride_desktop.agents.domain import AgentMode, AgentSession  # noqa: E402
from coloride_desktop.agents.memory_retrieval import (  # noqa: E402
    MemoryQuery,
    ProjectMemoryRetriever,
)
from coloride_desktop.agents.project_memory import (  # noqa: E402
    MemoryKind,
    MemorySource,
    ProjectIdentity,
    ProjectMemoryStore,
)
from coloride_desktop.agents.store import AgentSessionStore  # noqa: E402


def _context_case(root: Path, event_count: int) -> dict[str, float | int]:
    store = AgentSessionStore(root / f"sessions-{event_count}")
    session_id = f"benchmark-{event_count}"
    for index in range(event_count):
        role = "user" if index % 2 == 0 else "assistant"
        store.append_conversation_items(
            session_id,
            [{"role": role, "content": f"event {index}: inspect and update auth.ts"}],
        )
    manager = AgentContextManager(store)
    started = time.perf_counter()
    legacy = manager.prepare(session_id, 160_000, memory_v1=False)
    legacy_ms = (time.perf_counter() - started) * 1_000
    started = time.perf_counter()
    memory_v1 = manager.prepare(session_id, 160_000, memory_v1=True)
    memory_v1_ms = (time.perf_counter() - started) * 1_000
    legacy_tokens = (legacy.current_characters + 3) // 4
    memory_v1_tokens = (memory_v1.current_characters + 3) // 4
    reduction = 0.0 if not legacy_tokens else 100 * (1 - memory_v1_tokens / legacy_tokens)
    return {
        "events": event_count,
        "legacyInputTokens": legacy_tokens,
        "memoryV1InputTokens": memory_v1_tokens,
        "reductionPercent": round(reduction, 2),
        "legacyAssemblyMs": round(legacy_ms, 3),
        "memoryV1AssemblyMs": round(memory_v1_ms, 3),
    }


def _retrieval_case(root: Path, memory_count: int, query_count: int) -> dict[str, float | int]:
    session = AgentSession.create(
        agent="coloride",
        cwd="/srv/benchmark",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        connection_id="benchmark-server",
    )
    store = ProjectMemoryStore(root / "project-memory", ProjectIdentity.from_session(session))
    for index in range(memory_count):
        store.upsert_memory(
            MemoryKind.SEMANTIC,
            f"Symbol handler{index} is implemented in /srv/benchmark/src/module{index}.ts",
            MemorySource(
                source_type="benchmark",
                path=f"/srv/benchmark/src/module{index}.ts",
                symbol=f"handler{index}",
            ),
        )
    retriever = ProjectMemoryRetriever()
    durations: list[float] = []
    for index in range(query_count):
        query = MemoryQuery.from_task(f"find handler{index % memory_count}", None)
        started = time.perf_counter()
        retriever.retrieve(store, query)
        durations.append((time.perf_counter() - started) * 1_000)
    ordered = sorted(durations)
    p95_index = min(len(ordered) - 1, max(0, int(len(ordered) * 0.95) - 1))
    return {
        "memories": memory_count,
        "queries": query_count,
        "retrievalP50Ms": round(statistics.median(ordered), 3),
        "retrievalP95Ms": round(ordered[p95_index], 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--memories", type=int, default=10_000)
    parser.add_argument("--queries", type=int, default=100)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="coloride-memory-benchmark-") as directory:
        root = Path(directory)
        result = {
            "context": [_context_case(root, count) for count in (20, 200, 2_000)],
            "retrieval": _retrieval_case(
                root,
                max(1, args.memories),
                max(1, args.queries),
            ),
        }
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
