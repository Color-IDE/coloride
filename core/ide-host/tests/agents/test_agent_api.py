from __future__ import annotations

import base64
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from coloride_desktop.agents.config import AgentConfigStore, InMemoryAgentSecretStore
from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig
from coloride_desktop.files.local import WorkspaceFileService


def test_agent_config_api_persists_secret_outside_json(tmp_path) -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    path = tmp_path / "agent-config.json"
    secrets = InMemoryAgentSecretStore()
    app.state.agent_config = AgentConfigStore(
        path=path,
        secrets=secrets,
        environ={"COLORIDE_MANAGED_LLM": "0"},
    )

    with TestClient(app) as client:
        update = client.put(
            "/api/agents/config",
            headers={"authorization": "Bearer test-token"},
            json={
                "provider": "openai",
                "model": "coloride-test-model",
                "apiKey": "sk-never-return-this",
            },
        )
        current = client.get(
            "/api/agents/config",
            headers={"authorization": "Bearer test-token"},
        )

    assert update.status_code == 200
    assert update.json() == {
        "provider": "openai",
        "model": "coloride-test-model",
        "baseUrl": "https://api.openai.com/v1",
        "configured": True,
        "availability": "available",
        "credentialSource": "keychain",
        "managedLlm": False,
        "capabilities": {
            "tools": False,
            "streaming": True,
            "encryptedReasoning": True,
            # Unknown OpenAI model name → default 128k window.
            "maxContextCharacters": 348_160,
            "maxContextTokens": 128_000,
            "maxRetries": 3,
        },
    }
    assert current.json() == update.json()
    assert "sk-never-return-this" not in update.text
    assert "sk-never-return-this" not in path.read_text(encoding="utf-8")
    assert json.loads(path.read_text(encoding="utf-8"))["model"] == "coloride-test-model"


def test_agent_config_api_requires_desktop_token(tmp_path) -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    app.state.agent_config = AgentConfigStore(
        path=tmp_path / "agent-config.json",
        secrets=InMemoryAgentSecretStore(),
        environ={"COLORIDE_MANAGED_LLM": "0"},
    )

    with TestClient(app) as client:
        response = client.get("/api/agents/config")

    assert response.status_code == 401


def test_agent_debug_log_api_returns_entries(tmp_path) -> None:
    from coloride_desktop.agents.debug_log import agent_debug, configure_agent_debug_log

    log_path = tmp_path / "agent-debug.log"
    configure_agent_debug_log(log_path, enabled=True)
    agent_debug("turn_started", sessionId="sess_log")
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    try:
        with TestClient(app) as client:
            denied = client.get("/api/agents/debug-log")
            response = client.get(
                "/api/agents/debug-log",
                headers={"authorization": "Bearer test-token"},
            )
    finally:
        configure_agent_debug_log(None)

    assert denied.status_code == 401
    assert response.status_code == 200
    body = response.json()
    assert body["path"] == str(log_path)
    assert any(entry.get("msg") == "turn_started" for entry in body["entries"])


