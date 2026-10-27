from __future__ import annotations

import base64
import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig
from coloride_desktop.files.local import LocalFileService, WorkspaceFileService


@pytest.mark.asyncio
async def test_local_service_uses_selected_root_as_relative_base(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    service = LocalFileService(str(root))

    encoded = base64.b64encode(b"Coloride local").decode("ascii")
    await service.write(str(root / "hello.txt"), encoded)
    content, _etag, truncated = await service.read(str(root / "hello.txt"))

    assert base64.b64decode(content) == b"Coloride local"
    assert truncated is False
    assert await service.realpath(".") == str(root.resolve())
    assert [entry.name for entry in await service.list(str(tmp_path))] == ["project"]
    await service.write("../outside.txt", encoded)
    content, _, _ = await service.read(str(tmp_path / "outside.txt"))
    assert base64.b64decode(content) == b"Coloride local"


@pytest.mark.asyncio
async def test_local_service_recursively_deletes_without_deleting_root(tmp_path):
    root = tmp_path / "project"
    nested = root / "one" / "two"
    nested.mkdir(parents=True)
    (nested / "file.txt").write_text("value", encoding="utf-8")
    service = LocalFileService(str(root))

    await service.delete(str(root / "one"), recursive=True)

    assert not (root / "one").exists()
    assert root.exists()
    with pytest.raises(PermissionError):
        await service.delete(str(root), recursive=True)


@pytest.mark.asyncio
async def test_two_agent_sessions_keep_distinct_local_roots_concurrently(tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    service = WorkspaceFileService(object())
    service.authorize_local_session("chat-a", str(first))
    service.authorize_local_session("chat-b", str(second))
    encoded = base64.b64encode(b"ok").decode("ascii")

    async def write_for(session_id: str) -> str:
        with service.session_scope(session_id):
            await service.write("result.txt", encoded)
            return str(service.active_local.root)

    roots = await asyncio.gather(
        write_for("chat-a"),
        write_for("chat-b"),
    )

    assert roots == [str(first.resolve()), str(second.resolve())]
    assert (first / "result.txt").read_text() == "ok"
    assert (second / "result.txt").read_text() == "ok"


def test_workspace_service_switches_without_replacing_shared_instance(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    remote = object()
    service = WorkspaceFileService(remote)

    assert service.mode == "ssh"
    assert service.use_local(str(root)) == str(root.resolve())
    assert service.mode == "local"
    service.use_remote()
    assert service.mode == "ssh"


def test_local_workspace_api_opens_and_serves_selected_folder(tmp_path, monkeypatch):
    root = tmp_path / "project"
    root.mkdir()
    (root / "visible.txt").write_text("hello", encoding="utf-8")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    config = LaunchConfig(host="127.0.0.1", port=0, bearer_token="test-token")
    app = create_app(config)
    headers = {"authorization": "Bearer test-token"}

    with TestClient(app) as client:
        opened = client.post(
            "/api/local-workspace/open",
            headers=headers,
            json={"path": str(root)},
        )
        listed = client.post(
            "/api/files/list",
            headers=headers,
            json={"path": str(root)},
        )

    assert opened.status_code == 200
    assert opened.json() == {"mode": "local", "path": str(root.resolve())}
    assert listed.status_code == 200
    assert [entry["name"] for entry in listed.json()["entries"]] == ["visible.txt"]


def test_local_terminal_is_bound_to_local_workspace(tmp_path, monkeypatch):
    root = tmp_path / "project"
    root.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    app = create_app(LaunchConfig(host="127.0.0.1", port=0, bearer_token="test-token"))
    headers = {"authorization": "Bearer test-token"}

    with TestClient(app) as client:
        assert client.post(
            "/api/local-workspace/open",
            headers=headers,
            json={"path": str(root)},
        ).status_code == 200
        created = client.post(
            "/api/term/create",
            headers=headers,
            json={
                "cols": 80,
                "rows": 24,
                "cwd": str(root),
                "workspaceKind": "local",
                "connectionId": "local",
            },
        )
        assert created.status_code == 200
        terminal = app.state.terminals.get(created.json()["termId"])
        assert terminal is not None
        assert terminal.local is True
        assert terminal.connection_id == "local"
        assert terminal.cwd == str(root.resolve())


@pytest.mark.asyncio
async def test_local_agent_reads_writes_and_searches_outside_project(tmp_path):
    from coloride_desktop.agents.domain import AgentMode, AgentSession
    from coloride_desktop.agents.provider import ModelToolCall
    from coloride_desktop.agents.tools import RemoteWorkspaceTools

    root = tmp_path / "project"
    root.mkdir()
    outside = tmp_path / "sibling"
    outside.mkdir()
    (outside / "example.txt").write_text("external content\n")
    files = WorkspaceFileService(object())
    session = AgentSession.create(
        agent="coloride", cwd=str(root), mode=AgentMode.ACT, workspace_kind="local",
    )
    files.authorize_local_session(session.session_id, str(root))

    async def no_shell(command):
        raise AssertionError("Local file tools must not need a shell")

    tools = RemoteWorkspaceTools(files=files, run_command=no_shell)
    with files.session_scope(session.session_id):
        result = await tools.execute(ModelToolCall(
            call_id="read", name="read_file", arguments={"path": "../sibling/example.txt"},
        ), session)
        assert "external content" in result.output
        result = await tools.execute(ModelToolCall(
            call_id="search", name="search_files",
            arguments={"path": str(outside), "query": "external", "mode": "literal"},
        ), session)
        assert "example.txt" in result.output
        await tools.execute(ModelToolCall(
            call_id="write", name="write_file",
            arguments={"path": "../sibling/new.txt", "content": "written externally\n"},
        ), session)
        assert (outside / "new.txt").read_text() == "written externally\n"
        await tools.execute(ModelToolCall(
            call_id="rename-file", name="rename_path",
            arguments={"path": "../sibling/new.txt", "new_name": "renamed.txt"},
        ), session)
        assert not (outside / "new.txt").exists()
        assert (outside / "renamed.txt").read_text() == "written externally\n"
        await tools.execute(ModelToolCall(
            call_id="rename-folder", name="rename_path",
            arguments={"path": str(outside), "new_name": "renamed-folder"},
        ), session)
        assert not outside.exists()
        assert (tmp_path / "renamed-folder" / "renamed.txt").read_text() == "written externally\n"


def test_local_folder_search_returns_names_and_content_without_ssh(tmp_path, monkeypatch):
    root = tmp_path / "project"
    selected = root / "selected"
    selected.mkdir(parents=True)
    (selected / "branch").mkdir()
    (selected / "needle.txt").write_text("other", encoding="utf-8")
    (selected / "content.txt").write_text("needle in content", encoding="utf-8")
    (root / "outside.txt").write_text("needle outside selected folder", encoding="utf-8")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    app = create_app(LaunchConfig(host="127.0.0.1", port=0, bearer_token="test-token"))
    headers = {"authorization": "Bearer test-token"}
    with TestClient(app) as client:
        assert client.post("/api/local-workspace/open", headers=headers, json={"path":str(root)}).status_code == 200
        response = client.post("/api/files/search", headers=headers, json={"path":str(selected),"query":"needle","mode":"all"})
        directories = client.post("/api/files/search", headers=headers, json={"path":str(selected),"query":"branch","mode":"name"})
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "all"
    assert [hit["name"] for hit in data["files"]] == ["needle.txt"]
    assert [hit["path"] for hit in data["matches"]] == [str(selected / "content.txt")]
    assert directories.status_code == 200
    assert [(entry["name"], entry["kind"]) for entry in directories.json()["entries"]] == [("branch", "dir")]
