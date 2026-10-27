from coloride_desktop.agents.gemini_native import (
    gemini_api_root,
    gemini_contents,
    gemini_function_declarations,
    gemini_generate_url,
    gemini_input_items,
    gemini_thinking_config,
)


def test_gemini_api_root_strips_openai_compat_suffix() -> None:
    assert (
        gemini_api_root("https://generativelanguage.googleapis.com/v1beta/openai")
        == "https://generativelanguage.googleapis.com/v1beta"
    )
    assert gemini_generate_url(
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "gemini-3.7-flash",
        stream=False,
    ).endswith("/models/gemini-3.7-flash:generateContent")


def test_gemini_thinking_config_branches_by_family() -> None:
    assert gemini_thinking_config("gemini-3.1-pro-preview", "high") == {
        "thinkingLevel": "HIGH",
        "includeThoughts": True,
    }
    assert gemini_thinking_config("gemini-2.5-pro", "medium") == {
        "thinkingBudget": 4096,
        "includeThoughts": True,
    }
    assert gemini_thinking_config("gemini-2.0-flash", "high") is None


def test_gemini_contents_merges_tool_turns_and_signatures() -> None:
    contents = gemini_contents(
        [
            {"role": "user", "content": "edit page"},
            {
                "type": "function_call",
                "call_id": "c1",
                "name": "read_file",
                "arguments": '{"path":"app/page.tsx"}',
                "thought_signature": "abc",
            },
            {"type": "function_call_output", "call_id": "c1", "output": "export default"},
        ]
    )
    assert contents[1]["parts"][0]["thoughtSignature"] == "abc"
    assert contents[2]["parts"][0]["functionResponse"]["name"] == "read_file"


def test_gemini_function_declarations_drop_openai_only_schema_keys() -> None:
    declarations = gemini_function_declarations(
        [
            {
                "type": "function",
                "name": "read_file",
                "description": "Read a file",
                "parameters": {
                    "$schema": "https://json-schema.org/draft/07/schema",
                    "strict": True,
                    "additionalProperties": False,
                    "type": "object",
                    "properties": {"path": {"type": "string", "default": "."}},
                },
            }
        ]
    )
    parameters = declarations[0]["parameters"]
    assert "$schema" not in parameters
    assert "strict" not in parameters
    assert "additionalProperties" not in parameters
    assert "default" not in parameters["properties"]["path"]


def test_native_history_preserves_managed_gateway_signatures() -> None:
    contents = gemini_contents([
        {"role": "user", "content": "Read"},
        {"type": "function_call", "call_id": "a", "name": "read_file", "arguments": "{}",
         "extra_content": {"google": {"thought_signature": "gateway-signature"}}},
        {"type": "function_call_output", "call_id": "a", "output": "done"},
    ])
    assert contents[1]["parts"][0]["thoughtSignature"] == "gateway-signature"


def test_imported_tool_steps_do_not_bypass_current_turn_or_change_real_signatures() -> None:
    history = [
        {"role": "user", "content": "old request"},
        {"type": "function_call", "name": "read_file", "call_id": "a", "arguments": "{}"},
        {"type": "function_call", "name": "list_files", "call_id": "b", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "a", "output": "a"},
        {"type": "function_call_output", "call_id": "b", "output": "b"},
        {"type": "function_call", "name": "read_file", "call_id": "c", "arguments": "{}",
         "thought_signature": "real-signature"},
        {"type": "function_call_output", "call_id": "c", "output": "c"},
        {"role": "user", "content": "continue"},
        {"type": "function_call", "name": "read_file", "call_id": "current", "arguments": "{}"},
    ]
    items = gemini_input_items(history, model="gemini-4-argon")
    assert items[1]["extra_content"]["google"]["thought_signature"] == "skip_thought_signature_validator"
    assert items[2] == history[2]  # unsigned parallel sibling remains unchanged
    assert items[5] == history[5]  # real signature remains unchanged
    assert items[-1] == history[-1]  # never bypass current-turn validation
    assert "extra_content" not in history[1]
    assert gemini_input_items(history, model="gemini-2.5-pro") == history