def test_agent_config_api_supports_xai(tmp_path) -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    app.state.agent_config = AgentConfigStore(
        path=tmp_path / "agent-config.json",
        secrets=InMemoryAgentSecretStore(),
        environ={"COLORIDE_MANAGED_LLM": "0"},
    )

    with TestClient(app) as client:
        response = client.put(
            "/api/agents/config",
            headers={"authorization": "Bearer test-token"},
            json={
                "provider": "xai",
                "model": "grok-4.5",
                "apiKey": "xai-never-return-this",
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "provider": "xai",
        "model": "grok-4.5",
        "baseUrl": "https://api.x.ai/v1",
        "configured": True,
        "availability": "available",
        "credentialSource": "keychain",
        "managedLlm": False,
        "capabilities": {
            "tools": True,
            "streaming": True,
            "encryptedReasoning": True,
            "maxContextCharacters": 1_360_000,
            "maxContextTokens": 500_000,
            "maxRetries": 3,
        },
    }
    assert "xai-never-return-this" not in response.text


def test_agent_config_api_supports_fireworks(tmp_path) -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    app.state.agent_config = AgentConfigStore(
        path=tmp_path / "agent-config.json",
        secrets=InMemoryAgentSecretStore(),
        environ={"COLORIDE_MANAGED_LLM": "0"},
    )

    with TestClient(app) as client:
        response = client.put(
            "/api/agents/config",
            headers={"authorization": "Bearer test-token"},
            json={
                "provider": "fireworks",
                "model": "accounts/fireworks/models/kimi-k3",
                "apiKey": "fw-never-return-this",
            },
        )

    assert response.status_code == 200
    assert response.json()["provider"] == "fireworks"
    assert response.json()["baseUrl"] == "https://api.fireworks.ai/inference/v1"
    assert response.json()["configured"] is True
    assert "fw-never-return-this" not in response.text


def test_agent_config_api_supports_gemini(tmp_path) -> None:
    from coloride_desktop.agents.cloud_token import clear_cloud_access_token, set_cloud_access_token

    clear_cloud_access_token()
    set_cloud_access_token("user-jwt-gemini")
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    app.state.agent_config = AgentConfigStore(
        path=tmp_path / "agent-config.json",
        secrets=InMemoryAgentSecretStore(),
        environ={"COLORIDE_MANAGED_LLM": "1"},
    )
    try:
        with TestClient(app) as client:
            response = client.put(
                "/api/agents/config",
                headers={"authorization": "Bearer test-token"},
                json={"provider": "gemini", "model": "gemini-3.7-flash"},
            )

        assert response.status_code == 200
        assert response.json()["provider"] == "gemini"
        assert response.json()["baseUrl"] == "https://generativelanguage.googleapis.com/v1beta"
        assert response.json()["managedLlm"] is True
        assert response.json()["credentialSource"] == "coloride"
    finally:
        clear_cloud_access_token()


def test_agent_start_allows_server_scope_on_browse_root() -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    started: dict[str, object] = {}

    class FakeAgents:
        async def start_session(self, **kwargs):
            started.update(kwargs)
            return "sess_server"

    class FakeProfiles:
        async def get(self, _profile_id: str):
            return SimpleNamespace(
                id="prof_server",
                access_mode="restricted",
                allowed_roots=["/home/coloride", "/tmp/coloride"],
            )

    app.state.agents = FakeAgents()
    app.state.profiles = FakeProfiles()
    app.state.ssh = SimpleNamespace(
        snapshot=SimpleNamespace(profile_id="prof_server"),
        connection=SimpleNamespace(is_closed=lambda: False),
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/agents/session/start",
            headers={"authorization": "Bearer test-token"},
            json={
                "agent": "coloride",
                "cwd": "/var/www",
                "workspaceKind": "ssh",
                "connectionId": "prof_server",
                "filesystemScope": "server",
            },
        )

    assert response.status_code == 200
    assert response.json()["sessionId"] == "sess_server"
    assert started["filesystem_scope"] == "server"
    assert started["cwd"] == "/var/www"


def test_agent_start_accepts_any_path_available_to_connected_user() -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )

    started: dict[str, object] = {}

    class FakeAgents:
        async def start_session(self, **kwargs):
            started.update(kwargs)
            return "sess_direct"

    class FakeProfiles:
        async def get(self, _profile_id: str):
            return SimpleNamespace(
                id="prof_server",
                access_mode="restricted",
                allowed_roots=["/home/coloride", "/tmp/coloride"],
            )

    app.state.agents = FakeAgents()
    app.state.profiles = FakeProfiles()
    app.state.ssh = SimpleNamespace(
        snapshot=SimpleNamespace(profile_id="prof_server"),
        connection=SimpleNamespace(is_closed=lambda: False),
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/agents/session/start",
            headers={"authorization": "Bearer test-token"},
            json={
                "agent": "coloride",
                "cwd": "/etc/secret-app",
                "workspaceKind": "ssh",
                "connectionId": "prof_server",
                "filesystemScope": "workspace",
            },
        )

    assert response.status_code == 200
    assert response.json()["sessionId"] == "sess_direct"
    assert started["cwd"] == "/etc/secret-app"


