"""Real PTY integration: agent tools share native IDE terminal identities/output."""

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from coloride_desktop.agents.domain import AgentMode, AgentSession
from coloride_desktop.agents.provider import ModelToolCall
from coloride_desktop.agents.terminals import AgentTerminalService
from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig


@pytest.fixture
def terminal_app(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("SHELL", "/bin/bash")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    app = create_app(LaunchConfig(host="127.0.0.1", port=0, bearer_token="test-token"))
    with TestClient(app) as client:
        try:
            yield app, client
        finally:
            for terminal in app.state.terminals.list():
                client.post(
                    f"/api/term/{terminal.term_id}/close", headers={"Authorization": "Bearer test-token"}
                )


def session(path):
    return AgentSession.create(
        agent="coloride", cwd=str(path), mode=AgentMode.ACT, workspace_kind="local", access_level="full"
    )


def invoke(app, client, name, arguments, agent):
    return client.portal.call(app.state.agents._tools.terminals.execute, name, arguments, agent)


def test_create_run_read_shares_native_terminal_and_preserves_output(terminal_app, tmp_path):
    app, client = terminal_app
    agent = session(tmp_path)
    created = invoke(app, client, "create_terminal", {"cwd": str(tmp_path), "title": "Checks"}, agent)
    terminal_id = created["termId"]
    headers = {"Authorization": "Bearer test-token"}
    assert created["agentSessionId"] == agent.session_id
    listed = client.get("/api/term", headers=headers).json()
    assert listed[0]["title"] == "Checks"
    # Native tab attaches to exactly the terminal the agent created.
    attached = client.post(
        "/api/term/create",
        headers=headers,
        json={
            "cols": 80,
            "rows": 24,
            "cwd": str(tmp_path),
            "workspaceKind": "local",
            "connectionId": "local",
            "sessionId": created["sessionId"],
        },
    ).json()
    assert attached["termId"] == terminal_id
    assert len(app.state.terminals.list()) == 1
    client.portal.call(asyncio.sleep, 0.3)
    sent = invoke(
        app,
        client,
        "run_terminal_command",
        {"terminal_id": terminal_id, "command": "printf 'VISIBLE_%s\\n' AGENT"},
        agent,
    )
    assert sent["status"] == "submitted"
    assert "exitCode" not in sent

    async def wait_output():
        async with asyncio.timeout(5):
            while b"VISIBLE_AGENT" not in app.state.terminals.get(terminal_id).local_output:
                await asyncio.sleep(0.02)

    client.portal.call(wait_output)
    read = invoke(app, client, "read_terminal", {"terminal_id": terminal_id, "lines": 100}, agent)
    assert "VISIBLE_AGENT" in read["output"]
    assert "\x1b" not in read["output"]
    before = bytes(app.state.terminals.get(terminal_id).local_output)
    invoke(app, client, "read_terminal", {"terminal_id": terminal_id, "lines": 1}, agent)
    assert bytes(app.state.terminals.get(terminal_id).local_output) == before
    assert invoke(app, client, "list_terminals", {}, agent)["terminals"][0]["termId"] == terminal_id


def test_scope_user_terminal_read_only_and_busy_protection(terminal_app, tmp_path):
    app, client = terminal_app
    agent = session(tmp_path)
    created = invoke(app, client, "create_terminal", {"cwd": str(tmp_path)}, agent)
    tid = created["termId"]
    another = session(tmp_path)
    assert invoke(app, client, "read_terminal", {"terminal_id": tid}, another)["termId"] == tid
    with pytest.raises(PermissionError, match="user terminals are read-only"):
        invoke(app, client, "run_terminal_command", {"terminal_id": tid, "command": "echo NO"}, another)
    outside = tmp_path / "other"
    outside.mkdir()
    with pytest.raises(PermissionError, match="selected workspace"):
        invoke(app, client, "read_terminal", {"terminal_id": tid}, session(outside))
    client.portal.call(asyncio.sleep, 0.3)
    invoke(app, client, "run_terminal_command", {"terminal_id": tid, "command": "sleep 30"}, agent)
    client.portal.call(asyncio.sleep, 0.2)
    with pytest.raises(ValueError, match="busy"):
        invoke(app, client, "run_terminal_command", {"terminal_id": tid, "command": "echo BAD"}, agent)


def test_terminal_tools_registered_with_permissions_and_dynamic_selection(terminal_app, tmp_path):
    app, _ = terminal_app
    tools = app.state.agents._tools
    names = {s["name"] for s in tools.schemas_for(AgentMode.ACT, session(tmp_path), intent="show progress in the terminal")}
    assert {"list_terminals", "read_terminal", "create_terminal", "run_terminal_command"} <= names
    read_names = {s["name"] for s in tools.schemas_for(AgentMode.ASK, session(tmp_path))}
    assert {"list_terminals", "read_terminal"} <= read_names
    assert not {"create_terminal", "run_terminal_command"} & read_names


def test_dev_server_stays_in_chat_unless_visible_terminal_is_explicit(terminal_app, tmp_path):
    app, _ = terminal_app
    tools = app.state.agents._tools
    agent = session(tmp_path)

    chat_names = {
        schema["name"]
        for schema in tools.schemas_for(
            AgentMode.ACT,
            agent,
            intent="crea un npm run dev",
        )
    }
    assert {"start_process", "read_process", "stop_process"} <= chat_names
    assert not {"create_terminal", "run_terminal_command"} & chat_names
    assert "execute_command" not in chat_names

    visible_names = {
        schema["name"]
        for schema in tools.schemas_for(
            AgentMode.ACT,
            agent,
            intent="abre una terminal visible y ejecuta npm run dev",
        )
    }
    assert {"create_terminal", "run_terminal_command", "read_terminal"} <= visible_names
    assert "start_process" not in visible_names

    background_names = {
        schema["name"]
        for schema in tools.schemas_for(
            AgentMode.ACT,
            agent,
            intent="arranca npm run dev en segundo plano",
        )
    }
    assert {"start_process", "read_process", "stop_process"} <= background_names
    assert "execute_command" not in background_names

    existing_process_names = {
        schema["name"]
        for schema in tools.schemas_for(
            AgentMode.ACT,
            agent,
            intent="lee el proceso proc_abc123",
        )
    }
    assert {"read_process", "stop_process"} <= existing_process_names


def test_tool_dispatch_and_approval_are_side_effect_free_until_execution(terminal_app, tmp_path):
    app, client = terminal_app
    agent = session(tmp_path)
    tools = app.state.agents._tools
    app.state.files.authorize_local_session(agent.session_id, agent.cwd)

    async def exercise():
        with app.state.files.session_scope(agent.session_id):
            call = ModelToolCall("create-visible", "create_terminal", {"cwd": ".", "title": "Review"})
            details = await tools.approval_details(call, agent)
            assert details["risk"] == "execute"
            assert not app.state.terminals.list()
            result = await tools.execute(call, agent)
            assert result.metadata["title"] == "Review"
            listed = await tools.execute(ModelToolCall("list", "list_terminals", {}), agent)
            assert len(listed.metadata["terminals"]) == 1
            with pytest.raises(PermissionError):
                await tools.execute(
                    ModelToolCall("escape", "create_terminal", {"cwd": str(tmp_path.parent), "title": "No"}),
                    agent,
                )

    client.portal.call(exercise)


def test_start_process_uses_hidden_native_terminal_until_user_opens_it(terminal_app, tmp_path):
    app, client = terminal_app
    agent = session(tmp_path)
    tools = app.state.agents._tools
    app.state.files.authorize_local_session(agent.session_id, agent.cwd)

    async def exercise():
        with app.state.files.session_scope(agent.session_id):
            started = await tools.execute(
                ModelToolCall(
                    "start-server",
                    "start_process",
                    {"command": "printf 'CHAT_PROCESS_READY\\n'; sleep 30", "cwd": "."},
                ),
                agent,
            )
            process_id = str(started.metadata["id"])
            terminal = started.metadata["terminal"]
            assert terminal["revealed"] is False
            assert app.state.terminals.get(terminal["termId"]).agent_revealed is False

            async with asyncio.timeout(5):
                while b"CHAT_PROCESS_READY" not in app.state.terminals.get(terminal["termId"]).local_output:
                    await asyncio.sleep(0.02)

            read = await tools.execute(
                ModelToolCall("read-server", "read_process", {"process_id": process_id, "lines": 100}),
                agent,
            )
            assert "CHAT_PROCESS_READY" in read.output
            assert read.metadata["alive"] is True
            assert read.metadata["terminal"]["termId"] == terminal["termId"]

            stopped = await tools.execute(
                ModelToolCall("stop-server", "stop_process", {"process_id": process_id}),
                agent,
            )
            assert stopped.metadata["terminal"]["termId"] == terminal["termId"]

    client.portal.call(exercise)


def test_submitted_terminal_command_cannot_verify_an_edit():
    from coloride_desktop.agents.completion import complete, record_result
    from coloride_desktop.agents.task import AgentTask

    task = AgentTask.create(conversation_id="terminal", workspace_id="/workspace")
    task.remember_path("app.py", changed=True)
    record_result(
        task,
        ModelToolCall("edit", "write_file", {"path": "app.py"}),
        failed=False,
        metadata={},
        cwd="/workspace",
    )
    record_result(
        task,
        ModelToolCall(
            "submitted", "run_terminal_command", {"terminal_id": "term_test", "command": "pytest -q"}
        ),
        failed=False,
        metadata={"status": "submitted"},
        cwd="/workspace",
    )
    with pytest.raises(ValueError, match="verification"):
        complete(
            task,
            {
                "outcome": "completed",
                "summary": "Done",
                "requirements": ["goal"],
                "verification_ids": ["submitted"],
                "reason": "",
            },
            "/workspace",
        )


def test_visible_dev_server_launch_can_complete_without_code_verification():
    from coloride_desktop.agents.completion import complete, record_result
    from coloride_desktop.agents.task import AgentTask

    task = AgentTask.create(conversation_id="terminal-server", workspace_id="/workspace")
    record_result(
        task,
        ModelToolCall(
            "server",
            "run_terminal_command",
            {"terminal_id": "term_test", "command": "npm run dev"},
        ),
        failed=False,
        metadata={"status": "submitted"},
        cwd="/workspace",
    )

    assert task.verification_required is False
    result = complete(
        task,
        {
            "outcome": "completed",
            "summary": "Development server is visible in the IDE terminal.",
            "requirements": ["goal"],
            "verification_ids": [],
            "reason": "",
        },
        "/workspace",
    )
    assert result["outcome"] == "completed"


def test_chat_dev_server_launch_can_complete_without_code_verification():
    from coloride_desktop.agents.completion import complete, record_result
    from coloride_desktop.agents.task import AgentTask

    task = AgentTask.create(conversation_id="chat-server", workspace_id="/workspace")
    record_result(
        task,
        ModelToolCall("server", "start_process", {"command": "npm run dev", "cwd": "."}),
        failed=False,
        metadata={"alive": True},
        cwd="/workspace",
    )
    assert task.verification_required is False
    result = complete(
        task,
        {
            "outcome": "completed",
            "summary": "Development server is running and remains available from chat.",
            "requirements": ["goal"],
            "verification_ids": [],
            "reason": "",
        },
        "/workspace",
    )
    assert result["outcome"] == "completed"


@pytest.mark.asyncio
async def test_remote_terminal_uses_selected_connection_and_cleans_captured_output():
    agent = AgentSession.create(
        agent="coloride",
        cwd="/srv/project",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        connection_id="server-1",
        access_level="full",
    )
    terminal = SimpleNamespace(
        term_id="term_remote",
        session_id="session_remote",
        local=False,
        connection_id="server-1",
        cwd="/srv/project",
        agent_owner=agent.session_id,
        agent_workspace=agent.cwd,
        agent_title="Remote checks",
        exited=False,
        suspended=False,
        shell="zsh",
        tmux_session="coloride_remote",
        process=None,
    )

    class Registry:
        def list(self):
            return [terminal]

        def get(self, terminal_id):
            return terminal if terminal_id == terminal.term_id else None

    calls = []

    async def remote(action, selected, value):
        calls.append((action, getattr(selected, "term_id", None), value))
        if action == "read":
            return "\x1b[31mREMOTE_OK\x1b[0m\r\n"
        return None

    async def info(_terminal_id):
        return SimpleNamespace(foreground="zsh", cwd=terminal.cwd)

    async def publish(event, payload):
        calls.append((event, payload["termId"], None))

    service = AgentTerminalService(
        Registry(),
        create=None,
        info=info,
        remote=remote,
        publish=publish,
    )
    listed = await service.execute("list_terminals", {}, agent)
    assert listed["terminals"][0]["connectionId"] == "server-1"
    read = await service.execute("read_terminal", {"terminal_id": terminal.term_id, "lines": 20}, agent)
    assert read["output"] == "REMOTE_OK"
    submitted = await service.execute(
        "run_terminal_command",
        {"terminal_id": terminal.term_id, "command": "pytest -q"},
        agent,
    )
    assert submitted["status"] == "submitted"
    assert ("write", terminal.term_id, "pytest -q") in calls

    wrong_connection = AgentSession.create(
        agent="coloride",
        cwd="/srv/project",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        connection_id="server-2",
        access_level="full",
    )
    with pytest.raises(PermissionError, match="selected workspace"):
        await service.execute(
            "read_terminal", {"terminal_id": terminal.term_id, "lines": 20}, wrong_connection
        )
