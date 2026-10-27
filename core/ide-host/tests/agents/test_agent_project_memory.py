from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest

from coloride_desktop.agents.budget import working_set_token_limit
from coloride_desktop.agents.context import AgentContextManager
from coloride_desktop.agents.domain import AgentMode, AgentSession
from coloride_desktop.agents.memory_consolidator import ProjectMemoryConsolidator
from coloride_desktop.agents.memory_retrieval import MemoryQuery, ProjectMemoryRetriever
from coloride_desktop.agents.project_memory import (
    MemoryKind,
    MemorySource,
    MemoryStatus,
    ProjectIdentity,
    ProjectMemoryRegistry,
    ProjectMemoryStore,
    SymbolRecord,
)
from coloride_desktop.agents.provider import ModelToolCall
from coloride_desktop.agents.store import AgentSessionStore
from coloride_desktop.agents.task import AgentTask
from coloride_desktop.agents.tools import RemoteWorkspaceTools
from coloride_desktop.files.local import LocalFileService


def _session(cwd: str, *, kind: str = "ssh", connection_id: str = "server-1") -> AgentSession:
    return AgentSession.create(
        agent="coloride",
        cwd=cwd,
        mode=AgentMode.ACT,
        workspace_kind=kind,
        connection_id=connection_id if kind == "ssh" else None,
    )


def test_project_identity_isolates_paths_on_the_same_server() -> None:
    first = ProjectIdentity.from_session(_session("/srv/app"))
    second = ProjectIdentity.from_session(_session("/srv/api"))
    same = ProjectIdentity.from_session(_session("/srv/app/../app"))

    assert first.key != second.key
    assert first.key == same.key
    assert first.canonical == "ssh|server-1|/srv/app"


def test_project_store_is_private_deduplicated_and_searchable(tmp_path) -> None:
    identity = ProjectIdentity.from_session(_session("/srv/app"))
    store = ProjectMemoryStore(tmp_path / "project-memory", identity)
    source = MemorySource(
        source_type="repository_file",
        path="/srv/app/src/auth.ts",
        etag="20-100",
        symbol="refreshSession",
    )

    first = store.upsert_memory(
        MemoryKind.SEMANTIC,
        "Authentication refresh lives in refreshSession.",
        source,
        canonical_key="auth-refresh",
        confidence=0.8,
    )
    second = store.upsert_memory(
        MemoryKind.SEMANTIC,
        "Authentication refresh is implemented by refreshSession.",
        source,
        canonical_key="auth-refresh",
        confidence=0.95,
    )

    assert first is not None and second is not None
    assert first.memory_id == second.memory_id
    assert len(store.all_memories()) == 1
    hits = store.query_candidates("auth refreshSession")
    assert hits and hits[0][0].source.path == "/srv/app/src/auth.ts"
    exact = ProjectMemoryRetriever().retrieve(
        store,
        MemoryQuery(text="", paths=["/srv/app/src/auth.ts"]),
    )
    assert exact.hits[0].reasons[0] == "exact"
    assert store.path.stat().st_mode & 0o777 == 0o600
    assert store.project_root.stat().st_mode & 0o777 == 0o700