def test_agent_send_does_not_depend_on_legacy_workspace_grants() -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )

    class FakeAgents:
        async def get_session(self, _session_id: str):
            return SimpleNamespace(
                workspace_kind="ssh",
                connection_id="prof_server",
                cwd="/etc/revoked",
                filesystem_scope="workspace",
            )

        async def send(self, *_args, **_kwargs):
            return True

    class FakeProfiles:
        async def get(self, _profile_id: str):
            return SimpleNamespace(
                id="prof_server",
                access_mode="restricted",
                allowed_roots=["/home/coloride", "/tmp/coloride"],
            )

    app.state.agents = FakeAgents()
    app.state.profiles = FakeProfiles()
    app.state.ssh = SimpleNamespace(
        snapshot=SimpleNamespace(profile_id="prof_server"),
        connection=SimpleNamespace(is_closed=lambda: False),
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/agents/session/send",
            headers={"authorization": "Bearer test-token"},
            json={"sessionId": "sess_revoked", "message": "continue"},
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_agent_send_keeps_open_anyway_live_workspace() -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    sent: list[str] = []

    class FakeAgents:
        async def get_session(self, _session_id: str):
            return SimpleNamespace(
                workspace_kind="ssh",
                connection_id="prof_server",
                cwd="/var/www/coloride/sites/www",
                filesystem_scope="workspace",
            )

        async def send(self, session_id: str, message: str, **_kwargs):
            sent.append(f"{session_id}:{message}")
            return True

    class FakeProfiles:
        async def get(self, _profile_id: str):
            return SimpleNamespace(
                id="prof_server",
                access_mode="restricted",
                bootstrap_profile_id="prof_bootstrap",
                default_workspace="/var/www/coloride/sites/www",
                workspace_source_path="/var/www/coloride/sites/www",
                allowed_roots=["/home/coloride", "/tmp/coloride"],
            )

    app.state.agents = FakeAgents()
    app.state.profiles = FakeProfiles()
    app.state.ssh = SimpleNamespace(
        snapshot=SimpleNamespace(profile_id="prof_server"),
        connection=SimpleNamespace(is_closed=lambda: False),
    )
    app.state.session_identity = {"username": "coloride", "elevated": False}

    with TestClient(app) as client:
        response = client.post(
            "/api/agents/session/send",
            headers={"authorization": "Bearer test-token"},
            json={"sessionId": "sess_live", "message": "continue"},
        )

    assert response.status_code == 200
    assert sent == ["sess_live:continue"]


@pytest.mark.asyncio
async def test_agent_send_keeps_coloride_user_for_coloride_home_workspace() -> None:
    from coloride_desktop.profiles.store import ConnectionProfile, InMemoryProfileStore

    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    store = InMemoryProfileStore()
    await store.save(
        ConnectionProfile(
            id="prof_restricted",
            name="Server",
            host="example.test",
            username="coloride",
            access_mode="restricted",
            bootstrap_profile_id="prof_bootstrap",
            default_workspace="/home/coloride",
            allowed_roots=["/home/coloride", "/tmp/coloride"],
        )
    )
    await store.save(
        ConnectionProfile(
            id="prof_bootstrap",
            name="Bootstrap",
            host="example.test",
            username="root",
            hidden=True,
            access_mode="restricted",
        )
    )
    opened: list[str] = []

    class FakeAgents:
        async def get_session(self, _session_id: str):
            return SimpleNamespace(
                workspace_kind="ssh",
                connection_id="prof_restricted",
                cwd="/home/coloride",
                filesystem_scope="server",
                preferred_linux_user="admin",
            )

        async def send(self, session_id: str, message: str, **_kwargs):
            return True

    async def fake_open_elevated(creds):
        opened.append(creds.username)
        app.state.ssh._elevated_username = creds.username
        return creds.username

    async def _none_async(*_args, **_kwargs):
        return None

    app.state.agents = FakeAgents()
    app.state.profiles = store
    app.state.ssh = SimpleNamespace(
        snapshot=SimpleNamespace(profile_id="prof_restricted"),
        connection=SimpleNamespace(is_closed=lambda: False),
        open_elevated_connection=fake_open_elevated,
        close_elevated_connection=_none_async,
        _elevated_username=None,
    )
    app.state.certs = SimpleNamespace(
        load_private_key=_none_async,
        load=_none_async,
    )
    app.state.host_keys = SimpleNamespace(get=lambda _host, _port: None)
    app.state.session_identity = {"username": "coloride", "elevated": False}

    with TestClient(app) as client:
        response = client.post(
            "/api/agents/session/send",
            headers={"authorization": "Bearer test-token"},
            json={"sessionId": "sess_admin", "message": "continue"},
        )

    assert response.status_code == 200
    # The open folder owner wins over a stale chat preference. A safe Coloride
    # workspace must never silently reopen the bootstrap/root connection.
    assert opened == []
    assert app.state.session_identity == {"username": "coloride", "elevated": False}


@pytest.mark.asyncio
async def test_agent_open_keeps_coloride_user_for_coloride_home_workspace() -> None:
    from datetime import UTC, datetime

    from coloride_desktop.models import SessionSummary
    from coloride_desktop.profiles.store import ConnectionProfile, InMemoryProfileStore

    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    store = InMemoryProfileStore()
    await store.save(
        ConnectionProfile(
            id="prof_restricted",
            name="Server",
            host="example.test",
            username="coloride",
            access_mode="restricted",
            bootstrap_profile_id="prof_bootstrap",
            default_workspace="/home/coloride",
            allowed_roots=["/home/coloride", "/tmp/coloride"],
        )
    )
    await store.save(
        ConnectionProfile(
            id="prof_bootstrap",
            name="Bootstrap",
            host="example.test",
            username="root",
            hidden=True,
            access_mode="restricted",
        )
    )
    opened: list[str] = []
    now = datetime.now(UTC)

    class FakeAgents:
        async def get_session(self, _session_id: str):
            return SessionSummary(
                sessionId="sess_admin",
                agent="coloride",
                task="continue",
                cwd="/home/coloride",
                workspaceKind="ssh",
                connectionId="prof_restricted",
                filesystemScope="server",
                mode="act",
                state="idle",
                spentUsd=0.0,
                preferredLinuxUser="admin",
                startedAt=now,
                updatedAt=now,
            )

        async def list_events(self, _session_id: str, **_kwargs):
            return []

    async def fake_open_elevated(creds):
        opened.append(creds.username)
        app.state.ssh._elevated_username = creds.username
        return creds.username

    async def _none_async(*_args, **_kwargs):
        return None

    app.state.agents = FakeAgents()
    app.state.profiles = store
    app.state.ssh = SimpleNamespace(
        snapshot=SimpleNamespace(profile_id="prof_restricted"),
        connection=SimpleNamespace(is_closed=lambda: False),
        open_elevated_connection=fake_open_elevated,
        close_elevated_connection=_none_async,
        _elevated_username=None,
    )
    app.state.certs = SimpleNamespace(
        load_private_key=_none_async,
        load=_none_async,
    )
    app.state.host_keys = SimpleNamespace(get=lambda _host, _port: None)
    app.state.session_identity = {"username": "coloride", "elevated": False}

    with TestClient(app) as client:
        response = client.get(
            "/api/agents/sessions/sess_admin",
            headers={"authorization": "Bearer test-token"},
        )
        events = client.get(
            "/api/agents/sessions/sess_admin/events",
            headers={"authorization": "Bearer test-token"},
        )

    assert response.status_code == 200
    assert events.status_code == 200
    assert opened == []
    assert app.state.session_identity == {"username": "coloride", "elevated": False}


def test_agent_send_keeps_open_srv_workspace() -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    sent: list[str] = []

    class FakeAgents:
        async def get_session(self, _session_id: str):
            return SimpleNamespace(
                workspace_kind="ssh",
                connection_id="prof_server",
                cwd="/srv/www/app",
                filesystem_scope="workspace",
            )

        async def send(self, session_id: str, message: str, **_kwargs):
            sent.append(f"{session_id}:{message}")
            return True

    class FakeProfiles:
        async def get(self, _profile_id: str):
            return SimpleNamespace(
                id="prof_server",
                access_mode="restricted",
                bootstrap_profile_id="prof_bootstrap",
                default_workspace="/srv/www/app",
                workspace_source_path="/srv/www/app",
                allowed_roots=["/home/coloride", "/tmp/coloride"],
            )

    app.state.agents = FakeAgents()
    app.state.profiles = FakeProfiles()
    app.state.ssh = SimpleNamespace(
        snapshot=SimpleNamespace(profile_id="prof_server"),
        connection=SimpleNamespace(is_closed=lambda: False),
    )
    app.state.session_identity = {"username": "coloride", "elevated": False}

    with TestClient(app) as client:
        response = client.post(
            "/api/agents/session/send",
            headers={"authorization": "Bearer test-token"},
            json={"sessionId": "sess_srv", "message": "continue"},
        )

    assert response.status_code == 200
    assert sent == ["sess_srv:continue"]


def test_agent_start_rejects_closed_ssh_connection() -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )

    class FakeAgents:
        async def start_session(self, **_kwargs):
            raise AssertionError("A closed SSH connection must fail before session creation")

    class FakeProfiles:
        async def get(self, _profile_id: str):
            return SimpleNamespace(
                id="prof_server",
                access_mode="restricted",
                allowed_roots=["/var/www/app"],
            )

    app.state.agents = FakeAgents()
    app.state.profiles = FakeProfiles()
    app.state.ssh = SimpleNamespace(
        snapshot=SimpleNamespace(profile_id="prof_server"),
        connection=SimpleNamespace(is_closed=lambda: True),
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/agents/session/start",
            headers={"authorization": "Bearer test-token"},
            json={
                "agent": "coloride",
                "cwd": "/var/www/app",
                "workspaceKind": "ssh",
                "connectionId": "prof_server",
            },
        )

    assert response.status_code == 403
    assert response.json()["code"] == "agents.workspace_not_authorized"


