from __future__ import annotations

import base64
import json
import shutil
import subprocess
from dataclasses import dataclass

import pytest

from coloride_desktop.agents.domain import AgentMode, AgentSession
from coloride_desktop.agents.provider import ModelToolCall
from coloride_desktop.agents.store import AgentSessionStore
from coloride_desktop.agents.task import AgentTask
from coloride_desktop.agents.tools import (
    RecoverableToolInputError,
    SERVER_ONLY_TOOL_NAMES,
    RemoteWorkspaceTools,
    ToolExecutionResult,
    _ACTIVE_TOOL_SESSION,
    _isolate_command_stdio,
    _strip_known_shell_startup_noise,
    tool_catalog,
)


class FakeFiles:
    def __init__(self) -> None:
        self.values = {"/srv/app/example.txt": b"before\n"}
        self.etags = {"/srv/app/example.txt": "etag-before"}
        self.realpaths: dict[str, str] = {}
        self.directories: set[str] = {"/srv/app", "/srv/other"}

    async def realpath(self, path: str) -> str:
        if path in self.realpaths:
            return self.realpaths[path]
        if path in self.directories or path in self.values:
            return path
        if path in {"/srv/app", "/srv/app/example.txt"}:
            return path
        raise FileNotFoundError(path)

    async def exists(self, path: str) -> bool:
        return path in self.directories or path in self.values

    async def read(self, path: str) -> tuple[str, str, bool]:
        if path not in self.values:
            raise FileNotFoundError(path)
        return (
            base64.b64encode(self.values[path]).decode("ascii"),
            self.etags[path],
            False,
        )

    async def write(self, path: str, content_base64: str, etag: str | None) -> str:
        if etag is not None and etag != self.etags.get(path):
            raise RuntimeError("etag mismatch")
        self.values[path] = base64.b64decode(content_base64)
        self.etags[path] = "etag-after"
        return "etag-after"

    async def ensure_dir(self, path: str) -> None:
        cursor = path.rstrip("/")
        missing: list[str] = []
        while cursor and cursor not in self.directories:
            missing.append(cursor)
            cursor = cursor.rsplit("/", 1)[0] or "/"
        self.directories.update(missing)

    async def delete(self, path: str, *, recursive: bool = False) -> None:
        del recursive
        self.values.pop(path, None)
        self.etags.pop(path, None)
        self.directories.discard(path)


@dataclass(slots=True)
class FakeCommandResult:
    stdout: str = ""
    stderr: str = ""
    exit_status: int = 0


async def _run_command(command: str) -> FakeCommandResult:
    return FakeCommandResult()


def test_isolate_command_stdio_enables_job_control() -> None:
    wrapped = _isolate_command_stdio("npm run dev 2>&1 & sleep 1")
    assert "set -m" in wrapped
    assert "npm run dev" in wrapped
    assert "mktemp" in wrapped
    assert "</dev/null" in wrapped


@pytest.mark.parametrize("exit_code", [0, 7])
def test_isolate_command_stdio_preserves_output_in_zsh(exit_code: int) -> None:
    shell = shutil.which("zsh")
    if shell is None:
        pytest.skip("zsh is not installed")
    result = subprocess.run(
        [shell, "-c", _isolate_command_stdio(f"printf hello; exit {exit_code}")],
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == exit_code
    assert result.stdout == "hello"
    assert "read-only variable" not in result.stderr


def test_shell_noise_filter_removes_only_a_leading_plesk_banner() -> None:
    banner = (
        "This server is powered by Plesk.\n\n"
        "Run the 'plesk login' command and log in by browsing either of the links received in the output.\n"
        "Use the 'plesk' command to manage the server. Run 'plesk help' for more info.\n\n"
    )
    match = "471:export function LoggedInNotice({\n"

    assert _strip_known_shell_startup_noise(banner + match) == match
    assert _strip_known_shell_startup_noise(match + banner) == match + banner


async def test_run_removes_plesk_banner_from_stderr_without_losing_stdout() -> None:
    banner = (
        "This server is powered by Plesk.\n\n"
        "Run the 'plesk login' command and log in by browsing either of the links received in the output.\n"
        "Use the 'plesk' command to manage the server. Run 'plesk help' for more info.\n"
    )

    async def command_with_stderr_notice(_command: str) -> FakeCommandResult:
        return FakeCommandResult(
            stdout="471:export function LoggedInNotice({\n",
            stderr=banner,
        )

    tools = RemoteWorkspaceTools(
        files=FakeFiles(),
        run_command=command_with_stderr_notice,  # type: ignore[arg-type]
    )

    output, status = await tools._run("rg -n 'function LoggedInNotice' login-form.tsx")

    assert output == "471:export function LoggedInNotice({"
    assert status == 0


async def test_execute_command_times_out_instead_of_hanging() -> None:
    files = FakeFiles()
    files.directories.update({"/home/coloride"})

    async def hang(_command: str) -> FakeCommandResult:
        await __import__("asyncio").sleep(30)
        return FakeCommandResult()

    tools = RemoteWorkspaceTools(files=files, run_command=hang)  # type: ignore[arg-type]
    session = AgentSession.create(
        agent="coloride",
        cwd="/home/coloride",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        filesystem_scope="server",
    )
    _ACTIVE_TOOL_SESSION.set(session)
    result = await tools._run("sleep 999", timeout=0.05)
    assert result[1] == 124
    assert "timed out" in result[0]


async def test_delete_path_removes_a_binary_file() -> None:
    files = FakeFiles()
    files.values["/srv/app/ocr"] = b"\x7fELF\0binary"
    files.etags["/srv/app/ocr"] = "etag-ocr"
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)

    result = await tools.execute(
        ModelToolCall(
            call_id="call-delete-binary",
            name="delete_path",
            arguments={"path": "ocr", "recursive": False},
        ),
        session,
    )

    assert "/srv/app/ocr" not in files.values
    assert "Deleted ocr" in result.output
    assert result.diff is not None
    assert "Delete binary file: ocr" in result.diff


