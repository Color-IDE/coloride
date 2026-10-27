from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol

from .secrets import KeyringProfileSecretStore, ProfileSecretStore

ProductionAccess = Literal["always-ask", "allow-approved"]
ProductionRuntimeKind = Literal["none", "pm2", "systemd", "docker-compose", "custom"]


def default_production_capabilities() -> dict[str, bool]:
    return {
        "deploy": True,
        "logs": True,
        "restart": False,
        "pm2": False,
        "systemd": False,
        "nginx": False,
        "docker": False,
    }


def normalize_production_capabilities(raw: object) -> dict[str, bool]:
    defaults = default_production_capabilities()
    if not isinstance(raw, dict):
        return defaults
    next_value = dict(defaults)
    for key in defaults:
        if key in raw:
            next_value[key] = bool(raw[key])
    return next_value


def normalize_production_runtime(raw: object) -> dict[str, str]:
    data = raw if isinstance(raw, dict) else {}
    kind = str(data.get("kind") or "none").strip().lower()
    if kind not in {"none", "pm2", "systemd", "docker-compose", "custom"}:
        kind = "none"
    return {
        "kind": kind,
        "process": str(data.get("process") or "").strip()[:120],
        "buildCommand": str(data.get("buildCommand") or data.get("build_command") or "").strip()[:400],
        "healthCheck": str(data.get("healthCheck") or data.get("health_check") or "").strip()[:400],
        "customCommand": str(data.get("customCommand") or data.get("custom_command") or "").strip()[:400],
    }


@dataclass(slots=True)
class ConnectionProfile:
    """Internal representation for connection details.
    Passwords are hydrated from the OS keyring only when a profile is opened.
    M1+: private_key + certificate (SSH user cert) instead of password.
    """

    id: str
    name: str
    host: str
    port: int = 22
    username: str = "root"
    password: str | None = None
    # M1+ cert path (stored as text; real impl will use keyring)
    private_key: str | None = None
    certificate: str | None = None
    default_workspace: str | None = None
    # Environment remains metadata. Both paths refer to the folder selected by
    # the user and every operation uses this profile's SSH username.
    workspace_environment: Literal["development", "production"] = "development"
    workspace_source_path: str | None = None
    # Production authorization is independent of agent autonomy (Request / Agent / Full).
    production_access: ProductionAccess = "always-ask"
    production_capabilities: dict[str, bool] = field(default_factory=default_production_capabilities)
    production_runtime: dict[str, str] = field(default_factory=lambda: normalize_production_runtime(None))
    default_shell: str = "default"
    terminal_persistence: bool = True
    monitor_interval: int = 5
    access_mode: Literal["bootstrap", "restricted"] = "bootstrap"
    hidden: bool = False
    bootstrap_profile_id: str | None = None
    allowed_roots: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class ProfileStore(Protocol):
    async def list(self) -> list[ConnectionProfile]: ...

    async def get(self, profile_id: str) -> ConnectionProfile | None: ...

    async def save(self, profile: ConnectionProfile) -> None: ...

    async def delete(self, profile_id: str) -> bool: ...


class InMemoryProfileStore:
    def __init__(self) -> None:
        self._profiles: dict[str, ConnectionProfile] = {}

    async def list(self) -> list[ConnectionProfile]:
        return list(self._profiles.values())

    async def get(self, profile_id: str) -> ConnectionProfile | None:
        return self._profiles.get(profile_id)

    async def save(self, profile: ConnectionProfile) -> None:
        self._profiles[profile.id] = profile

    async def delete(self, profile_id: str) -> bool:
        return self._profiles.pop(profile_id, None) is not None


