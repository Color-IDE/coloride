from __future__ import annotations

import json

import pytest

from coloride_desktop.agents.budget import (
    HARD_LIMIT_TOKENS,
    SOFT_LIMIT_TOKENS,
    TARGET_CONTEXT_TOKENS,
    estimate_tokens,
)
from coloride_desktop.agents.context import (
    WORKING_SET_MAX_CHARACTERS,
    AgentContextManager,
    keep_recent_spans,
)
from coloride_desktop.agents.provider import (
    CONTEXT_COMPACT_TOKEN_FRACTION,
    _max_context_characters,
    _max_context_tokens,
)
from coloride_desktop.agents.store import AgentSessionStore


def test_context_compaction_is_prompt_only_and_keeps_recent_messages(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_context_test"
    items = [
        {
            "role": "user" if index % 2 == 0 else "assistant",
            "content": f"message-{index} " + ("x" * 4_000),
        }
        for index in range(20)
    ]
    store.append_conversation_items(session_id, items)
    original = store.list_conversation_items(session_id, limit=2_000)

    prepared = AgentContextManager(store).prepare(session_id, 24_000)

    assert prepared.compacted is True
    assert prepared.newly_compacted is True
    assert prepared.removed_items > 0
    assert prepared.current_characters < prepared.original_characters
    assert "Coloride compacted earlier task context" in str(prepared.items[0]["content"])
    assert "Goal:" in str(prepared.items[0]["content"])
    assert "message-19" in str(prepared.items[-1]["content"])
    # Durable history must stay intact — compaction is a prompt view only.
    assert store.list_conversation_items(session_id, limit=2_000) == original
    assert len(store.list_conversation_items(session_id, limit=2_000)) == 20


def test_context_clips_huge_pasted_user_message(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_huge_paste"
    pasted = "<div class='app-main-card'>" + ("x" * 40_000)
    store.append_conversation_items(
        session_id,
        [
            {"role": "user", "content": "small earlier note"},
            {"role": "assistant", "content": "ok"},
            {"role": "user", "content": pasted},
        ],
    )
    original = store.list_conversation_items(session_id, limit=2_000)

    prepared = AgentContextManager(store).prepare(session_id, 200_000)

    assert prepared.compacted is True
    assert prepared.newly_compacted is False
    assert prepared.current_characters < prepared.original_characters
    last = str(prepared.items[-1]["content"])
    assert "Coloride omitted" in last
    assert len(last) < 17_000
    assert store.list_conversation_items(session_id, limit=2_000) == original


def test_recovery_prepare_keeps_a_small_working_set(tmp_path) -> None:
    from coloride_desktop.agents.context import recovery_history_limit

    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_recovery"
    chunk = "y" * 8_000
    store.append_conversation_items(
        session_id,
        [
            {
                "role": "user" if index % 2 == 0 else "assistant",
                "content": f"turn-{index} {chunk}",
            }
            for index in range(30)
        ],
    )
    budget = recovery_history_limit(1_360_000)
    prepared = AgentContextManager(store).prepare(session_id, budget, recovery=True)

    assert prepared.compacted is True
    assert prepared.current_characters <= budget
    assert prepared.current_characters < prepared.original_characters
    assert any("Coloride omitted" in str(item.get("content") or "") for item in prepared.items)


def test_context_compacts_only_old_large_tool_outputs(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_tool_context"
    items: list[dict[str, str]] = []
    for index in range(10):
        call_id = f"call-{index}"
        items.extend(
            [
                {
                    "type": "function_call",
                    "call_id": call_id,
                    "name": "read_file",
                    "arguments": '{"path":"large.py"}',
                },
                {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": json.dumps({"ok": True, "output": f"tool-{index} " + "x" * 5_000}),
                },
            ]
        )
    store.append_conversation_items(session_id, items)
    original = store.list_conversation_items(session_id, limit=2_000)

    prepared = AgentContextManager(store).prepare(session_id, 200_000)

    outputs = [
        str(item["output"])
        for item in prepared.items
        if item.get("type") == "function_call_output"
    ]
    assert prepared.compacted is True
    assert prepared.newly_compacted is False
    assert prepared.current_characters < prepared.original_characters
    assert '"compacted":true' in outputs[0]
    assert "spilled" in outputs[0]
    assert "read_tool_output" in outputs[0]
    assert all('"compacted":true' in body for body in outputs[:-2])
    assert "tool-8 " + "x" * 5_000 in outputs[8]
    assert "tool-9 " + "x" * 5_000 in outputs[9]
    spilled = store.read_tool_output(session_id, "call-0")
    assert spilled["lines"] >= 1
    assert "tool-0" in spilled["text"]
    # The stored transcript remains recoverable and unmodified.
    assert store.list_conversation_items(session_id, limit=2_000) == original


def test_grok_45_window_is_500k_tokens() -> None:
    assert _max_context_tokens("xai", "grok-4.5") == 500_000
    assert _max_context_tokens("xai", "grok-4") == 500_000
    # Compact at 85% of 500k → char budget ≈ 500k * 0.85 * 3.2
    assert _max_context_characters("xai", "grok-4.5") == 1_360_000
    assert CONTEXT_COMPACT_TOKEN_FRACTION == 0.85


def test_grok_43_window_is_1m_tokens() -> None:
    assert _max_context_tokens("xai", "grok-4.3") == 1_000_000
    assert _max_context_tokens("xai", "grok-4.3-reasoning") == 1_000_000
    # Compact at 85% of 1M → char budget ≈ 1M * 0.85 * 3.2
    assert _max_context_characters("xai", "grok-4.3") == 2_720_000


def test_minimax_m3_window_is_512k_tokens() -> None:
    model = "accounts/fireworks/models/minimax-m3"
    assert _max_context_tokens("fireworks", model) == 512_000
    # Compact at 85% of 512k → char budget ≈ 512k * 0.85 * 3.2
    assert _max_context_characters("fireworks", model) == 1_392_640


def test_grok_build_window_is_256k_tokens() -> None:
    assert _max_context_tokens("xai", "grok-build-0.1") == 256_000
    # The published window remains 256k, but the working prompt is bounded so
    # the managed xAI proxy does not time out on huge agent transcripts.
    assert _max_context_characters("xai", "grok-build-0.1") == 120_000


def test_deepseek_v4_flash_window_is_1m_tokens() -> None:
    model = "accounts/fireworks/models/deepseek-v4-flash"
    assert _max_context_tokens("fireworks", model) == 1_000_000
    assert _max_context_characters("fireworks", model) == 2_720_000


def test_working_set_cap_compacts_medium_history(tmp_path) -> None:
    """History above the hard 128k working-set cap must compact (Grok window no longer wins)."""
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_context_large"
    items = [
        {
            "role": "user" if index % 2 == 0 else "assistant",
            "content": f"message-{index} " + ("x" * 4_000),
        }
        for index in range(40)
    ]
    store.append_conversation_items(session_id, items)
    original = store.list_conversation_items(session_id, limit=2_000)

    prepared = AgentContextManager(store).prepare(session_id, WORKING_SET_MAX_CHARACTERS)
    assert prepared.original_characters > WORKING_SET_MAX_CHARACTERS
    assert prepared.compacted is True
    assert prepared.newly_compacted is True
    assert prepared.removed_items > 0
    assert prepared.current_characters <= WORKING_SET_MAX_CHARACTERS
    assert "Coloride compacted earlier task context" in str(prepared.items[0]["content"])
    assert "Goal:" in str(prepared.items[0]["content"])
    assert "message-39" in str(prepared.items[-1]["content"])
    assert store.list_conversation_items(session_id, limit=2_000) == original


def test_greeting_short_circuit_is_not_part_of_the_engine() -> None:
    import coloride_desktop.agents.client as client_mod
    import coloride_desktop.agents.engine as engine_mod

    assert not hasattr(engine_mod, "is_trivial_agent_message")
    assert not hasattr(engine_mod, "_run_trivial_turn")
    assert not hasattr(engine_mod, "_TRIVIAL_UTTERANCES")
    assert "is_trivial_agent_message" not in dir(client_mod)


def test_grok_budget_compacts_when_history_reaches_window(tmp_path) -> None:
    """When transcript chars hit 85% of the Grok window, compact immediately."""
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_context_full"
    budget = _max_context_characters("xai", "grok-4.5")
    # Stay under the per-message clip, but exceed the ~1.36M (85%) soft budget.
    chunk = "x" * 14_000
    items = [
        {
            "role": "user" if index % 2 == 0 else "assistant",
            "content": f"message-{index} {chunk}",
        }
        for index in range(100)
    ]
    store.append_conversation_items(session_id, items)
    original = store.list_conversation_items(session_id, limit=2_000)

    manager = AgentContextManager(store)
    prepared = manager.prepare(session_id, WORKING_SET_MAX_CHARACTERS)

    assert prepared.original_characters > WORKING_SET_MAX_CHARACTERS
    assert prepared.compacted is True
    assert prepared.newly_compacted is True
    assert prepared.removed_items > 0
    assert prepared.current_characters < prepared.original_characters
    assert prepared.current_characters <= WORKING_SET_MAX_CHARACTERS
    assert "Coloride compacted earlier task context" in str(prepared.items[0]["content"])
    # Durable log untouched.
    assert store.list_conversation_items(session_id, limit=2_000) == original

    # Incremental cache: small tail append reuses the summary — not a new compact.
    store.append_conversation_items(
        session_id,
        [{"role": "user", "content": "follow-up after compact"}],
    )
    again = manager.prepare(session_id, WORKING_SET_MAX_CHARACTERS)
    assert again.compacted is True
    assert again.newly_compacted is False
    assert again.current_characters <= WORKING_SET_MAX_CHARACTERS
    assert "follow-up after compact" in str(again.items[-1]["content"])
    assert "Coloride compacted earlier task context" in str(again.items[0]["content"])

    # Engines are created per turn — a NEW manager must still reuse the process cache
    # so we don't spam "Context compacted" on every user message.
    other = AgentContextManager(store)
    third = other.prepare(session_id, WORKING_SET_MAX_CHARACTERS)
    assert third.compacted is True
    assert third.newly_compacted is False
    assert "follow-up after compact" in str(third.items[-1]["content"])

    # Tighter force-budget may rebuild once if the cached view is larger than the
    # new limit — but a second call at the same limit must not spam again.
    tight = int(WORKING_SET_MAX_CHARACTERS * 0.55)
    forced = other.prepare(session_id, tight)
    assert forced.compacted is True
    assert forced.current_characters <= tight
    forced_again = other.prepare(session_id, tight)
    assert forced_again.newly_compacted is False

    # Back to the normal budget: still reuse cache (no new UI compact row).
    relaxed = other.prepare(session_id, WORKING_SET_MAX_CHARACTERS)
    assert relaxed.newly_compacted is False


def test_token_budget_is_real_tokens_not_the_published_window() -> None:
    assert TARGET_CONTEXT_TOKENS == 25_000
    assert SOFT_LIMIT_TOKENS == 32_000
    assert HARD_LIMIT_TOKENS == 40_000
    assert estimate_tokens(WORKING_SET_MAX_CHARACTERS) == HARD_LIMIT_TOKENS


def test_keep_recent_spans_does_not_split_tool_call_from_result() -> None:
    items: list[dict] = []
    for index in range(6):
        items.append({"role": "user", "content": f"ask-{index} " + ("x" * 800)})
        items.append(
            {
                "type": "function_call",
                "call_id": f"call-{index}",
                "name": "read_file",
                "arguments": '{"path":"src/auth.ts"}',
            }
        )
        items.append(
            {
                "type": "function_call_output",
                "call_id": f"call-{index}",
                "output": f"body-{index} " + ("y" * 800),
            }
        )
        items.append({"role": "assistant", "content": f"done-{index}"})
    recent, split_at = keep_recent_spans(items, 8_000, target_tokens=2_000)
    assert split_at > 0
    assert recent[0].get("role") == "user"
    call_ids = [item.get("call_id") for item in recent if item.get("type") == "function_call"]
    result_ids = [item.get("call_id") for item in recent if item.get("type") == "function_call_output"]
    assert call_ids
    assert set(call_ids) == set(result_ids)


def test_small_history_is_not_padded_to_the_hard_limit(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session_id = "sess_small"
    store.append_conversation_items(
        session_id,
        [
            {"role": "user", "content": "Fix the login redirect"},
            {"role": "assistant", "content": "I will inspect auth.ts"},
        ],
    )
    prepared = AgentContextManager(store).prepare(session_id, WORKING_SET_MAX_CHARACTERS)
    assert prepared.compacted is False
    assert prepared.current_characters < 2_000
    assert estimate_tokens(prepared.current_characters) < TARGET_CONTEXT_TOKENS


def test_argon_uses_unified_context_window() -> None:
    assert _max_context_tokens("gemini", "gemini-4-argon") == 1_048_576
    assert _max_context_characters("gemini", "gemini-4-argon") == int(1_048_576 * 0.85 * 3.2)


@pytest.mark.parametrize("recovery", [False, True])
@pytest.mark.parametrize("signed", [False, True])
def test_context_preserves_large_native_tool_arguments_and_signature(tmp_path, recovery, signed) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    args = json.dumps({"path": "ephemeris.ts", "content": "const x = '界';\n" * 1600}, ensure_ascii=False)
    call = {"type": "function_call", "call_id": "large-write", "name": "write_file", "arguments": args}
    if signed:
        call["extra_content"] = {"google": {"thought_signature": "original-signature"}}
    items = [
        {"role": "user", "content": "Write the file"}, call,
        {"type": "function_call_output", "call_id": "large-write", "output": "written"},
    ]
    store.append_conversation_items("sess_large_arguments", items)
    prepared = AgentContextManager(store).prepare("sess_large_arguments", 1_000_000, recovery=recovery)
    sent_call = next(item for item in prepared.items if item.get("call_id") == "large-write"
                     and item.get("type") == "function_call")
    assert sent_call["arguments"] == args
    assert json.loads(sent_call["arguments"])["path"] == "ephemeris.ts"
    assert sent_call.get("extra_content") == call.get("extra_content")
    assert store.list_conversation_items("sess_large_arguments") == items
