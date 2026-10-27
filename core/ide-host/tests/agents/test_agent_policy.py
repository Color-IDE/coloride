from __future__ import annotations

from coloride_desktop.agents.domain import AgentMode
from coloride_desktop.agents.policy import (
    AGENT_TOOLS,
    PolicyEngine,
    PolicyOutcome,
    ScopedGrant,
    policy_for,
    scoped_grant_for,
)
from coloride_desktop.agents.provider import ModelToolCall
from coloride_desktop.agents.tools import TOOL_DEFINITIONS


def test_ask_mode_is_conversation_only() -> None:
    policy = policy_for(AgentMode.ASK)
    assert policy.sandbox == "read-only"
    assert policy.collaboration_mode == "ask"
    assert policy.automatic_decision == "decline"


def test_ask_mode_system_prompt_is_read_analyze_only() -> None:
    from coloride_desktop.agents.domain import AgentSession
    from coloride_desktop.agents.engine import _system_prompt

    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ASK)
    prompt = _system_prompt(session)
    assert "Ask mode" in prompt
    assert "read-only" in prompt.lower() or "read, analyze" in prompt.lower()
    assert "Do NOT create" in prompt
    assert "list_files" in prompt or "read_file" in prompt
    assert "No tools at all" not in prompt
    # Must not inherit Act-style “create/edit files” operating rules.
    assert "write_file only to create" not in prompt
    assert "Inspect relevant files before editing" not in prompt


def test_local_workspace_prompt_does_not_require_tmux() -> None:
    from coloride_desktop.agents.domain import AgentSession
    from coloride_desktop.agents.engine import _system_prompt

    session = AgentSession.create(
        agent="coloride",
        cwd="/Users/me/app",
        mode=AgentMode.ACT,
        workspace_kind="local",
    )
    prompt = _system_prompt(session)
    assert "local folder" in prompt
    assert "does not need tmux" in prompt
    assert "native background process" in prompt
    assert "remote VPS" not in prompt


def test_vps_workspace_prompt_works_in_the_selected_folder() -> None:
    from coloride_desktop.agents.domain import AgentSession
    from coloride_desktop.agents.engine import _system_prompt

    session = AgentSession.create(
        agent="coloride",
        cwd="/var/www/coloride/sites/www",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        filesystem_scope="workspace",
    )
    prompt = _system_prompt(session)
    assert "selected workspace root" in prompt
    assert "Never cd into or write /var/www" not in prompt
    assert "Coloride workspace copy" not in prompt
    assert "server-wide access" not in prompt


def test_vps_server_prompt_allows_permitted_server_areas() -> None:
    from coloride_desktop.agents.domain import AgentSession
    from coloride_desktop.agents.engine import _system_prompt

    session = AgentSession.create(
        agent="coloride",
        cwd="/home/coloride",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        filesystem_scope="server",
    )
    prompt = _system_prompt(session)
    assert "Starting directory" in prompt
    assert "move anywhere the Linux user can" in prompt
    assert "Never cd into or write /var/www" not in prompt
    assert "hard boundary" not in prompt
    assert "Work only inside the selected Coloride workspace" not in prompt
    assert "answer YES first" in prompt
    assert "Never say you cannot leave the current folder" in prompt
    assert "pm2" in prompt
    assert "deploy_application" not in prompt
    assert "Do not talk about workspace copies" in prompt
    assert "exact Linux user selected when this SSH connection was created" in prompt
    assert "never try to switch users" in prompt


def test_plan_mode_is_read_only_and_declines_write_requests() -> None:
    policy = policy_for(AgentMode.PLAN)
    assert policy.sandbox == "read-only"
    assert policy.collaboration_mode == "plan"
    assert policy.automatic_decision == "decline"


def test_debug_mode_allows_shell_with_approval() -> None:
    policy = policy_for(AgentMode.DEBUG)
    assert policy.sandbox == "workspace-write"
    assert policy.approval_policy == "on-request"
    assert policy.collaboration_mode == "debug"
    assert policy.automatic_decision is None


def test_act_mode_requires_human_approval_for_commands() -> None:
    policy = policy_for(AgentMode.ACT)
    assert policy.sandbox == "workspace-write"
    assert policy.approval_policy == "on-request"
    assert policy.automatic_decision is None


def test_ask_mode_exposes_read_tools_but_not_mutating_tools() -> None:
    tools = {str(tool["id"]): tool for tool in AGENT_TOOLS}

    for tool_id in (
        "list_files",
        "read_file",
        "search_files",
        "git_status",
        "git_diff",
        "get_diagnostics",
        "fetch_url",
    ):
        assert AgentMode.ASK.value in tools[tool_id]["modes"]
    for tool_id in (
        "write_file",
        "replace_in_file",
        "create_directory",
        "execute_command",
        "start_process",
        "submit_plan",
    ):
        assert AgentMode.ASK.value not in tools[tool_id]["modes"]


def test_plan_mode_exposes_read_tools_but_not_mutating_tools() -> None:
    tools = {str(tool["id"]): tool for tool in AGENT_TOOLS}

    for tool_id in (
        "list_files",
        "read_file",
        "search_files",
        "git_status",
        "git_diff",
        "submit_plan",
    ):
        assert AgentMode.PLAN.value in tools[tool_id]["modes"]
    for tool_id in ("write_file", "replace_in_file", "execute_command"):
        assert AgentMode.PLAN.value not in tools[tool_id]["modes"]
    # Progress markers are allowed while following a read-only plan in the same turn.
    assert AgentMode.PLAN.value in tools["update_plan_step"]["modes"]


