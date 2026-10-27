from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig
from coloride_desktop.profiles.secrets import InMemoryProfileSecretStore
from coloride_desktop.profiles.store import ConnectionProfile, InMemoryProfileStore, JsonProfileStore


def make_profile(*, username: str = "root") -> ConnectionProfile:
    return ConnectionProfile(
        id="prof_test",
        name="Original server",
        host="example.test",
        port=22,
        username=username,
        created_at=datetime(2026, 1, 2, tzinfo=UTC),
    )


def make_connected_app(*, username: str = "root"):
    app = create_app(LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token"))
    store = InMemoryProfileStore()
    profile = make_profile(username=username)
    app.state.profiles = store
    app.state.ssh = SimpleNamespace(
        snapshot=SimpleNamespace(profile_id=profile.id),
        connection=SimpleNamespace(is_closed=lambda: False),
    )

    class FakeFiles:
        async def stat_paths(self, paths: list[str]):
            return [{"path": path, "exists": True, "kind": "dir"} for path in paths]

    app.state.files = FakeFiles()
    return app, store, profile


@pytest.mark.asyncio
async def test_profile_name_update_is_persisted(tmp_path) -> None:
    app = create_app(LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token"))
    path = tmp_path / "profiles.json"
    secrets = InMemoryProfileSecretStore()
    store = JsonProfileStore(path, secrets)
    await store.save(make_profile())
    app.state.profiles = store

    with TestClient(app) as client:
        response = client.patch(
            "/api/profiles/prof_test",
            headers={"authorization": "Bearer test-token"},
            json={"name": "  Production API  ", "defaultWorkspace": "  /var/www/api  "},
        )

    assert response.status_code == 200
    assert response.json()["name"] == "Production API"
    assert response.json()["defaultWorkspace"] == "/var/www/api"
    reopened_store = JsonProfileStore(path, secrets)
    reopened_profile = (await reopened_store.list())[0]
    assert reopened_profile.name == "Production API"
    assert reopened_profile.default_workspace == "/var/www/api"


@pytest.mark.asyncio
async def test_profile_name_update_rejects_whitespace() -> None:
    app = create_app(LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token"))
    store = InMemoryProfileStore()
    await store.save(make_profile())
    app.state.profiles = store

    with TestClient(app) as client:
        response = client.patch(
            "/api/profiles/prof_test",
            headers={"authorization": "Bearer test-token"},
            json={"name": "   "},
        )

    assert response.status_code == 400
    assert (await store.list())[0].name == "Original server"


@pytest.mark.asyncio
async def test_profile_workspace_update_rejects_relative_path() -> None:
    app = create_app(LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token"))
    store = InMemoryProfileStore()
    await store.save(make_profile())
    app.state.profiles = store

    with TestClient(app) as client:
        response = client.patch(
            "/api/profiles/prof_test",
            headers={"authorization": "Bearer test-token"},
            json={"defaultWorkspace": "var/www/api"},
        )

    assert response.status_code == 400
    assert (await store.list())[0].default_workspace is None


@pytest.mark.asyncio
async def test_profile_runtime_preferences_are_updated() -> None:
    app = create_app(LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token"))
    store = InMemoryProfileStore()
    await store.save(make_profile())
    app.state.profiles = store

    with TestClient(app) as client:
        response = client.patch(
            "/api/profiles/prof_test",
            headers={"authorization": "Bearer test-token"},
            json={"defaultShell": "fish", "terminalPersistence": False, "monitorInterval": 10},
        )

    assert response.status_code == 200
    assert response.json()["defaultShell"] == "fish"
    assert response.json()["terminalPersistence"] is False
    assert response.json()["monitorInterval"] == 10
    profile = (await store.list())[0]
    assert profile.default_shell == "fish"
    assert profile.terminal_persistence is False
    assert profile.monitor_interval == 10


@pytest.mark.asyncio
@pytest.mark.parametrize("username", ["root", "coloride"])
async def test_open_workspace_preserves_connected_linux_user(username: str) -> None:
    app, store, profile = make_connected_app(username=username)
    await store.save(profile)

    with TestClient(app) as client:
        response = client.post(
            "/api/workspaces/open",
            headers={"authorization": "Bearer test-token"},
            json={"path": "/var/www/app", "elevate": True},
        )

    assert response.status_code == 200
    assert response.json()["path"] == "/var/www/app"
    assert response.json()["sourcePath"] == "/var/www/app"
    assert response.json()["sessionUser"] == username
    assert response.json()["elevated"] is False
    assert app.state.session_identity == {"username": username, "elevated": False}
    saved = await store.get(profile.id)
    assert saved is not None
    assert saved.default_workspace == "/var/www/app"
    assert saved.workspace_source_path == "/var/www/app"


@pytest.mark.asyncio
async def test_open_computer_workspace_uses_admin_user() -> None:
    app, store, profile = make_connected_app(username="coloride")
    profile.access_mode = "restricted"
    profile.bootstrap_profile_id = "prof_bootstrap"
    await store.save(profile)
    await store.save(
        ConnectionProfile(
            id="prof_bootstrap",
            name="Bootstrap",
            host="example.test",
            username="root",
            hidden=True,
            access_mode="restricted",
            created_at=datetime(2026, 1, 2, tzinfo=UTC),
        )
    )
    opened: list[str] = []

    async def fake_open_elevated(creds):
        opened.append(creds.username)
        app.state.ssh._elevated_username = creds.username
        return creds.username

    async def _none_async(*_args, **_kwargs):
        return None

    app.state.ssh = SimpleNamespace(
        snapshot=SimpleNamespace(profile_id=profile.id),
        connection=SimpleNamespace(is_closed=lambda: False),
        open_elevated_connection=fake_open_elevated,
        close_elevated_connection=_none_async,
        _elevated_username=None,
    )
    app.state.certs = SimpleNamespace(load_private_key=_none_async, load=_none_async)
    app.state.host_keys = SimpleNamespace(get=lambda _host, _port: None)
    app.state.session_identity = {"username": "coloride", "elevated": False}

    with TestClient(app) as client:
        computer = client.post(
            "/api/workspaces/open",
            headers={"authorization": "Bearer test-token"},
            json={"path": "/"},
        )
        home = client.post(
            "/api/workspaces/open",
            headers={"authorization": "Bearer test-token"},
            json={"path": "/home/coloride"},
        )

    assert computer.status_code == 200
    assert computer.json()["sessionUser"] == "root"
    assert computer.json()["elevated"] is True
    assert opened == ["root"]
    assert home.status_code == 200
    assert home.json()["sessionUser"] == "coloride"
    assert home.json()["elevated"] is False
    assert app.state.session_identity == {"username": "coloride", "elevated": False}


@pytest.mark.asyncio
async def test_prepare_agent_uses_direct_path_without_replacing_profile_default() -> None:
    app, store, profile = make_connected_app(username="root")
    profile.default_workspace = "/srv/default"
    await store.save(profile)

    with TestClient(app) as client:
        response = client.post(
            "/api/workspaces/prepare-agent",
            headers={"authorization": "Bearer test-token"},
            json={"path": "/root/another-project"},
        )

    assert response.status_code == 200
    assert response.json()["path"] == "/root/another-project"
    assert response.json()["sessionUser"] == "root"
    saved = await store.get(profile.id)
    assert saved is not None
    assert saved.default_workspace == "/srv/default"


@pytest.mark.asyncio
async def test_legacy_setup_restricted_does_not_provision_or_switch_user() -> None:
    app, store, profile = make_connected_app(username="root")
    profile.access_mode = "restricted"
    profile.allowed_roots = ["/home/coloride", "/tmp/coloride"]
    await store.save(profile)

    with TestClient(app) as client:
        response = client.post(
            "/api/conn/setup-restricted",
            headers={"authorization": "Bearer test-token"},
            json={},
        )

    assert response.status_code == 200
    assert response.json()["profileId"] == profile.id
    assert response.json()["username"] == "root"
    assert app.state.session_identity == {"username": "root", "elevated": False}
