from __future__ import annotations

import json
import stat
from datetime import UTC, datetime

import pytest

from coloride_desktop.profiles.secrets import InMemoryProfileSecretStore, KeyringProfileSecretStore
from coloride_desktop.profiles.store import ConnectionProfile, JsonProfileStore


def make_profile(*, profile_id: str = "prof_test", password: str | None = "secret") -> ConnectionProfile:
    return ConnectionProfile(
        id=profile_id,
        name="root@example.test",
        host="example.test",
        port=22,
        username="root",
        password=password,
        created_at=datetime(2026, 1, 2, tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_password_is_stored_in_keyring_not_json(tmp_path) -> None:
    path = tmp_path / "profiles.json"
    secrets = InMemoryProfileSecretStore()
    store = JsonProfileStore(path, secrets)

    await store.save(make_profile())

    assert await secrets.get_password("prof_test") == "secret"
    assert await store.get("prof_test") == make_profile()
    assert (await store.list())[0].password is None
    assert "password" not in path.read_text(encoding="utf-8")
    assert "secret" not in path.read_text(encoding="utf-8")
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


@pytest.mark.asyncio
async def test_plaintext_password_is_migrated_from_existing_json(tmp_path) -> None:
    path = tmp_path / "profiles.json"
    path.write_text(
        json.dumps(
            [
                {
                    "id": "prof_legacy",
                    "name": "Legacy server",
                    "host": "legacy.test",
                    "port": 2222,
                    "username": "deploy",
                    "password": "old-secret",
                    "created_at": "2026-01-02T00:00:00+00:00",
                }
            ]
        ),
        encoding="utf-8",
    )
    secrets = InMemoryProfileSecretStore()
    store = JsonProfileStore(path, secrets)

    profile = await store.get("prof_legacy")

    assert profile is not None
    assert profile.password == "old-secret"
    assert await secrets.get_password("prof_legacy") == "old-secret"
    assert "password" not in path.read_text(encoding="utf-8")
    assert "old-secret" not in path.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_legacy_null_password_field_is_removed(tmp_path) -> None:
    path = tmp_path / "profiles.json"
    path.write_text(
        json.dumps(
            [
                {
                    "id": "prof_without_password",
                    "name": "Key server",
                    "host": "keys.test",
                    "password": None,
                    "created_at": "2026-01-02T00:00:00+00:00",
                }
            ]
        ),
        encoding="utf-8",
    )
    store = JsonProfileStore(path, InMemoryProfileSecretStore())

    await store.list()

    saved = json.loads(path.read_text(encoding="utf-8"))
    assert "password" not in saved[0]


@pytest.mark.asyncio
async def test_deleting_profile_also_deletes_password(tmp_path) -> None:
    secrets = InMemoryProfileSecretStore()
    store = JsonProfileStore(tmp_path / "profiles.json", secrets)
    await store.save(make_profile())

    assert await store.delete("prof_test") is True
    assert await secrets.get_password("prof_test") is None
    assert await store.get("prof_test") is None


@pytest.mark.asyncio
async def test_server_preferences_survive_store_reopen(tmp_path) -> None:
    path = tmp_path / "profiles.json"
    secrets = InMemoryProfileSecretStore()
    profile = make_profile()
    profile.default_shell = "zsh"
    profile.terminal_persistence = False
    profile.monitor_interval = 30
    profile.access_mode = "restricted"
    profile.hidden = True
    profile.bootstrap_profile_id = "prof_bootstrap"
    profile.allowed_roots = ["/home/coloride", "/var/www/api"]

    await JsonProfileStore(path, secrets).save(profile)
    reopened = await JsonProfileStore(path, secrets).get("prof_test")

    assert reopened is not None
    assert reopened.default_shell == "zsh"
    assert reopened.terminal_persistence is False
    assert reopened.monitor_interval == 30
    assert reopened.access_mode == "restricted"
    assert reopened.hidden is True
    assert reopened.bootstrap_profile_id == "prof_bootstrap"
    assert reopened.allowed_roots == ["/home/coloride", "/var/www/api"]


class FailingSecretStore(InMemoryProfileSecretStore):
    async def save_password(self, profile_id: str, password: str) -> None:
        raise RuntimeError("Keychain unavailable")

    async def get_password(self, profile_id: str) -> str | None:
        raise RuntimeError("Keychain unavailable")


@pytest.mark.asyncio
async def test_failed_migration_preserves_legacy_password(tmp_path) -> None:
    path = tmp_path / "profiles.json"
    path.write_text(
        json.dumps(
            [
                {
                    "id": "prof_legacy",
                    "name": "Legacy server",
                    "host": "legacy.test",
                    "password": "do-not-lose",
                    "created_at": "2026-01-02T00:00:00+00:00",
                }
            ]
        ),
        encoding="utf-8",
    )
    store = JsonProfileStore(path, FailingSecretStore())

    profile = await store.get("prof_legacy")

    assert profile is not None
    assert profile.password == "do-not-lose"
    assert "do-not-lose" in path.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_keychain_read_failure_is_not_treated_as_missing_password(tmp_path) -> None:
    path = tmp_path / "profiles.json"
    path.write_text(
        json.dumps(
            [
                {
                    "id": "prof_secure",
                    "name": "Secure server",
                    "host": "secure.test",
                    "created_at": "2026-01-02T00:00:00+00:00",
                }
            ]
        ),
        encoding="utf-8",
    )
    store = JsonProfileStore(path, FailingSecretStore())

    with pytest.raises(RuntimeError, match="Keychain unavailable"):
        await store.get("prof_secure")


@pytest.mark.asyncio
async def test_keyring_secret_is_read_once_per_sidecar_session(monkeypatch) -> None:
    calls: list[tuple[str, str]] = []

    def get_password(service: str, account: str) -> str:
        calls.append((service, account))
        return "secret"

    monkeypatch.setattr("coloride_desktop.profiles.secrets.keyring.get_password", get_password)
    store = KeyringProfileSecretStore()

    assert await store.get_password("prof_test") == "secret"
    assert await store.get_password("prof_test") == "secret"

    assert calls == [("coloride-profiles", "prof_test:password")]
