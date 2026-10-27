from __future__ import annotations

import json

from coloride_desktop.agents.domain import (
    AgentApproval,
    AgentMode,
    AgentSession,
    AgentSessionState,
    ApprovalState,
)
from coloride_desktop.agents.store import AgentSessionStore


def test_agent_store_persists_sessions_and_ordered_events(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session = AgentSession.create(
        agent="coloride",
        cwd="/srv/app",
        mode=AgentMode.ACT,
        access_level="full",
        filesystem_scope="server",
    )
    store.save_session(session)

    first = store.append_event(session.session_id, "user_message", {"text": "Inspect the repo"})
    second = store.append_event(session.session_id, "text_delta", {"text": "Reading"})

    restored = store.get_session(session.session_id)
    assert restored is not None
    assert restored.cwd == "/srv/app"
    assert restored.mode == AgentMode.ACT
    assert restored.access_level == "full"
    assert restored.filesystem_scope == "server"
    assert restored.preferred_linux_user is None
    assert [event.sequence for event in store.list_events(session.session_id)] == [1, 2]
    assert first.event_id != second.event_id
    assert (tmp_path / "sessions" / f"{session.session_id}.json").stat().st_mode & 0o777 == 0o600


def test_agent_store_compacts_progressive_file_write_snapshots(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    store.save_session(session)

    store.append_event(
        session.session_id,
        "file_write_delta",
        {"itemId": "call-1", "tool": "write_file", "path": "page.tsx", "content": "a"},
    )
    store.append_event(
        session.session_id,
        "file_write_delta",
        {"itemId": "call-1", "tool": "write_file", "path": "page.tsx", "content": "abc"},
    )

    active = store.list_events(session.session_id)
    assert [event.type for event in active] == ["file_write_delta"]
    assert active[0].data["content"] == "abc"

    store.append_event(
        session.session_id,
        "tool_call",
        {"itemId": "call-1", "tool": "write_file", "arguments": {"path": "page.tsx"}},
    )
    finalized = store.list_events(session.session_id)
    assert [event.type for event in finalized] == ["tool_call"]


def test_agent_store_persists_preferred_linux_user(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session = AgentSession.create(
        agent="coloride",
        cwd="/var/www/app",
        mode=AgentMode.ACT,
    )
    session.preferred_linux_user = "admin"
    session.reasoning_effort = "high"
    store.save_session(session)

    restored = store.get_session(session.session_id)
    assert restored is not None
    assert restored.preferred_linux_user == "admin"
    assert restored.reasoning_effort == "high"


def test_agent_store_migrates_legacy_autonomous_session_to_act(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    payload = session.to_dict()
    payload["mode"] = "autonomous"
    session_path = tmp_path / "sessions" / f"{session.session_id}.json"
    session_path.parent.mkdir(parents=True, exist_ok=True)
    session_path.write_text(json.dumps(payload), encoding="utf-8")

    restored = store.get_session(session.session_id)

    assert restored is not None
    assert restored.mode == AgentMode.ACT


def test_agent_store_forks_session_history(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session = AgentSession.create(
        agent="coloride",
        cwd="/srv/app",
        mode=AgentMode.PLAN,
        access_level="agent",
        task="Inspect auth",
    )
    store.save_session(session)
    store.append_event(session.session_id, "user_message", {"text": "Inspect auth"})
    store.append_event(session.session_id, "text_delta", {"text": "Looking"})
    store.append_conversation_items(
        session.session_id,
        [{"type": "message", "role": "user", "content": "Inspect auth"}],
    )

    fork = store.fork_session(session.session_id)

    assert fork.session_id != session.session_id
    assert fork.cwd == "/srv/app"
    assert fork.mode == AgentMode.PLAN
    assert fork.access_level == "agent"
    assert fork.task == "Inspect auth"
    assert fork.state == AgentSessionState.IDLE
    events = store.list_events(fork.session_id)
    assert [event.type for event in events] == ["user_message", "text_delta"]
    assert all(event.session_id == fork.session_id for event in events)
    assert store.list_conversation_items(fork.session_id)[0]["role"] == "user"


def test_agent_store_pages_history_by_complete_turns(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    store.save_session(session)

    for index in range(5):
        store.append_event(session.session_id, "user_message", {"text": f"Question {index}"})
        store.append_event(session.session_id, "text_delta", {"text": f"Answer {index}"})

    latest = store.list_events(session.session_id, turn_limit=2)
    assert [event.data.get("text") for event in latest if event.type == "user_message"] == [
        "Question 3",
        "Question 4",
    ]

    older = store.list_events(
        session.session_id,
        before_sequence=latest[0].sequence,
        turn_limit=2,
    )
    assert [event.data.get("text") for event in older if event.type == "user_message"] == [
        "Question 1",
        "Question 2",
    ]


def test_agent_store_recovers_interrupted_state_and_expires_approval(tmp_path) -> None:
    root = tmp_path / "sessions"
    store = AgentSessionStore(root)
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    session.state = AgentSessionState.WAITING_APPROVAL
    store.save_session(session)
    approval = AgentApproval.create(
        session_id=session.session_id,
        kind="command",
        title="Allow this command?",
        details={"command": "npm test"},
    )
    store.save_approval(approval)

    recovered = AgentSessionStore(root)
    restored_session = recovered.get_session(session.session_id)
    restored_approval = recovered.get_approval(approval.approval_id)

    assert restored_session is not None
    assert restored_session.state == AgentSessionState.IDLE
    assert restored_approval is not None
    assert restored_approval.state == ApprovalState.EXPIRED
    assert restored_approval.resolved_at is not None

    payload = json.loads((root / "approvals" / f"{approval.approval_id}.json").read_text())
    assert payload["state"] == "expired"
    assert any(
        event.type == "approval_resolved"
        and event.data == {"approvalId": approval.approval_id, "decision": "expired"}
        for event in recovered.list_events(session.session_id)
    )


def test_agent_store_persists_provider_neutral_conversation(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.PLAN)
    store.save_session(session)

    store.append_conversation_items(
        session.session_id,
        [
            {"role": "user", "content": "Inspect the project"},
            {
                "type": "function_call_output",
                "call_id": "call-1",
                "output": '{"ok":true}',
            },
        ],
    )

    assert store.list_conversation_items(session.session_id) == [
        {"role": "user", "content": "Inspect the project"},
        {
            "type": "function_call_output",
            "call_id": "call-1",
            "output": '{"ok":true}',
        },
    ]
    conversation = tmp_path / "sessions" / f"{session.session_id}.messages.jsonl"
    assert conversation.stat().st_mode & 0o777 == 0o600


def test_agent_store_closes_orphan_function_calls(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    store.save_session(session)
    store.append_conversation_items(
        session.session_id,
        [
            {"role": "user", "content": "run something"},
            {
                "type": "function_call",
                "call_id": "call-open",
                "name": "execute_command",
                "arguments": "{\"command\":\"ls\"}",
            },
            {
                "type": "function_call_output",
                "call_id": "call-open",
                "output": '{"ok":true,"output":"ok"}',
            },
            {
                "type": "function_call",
                "call_id": "call-orphan",
                "name": "browser_press",
                "arguments": "{\"browser_id\":\"br_1\",\"key\":\"End\"}",
            },
        ],
    )

    closed = store.close_orphan_function_calls(session.session_id, reason="Cancelled by user")
    assert closed == ["call-orphan"]

    items = store.list_conversation_items(session.session_id)
    outputs = [item for item in items if item.get("type") == "function_call_output"]
    assert any(item.get("call_id") == "call-orphan" for item in outputs)
    orphan_out = next(item for item in outputs if item.get("call_id") == "call-orphan")
    payload = json.loads(str(orphan_out["output"]))
    assert payload["ok"] is False
    assert payload["cancelled"] is True
    assert "Cancelled by user" in payload["error"]

    # Idempotent — no second synthetic output.
    assert store.close_orphan_function_calls(session.session_id) == []


def test_history_preserves_response_identity_and_text_replacement(tmp_path) -> None:
    from coloride_desktop.agents.store import _compact_history_events

    store = AgentSessionStore(tmp_path / "sessions")
    events = [
        store.append_event("test", "text_delta", {"text": "old", "activityId": "a"}),
        store.append_event("test", "text_delta", {"text": "new", "activityId": "b"}),
        store.append_event("test", "text_replace", {"text": "final", "activityId": "b"}),
    ]
    compacted = _compact_history_events(events)
    assert [event.type for event in compacted] == ["text_delta", "text_delta", "text_replace"]
    assert [event.data["text"] for event in compacted] == ["old", "new", "final"]


def test_history_details_searches_message_chunks_and_skips_internal_events(tmp_path):
    store = AgentSessionStore(tmp_path / "history")
    session = AgentSession.create(agent="coloride", cwd="/project", mode=AgentMode.ACT)
    store.save_session(session)
    store.append_event(session.session_id, "user_message", {"text": "hey"})
    store.append_event(session.session_id, "text_delta", {"text": "Check the Open"})
    store.append_event(session.session_id, "text_delta", {"text": "Sky provider."})
    store.append_event(session.session_id, "reasoning_delta", {"text": "private reasoning"})
    store.append_event(session.session_id, "tool_result", {"text": "private tool output"})
    store.append_event(session.session_id, "user_message", {"text": "hidden instruction", "hidden": True})
    detail = store.history_details(session.session_id, "opensky")
    assert detail["firstMessage"] == "hey"
    assert detail["preview"] == "Check the OpenSky provider."
    assert detail["matches"] is True
    assert "OpenSky" in detail["snippet"]
    assert store.history_details(session.session_id, "private")["matches"] is False
    assert store.history_details(session.session_id, "hidden instruction")["matches"] is False
    store.append_event(session.session_id, "user_message", {"text": "New request"})
    assert store.history_details(session.session_id)["preview"] == "New request"


def test_history_details_includes_early_messages_in_long_logs(tmp_path):
    store = AgentSessionStore(tmp_path / "history")
    session = AgentSession.create(agent="coloride", cwd="/project", mode=AgentMode.ACT)
    store.save_session(session)
    store.append_event(session.session_id, "user_message", {"text": "Find the original requirement"})
    path = store._events_path(session.session_id)
    with path.open("a") as output:
        output.write('{"type":"tool_result","data":{"text":"not conversation"}}\n' * 20_001)
        output.write('broken json\n')
    assert store.history_details(session.session_id, "original requirement")["matches"] is True
