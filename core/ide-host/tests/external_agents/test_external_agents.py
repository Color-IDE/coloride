from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig
from coloride_desktop.external_agents.models import InstallationRecord
from coloride_desktop.external_agents.registry import parse_registry
from coloride_desktop.external_agents.service import ExternalAgentManager

REGISTRY = {
    "version": "1.0.0",
    "agents": [
        {
            "id": "codex-acp",
            "name": "Codex",
            "version": "2.3.0",
            "description": "ACP adapter",
            "distribution": {"npx": {"package": "@agentclientprotocol/codex-acp@2.3.0"}},
        }
    ],
}


def test_registry_parser_keeps_exact_npm_version() -> None:
    [entry] = parse_registry(REGISTRY)
    assert entry.id == "codex-acp"
    assert entry.version == "2.3.0"
    assert entry.package_spec == "@agentclientprotocol/codex-acp@2.3.0"
    assert entry.distribution_kind == "npx"


def test_install_is_not_repeated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    destination = tmp_path / "packages" / "codex-acp" / "2.3.0"
    destination.mkdir(parents=True)
    package = destination / "node_modules" / "@agentclientprotocol" / "codex-acp"
    package.mkdir(parents=True)
    (package / "package.json").write_text(
        json.dumps({"bin": {"codex-acp": "dist/index.js"}}), encoding="utf-8"
    )
    binary = package / "dist"
    binary.mkdir()
    executable = binary / "index.js"
    executable.write_text("// installed\n", encoding="utf-8")
    linked = destination / "node_modules" / ".bin"
    linked.mkdir()
    (linked / "codex-acp").write_text("#!/bin/sh\n", encoding="utf-8")

    calls: list[str] = []

    async def fail_install(*_args, **_kwargs):
        calls.append("npm")
        raise AssertionError("npm should not run for an existing verified install")

    monkeypatch.setattr(
        "coloride_desktop.external_agents.installer.asyncio.create_subprocess_exec", fail_install
    )
    app = _app(tmp_path)
    manager = app.state.external_agents
    manager.store.write_registry_cache({"payload": REGISTRY})
    record = InstallationRecord(
        id="codex-acp@2.3.0",
        agentId="codex-acp",
        name="Codex",
        version="2.3.0",
        distribution="npx",
        status="installed",
        packageSpec="@agentclientprotocol/codex-acp@2.3.0",
        executable=str(linked / "codex-acp"),
        location=str(destination),
    )
    manager.store.upsert_installation(record)
    with TestClient(app) as client:
        response = client.get("/api/external-agents/installations", headers=_auth(app))
    assert response.status_code == 200
    assert response.json()[0]["version"] == "2.3.0"
    assert calls == []


def test_ssh_workspace_is_rejected(tmp_path: Path) -> None:
    app = _app(tmp_path)
    _installed(app.state.external_agents, tmp_path)
    with TestClient(app) as client:
        response = client.post(
            "/api/external-agents/sessions",
            headers=_auth(app),
            json={
                "agentId": "codex-acp",
                "workspacePath": "ssh://example/project",
                "executionTarget": "local",
            },
        )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "external_agents.ssh"


def test_prompt_accepts_before_turn_finishes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app = _app(tmp_path)
    manager: ExternalAgentManager = app.state.external_agents
    workspace = tmp_path / "project"
    workspace.mkdir()
    _installed(manager, tmp_path)

    class Connection:
        async def prompt(self, session_id: str, text: str):
            assert text == "hello"
            from types import SimpleNamespace

            return SimpleNamespace(stop_reason="end_turn")

        async def cancel(self, session_id: str) -> None:
            return None

    async def ready(record, installation):
        record.phase = "ready"
        record.acp_session_id = "acp-1"
        manager.store.write_session(record)
        manager._connections[record.id] = Connection()

    monkeypatch.setattr(manager, "_ensure_connection", ready)
    with TestClient(app) as client:
        opened = client.post(
            "/api/external-agents/sessions",
            headers=_auth(app),
            json={"agentId": "codex-acp", "workspacePath": str(workspace), "executionTarget": "local"},
        )
        assert opened.status_code == 200
        session_id = opened.json()["id"]
        accepted = client.post(
            f"/api/external-agents/sessions/{session_id}/prompts",
            headers=_auth(app),
            json={"text": "hello"},
        )
    assert accepted.status_code == 202
    assert accepted.json()["accepted"] is True


def _app(tmp_path: Path):
    app = create_app(LaunchConfig(host="127.0.0.1", port=9, bearer_token="test-token"))
    app.state.external_agents.store.root = tmp_path
    app.state.external_agents.store.packages = tmp_path / "packages"
    app.state.external_agents.store.sessions_dir = tmp_path / "sessions"
    app.state.external_agents.store.installations_path = tmp_path / "installations.json"
    app.state.external_agents.store.registry_cache = tmp_path / "registry-cache.json"
    tmp_path.mkdir(parents=True, exist_ok=True)
    return app


def _auth(app) -> dict[str, str]:
    return {"authorization": f"Bearer {app.state.config.bearer_token}"}


def _installed(manager: ExternalAgentManager, root: Path) -> None:
    executable = root / "codex-acp"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    manager.store.upsert_installation(
        InstallationRecord(
            id="codex-acp@2.3.0",
            agentId="codex-acp",
            name="Codex",
            version="2.3.0",
            distribution="npx",
            status="installed",
            executable=str(executable),
            location=str(root),
        )
    )
