from __future__ import annotations

import asyncio
import json
import shlex
import shutil
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from coloride_desktop.agents.domain import AgentMode, AgentSession
from coloride_desktop.agents.provider import ModelToolCall
from coloride_desktop.agents.tools import RemoteWorkspaceTools
from coloride_desktop.files.local import LocalFileService
from coloride_desktop.files.search import ProjectSearchService, SearchConnectionError
from coloride_desktop.files.search_worker import database_path, index_once


async def unused_command(command):
    raise AssertionError("A local search must not use SSH")


async def test_real_agent_tool_expands_in_one_call_and_supports_literal(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (root / "nutrition.py").write_text("def calculateCalories(ingredients):\n    return sum(ingredients)\n")
    (root / ".env").write_text("FOOD_SECRET=private\n")
    (root / "ignored.py").write_text("food private\n")
    (root / ".colorideignore").write_text("ignored.py\n")
    service = ProjectSearchService(tmp_path / "cache")
    tools = RemoteWorkspaceTools(files=LocalFileService(str(root)), run_command=unused_command)
    tools.search_service = service
    session = AgentSession.create(agent="coloride", cwd=str(root), mode=AgentMode.ASK, workspace_kind="local")
    try:
        await tools.prepare(session)
        args = {"query": "comida", "path": ".", "include": "*.py"}
        result = await tools.execute(
            ModelToolCall(call_id="search", name="search_files", arguments=args), session
        )
        assert "nutrition.py" in result.output
        assert "calculateCalories" in result.output
        assert "[related]" in result.output
        assert "ignored.py" not in result.output
        exact = await tools.execute(
            ModelToolCall(call_id="exact", name="search_files", arguments={**args, "mode": "literal"}),
            session,
        )
        assert "No matches" in exact.output
        assert "nutrition.py" not in exact.output
    finally:
        await service.close()


async def test_warm_is_nonblocking_deduplicated_and_close_stops_process(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (root / "app.py").write_text("food\n" * 1000)
    service = ProjectSearchService(tmp_path / "cache")
    try:
        jobs = await asyncio.gather(*(service.warm(str(root)) for _ in range(8)))
        assert all(job is jobs[0] for job in jobs)
        assert len(service._workspaces) == 1
        await asyncio.wait_for(jobs[0].ready.wait(), 5)
        assert jobs[0].process is not None
    finally:
        await service.close()
    assert jobs[0].process.returncode is not None
    assert not service._workspaces


async def test_workspace_eviction_bounds_background_processes(tmp_path):
    service = ProjectSearchService(tmp_path / "cache")
    jobs = []
    try:
        for name in ("first", "second", "third"):
            root = tmp_path / name
            root.mkdir()
            job = await service.warm(str(root))
            await asyncio.wait_for(job.ready.wait(), 5)
            jobs.append(job)
        assert len(service._workspaces) == 2
        assert jobs[0].process.returncode is not None
    finally:
        await service.close()


async def test_reopen_reuses_index_and_external_edits_have_current_results(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    source = root / "app.py"
    source.write_text("old_exact_name\n")
    cache = tmp_path / "cache"
    index_once(str(root), str(cache), pause_seconds=0, cpu_fraction=1)
    assert database_path(str(root), str(cache)).exists()
    source.write_text("new_exact_name\n")
    service = ProjectSearchService(cache)
    try:
        old = await service.search(str(root), "old_exact_name", mode="literal")
        assert not old["matches"]
        new = await service.search(str(root), "new_exact_name", mode="literal")
        assert new["matches"][0]["text"] == "new_exact_name"
    finally:
        await service.close()


class ShellRemote:
    """Exercise the VPS CLI protocol in a local shell, without a real SSH host."""

    def __init__(self, cache: Path):
        from coloride_desktop.files import search_worker

        self.cache = cache
        self.worker = Path(search_worker.__file__)
        self.processes = []
        self.commands = []

    async def run(self, command):
        self.commands.append(command)
        if command.startswith("python3 -c "):
            # The installer is transport-only; provision the same versioned
            # source through the fixture while keeping the cache in tmp_path.
            return SimpleNamespace(
                exit_status=0,
                stderr="",
                stdout=json.dumps({"worker": str(self.worker), "cache": str(self.cache)}),
            )
        if command.startswith("nohup "):
            arguments = shlex.split(command.split(" </dev/null")[0])[1:]
            arguments[0] = sys.executable
            process = await asyncio.create_subprocess_exec(
                *arguments, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            self.processes.append(process)
            return SimpleNamespace(exit_status=0, stderr="", stdout="")
        process = await asyncio.create_subprocess_exec(
            "/bin/sh", "-c", command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        out, err = await process.communicate()
        return SimpleNamespace(exit_status=process.returncode, stdout=out.decode(), stderr=err.decode())

    async def close(self):
        for process in self.processes:
            if process.returncode is None:
                process.terminate()
            await process.wait()


async def test_vps_protocol_matches_local_and_captures_connection(tmp_path):
    root = tmp_path / "project ' with spaces"
    root.mkdir()
    (root / "recipes.py").write_text("def foodRecipes():\n    return []\n")
    remote = ShellRemote(tmp_path / "remote-cache")
    active = {"connection": "vps-a"}

    def binding(connection_id):
        if connection_id != active["connection"]:
            raise RuntimeError("wrong connection")
        captured = connection_id

        async def run(command):
            if captured != active["connection"]:
                raise RuntimeError("connection changed")
            return await remote.run(command)

        return captured, run

    service = ProjectSearchService(tmp_path / "local-cache", binding)
    try:
        local = await service.search(str(root), "comida")
        ssh = await service.search(str(root), "comida", kind="ssh", connection_id="vps-a")
        assert [(m["path"], m["text"]) for m in ssh["matches"]] == [
            (m["path"], m["text"]) for m in local["matches"]
        ]
        assert ssh["matches"]
        active["connection"] = "vps-b"
        with pytest.raises(RuntimeError, match="wrong connection"):
            await service.search(str(root), "comida", kind="ssh", connection_id="vps-a")
        await service.disconnect("vps-a")
        assert all(key[0] == "local" for key in service._workspaces)
    finally:
        await service.close()
        await remote.close()


async def test_changed_ssh_transport_never_falls_back_on_another_server(tmp_path):
    root = tmp_path / "project"
    root.mkdir()

    def binding(connection_id):
        raise SearchConnectionError("connection changed")

    service = ProjectSearchService(tmp_path / "cache", binding)
    tools = RemoteWorkspaceTools(files=LocalFileService(str(root)), run_command=unused_command)
    tools.search_service = service
    session = AgentSession.create(
        agent="coloride",
        cwd=str(root),
        mode=AgentMode.ASK,
        workspace_kind="ssh",
        connection_id="old-server",
    )
    try:
        with pytest.raises(PermissionError, match="SSH connection changed"):
            await tools.execute(
                ModelToolCall(
                    call_id="changed",
                    name="search_files",
                    arguments={"query": "food", "path": ".", "include": "*"},
                ),
                session,
            )
    finally:
        await service.close()


async def test_subtree_filters_and_two_local_projects_do_not_mix(tmp_path):
    roots = [tmp_path / name for name in ("one", "two")]
    for root in roots:
        (root / "src").mkdir(parents=True)
        (root / "src" / "app.py").write_text(f"food {root.name}\n")
        (root / "app.txt").write_text("food excluded by include\n")
    service = ProjectSearchService(tmp_path / "cache")
    try:
        results = await asyncio.gather(
            *(service.search(str(root), "food", path=str(root / "src"), include="*.py") for root in roots)
        )
        assert all(len(result["matches"]) == 1 for result in results)
        assert results[0]["matches"][0]["text"] == "food one"
        assert results[1]["matches"][0]["text"] == "food two"
    finally:
        await service.close()


@pytest.mark.skipif(shutil.which("rg") is None, reason="ripgrep fallback requires rg")
async def test_remote_literal_fallback_obeys_ignores_symlinks_and_reports_errors(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (root / "app.py").write_text("food\nfood again\n")
    (root / ".env").write_text("food secret\n")
    (root / "private.py").write_text("food ignored\n")
    (root / ".colorideignore").write_text("private.py\n")
    outside = tmp_path / "outside.py"
    outside.write_text("food outside\n")
    (root / "link.py").symlink_to(outside)

    async def command(cmd):
        process = await asyncio.create_subprocess_exec(
            "/bin/bash",
            "-c",
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await process.communicate()
        return SimpleNamespace(stdout=out.decode(), stderr=err.decode(), exit_status=process.returncode)

    tools = RemoteWorkspaceTools(files=LocalFileService(str(root)), run_command=command)
    session = AgentSession.create(agent="coloride", cwd=str(root), mode=AgentMode.ASK, workspace_kind="ssh")
    await tools.prepare(session)
    args = {"query": "food", "path": ".", "include": "*", "max_results": 1}
    result = await tools.execute(
        ModelToolCall(call_id="fallback", name="search_files", arguments=args), session
    )
    assert "app.py" in result.output
    assert "private.py" not in result.output
    assert "outside.py" not in result.output
    assert "secret" not in result.output
    assert result.metadata["truncated"]
    empty = await tools.execute(
        ModelToolCall(
            call_id="empty", name="search_files", arguments={**args, "query": "unfindable_literal"}
        ),
        session,
    )
    assert "No matches" in empty.output
    assert not empty.metadata["truncated"]


def test_api_workspace_open_starts_index_and_lifespan_closes_it(tmp_path):
    from fastapi.testclient import TestClient

    from coloride_desktop.api.app import create_app
    from coloride_desktop.config import LaunchConfig

    root = tmp_path / "project"
    root.mkdir()
    (root / "app.py").write_text("food\n")
    app = create_app(LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token"))
    service = ProjectSearchService(tmp_path / "cache")
    app.state.search = service
    app.state.agents.bind_search(service)
    with TestClient(app) as client:
        response = client.post(
            "/api/local-workspace/open",
            json={"path": str(root)},
            headers={"Authorization": "Bearer test-token"},
        )
        assert response.status_code == 200
        assert len(service._workspaces) == 1
    assert service._closed
    assert not service._workspaces
