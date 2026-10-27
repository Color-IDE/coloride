from __future__ import annotations

from coloride_desktop.agents.context import AgentContextManager
from coloride_desktop.agents.memory import ConversationMemory
from coloride_desktop.agents.retrieval import (
    TurnRetrievalState,
    classify_user_intent,
    format_search_report,
    search_conversation,
)
from coloride_desktop.agents.store import AgentSessionStore
from coloride_desktop.agents.task import AgentTask


def test_conversation_memory_extracts_topics_and_changes() -> None:
    memory = ConversationMemory.from_items(
        [
            {"role": "user", "content": "Harden desktop secrets so the DMG does not ship .env"},
            {"role": "assistant", "content": "I will inspect the Electron packaging."},
            {
                "type": "function_call",
                "name": "replace_in_file",
                "arguments": '{"path":"client/desktop/src/main.cjs"}',
            },
            {"role": "user", "content": "Linear OAuth is failing after the callback"},
            {"role": "assistant", "content": "The client_secret is missing from the token exchange."},
        ]
    )
    assert memory.sufficient_for_recap() is True
    assert any("desktop secrets" in topic.lower() or "dmg" in topic.lower() for topic in memory.all_topics)
    assert any("Linear OAuth" in topic for topic in memory.all_topics)
    assert any("replace_in_file" in change for change in memory.all_changes)
    block = memory.prompt_block()
    assert "CONVERSATION MEMORY" in block
    assert "Topics:" in block


