from __future__ import annotations

from coloride_desktop.agents.context import _SESSION_PROMPT_CACHE, AgentContextManager
from coloride_desktop.agents.store import AgentSessionStore


def test_compacted_prefix_survives_a_new_context_manager(tmp_path):
    store = AgentSessionStore(root=tmp_path / "sessions")
    session_id = "sess_context"
    store.append_conversation_items(
        session_id,
        [{"role": "user", "content": f"message {index} " + "x" * 1_000} for index in range(80)],
    )
    first = AgentContextManager(store).prepare(session_id, max_characters=24_000)
    assert first.newly_compacted
    assert first.compacted
    assert first.current_characters <= 24_000

    # New engine / manager in the same process must reuse the prompt cache.
    restored = AgentContextManager(store).prepare(session_id, max_characters=24_000)
    assert restored.compacted
    assert not restored.newly_compacted
    assert restored.current_characters <= 24_000


def test_compacted_prefix_survives_a_process_cache_reset(tmp_path):
    root = tmp_path / "sessions"
    store = AgentSessionStore(root=root)
    session_id = "sess_context_restart"
    store.append_conversation_items(
        session_id,
        [{"role": "user", "content": f"message {index} " + "x" * 1_000} for index in range(80)],
    )
    first = AgentContextManager(store).prepare(session_id, max_characters=24_000)
    assert first.newly_compacted
    assert (root / "context_snapshots" / f"session_{session_id}.json").exists()

    # Simulate a full Python/Electron restart: the module cache is empty, while
    # the append-only transcript and persisted compact snapshot remain.
    _SESSION_PROMPT_CACHE.clear()
    restored_store = AgentSessionStore(root=root)
    restored = AgentContextManager(restored_store).prepare(
        session_id,
        max_characters=24_000,
    )

    assert restored.compacted
    assert not restored.newly_compacted
    assert restored.current_characters <= 24_000
