from __future__ import annotations

from coloride_desktop.agents.debug_log import (
    agent_debug,
    agent_debug_console,
    compact_log_value,
    configure_agent_debug_log,
    log_agent_emit,
    read_agent_debug,
    read_agent_debug_records,
)


def test_agent_debug_log_appends_and_tails(tmp_path) -> None:
    path = tmp_path / "agent-debug.log"
    configure_agent_debug_log(path, enabled=True)
    try:
        agent_debug("turn_started", sessionId="sess_1")
        agent_debug("tool_call", sessionId="sess_1", tool="read_file", path="/tmp/a.py")
        log_agent_emit("sess_1", "text_delta", {"text": "ignored"})
        log_agent_emit("sess_1", "tool_result", {"tool": "read_file", "failed": False})
        log_agent_emit(
            "sess_1",
            "loop_warning",
            {"sessionId": "sess_1", "message": "repeated tool", "kind": "repeated_tool"},
        )

        first = read_agent_debug(tail=50)
        assert first["total"] == 4
        messages = [entry["msg"] for entry in first["entries"]]
        assert messages == ["turn_started", "tool_call", "tool_result", "loop_warning"]
        assert all("ignored" not in str(entry) for entry in first["entries"])

        more = read_agent_debug(after=first["nextAfter"])
        assert more["entries"] == []
        assert more["nextAfter"] == first["nextAfter"]
    finally:
        configure_agent_debug_log(None)


def test_read_agent_debug_records_filters_other_chats(tmp_path) -> None:
    path = tmp_path / "agent-debug.log"
    configure_agent_debug_log(path, enabled=True)
    try:
        agent_debug("turn_started", sessionId="sess_a")
        agent_debug("turn_started", sessionId="sess_b")
        agent_debug("tool_call", sessionId="sess_a", tool="read_file")
        only_a = read_agent_debug_records("sess_a")
        assert [row["msg"] for row in only_a] == ["turn_started", "tool_call"]
        assert all(row["sessionId"] == "sess_a" for row in only_a)
    finally:
        configure_agent_debug_log(None)


def test_agent_debug_log_disabled_outside_dev(tmp_path) -> None:
    path = tmp_path / "agent-debug.log"
    configure_agent_debug_log(path, enabled=False)
    try:
        agent_debug("turn_started", sessionId="sess_prod")
        assert not path.exists()
        payload = read_agent_debug()
        assert payload["enabled"] is False
        assert payload["entries"] == []
    finally:
        configure_agent_debug_log(None)


def test_agent_debug_console_writes_to_stderr_in_dev(tmp_path, capsys) -> None:
    configure_agent_debug_log(tmp_path / "agent-debug.log", enabled=True)
    try:
        agent_debug_console(
            "provider_failure",
            provider="gemini",
            reason="Authorization: Bearer should-not-leak",
        )
        assert "[coloride][agent] provider_failure" in capsys.readouterr().err
    finally:
        configure_agent_debug_log(None)


def test_raw_event_records_keep_every_delta(tmp_path) -> None:
    from coloride_desktop.agents.domain import AgentMode, AgentSession
    from coloride_desktop.agents.store import AgentSessionStore

    store = AgentSessionStore(tmp_path / "sessions")
    session = AgentSession.create(
        agent="coloride",
        cwd=str(tmp_path),
        mode=AgentMode.ACT,
        access_level="full",
        filesystem_scope="workspace",
    )
    store.save_session(session)
    store.append_event(session.session_id, "user_message", {"text": "hola"})
    store.append_event(session.session_id, "text_delta", {"text": "He"})
    store.append_event(session.session_id, "text_delta", {"text": "llo"})
    raw = store.raw_event_records(session.session_id)
    types = [item.get("type") for item in raw]
    assert types.count("text_delta") == 2
    compacted = store.list_events(session.session_id)
    assert [event.type for event in compacted].count("text_delta") == 1


def test_compact_log_value_truncates_long_strings() -> None:
    long = "x" * 800
    compact = compact_log_value({"text": long, "ok": True})
    assert compact["ok"] is True
    assert isinstance(compact["text"], str)
    assert compact["text"].endswith("…")
    assert len(compact["text"]) < 420