class JsonProfileStore:
    """Small local profile store.

    Only non-secret connection metadata is persisted in JSON. Passwords are
    stored in the OS keyring and hydrated only by get().
    """

    def __init__(
        self,
        path: Path | None = None,
        secret_store: ProfileSecretStore | None = None,
    ) -> None:
        self._path = path or Path.home() / ".coloride" / "desktop" / "profiles.json"
        self._secrets = secret_store or KeyringProfileSecretStore()
        self._profiles: dict[str, ConnectionProfile] | None = None
        # Kept only when an old plaintext password could not be moved to Keychain.
        self._pending_legacy_passwords: dict[str, str] = {}

    async def _load(self) -> dict[str, ConnectionProfile]:
        if self._profiles is not None:
            return self._profiles

        if not self._path.exists():
            self._profiles = {}
            return self._profiles

        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except Exception:
            self._profiles = {}
            return self._profiles

        profiles: dict[str, ConnectionProfile] = {}
        needs_rewrite = False
        for item in raw if isinstance(raw, list) else []:
            try:
                created_at = datetime.fromisoformat(item["created_at"])
                profile_id = item["id"]
                needs_rewrite = needs_rewrite or "password" in item
                legacy_password = item.get("password")
                if legacy_password:
                    try:
                        await self._secrets.save_password(profile_id, legacy_password)
                    except Exception:
                        # Never remove the only copy of a credential when Keychain
                        # is unavailable. A later app launch will retry migration.
                        self._pending_legacy_passwords[profile_id] = legacy_password

                profiles[profile_id] = ConnectionProfile(
                    id=profile_id,
                    name=item["name"],
                    host=item["host"],
                    port=int(item.get("port", 22)),
                    username=item.get("username", "root"),
                    password=None,
                    private_key=None,
                    certificate=None,
                    default_workspace=item.get("default_workspace"),
                    workspace_environment=(
                        "production"
                        if item.get("workspace_environment") == "production"
                        else "development"
                    ),
                    workspace_source_path=item.get("workspace_source_path")
                    or item.get("default_workspace"),
                    production_access=(
                        "allow-approved"
                        if item.get("production_access") == "allow-approved"
                        else "always-ask"
                    ),
                    production_capabilities=normalize_production_capabilities(
                        item.get("production_capabilities")
                    ),
                    production_runtime=normalize_production_runtime(
                        item.get("production_runtime")
                    ),
                    default_shell=item.get("default_shell", "default"),
                    terminal_persistence=bool(item.get("terminal_persistence", True)),
                    monitor_interval=int(item.get("monitor_interval", 5)),
                    access_mode=(
                        "restricted"
                        if item.get("access_mode") == "restricted"
                        else "bootstrap"
                    ),
                    hidden=bool(item.get("hidden", False)),
                    bootstrap_profile_id=item.get("bootstrap_profile_id"),
                    allowed_roots=[
                        str(root)
                        for root in item.get("allowed_roots", [])
                        if isinstance(root, str) and root.startswith("/")
                    ],
                    created_at=created_at,
                )
            except Exception:
                continue
        self._profiles = profiles
        if needs_rewrite:
            await self._save_all()
        return profiles

    async def _save_all(self) -> None:
        profiles = await self._load()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = []
        for profile in profiles.values():
            item = {
                "id": profile.id,
                "name": profile.name,
                "host": profile.host,
                "port": profile.port,
                "username": profile.username,
                "default_workspace": profile.default_workspace,
                "workspace_environment": profile.workspace_environment,
                "workspace_source_path": profile.workspace_source_path,
                "production_access": profile.production_access,
                "production_capabilities": profile.production_capabilities,
                "production_runtime": profile.production_runtime,
                "default_shell": profile.default_shell,
                "terminal_persistence": profile.terminal_persistence,
                "monitor_interval": profile.monitor_interval,
                "access_mode": profile.access_mode,
                "hidden": profile.hidden,
                "bootstrap_profile_id": profile.bootstrap_profile_id,
                "allowed_roots": profile.allowed_roots,
                "created_at": profile.created_at.isoformat(),
            }
            legacy_password = self._pending_legacy_passwords.get(profile.id)
            if legacy_password is not None:
                item["password"] = legacy_password
            data.append(item)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
        os.chmod(tmp, 0o600)
        tmp.replace(self._path)
        os.chmod(self._path, 0o600)

    async def list(self) -> list[ConnectionProfile]:
        return list((await self._load()).values())

    async def get(self, profile_id: str) -> ConnectionProfile | None:
        profile = (await self._load()).get(profile_id)
        if profile is None:
            return None

        try:
            password = await self._secrets.get_password(profile_id)
        except Exception:
            legacy_password = self._pending_legacy_passwords.get(profile_id)
            if legacy_password is None:
                raise
            password = legacy_password
        else:
            password = password or self._pending_legacy_passwords.get(profile_id)
        return replace(profile, password=password)

    async def save(self, profile: ConnectionProfile) -> None:
        profiles = await self._load()
        if profile.password is not None:
            await self._secrets.save_password(profile.id, profile.password)
            self._pending_legacy_passwords.pop(profile.id, None)
        profiles[profile.id] = replace(profile, password=None)
        await self._save_all()

    async def delete(self, profile_id: str) -> bool:
        profiles = await self._load()
        if profile_id not in profiles:
            return False
        await self._secrets.delete_password(profile_id)
        del profiles[profile_id]
        self._pending_legacy_passwords.pop(profile_id, None)
        await self._save_all()
        return True


def generate_profile_id() -> str:
    return "prof_" + secrets.token_hex(8)


def make_dev_profile_from_pair(
    host: str,
    port: int,
    phrase: str,
    username: str = "root",
) -> ConnectionProfile:
    """M0 helper: treat the 'phrase' as the password for direct password auth.
    In real flow this will do keygen + cert enrollment instead.
    """
    pid = generate_profile_id()
    return ConnectionProfile(
        id=pid,
        name=f"{username}@{host}",
        host=host,
        port=port,
        username=username,
        password=phrase or None,
        created_at=datetime.now(UTC),
    )


def make_cert_profile(
    host: str,
    port: int,
    private_key: str,
    certificate: str,
    username: str = "root",
) -> ConnectionProfile:
    """M1+ helper: create a profile that will connect using SSH user certificate."""
    pid = generate_profile_id()
    return ConnectionProfile(
        id=pid,
        name=f"{username}@{host}",
        host=host,
        port=port,
        username=username,
        private_key=private_key,
        certificate=certificate,
        created_at=datetime.now(UTC),
    )