def test_recap_intent_does_not_need_search_when_memory_is_rich(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_recap"
    store.append_conversation_items(
        session_id,
        [
            {"role": "user", "content": "Fix desktop secrets and Linear OAuth"},
            {"role": "assistant", "content": "Packaging no longer ships .env. OAuth callback still needs the secret."},
            {
                "type": "function_call",
                "name": "write_file",
                "arguments": '{"path":"client/ide/src/auth/linearCloud.ts"}',
            },
            {"role": "user", "content": "The VPS API /users admin list is empty"},
            {"role": "assistant", "content": "The query was using the wrong table."},
        ],
    )
    memory = store.load_or_build_memory(session_id)
    assert memory.sufficient_for_recap() is True
    assert classify_user_intent("explícame lo que hemos hecho") == "recap"
    assert classify_user_intent("continúa donde lo dejamos") == "recap"
    assert classify_user_intent("fix the remaining OAuth bug") == "other"

    task = AgentTask.create(conversation_id=session_id, workspace_id="/srv/app", goal="Fix OAuth")
    prepared = AgentContextManager(store).build(
        session_id,
        24_000,
        task=task,
        memory=memory,
        recap=True,
    )
    first = str(prepared.items[0]["content"])
    assert "CONVERSATION MEMORY" in first
    assert "Answer now. Do not call search_chat_history." in first
    assert "CURRENT TASK" in first
    assert "Fix OAuth" in first


def test_compacted_build_does_not_inject_conversation_memory_twice(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_memory_deduplicated"
    store.append_conversation_items(
        session_id,
        [
            {
                "role": "user" if index % 2 == 0 else "assistant",
                "content": f"turn-{index} OAuth decision " + "x" * 1_000,
            }
            for index in range(80)
        ],
    )
    memory = store.load_or_build_memory(session_id)
    task = AgentTask.create(
        conversation_id=session_id,
        workspace_id="/srv/app",
        goal="Finish OAuth",
    )

    prepared = AgentContextManager(store).build(
        session_id,
        24_000,
        task=task,
        memory=memory,
    )

    internal = prepared.items[0]
    compacted = prepared.items[1]
    assert prepared.compacted
    assert internal["role"] == "developer"
    assert internal.get("colorideInternal") is True
    assert "Coloride compacted earlier task context" in str(compacted["content"])
    assert "CONVERSATION MEMORY (" not in str(internal["content"])
    # The compact prefix contains summary metadata once in its explanation and
    # once as the structured summary heading, not a third injected memory block.
    assert str(compacted["content"]).count("summary_v") == 2


def test_long_history_memory_and_search_cover_items_before_2000_cap(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_long_memory"
    store.append_conversation_items(
        session_id,
        [
            {"role": "user", "content": "oldest architectural decision keep-safe-copy"},
            *[
                {"role": "assistant", "content": f"filler event {index}"}
                for index in range(2_103)
            ],
            {"role": "user", "content": "newest follow-up"},
        ],
    )

    assert store.conversation_item_count(session_id) == 2_105
    assert len(store.list_conversation_items(session_id, limit=None)) == 2_105
    hits = store.search_chat_history(session_id, "keep-safe-copy")
    assert len(hits) == 1
    assert hits[0]["index"] == 0

    memory = store.load_or_build_memory(session_id)
    assert memory.covered_items == 2_105
    assert memory.event_count == 2_105


def test_search_chat_history_batches_queries_and_latches_duplicates(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_search"
    store.append_conversation_items(
        session_id,
        [
            {"role": "user", "content": "Desktop secrets must not ship in the DMG"},
            {"role": "assistant", "content": "I removed .env from the package."},
            {"role": "user", "content": "Linear OAuth callback is 401"},
            {"role": "assistant", "content": "client_secret is missing."},
            {"role": "user", "content": "VPS API /users returns empty for admin"},
            {"role": "assistant", "content": "Wrong users table in the query."},
        ],
    )
    state = TurnRetrievalState(session_id=session_id)
    first = search_conversation(
        store,
        session_id,
        ["desktop secrets DMG", "Linear OAuth", "VPS API"],
        limit=20,
        state=state,
    )
    assert first["already"] is False
    assert len(first["topics"]) >= 2
    report = format_search_report(first)
    assert "Topic:" in report
    assert "events:" in report

    second = search_conversation(
        store,
        session_id,
        ["Linear OAuth"],
        limit=20,
        state=state,
    )
    assert second["already"] is True
    assert "Already available in current working context." in format_search_report(second)


def test_memory_recent_delta_updates_before_compaction(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_delta"
    store.append_conversation_items(
        session_id,
        [
            {"role": "user", "content": "Fix authentication redirect after login"},
            {"role": "assistant", "content": "I will inspect the auth middleware."},
            {
                "type": "function_call",
                "name": "replace_in_file",
                "arguments": '{"path":"src/auth.ts"}',
            },
        ],
    )
    first = store.load_or_build_memory(session_id)
    assert first.summary_version == 0
    assert first.covers_until == 0
    assert any("authentication" in topic.lower() for topic in first.recent_delta.topics)
    assert first.sufficient_for_recap() is True

    store.append_conversation_items(
        session_id,
        [
            {"role": "user", "content": "OAuth refresh token fails on the VPS API"},
            {"role": "assistant", "content": "The middleware skips refresh when the cookie is missing."},
        ],
    )
    second = store.load_or_build_memory(session_id)
    assert second.covered_items == 5
    assert any("OAuth" in topic for topic in second.recent_delta.topics)
    assert "OAuth" in second.prompt_block()
    assert second.summary_version == 0

    second.fold_delta(covers_until=5)
    assert second.summary_version == 1
    assert second.covers_until == 5
    assert second.recent_delta.empty() is True
    assert any("OAuth" in topic for topic in second.session_topics)
    payload = second.structured_summary()
    assert payload["summary_version"] == 1
    assert payload["covers_until_event_id"] == 5


def test_search_budget_blocks_a_third_call(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_budget"
    store.append_conversation_items(
        session_id,
        [
            {"role": "user", "content": "OAuth on the VPS"},
            {"role": "assistant", "content": "Need the client secret."},
        ],
    )
    state = TurnRetrievalState(session_id=session_id)
    first = search_conversation(store, session_id, ["OAuth"], state=state)
    second = search_conversation(store, session_id, ["VPS API"], state=state)
    third = search_conversation(store, session_id, ["desktop security"], state=state)
    assert first["already"] is False
    assert second["already"] is False
    assert third["budget_exhausted"] is True
    assert "budget exhausted" in format_search_report(third).lower()