def test_agent_start_missing_local_workspace_is_invalid_request(tmp_path) -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/agents/session/start",
            headers={"authorization": "Bearer test-token"},
            json={
                "agent": "coloride",
                "cwd": str(tmp_path / "missing"),
                "workspaceKind": "local",
                "connectionId": "local",
            },
        )

    assert response.status_code == 400
    assert response.json()["code"] == "agents.invalid_request"


def test_agent_session_files_use_local_chat_root_not_global_workspace(tmp_path) -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )
    global_root = tmp_path / "global"
    chat_root = tmp_path / "chat"
    global_root.mkdir()
    chat_root.mkdir()
    files = WorkspaceFileService(object())
    files.use_local(str(global_root))
    app.state.files = files
    (chat_root / "outside-link").symlink_to(global_root, target_is_directory=True)

    class FakeAgents:
        async def get_session(self, _session_id: str):
            return SimpleNamespace(
                session_id="sess_local",
                workspace_kind="local",
                connection_id="local",
                cwd=str(chat_root),
            )

    app.state.agents = FakeAgents()
    target = chat_root / "note.txt"
    encoded = base64.b64encode(b"chat scoped").decode("ascii")

    with TestClient(app) as client:
        written = client.post(
            "/api/agents/sessions/sess_local/files/write",
            headers={"authorization": "Bearer test-token"},
            json={"path": str(target), "content": encoded},
        )
        read = client.post(
            "/api/agents/sessions/sess_local/files/read",
            headers={"authorization": "Bearer test-token"},
            json={"path": str(target)},
        )
        outside = client.post(
            "/api/agents/sessions/sess_local/files/write",
            headers={"authorization": "Bearer test-token"},
            json={"path": str(global_root / "escape.txt"), "content": encoded},
        )
        symlink_escape = client.post(
            "/api/agents/sessions/sess_local/files/write",
            headers={"authorization": "Bearer test-token"},
            json={"path": str(chat_root / "outside-link" / "escape.txt"), "content": encoded},
        )

    assert written.status_code == 200
    assert read.status_code == 200
    assert base64.b64decode(read.json()["content"]) == b"chat scoped"
    assert target.read_text() == "chat scoped"
    assert outside.status_code == 403
    assert outside.json()["code"] == "agents.file_outside_workspace"
    assert symlink_escape.status_code == 403
    assert symlink_escape.json()["code"] == "agents.file_outside_workspace"
    assert not (global_root / "escape.txt").exists()


