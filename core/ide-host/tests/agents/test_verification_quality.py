"""Checks that apparently successful commands cannot certify untested edits."""

from __future__ import annotations

import sys

import pytest

from coloride_desktop.agents.completion import complete, record_result, verification_command
from coloride_desktop.agents.provider import ModelToolCall
from coloride_desktop.agents.task import AgentTask


@pytest.mark.parametrize(
    "command",
    [
        "python -m pytest --help",
        "python3 -m unittest --help",
        "pytest --collect-only",
        "python -m pytest --co",
        "npm test -- --help",
        "pnpm test --version",
        "cargo test --help",
        "go test -list .",
        "ruff check --help",
        "npx vitest list",
        "corepack pnpm exec vitest --version",
    ],
)
def test_discovery_and_help_are_not_verification(command):
    assert verification_command(command) is False


@pytest.mark.parametrize(
    "command",
    [
        f"{sys.executable} -m unittest discover -v",
        "python3.12 -m pytest tests -q",
        "PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -v",
        "env CI=1 python3 -B -m pytest tests -q",
        "corepack pnpm exec tsc --noEmit",
        "pnpm exec vitest run",
        "npm exec -- vitest run",
    ],
)
def test_actual_checks_use_the_selected_interpreter_and_package_runner(command):
    assert verification_command(command) is True


def test_help_exit_zero_cannot_complete_an_edit():
    task = AgentTask.create(conversation_id="quality", workspace_id="/workspace")
    task.goal = "Fix calculator"
    task.remember_path("calculator.py", changed=True)
    for call in [
        ModelToolCall("edit", "write_file", {"path": "calculator.py", "content": "pass"}),
        ModelToolCall("help", "execute_command", {"command": "python -m pytest --help"}),
    ]:
        record_result(task, call, failed=False, metadata={"exitCode": 0}, cwd="/workspace")
    with pytest.raises(ValueError, match="verification"):
        complete(
            task,
            {
                "outcome": "completed",
                "summary": "Fixed",
                "requirements": ["goal"],
                "verification_ids": ["help"],
                "reason": "",
            },
            "/workspace",
        )


def test_rejected_completion_gives_current_check_ids_without_accepting_stale_evidence():
    task = AgentTask.create(conversation_id="follow-up", workspace_id="/workspace")
    task.remember_path("calculator.py", changed=True)
    for call in [
        ModelToolCall("old-edit", "write_file", {"path": "calculator.py"}),
        ModelToolCall("old-check", "execute_command", {"command": "python -m unittest"}),
        ModelToolCall("new-edit", "write_file", {"path": "calculator.py"}),
        ModelToolCall("current-check", "execute_command", {"command": "python -m unittest"}),
    ]:
        record_result(task, call, failed=False, metadata={"exitCode": 0}, cwd="/workspace")
    arguments = {
        "outcome": "completed",
        "summary": "Checked",
        "requirements": ["goal"],
        "verification_ids": ["old-check"],
        "reason": "",
    }
    with pytest.raises(ValueError) as caught:
        complete(task, arguments, "/workspace")
    assert "Current successful verification tool IDs: ['current-check']" in str(caught.value)
    assert "old-check" not in str(caught.value)
    assert task.completion["accepted"] is False
    arguments["verification_ids"] = ["current-check"]
    assert complete(task, arguments, "/workspace")["outcome"] == "completed"


def test_shell_only_edits_cannot_bypass_post_change_verification():
    task = AgentTask.create(conversation_id="shell-edit", workspace_id="/workspace")
    call = ModelToolCall("shell-write", "execute_command", {"command": "printf code > calculator.py"})
    record_result(task, call, failed=False, metadata={"exitCode": 0}, cwd="/workspace")
    assert task.verification_required is True
    with pytest.raises(ValueError, match="verification"):
        complete(
            task,
            {
                "outcome": "completed",
                "summary": "Created file",
                "requirements": ["goal"],
                "verification_ids": [],
                "reason": "",
            },
            "/workspace",
        )


@pytest.mark.parametrize(
    "command",
    [
        "rg add .",
        "grep -n add calculator.py",
        "find . -name '*.py'",
        "echo hello",
        "npm --version",
        "python3.12 --version",
    ],
)
def test_shell_inspection_does_not_require_code_tests(command):
    task = AgentTask.create(conversation_id="inspect", workspace_id="/workspace")
    record_result(
        task,
        ModelToolCall("read", "execute_command", {"command": command}),
        failed=False,
        metadata={"exitCode": 0},
        cwd="/workspace",
    )
    assert task.verification_required is False


@pytest.mark.parametrize("command", ["find . -delete", "find . -exec touch x +", "rg --pre=touch pattern ."])
def test_search_with_side_effects_is_not_read_only(command):
    task = AgentTask.create(conversation_id="mutate", workspace_id="/workspace")
    record_result(
        task,
        ModelToolCall("mutate", "execute_command", {"command": command}),
        failed=False,
        metadata={"exitCode": 0},
        cwd="/workspace",
    )
    assert task.verification_required is True


def test_excessive_runner_wrappers_are_rejected_without_recursion_error():
    assert verification_command("env " * 1200 + "python -m unittest") is False