@pytest.mark.asyncio
async def test_retrieval_rejects_changed_source_code(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    target = workspace / "auth.ts"
    target.write_text("export const oldAuth = true;\n", encoding="utf-8")
    session = _session(str(workspace), kind="local")
    files = LocalFileService(str(workspace))
    stat = await files.stat_path(str(target))
    store = ProjectMemoryStore(
        tmp_path / "project-memory",
        ProjectIdentity.from_session(session),
    )
    entry = store.upsert_memory(
        MemoryKind.SEMANTIC,
        "oldAuth controls authentication.",
        MemorySource(
            source_type="repository_file",
            path=str(target),
            etag=str(stat["etag"]),
            symbol="oldAuth",
        ),
    )
    assert entry is not None
    store.replace_symbols(
        str(target),
        str(stat["etag"]),
        [
            SymbolRecord(
                name="oldAuth",
                kind="variable",
                path=str(target),
                start_line=1,
                end_line=1,
                etag=str(stat["etag"]),
            )
        ],
    )
    retriever = ProjectMemoryRetriever()
    result = retriever.retrieve(store, MemoryQuery.from_task("change oldAuth", None))
    assert result.hits

    target.write_text("export const newAuth = true;\n", encoding="utf-8")
    os.utime(target, (stat["mtime"] + 2, stat["mtime"] + 2))
    validated = await retriever.validate_sources(store, result, files)

    assert validated.hits == []
    assert validated.symbols == []
    assert validated.stale_rejected_ids == [entry.memory_id]
    assert store.get_memory(entry.memory_id).status == MemoryStatus.STALE  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_read_file_reuses_verified_range_without_second_content_read(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    target = workspace / "page.tsx"
    target.write_text(
        "export function Page() {\n  return <main>Hello</main>;\n}\n",
        encoding="utf-8",
    )
    files = LocalFileService(str(workspace))
    original_read = files.read
    reads = 0

    async def counted_read(path: str):
        nonlocal reads
        reads += 1
        return await original_read(path)

    files.read = counted_read  # type: ignore[method-assign]

    async def run_command(_command: str):
        return {"stdout": "", "exit_status": 0}

    session_store = AgentSessionStore(tmp_path / "sessions")
    tools = RemoteWorkspaceTools(files=files, run_command=run_command, store=session_store)
    tools.bind_project_memory(ProjectMemoryRegistry(tmp_path / "project-memory"))
    session = _session(str(workspace), kind="local")
    tools.begin_turn_retrieval(session.session_id, object())
    first = await tools.execute(
        ModelToolCall(
            call_id="call-1",
            name="read_file",
            arguments={"path": str(target), "start_line": 1, "end_line": 3},
        ),
        session,
    )
    second = await tools.execute(
        ModelToolCall(
            call_id="call-2",
            name="read_file",
            arguments={"path": str(target), "start_line": 1, "end_line": 3},
        ),
        session,
    )

    assert reads == 1
    assert first.output == second.output
    assert first.metadata["cached"] is False
    assert second.metadata["cached"] is True
    assert tools.memory_cache_hits(session.session_id) == 1
    assert any(item["name"] == "Page" for item in second.metadata["symbols"])


def test_context_budget_uses_provider_capacity_with_unknown_fallback() -> None:
    assert working_set_token_limit(None) == 40_000
    assert working_set_token_limit(200_000) == 192_000


def test_memory_v1_keeps_all_conversation_that_fits(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_memory_v1"
    for index in range(100):
        store.append_conversation_items(
            session_id,
            [
                {"role": "user", "content": f"old question {index}"},
                {"role": "assistant", "content": f"old answer {index}"},
            ],
        )
    prepared = AgentContextManager(store).prepare(
        session_id,
        120_000,
        memory_v1=True,
    )
    rendered = str(prepared.items)

    assert "old question 0" in rendered
    assert "old question 98" in rendered
    assert "old question 99" in rendered
    assert len(prepared.items) == 200


def test_consolidator_redacts_decisions_and_records_verified_workflow(tmp_path) -> None:
    store = ProjectMemoryStore(
        tmp_path / "project-memory",
        ProjectIdentity.from_session(_session("/srv/app")),
    )
    task = AgentTask.create(
        conversation_id="sess-1",
        workspace_id=store.identity.key,
        goal="Fix tests",
    )
    task.remember_decision("Always use the focused auth test")
    consolidator = ProjectMemoryConsolidator()
    consolidator.observe_tool(
        store,
        task,
        tool="execute_command",
        arguments={"command": "API_TOKEN=super-secret npm test -- auth", "cwd": "/srv/app"},
        output="Exit code: 0\n3 passed",
        metadata={"exitCode": 0, "cwd": "/srv/app"},
    )
    consolidator.consolidate_task(
        store,
        task,
        user_message="Never include Authorization: Bearer abc123 in memory",
    )
    contents = "\n".join(entry.content for entry in store.all_memories())

    assert "super-secret" not in contents
    assert "abc123" not in contents
    assert "API_TOKEN=<redacted>" in contents
    assert any(entry.kind == MemoryKind.DECISION for entry in store.all_memories())


def test_retention_never_archives_decisions_automatically(tmp_path) -> None:
    store = ProjectMemoryStore(
        tmp_path / "project-memory",
        ProjectIdentity.from_session(_session("/srv/app")),
    )
    decision = store.upsert_memory(
        MemoryKind.DECISION,
        "Use SQLite FTS5.",
        MemorySource(source_type="user_decision"),
    )
    fact = store.upsert_memory(
        MemoryKind.SEMANTIC,
        "A very old fact.",
        MemorySource(source_type="legacy_session"),
    )
    assert decision is not None and fact is not None
    old = (datetime.now(UTC) - timedelta(days=400)).isoformat()
    with store._connect() as connection:  # noqa: SLF001 - deterministic retention fixture
        connection.execute("UPDATE memory_entries SET last_accessed_at=?", (old,))

    store.run_retention()

    assert store.get_memory(decision.memory_id).status == MemoryStatus.ACTIVE  # type: ignore[union-attr]
    assert store.get_memory(fact.memory_id) is None


def test_new_decision_can_supersede_an_old_one_without_retrieving_it(tmp_path) -> None:
    store = ProjectMemoryStore(
        tmp_path / "project-memory",
        ProjectIdentity.from_session(_session("/srv/app")),
    )
    old = store.upsert_memory(
        MemoryKind.DECISION,
        "Use npm for this project.",
        MemorySource(source_type="user_decision"),
        canonical_key="package-manager:npm",
    )
    assert old is not None
    new = store.upsert_memory(
        MemoryKind.DECISION,
        "Use pnpm for this project.",
        MemorySource(source_type="user_decision"),
        canonical_key="package-manager:pnpm",
        supersedes_id=old.memory_id,
    )

    assert new is not None
    assert store.get_memory(old.memory_id).status == MemoryStatus.SUPERSEDED  # type: ignore[union-attr]
    retrieved = ProjectMemoryRetriever().retrieve(
        store,
        MemoryQuery.from_task("Which package manager should I use?", None),
    )
    assert all(hit.entry.memory_id != old.memory_id for hit in retrieved.hits)


def test_two_chats_share_project_memory_but_another_cwd_does_not(tmp_path) -> None:
    registry = ProjectMemoryRegistry(tmp_path / "project-memory")
    first_session = _session("/srv/app")
    second_session = _session("/srv/app")
    other_session = _session("/srv/api")
    first = registry.for_session(first_session)
    first.upsert_memory(
        MemoryKind.DECISION,
        "Use SQLite FTS5 for project memory.",
        MemorySource(source_type="user_decision", session_id=first_session.session_id),
    )

    query = MemoryQuery.from_task("How does project memory use FTS5?", None)
    shared = ProjectMemoryRetriever().retrieve(registry.for_session(second_session), query)
    isolated = ProjectMemoryRetriever().retrieve(registry.for_session(other_session), query)

    assert shared.hits and shared.hits[0].entry.kind == MemoryKind.DECISION
    assert isolated.hits == []


def test_lazy_migration_is_idempotent_and_does_not_copy_raw_transcript(tmp_path) -> None:
    sessions = AgentSessionStore(tmp_path / "sessions")
    session = _session("/srv/app")
    sessions.save_session(session)
    sessions.append_conversation_items(
        session.session_id,
        [
            {"role": "user", "content": "Always use SQLite FTS5 for memory"},
            {"role": "assistant", "content": "Decision: use SQLite FTS5."},
            {
                "type": "function_call_output",
                "call_id": "call-secret",
                "output": "RAW-OUTPUT-MUST-NOT-BE-INDEXED",
            },
        ],
    )
    project = ProjectMemoryStore(
        tmp_path / "project-memory",
        ProjectIdentity.from_session(session),
    )
    consolidator = ProjectMemoryConsolidator()

    first = consolidator.migrate_legacy(project, sessions)
    second = consolidator.migrate_legacy(project, sessions)
    contents = "\n".join(entry.content for entry in project.all_memories())

    assert first["sessions"] == 1
    assert second == {"sessions": 0, "memories": 0}
    assert "RAW-OUTPUT-MUST-NOT-BE-INDEXED" not in contents


def test_memory_v1_does_not_discard_history_after_500_items(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    short_id = "sess_short"
    long_id = "sess_long"
    recent = [
        {"role": "user", "content": "Inspect auth.ts"},
        {"role": "assistant", "content": "I will inspect auth.ts"},
        {"role": "user", "content": "Fix refreshSession"},
        {"role": "assistant", "content": "I will fix refreshSession"},
    ]
    store.append_conversation_items(short_id, recent)
    for index in range(2_000):
        store.append_conversation_items(
            long_id,
            [{"role": "user" if index % 2 == 0 else "assistant", "content": f"old-{index}"}],
        )
    store.append_conversation_items(long_id, recent)

    manager = AgentContextManager(store)
    short = manager.prepare(short_id, 160_000, memory_v1=True)
    long = manager.prepare(long_id, 160_000, memory_v1=True)

    assert long.current_characters <= 160_000
    assert long.items[-4:] == short.items
    assert "old-0" in str(long.items)
    assert len(long.items) == 2_004


def test_memory_v1_compacts_seen_tool_outputs_without_orphaning_pairs(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_tool_history"
    store.append_conversation_items(
        session_id,
        [{"role": "user", "content": "Diagnose and fix the project"}],
    )
    for index in range(20):
        call_id = f"call-{index}"
        store.append_conversation_items(
            session_id,
            [
                {
                    "type": "function_call",
                    "call_id": call_id,
                    "name": "read_file",
                    "arguments": '{"path":"/srv/app/file.ts"}',
                },
                {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": "source line\n" * 600,
                },
            ],
        )

    prepared = AgentContextManager(store).prepare(
        session_id,
        24_000,
        memory_v1=True,
    )
    call_ids = {
        str(item.get("call_id") or "")
        for item in prepared.items
        if item.get("type") == "function_call"
    }
    output_ids = {
        str(item.get("call_id") or "")
        for item in prepared.items
        if item.get("type") == "function_call_output"
    }

    assert call_ids == output_ids
    assert prepared.current_characters <= 24_000
    assert any(
        item.get("output") == "source line\n" * 600
        for item in store.list_conversation_items(session_id)
    )
    store.append_conversation_items(
        session_id,
        [{"role": "assistant", "content": "The previous tool batch was processed."}],
    )
    after_response = AgentContextManager(store).prepare(
        session_id,
        24_000,
        memory_v1=True,
    )
    assert all(
        item.get("output") != "source line\n" * 600
        for item in after_response.items
    )


def test_forget_server_purges_every_cwd_for_only_that_connection(tmp_path) -> None:
    registry = ProjectMemoryRegistry(tmp_path / "project-memory")
    first = registry.for_session(_session("/srv/app", connection_id="server-1"))
    second = registry.for_session(_session("/srv/api", connection_id="server-1"))
    other = registry.for_session(_session("/srv/app", connection_id="server-2"))
    for store in (first, second, other):
        store.upsert_memory(
            MemoryKind.SEMANTIC,
            f"Memory for {store.identity.canonical}",
            MemorySource(source_type="test"),
        )

    assert registry.purge_connection("server-1") == 2
    assert not first.project_root.exists()
    assert not second.project_root.exists()
    assert other.project_root.exists()


def test_memory_v1_budget_scales_and_keeps_goal_and_decisions_when_compacting(tmp_path):
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "planning-continuity"
    items = [
        {"role": "user", "content": "Quiero crear una app de recetas llamada Cocina."},
        {"role": "assistant", "content": "Podemos usar distintas tecnologías."},
        {"role": "user", "content": "Prefiero TypeScript y Tailwind, sin login."},
    ]
    for index in range(60):
        items.extend([
            {"role": "user", "content": f"Detalle {index}: " + "layout " * 150},
            {"role": "assistant", "content": f"Respuesta {index}: " + "component " * 150},
        ])
    items.append({"role": "user", "content": "puedes empezar con la creacion"})
    store.append_conversation_items(session_id, items)
    manager = AgentContextManager(store)
    large = manager.prepare(session_id, 300_000, memory_v1=True)
    small = manager.prepare(session_id, 30_000, memory_v1=True)
    assert large.items == items
    assert large.current_characters > small.current_characters
    assert small.current_characters <= 30_000 * 0.8
    assert small.removed_items > 0
    summary = small.items[0]["content"]
    assert "Cocina" in summary
    assert "Prefiero TypeScript y Tailwind, sin login" in summary
    assert small.items[-1] == items[-1]
    assert store.list_conversation_items(session_id, limit=None) == items
    # A new manager after reopening the chat preserves the same decisions.
    reopened = AgentContextManager(store).prepare(session_id, 30_000, memory_v1=True)
    assert "Cocina" in reopened.items[0]["content"]
    assert "sin login" in reopened.items[0]["content"]