async def test_exact_replace_returns_diff_and_preserves_workspace_boundary() -> None:
    files = FakeFiles()
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)

    result = await tools.execute(
        ModelToolCall(
            call_id="call-edit",
            name="replace_in_file",
            arguments={
                "path": "example.txt",
                "old_text": "before",
                "new_text": "after",
                "replace_all": False,
            },
        ),
        session,
    )

    assert files.values["/srv/app/example.txt"] == b"after\n"
    assert result.diff is not None
    assert "-before" in result.diff
    assert "+after" in result.diff


async def test_read_file_repairs_line_count_shaped_end_line() -> None:
    files = FakeFiles()
    files.values["/srv/app/example.txt"] = "\n".join(
        f"line {number}" for number in range(1, 701)
    ).encode()
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ASK)

    raw_call = ModelToolCall(
        call_id="call-read-count-slip",
        name="read_file",
        arguments={"path": "example.txt", "start_line": 540, "end_line": 80},
    )
    normalized = tools.normalize_call(raw_call)
    result = await tools.execute(raw_call, session)

    assert normalized.arguments["start_line"] == 540
    assert normalized.arguments["end_line"] == 619
    assert "   540 | line 540" in result.output
    assert "   619 | line 619" in result.output
    assert "   620 | line 620" not in result.output


async def test_replace_file_empty_anchor_is_recoverable_and_does_not_write() -> None:
    files = FakeFiles()
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)

    with pytest.raises(RecoverableToolInputError, match="non-empty old_text"):
        await tools.execute(
            ModelToolCall(
                call_id="call-empty-anchor",
                name="replace_in_file",
                arguments={
                    "path": "example.txt",
                    "old_text": "",
                    "new_text": "after\n",
                    "replace_all": False,
                },
            ),
            session,
        )

    assert files.values["/srv/app/example.txt"] == b"before\n"


async def test_server_scope_shell_runs_as_the_connected_linux_user() -> None:
    files = FakeFiles()
    files.directories.update({"/home/coloride"})
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(
        agent="coloride",
        cwd="/home/coloride",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        filesystem_scope="server",
    )
    _ACTIVE_TOOL_SESSION.set(session)

    command = await tools._sandbox_command("pm2 restart api", "/home/coloride", "/home/coloride")
    assert command == "cd /home/coloride && pm2 restart api"
    assert "bwrap" not in command


async def test_full_access_keeps_the_connected_linux_identity() -> None:
    files = FakeFiles()
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(
        agent="coloride",
        cwd="/srv/app",
        mode=AgentMode.ACT,
        access_level="full",
        workspace_kind="ssh",
        filesystem_scope="workspace",
    )
    _ACTIVE_TOOL_SESSION.set(session)

    command = await tools._sandbox_command("npm test", "/srv/app", "/srv/app")
    assert command == "cd /srv/app && npm test"
    assert "bwrap" not in command


