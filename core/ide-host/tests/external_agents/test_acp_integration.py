"""Real stdio SDK transport and process lifecycle, isolated from user credentials."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

from coloride_desktop.external_agents.files import AcpFileBridge
from coloride_desktop.external_agents.models import InstallationRecord, OpenSessionRequest
from coloride_desktop.external_agents.service import ExternalAgentError, ExternalAgentManager
from coloride_desktop.files.local import LocalFileService


async def eventually(predicate, timeout=5):
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


def manager_for(root: Path, *args: str) -> ExternalAgentManager:
    root.mkdir(exist_ok=True)
    files = LocalFileService(str(root))

    async def publish(*_args):
        pass

    manager = ExternalAgentManager(
        root / "state",
        publish,
        AcpFileBridge(
            root,
            stat_file=files.stat_path,
            read_file=files.read,
            write_file=files.write,
            known_etag=lambda _: None,
        ),
    )
    fake = Path(__file__).with_name("fake_agent.py")
    manager.store.upsert_installation(
        InstallationRecord(
            id="test@1",
            agentId="test",
            name="Test Agent",
            version="1",
            status="installed",
            distribution="binary",
            executable=sys.executable,
            args=[str(fake), *args],
            location=str(root / "state/packages/test/1"),
        )
    )
    return manager


@pytest.mark.asyncio
async def test_login_creates_session_config_permission_file_write_and_replay(tmp_path):
    manager = manager_for(tmp_path)
    try:
        opened = await manager.open_session(OpenSessionRequest(agentId="test", workspacePath=str(tmp_path)))
        assert opened["phase"] == "needs-login"
        sid = opened["id"]
        ready = await manager.authenticate(sid, "codex-login")
        assert ready["phase"] == "ready"
        assert ready["acpSessionId"] == "acp-session-1"
        config = await manager.set_config(sid, "thought", "high")
        assert config["options"][0]["currentValue"] == "high"
        await manager.prompt(sid, "hello")
        await eventually(lambda: bool(manager._permissions))
        request_id = next(iter(manager._permissions))
        with pytest.raises(ExternalAgentError):
            await manager.resolve_permission("different-session", request_id, "allow", "selected")
        with pytest.raises(ExternalAgentError):
            await manager.resolve_permission(sid, request_id, "made-up", "selected")
        await manager.resolve_permission(sid, request_id, "allow", "selected")
        await eventually(lambda: manager._session(sid).turn == "idle")
        assert (tmp_path / "README.md").read_text() == "Edited through ACP\n"
        events = await manager.events(sid, 0)
        assert sum(e["update"]["sessionUpdate"] == "user_message_chunk" for e in events) == 1
        assert events[-1]["update"]["sessionUpdate"] == "turn_complete"
        count = sum(e["update"]["sessionUpdate"] == "agent_message_chunk" for e in events)
        await manager.close_execution(sid)
        restored = await manager.open_session(
            OpenSessionRequest(sessionId=sid, agentId="test", workspacePath=str(tmp_path))
        )
        assert restored["phase"] == "ready"
        assert (
            sum(e["update"]["sessionUpdate"] == "agent_message_chunk" for e in await manager.events(sid, 0))
            == count
        )
        await manager.delete_session(sid)
        assert manager.store.read_session(sid) is None
    finally:
        await manager.shutdown()
    assert not manager.processes._processes
    assert not manager._permissions


@pytest.mark.asyncio
async def test_cancel_resolves_pending_permission_and_turn(tmp_path):
    manager = manager_for(tmp_path, "--no-auth")
    try:
        opened = await manager.open_session(OpenSessionRequest(agentId="test", workspacePath=str(tmp_path)))
        assert opened["phase"] == "ready"  # authMethods alone must not force another login.
        sid = opened["id"]
        await manager.prompt(sid, "test cancellation")
        await eventually(lambda: bool(manager._permissions))
        await manager.cancel(sid)
        assert manager._session(sid).turn == "idle"
        assert not manager._permissions
        assert not (tmp_path / "README.md").exists()
    finally:
        await manager.shutdown()


@pytest.mark.asyncio
async def test_no_load_is_read_only_and_crash_marks_session_failed(tmp_path):
    manager = manager_for(tmp_path, "--no-auth", "--no-load")
    try:
        opened = await manager.open_session(OpenSessionRequest(agentId="test", workspacePath=str(tmp_path)))
        sid = opened["id"]
        await manager.close_execution(sid)
        restored = await manager.open_session(
            OpenSessionRequest(sessionId=sid, agentId="test", workspacePath=str(tmp_path))
        )
        assert restored["phase"] == "unsupported"
        with pytest.raises(ExternalAgentError):
            await manager.prompt(sid, "do not silently create a new chat")
    finally:
        await manager.shutdown()
    manager = manager_for(tmp_path / "crash", "--no-auth", "--crash")
    try:
        opened = await manager.open_session(
            OpenSessionRequest(agentId="test", workspacePath=str(tmp_path / "crash"))
        )
        sid = opened["id"]
        await manager.prompt(sid, "crash now")
        await eventually(lambda: manager._session(sid).phase == "failed")
        assert manager._session(sid).turn == "idle"
    finally:
        await manager.shutdown()


@pytest.mark.asyncio
async def test_interrupted_host_turn_is_not_restored_as_permanently_running(tmp_path):
    manager = manager_for(tmp_path, "--no-auth")
    opened = await manager.open_session(OpenSessionRequest(agentId="test", workspacePath=str(tmp_path)))
    sid = opened["id"]
    await manager.shutdown()
    record = manager._session(sid)
    record.turn = "running"
    record.phase = "ready"
    manager.store.write_session(record)
    manager.store.append_event(
        sid, {"sessionUpdate": "permission_request", "requestId": "stale", "sessionId": sid, "options": []}
    )
    replacement = manager_for(tmp_path, "--no-auth")
    try:
        restored = await replacement.open_session(
            OpenSessionRequest(sessionId=sid, agentId="test", workspacePath=str(tmp_path))
        )
        assert restored["turn"] == "idle"
        assert any(
            event["update"].get("stopReason") == "interrupted" for event in await replacement.events(sid, 0)
        )
    finally:
        await replacement.shutdown()


@pytest.mark.asyncio
async def test_terminal_callbacks_report_exit_status_and_enforce_session_ownership(tmp_path):
    from coloride_desktop.external_agents.terminals import AcpTerminalBridge

    terminals = AcpTerminalBridge()
    terminal = await terminals.create(
        session_id="owner",
        command=sys.executable,
        args=["-c", "print('terminal worked')"],
        env=[],
        cwd=str(tmp_path),
        output_byte_limit=1024,
    )
    try:
        with pytest.raises(KeyError):
            await terminals.output(terminal, owner="other")
        assert await terminals.wait(terminal, owner="owner") == (0, None)
        output, truncated, status = await terminals.output(terminal, owner="owner")
        assert output == "terminal worked\n"
        assert not truncated
        assert status == {"exitCode": 0}
    finally:
        await terminals.close_all()


@pytest.mark.asyncio
async def test_image_only_prompt_uses_acp_image_blocks_and_persists_preview(tmp_path):
    import json
    from coloride_desktop.external_agents.models import PromptImage

    manager = manager_for(tmp_path, "--no-auth", "--images")
    image = PromptImage(data="aGVsbG8=", mimeType="image/png", name="reference.png")
    try:
        opened = await manager.open_session(OpenSessionRequest(agentId="test", workspacePath=str(tmp_path)))
        assert opened["supportsImages"] is True
        sid = opened["id"]
        accepted = await manager.prompt(sid, "", [image])
        assert accepted["accepted"] is True
        await eventually(lambda: bool(manager._permissions))
        sent = json.loads((tmp_path / ".fake-prompt.json").read_text())["prompt"]
        assert len(sent) == 1
        assert sent[0]["type"] == "image"
        assert sent[0]["data"] == image.data
        assert sent[0]["mimeType"] == "image/png"
        events = await manager.events(sid, 0)
        content = next(e["update"]["content"] for e in events if e["update"]["sessionUpdate"] == "user_message_chunk")
        assert content["name"] == "reference.png"
        assert content["data"] == image.data
        await manager.cancel(sid)
    finally:
        await manager.shutdown()


@pytest.mark.asyncio
async def test_images_rejected_without_advertised_capability(tmp_path):
    from coloride_desktop.external_agents.models import PromptImage

    manager = manager_for(tmp_path, "--no-auth")
    try:
        opened = await manager.open_session(OpenSessionRequest(agentId="test", workspacePath=str(tmp_path)))
        assert opened["supportsImages"] is False
        with pytest.raises(ExternalAgentError, match="does not support image"):
            await manager.prompt(opened["id"], "look", [PromptImage(data="aGk=", mimeType="image/png")])
        assert manager._session(opened["id"]).turn == "idle"
    finally:
        await manager.shutdown()
