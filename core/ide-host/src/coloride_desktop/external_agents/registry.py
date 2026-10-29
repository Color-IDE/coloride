"""Fetch, validate and cache the public ACP agent catalog."""

from __future__ import annotations

import platform
import re
from typing import Any

import httpx

from .models import RegistryEntryRecord
from .store import ExternalAgentStore

REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"


class RegistryError(RuntimeError):
    pass


def platform_target() -> str:
    system = {"Darwin": "darwin", "Linux": "linux", "Windows": "windows"}.get(platform.system())
    machine = platform.machine().lower()
    architecture = {
        "arm64": "aarch64",
        "aarch64": "aarch64",
        "x86_64": "x86_64",
        "amd64": "x86_64",
    }.get(machine)
    if system is None or architecture is None:
        return "unknown"
    return f"{system}-{architecture}"


def _text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def parse_distribution(raw: Any) -> tuple[str, str | None, list[str], str | None, str | None]:
    """Return kind, package spec, command, archive URL and digest for this machine."""
    if not isinstance(raw, dict) or not raw:
        raise RegistryError("Agent distribution is missing.")
    if isinstance(raw.get("npx"), dict):
        spec = _text(raw["npx"].get("package"))
        if spec is None:
            raise RegistryError("npm distribution has no package.")
        args = [str(item) for item in raw["npx"].get("args") or []]
        return "npx", spec, args, None, None
    if isinstance(raw.get("uvx"), dict):
        spec = _text(raw["uvx"].get("package"))
        if spec is None:
            raise RegistryError("uvx distribution has no package.")
        args = [str(item) for item in raw["uvx"].get("args") or []]
        return "uvx", spec, args, None, None
    binary = raw.get("binary")
    if isinstance(binary, dict):
        target = platform_target()
        entry = binary.get(target)
        if not isinstance(entry, dict):
            raise RegistryError(f"No binary distribution for {target}.")
        archive = _text(entry.get("archive"))
        command = _text(entry.get("cmd"))
        if archive is None or command is None:
            raise RegistryError("Binary distribution is incomplete.")
        args = [str(item) for item in entry.get("args") or []]
        digest = _text(entry.get("sha256"))
        return "binary", None, [command, *args], archive, digest
    raise RegistryError("Unsupported distribution.")


def parse_registry(payload: Any) -> list[RegistryEntryRecord]:
    if not isinstance(payload, dict) or not isinstance(payload.get("agents"), list):
        raise RegistryError("Registry payload is not a v1 catalog.")
    entries: list[RegistryEntryRecord] = []
    for raw in payload["agents"]:
        if not isinstance(raw, dict):
            continue
        agent_id = _text(raw.get("id"))
        version = _text(raw.get("version"))
        name = _text(raw.get("name")) or agent_id
        if (
            agent_id is None
            or version is None
            or name is None
            or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*", agent_id)
            or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._+-]*", version)
        ):
            continue
        try:
            kind, spec, command, archive, digest = parse_distribution(raw.get("distribution"))
        except RegistryError:
            continue
        distribution = raw["distribution"][kind]
        if kind == "binary":
            distribution = distribution[platform_target()]
        entries.append(
            RegistryEntryRecord(
                id=agent_id,
                name=name,
                version=version,
                description=_text(raw.get("description")) or "",
                repository=_text(raw.get("repository")),
                website=_text(raw.get("website")),
                license=_text(raw.get("license")),
                licenseUrl=_text(raw.get("license_url")),
                icon=_text(raw.get("icon")),
                distributionKind=kind,  # type: ignore[arg-type]
                packageSpec=spec,
                command=command,
                env={str(key): str(value) for key, value in (distribution.get("env") or {}).items()},
                archive_url=archive,
                archive_sha256=digest,
            )
        )
    return entries


class RegistryClient:
    def __init__(self, store: ExternalAgentStore, url: str = REGISTRY_URL) -> None:
        self.store = store
        self.url = url

    async def catalog(self, *, refresh: bool = True) -> list[RegistryEntryRecord]:
        payload = None
        if refresh:
            try:
                async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                    response = await client.get(self.url)
                    response.raise_for_status()
                    payload = response.json()
                parse_registry(payload)
                self.store.write_registry_cache({"source": self.url, "payload": payload})
            except (httpx.HTTPError, ValueError, RegistryError):
                payload = None
        if payload is None:
            cached = self.store.read_registry_cache()
            payload = cached.get("payload") if cached else None
        if payload is None:
            raise RegistryError("The ACP Registry could not be reached. Check your connection and retry.")
        return parse_registry(payload)

    async def entry(self, agent_id: str, version: str | None = None) -> RegistryEntryRecord:
        entries = await self.catalog(refresh=True)
        if not entries:
            entries = await self.catalog(refresh=False)
        match = next((item for item in entries if item.id == agent_id), None)
        if match is None:
            raise RegistryError(f"Registry has no agent {agent_id}.")
        if version and version != match.version:
            raise RegistryError(f"{agent_id} {version} is not the published stable version {match.version}.")
        return match