async def test_server_scope_uses_normal_shell_tools() -> None:
    files = FakeFiles()
    files.directories.update({"/home/coloride"})
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(
        agent="coloride",
        cwd="/home/coloride",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        filesystem_scope="server",
    )
    names = {schema["name"] for schema in tools.schemas_for(AgentMode.ACT, session)}
    assert "execute_command" in names
    assert "switch_user" not in names
    assert "deploy_application" not in names
    assert "restart_application" not in names
    assert "get_application_logs" not in names
    assert "check_application_health" not in names

    workspace = AgentSession.create(
        agent="coloride",
        cwd="/home/coloride/workspaces/app",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        filesystem_scope="workspace",
    )
    workspace_names = {schema["name"] for schema in tools.schemas_for(AgentMode.ACT, workspace)}
    assert "execute_command" in workspace_names
    assert "switch_user" not in workspace_names
    assert "deploy_application" not in workspace_names
    assert "restart_application" not in workspace_names
    assert "get_application_logs" not in workspace_names
    assert "check_application_health" not in workspace_names

    task = AgentTask.create(
        conversation_id=session.session_id,
        workspace_id=session.cwd,
        goal="Fix the auth redirect",
    )
    focused_names = {
        schema["name"]
        for schema in tools.schemas_for(
            AgentMode.ACT,
            session,
            task=task,
            intent="Fix the auth redirect",
        )
    }
    assert "replace_in_file" in focused_names
    assert "execute_command" in focused_names
    assert "browser_click" not in focused_names
    assert "delete_path" in focused_names

    visual_names = {
        schema["name"]
        for schema in tools.schemas_for(
            AgentMode.ACT,
            session,
            task=task,
            intent="Verify the login page visually in the browser",
        )
    }
    assert "browser_snapshot" in visual_names
    assert "browser_click" in visual_names

    with pytest.raises(ValueError, match="Unknown Coloride tool"):
        await tools.execute(
            ModelToolCall(
                call_id="call-restart",
                name="restart_application",
                arguments={"reason": "restart admin"},
            ),
            session,
        )


async def test_switch_user_is_not_available() -> None:
    files = FakeFiles()
    files.directories.update({"/home/coloride"})
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(
        agent="coloride",
        cwd="/home/coloride",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        filesystem_scope="server",
    )
    assert "switch_user" not in {schema["name"] for schema in tools.schemas_for(AgentMode.ACT, session)}
    with pytest.raises(ValueError, match="Unknown Coloride tool"):
        await tools.execute(
            ModelToolCall(
                call_id="call-switch",
                name="switch_user",
                arguments={"target": "admin"},
            ),
            session,
        )


async def test_server_scope_can_leave_the_starting_folder() -> None:
    files = FakeFiles()
    files.values["/var/www/app/index.html"] = b"<html></html>\n"
    files.directories.update({"/var/www", "/var/www/app", "/home/coloride", "/etc"})
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(
        agent="coloride",
        cwd="/home/coloride",
        mode=AgentMode.PLAN,
        workspace_kind="ssh",
        filesystem_scope="server",
    )

    readable = await tools._safe_path(
        session.cwd,
        "/var/www/app/index.html",
        mutate=False,
        session=session,
    )
    assert readable == "/var/www/app/index.html"
    writable = await tools._safe_path(
        session.cwd,
        "/var/www/app/index.html",
        mutate=True,
        session=session,
    )
    assert writable == "/var/www/app/index.html"


async def test_workspace_scope_still_cannot_leave_the_open_folder() -> None:
    files = FakeFiles()
    files.values["/var/www/app/index.html"] = b"<html></html>\n"
    files.directories.update({"/var/www", "/var/www/app"})
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(
        agent="coloride",
        cwd="/srv/app",
        mode=AgentMode.PLAN,
        workspace_kind="ssh",
        filesystem_scope="workspace",
    )

    with pytest.raises(PermissionError, match="escapes"):
        await tools._safe_path(
            session.cwd,
            "/var/www/app/index.html",
            mutate=False,
            session=session,
        )


async def test_tool_rejects_parent_traversal_and_symlink_escape() -> None:
    files = FakeFiles()
    files.realpaths["/srv/app/link"] = "/etc/passwd"
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.PLAN)

    with pytest.raises(PermissionError, match="traversal"):
        await tools.execute(
            ModelToolCall(
                call_id="call-traversal",
                name="read_file",
                arguments={"path": "../etc/passwd", "start_line": None, "end_line": None},
            ),
            session,
        )

    with pytest.raises(PermissionError, match="escapes"):
        await tools.execute(
            ModelToolCall(
                call_id="call-symlink",
                name="read_file",
                arguments={"path": "link", "start_line": None, "end_line": None},
            ),
            session,
        )