def test_act_mode_exposes_update_plan_step_not_submit_plan() -> None:
    tools = {str(tool["id"]): tool for tool in AGENT_TOOLS}
    assert AgentMode.ACT.value in tools["update_plan_step"]["modes"]
    assert AgentMode.PLAN.value in tools["update_plan_step"]["modes"]
    assert AgentMode.ACT.value not in tools["submit_plan"]["modes"]


def test_debug_mode_exposes_shell_but_not_file_mutations() -> None:
    tools = {str(tool["id"]): tool for tool in AGENT_TOOLS}

    for tool_id in ("list_files", "read_file", "execute_command", "start_process", "get_diagnostics"):
        assert AgentMode.DEBUG.value in tools[tool_id]["modes"]
    for tool_id in (
        "write_file",
        "replace_in_file",
        "create_directory",
        "rename_path",
        "move_path",
        "delete_path",
    ):
        assert AgentMode.DEBUG.value not in tools[tool_id]["modes"]


def _definition(name: str):
    return next(item for item in TOOL_DEFINITIONS if item.name == name)


def test_npm_test_grant_does_not_authorize_install_or_another_cwd() -> None:
    from coloride_desktop.agents.domain import AgentSession

    session = AgentSession.create(
        agent="coloride",
        cwd="/srv/app",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        access_level="agent",
    )
    test_call = ModelToolCall(
        call_id="test",
        name="execute_command",
        arguments={"command": "npm test", "cwd": "/srv/app"},
    )
    grant = scoped_grant_for(test_call, session, _definition("execute_command"))
    engine = PolicyEngine()
    assert engine.evaluate(
        test_call, session, _definition("execute_command"), grants=[grant]
    ).outcome == PolicyOutcome.ALLOW

    install_call = ModelToolCall(
        call_id="install",
        name="execute_command",
        arguments={"command": "npm install", "cwd": "/srv/app"},
    )
    other_cwd = ModelToolCall(
        call_id="other",
        name="execute_command",
        arguments={"command": "npm test", "cwd": "/srv/other"},
    )
    assert engine.evaluate(
        install_call, session, _definition("execute_command"), grants=[grant]
    ).outcome == PolicyOutcome.ASK
    assert engine.evaluate(
        other_cwd, session, _definition("execute_command"), grants=[grant]
    ).outcome == PolicyOutcome.ASK


def test_all_commands_session_grant_accepts_any_command_but_not_file_tools() -> None:
    from coloride_desktop.agents.domain import AgentSession

    session = AgentSession.create(
        agent="coloride",
        cwd="/srv/app",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        access_level="request",
    )
    seed = ModelToolCall(
        call_id="seed",
        name="execute_command",
        arguments={"command": "npm test", "cwd": "/srv/app"},
    )
    grant = scoped_grant_for(
        seed,
        session,
        _definition("execute_command"),
    ).for_all_commands_session()
    restored = ScopedGrant.from_dict(grant.to_dict())
    assert restored is not None

    commands = [
        ModelToolCall(
            call_id="install",
            name="execute_command",
            arguments={"command": "npm install", "cwd": "/srv/other"},
        ),
        ModelToolCall(
            call_id="network",
            name="execute_command",
            arguments={"command": "curl https://example.test", "cwd": "/tmp"},
        ),
    ]
    engine = PolicyEngine()
    for call in commands:
        assert engine.evaluate(
            call,
            session,
            _definition("execute_command"),
            grants=[restored],
        ).outcome == PolicyOutcome.ALLOW

    write = ModelToolCall(
        call_id="write",
        name="write_file",
        arguments={"path": "/srv/app/example.ts", "content": "export {};"},
    )
    assert engine.evaluate(
        write,
        session,
        _definition("write_file"),
        grants=[restored],
    ).outcome == PolicyOutcome.ASK


def test_scoped_grant_normalizes_relative_and_absolute_workspace_cwd() -> None:
    from coloride_desktop.agents.domain import AgentSession

    session = AgentSession.create(
        agent="coloride",
        cwd="/srv/app",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        access_level="agent",
    )
    relative = ModelToolCall(
        call_id="relative",
        name="execute_command",
        arguments={"command": "npm test", "cwd": "."},
    )
    absolute = ModelToolCall(
        call_id="absolute",
        name="execute_command",
        arguments={"command": "npm test", "cwd": "/srv/app"},
    )
    relative_grant = scoped_grant_for(relative, session, _definition("execute_command"))
    absolute_grant = scoped_grant_for(absolute, session, _definition("execute_command"))
    assert relative_grant.cwd == "/srv/app"
    assert relative_grant.matches(absolute_grant)


def test_full_access_never_bypasses_network_policy() -> None:
    from coloride_desktop.agents.domain import AgentSession

    session = AgentSession.create(
        agent="coloride",
        cwd="/srv/app",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        access_level="full",
    )
    call = ModelToolCall(
        call_id="curl",
        name="execute_command",
        arguments={"command": "curl https://example.test", "cwd": "/srv/app"},
    )
    decision = PolicyEngine().evaluate(call, session, _definition("execute_command"))
    assert decision.outcome == PolicyOutcome.ASK
    assert decision.network_scope == "any"
