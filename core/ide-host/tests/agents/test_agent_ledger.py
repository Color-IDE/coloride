from __future__ import annotations

from coloride_desktop.agents.gateway import ModelGateway
from coloride_desktop.agents.ledger import UsageLedger


def test_usage_ledger_appends_task_rows(tmp_path) -> None:
    ledger = UsageLedger(tmp_path / "agent-usage.jsonl")
    first = ledger.record(
        task_id="task_1",
        conversation_id="sess_1",
        model="grok-4.6",
        input_tokens=1200,
        cached_input_tokens=800,
        output_tokens=40,
    )
    second = ledger.record(
        task_id="task_1",
        conversation_id="sess_1",
        model="grok-4.6",
        input_tokens=300,
        cached_input_tokens=200,
        output_tokens=20,
    )
    rows = ledger.list_rows()
    assert len(rows) == 2
    assert first["request_id"] != second["request_id"]
    assert rows[0]["task_id"] == "task_1"
    assert rows[0]["cached_input_tokens"] == 800
    assert rows[1]["input_tokens"] == 300
    assert rows[0]["coloride_credits"] is None


def test_model_gateway_cache_key_is_stable() -> None:
    assert ModelGateway.cache_key("sess_abc") == "coloride:sess_abc"
    assert ModelGateway.cache_key("") == ""