async def test_search_chat_history_and_read_spilled_tool_output(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ASK)
    store.save_session(session)
    store.append_conversation_items(
        session.session_id,
        [
            {"role": "user", "content": "Please fix the login redirect after OAuth"},
            {"role": "assistant", "content": "I will inspect auth middleware."},
        ],
    )
    tools = RemoteWorkspaceTools(
        files=FakeFiles(),
        run_command=_run_command,  # type: ignore[arg-type]
        store=store,
    )
    huge = "line-start\n" + ("npm build log\n" * 120) + "login redirect failed at callback\n"
    store.write_tool_output(session.session_id, "call_build_1", huge)
    found = await tools.execute(
        ModelToolCall(
            call_id="call-search",
            name="search_chat_history",
            arguments={"query": "login redirect", "queries": None, "limit": 10},
        ),
        session,
    )
    assert "login redirect" in found.output.lower()

    page = await tools.execute(
        ModelToolCall(
            call_id="call-read",
            name="read_tool_output",
            arguments={"id": "call_build_1", "offset": 0, "limit": 20},
        ),
        session,
    )
    assert "Tool output call_build_1" in page.output
    assert "line-start" in page.output
    assert page.metadata is not None
    assert page.metadata["truncated"] is True


async def test_large_execute_result_is_written_to_tool_outputs(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "sessions")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ASK)
    store.save_session(session)
    tools = RemoteWorkspaceTools(
        files=FakeFiles(),
        run_command=_run_command,  # type: ignore[arg-type]
        store=store,
    )
    result = tools._persist_large_tool_output(
        ModelToolCall(call_id="call_exec_9", name="execute_command", arguments={}),
        session,
        ToolExecutionResult(output=("out\n" * 200)),
    )
    assert result.metadata is not None
    assert result.metadata["spilled"] is True
    saved = store.read_tool_output(session.session_id, "call_exec_9", offset=0, limit=5)
    assert saved["lines"] == 200
    assert saved["text"].startswith("out")
    meta_path = store._tool_outputs_dir(session.session_id) / "call_exec_9.meta.json"
    assert meta_path.exists()
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["tool"] == "execute_command"
    assert meta["bytes"] > 0
    assert meta["sha256"]


async def test_agent_cannot_change_workspace_itself() -> None:
    files = FakeFiles()
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)

    assert "change_workspace" not in {item["id"] for item in tool_catalog()}
    with pytest.raises(ValueError, match="Unknown Coloride tool"):
        await tools.execute(
            ModelToolCall(
                call_id="call-cwd",
                name="change_workspace",
                arguments={"path": "/srv/other"},
            ),
            session,
        )
    assert session.cwd == "/srv/app"


async def test_create_directory_supports_multiple_missing_levels() -> None:
    files = FakeFiles()
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)

    result = await tools.execute(
        ModelToolCall(
            call_id="call-nested-dir",
            name="create_directory",
            arguments={"path": "src/app/api/auth/apple"},
        ),
        session,
    )

    assert "/srv/app/src/app/api/auth/apple" in files.directories
    assert result.metadata == {"path": "/srv/app/src/app/api/auth/apple"}


async def test_session_plugins_gate_mcp_schemas() -> None:
    from coloride_desktop.agents.integrations import MCPTool

    files = FakeFiles()
    tools = RemoteWorkspaceTools(files=files, run_command=_run_command)  # type: ignore[arg-type]
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)

    class FakeIntegrations:
        def tools(self):
            return [
                MCPTool(
                    exposed_name="mcp__linear__list_issues",
                    server_id="linear",
                    remote_name="list_issues",
                    title="List issues",
                    description="List Linear issues",
                    parameters={"type": "object", "properties": {}, "additionalProperties": False},
                ),
                MCPTool(
                    exposed_name="mcp__github__list_prs",
                    server_id="github",
                    remote_name="list_prs",
                    title="List PRs",
                    description="List GitHub PRs",
                    parameters={"type": "object", "properties": {}, "additionalProperties": False},
                ),
            ]

        def get_tool(self, name: str):
            return next((tool for tool in self.tools() if tool.exposed_name == name), None)

    tools.integrations = FakeIntegrations()  # type: ignore[assignment]

    names = {schema["name"] for schema in tools.schemas_for(AgentMode.ACT, session)}
    assert "mcp__linear__list_issues" not in names
    assert "mcp__github__list_prs" not in names

    tools.set_session_plugins(session.session_id, ["linear"])
    names = {schema["name"] for schema in tools.schemas_for(AgentMode.ACT, session)}
    assert "mcp__linear__list_issues" in names
    assert "mcp__github__list_prs" not in names

    with pytest.raises(PermissionError, match="not added to this chat"):
        await tools.execute(
            ModelToolCall(
                call_id="call-github",
                name="mcp__github__list_prs",
                arguments={},
            ),
            session,
        )
