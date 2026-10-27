from __future__ import annotations

import json

from coloride_desktop.agents.telemetry import AgentTelemetryStore


def test_agent_telemetry_is_private_and_contains_no_user_content(tmp_path) -> None:
    path = tmp_path / "agent-metrics.jsonl"
    store = AgentTelemetryStore(path)

    store.record("turn_started", session_id="sess_private")
    store.record("tool_call", session_id="sess_private", tool="read_file")
    store.record(
        "tool_result",
        session_id="sess_private",
        tool="read_file",
        failed=True,
    )
    store.record(
        "turn_completed",
        session_id="sess_private",
        duration_ms=120,
        input_tokens=40,
        output_tokens=10,
    )

    raw = path.read_text(encoding="utf-8")
    records = [json.loads(line) for line in raw.splitlines()]
    summary = store.summary()
    assert path.stat().st_mode & 0o777 == 0o600
    forbidden_fields = {"prompt", "output", "content", "command", "path"}
    assert all(forbidden_fields.isdisjoint(record) for record in records)
    assert summary["turns"] == 1
    assert summary["completedTurns"] == 1
    assert summary["toolFailures"] == 1
    assert summary["averageTurnMs"] == 120
    assert summary["topTools"] == [{"name": "read_file", "calls": 2}]


def test_turn_telemetry_records_budget_fields(tmp_path) -> None:
    path = tmp_path / "agent-metrics.jsonl"
    store = AgentTelemetryStore(path)
    store.record(
        "turn_telemetry",
        session_id="sess_turn",
        input_tokens=24_200,
        cached_input_tokens=17_100,
        output_tokens=1_800,
        extra={
            "turnIndex": 192,
            "credits": 27,
            "llmCalls": 2,
            "freshTokens": 7_100,
            "historySearches": 1,
            "filesInspected": 7,
            "toolCalls": 5,
        },
    )
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert records[-1]["event"] == "turn_telemetry"
    assert records[-1]["credits"] == 27
    assert records[-1]["llmCalls"] == 2
    assert records[-1]["freshTokens"] == 7_100
    assert records[-1]["historySearches"] == 1
    assert "prompt" not in records[-1]
