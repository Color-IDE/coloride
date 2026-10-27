"""Exercise real local tools and the turn runtime with deterministic model decisions.

These validate the paid evaluator and host workflow; they do not score a real
model. The manual runner separately performs live multi-model evaluations.
"""

from __future__ import annotations

import importlib.util
import json
import shlex
import sys
from pathlib import Path

import pytest

from coloride_desktop.agents.config import AgentProviderSettings
from coloride_desktop.agents.provider import ModelResponse, ModelToolCall, ModelUsage, ProviderCapabilities

_SPEC = importlib.util.spec_from_file_location(
    "agent_quality", Path(__file__).parents[1] / "manual" / "agent_quality.py"
)
quality = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(quality)

SOURCE = "def add(a,b):\n    return a+b\ndef clamp(value,low,high):\n    return max(low,min(high,value))\n"


class ScriptedProvider:
    def __init__(self, settings, steps):
        self.settings = settings
        self.model = settings.model
        self.capabilities = ProviderCapabilities(
            tools=True,
            streaming=False,
            encrypted_reasoning=False,
            max_context_characters=128_000,
            max_context_tokens=32_000,
        )
        self.steps = iter(steps)
        self.count = 0

    async def complete(self, **kwargs):
        self.count += 1
        name, arguments = next(self.steps)
        call_id = f"quality-{self.count}"
        return ModelResponse(
            response_id=f"response-{self.count}",
            text="",
            tool_calls=(ModelToolCall(call_id, name, arguments),),
            output_items=(
                {
                    "type": "function_call",
                    "call_id": call_id,
                    "name": name,
                    "arguments": json.dumps(arguments),
                },
            ),
            usage=ModelUsage(),
            finish_reason="tool_calls",
        )


def finish(check_id):
    return (
        "complete_task",
        {
            "outcome": "completed",
            "summary": "Changes checked",
            "requirements": ["goal"],
            "verification_ids": [check_id],
            "reason": "",
        },
    )


@pytest.mark.parametrize(
    "case", ["repair", "failed_check_recovery", "multiple_files", "follow_up", "shell_edit"]
)
async def test_real_local_workflows_and_independent_oracle(tmp_path, monkeypatch, case):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("COLORIDE_AGENT_FAST_RETRY", "1")
    check = ("execute_command", {"command": f"{shlex.quote(sys.executable)} -m unittest discover -v"})
    steps = []
    if case == "failed_check_recovery":
        steps.append(check)
    if case == "shell_edit":
        script = f"from pathlib import Path; Path('calculator.py').write_text({SOURCE!r})"
        steps.append(
            ("execute_command", {"command": f"{shlex.quote(sys.executable)} -c {shlex.quote(script)}"})
        )
    else:
        steps.append(("write_file", {"path": "calculator.py", "content": SOURCE}))
    if case == "multiple_files":
        steps.extend(
            [
                (
                    "write_file",
                    {"path": "cli.py", "content": "from calculator import add\nprint(add(2,3))\n"},
                ),
                ("write_file", {"path": "test_contract.py", "content": quality.TESTS}),
            ]
        )
    steps.append(check)
    steps.append(finish(f"quality-{len(steps)}"))
    if case == "follow_up":
        steps.extend(
            [
                ("read_file", {"path": "calculator.py"}),
                (
                    "write_file",
                    {"path": "calculator.py", "content": SOURCE + "def multiply(a,b):\n    return a*b\n"},
                ),
                (
                    "write_file",
                    {
                        "path": "test_multiply.py",
                        "content": "import unittest\nfrom calculator import multiply\n"
                        "class Tests(unittest.TestCase):\n    def test_multiply(self):\n"
                        "        self.assertEqual(multiply(2,3),6)\n",
                    },
                ),
                check,
            ]
        )
        steps.append(finish(f"quality-{len(steps)}"))
    monkeypatch.setitem(quality.ADAPTERS, "xai", lambda settings: ScriptedProvider(settings, steps))
    settings = AgentProviderSettings("xai", "grok-4.7", "https://unused.test", "test-secret", "test")
    result = await quality.run_case(settings, case, tmp_path / "evaluation", timeout=20)
    assert result["status"] == "passed", result