def test_agent_session_files_reject_different_ssh_connection() -> None:
    app = create_app(
        LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    )

    class FakeAgents:
        async def get_session(self, _session_id: str):
            return SimpleNamespace(
                session_id="sess_ssh",
                workspace_kind="ssh",
                connection_id="prof_other_server",
                cwd="/etc/app",
                filesystem_scope="workspace",
            )

    class FakeProfiles:
        async def get(self, _profile_id: str):
            return SimpleNamespace(
                id="prof_server",
                access_mode="restricted",
                allowed_roots=["/home/coloride", "/tmp/coloride"],
            )

    app.state.agents = FakeAgents()
    app.state.profiles = FakeProfiles()
    app.state.ssh = SimpleNamespace(
        snapshot=SimpleNamespace(profile_id="prof_server"),
        connection=SimpleNamespace(is_closed=lambda: False),
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/agents/sessions/sess_ssh/files/read",
            headers={"authorization": "Bearer test-token"},
            json={"path": "/etc/app/file.txt"},
        )

    assert response.status_code == 403
    assert response.json()["code"] == "agents.workspace_not_authorized"


def test_chat_history_api_is_authenticated_scoped_and_searches_content(tmp_path):
    from coloride_desktop.agents.client import AgentProxyClient
    from coloride_desktop.agents.domain import AgentSession, AgentMode
    from coloride_desktop.agents.store import AgentSessionStore
    store = AgentSessionStore(tmp_path / "sessions")
    local = AgentSession.create(agent="coloride", cwd="/project", mode=AgentMode.ACT, workspace_kind="local")
    remote = AgentSession.create(agent="coloride", cwd="/remote", mode=AgentMode.ACT, workspace_kind="ssh", connection_id="server-a")
    for session in (local, remote):
        store.save_session(session)
        store.append_event(session.session_id, "user_message", {"text": "Investigate OpenSky"})
    app = create_app(LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token"))
    app.state.agents = AgentProxyClient(store=store)
    with TestClient(app) as client:
        assert client.get("/api/agents/sessions/history?workspaceKind=local").status_code == 401
        response = client.get("/api/agents/sessions/history?workspaceKind=local&q=OpenSky", headers={"authorization":"Bearer test-token"})
        assert response.status_code == 200
        assert len(response.json()) == 1
        assert response.json()[0]["sessionId"] == local.session_id
        assert response.json()[0]["firstMessage"] == "Investigate OpenSky"
        assert response.json()[0]["matches"] is True
