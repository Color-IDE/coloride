from coloride_desktop.agents.engine import _exclude_superseded_tool_history


def test_superseded_tool_outputs_leave_active_prompt_but_not_other_history() -> None:
    history = [
        {"role": "user", "content": "fix it"},
        {"type": "function_call", "call_id": "old", "name": "read_file"},
        {"type": "function_call_output", "call_id": "old", "output": "same"},
        {"type": "function_call", "call_id": "keep", "name": "read_file"},
        {"type": "function_call_output", "call_id": "keep", "output": "new"},
    ]
    filtered = _exclude_superseded_tool_history(history, ["old"])
    assert history[1]["call_id"] == "old"
    assert all(item.get("call_id") != "old" for item in filtered)
    assert any(item.get("call_id") == "keep" for item in filtered)
