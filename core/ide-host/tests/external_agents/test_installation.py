from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from coloride_desktop.external_agents.installer import ExternalAgentInstaller
from coloride_desktop.external_agents.models import RegistryEntryRecord
from coloride_desktop.external_agents.registry import RegistryClient, RegistryError, parse_registry
from coloride_desktop.external_agents.runtimes import RuntimeMissing, extract_archive, resolve_npm
from coloride_desktop.external_agents.store import ExternalAgentStore


def test_registry_rejects_paths_and_retains_launch_environment():
    entries = parse_registry(
        {
            "agents": [
                {
                    "id": "../bad",
                    "name": "Bad",
                    "version": "1",
                    "distribution": {"npx": {"package": "bad@1.0.0"}},
                },
                {
                    "id": "good",
                    "name": "Good",
                    "version": "1.0.0",
                    "website": "https://example.org",
                    "distribution": {
                        "npx": {"package": "good@1.0.0", "args": ["acp"], "env": {"ACP_MODE": "1"}}
                    },
                },
            ]
        }
    )
    assert len(entries) == 1
    assert entries[0].command == ["acp"]
    assert entries[0].env == {"ACP_MODE": "1"}
    assert entries[0].website == "https://example.org"


@pytest.mark.asyncio
async def test_existing_verified_install_does_not_run_package_manager(tmp_path, monkeypatch):
    store = ExternalAgentStore(tmp_path)
    installer = ExternalAgentInstaller(store)
    entry = RegistryEntryRecord(
        id="test", name="Test", version="1.0.0", distributionKind="npx", packageSpec="test@1.0.0"
    )
    destination = installer.destination(entry.id, entry.version)
    package = destination / "node_modules/test"
    package.mkdir(parents=True)
    (package / "package.json").write_text(json.dumps({"bin": {"test": "index.js"}}))
    (package / "index.js").write_text("console.log('test');")

    async def no_install(*args):
        raise AssertionError("An existing installation must be reused")

    monkeypatch.setattr(installer, "_install_into", no_install)
    record = await installer.install(entry)
    assert record.status == "installed"
    assert Path(record.executable).is_file()


def test_zip_archive_cannot_escape_installation(tmp_path):
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("../outside", "unsafe")
    with pytest.raises(RuntimeMissing):
        extract_archive(archive, tmp_path / "extract", zip_format=True)
    assert not (tmp_path / "outside").exists()


def test_npm_resolver_does_not_accept_pnpm_as_npm(tmp_path, monkeypatch):
    node = tmp_path / "node"
    node.write_text("node")
    pnpm = tmp_path / "pnpm.cjs"
    pnpm.write_text("pnpm")
    npm = tmp_path / "lib/node_modules/npm/bin/npm-cli.js"
    npm.parent.mkdir(parents=True)
    npm.write_text("npm")
    # Resolver supports Node installed in prefix/bin alongside prefix/lib/npm.
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "node").write_text("node")
    monkeypatch.setenv("COLORIDE_NODE", str(bindir / "node"))
    monkeypatch.setenv("COLORIDE_NPM", str(pnpm))
    command = resolve_npm()
    assert command.executable == str(bindir / "node")
    assert command.prefix == (str(npm),)


@pytest.mark.asyncio
async def test_invalid_remote_registry_does_not_replace_valid_offline_cache(tmp_path, monkeypatch):
    import httpx

    store = ExternalAgentStore(tmp_path)
    payload = {
        "agents": [
            {
                "id": "cached",
                "name": "Cached",
                "version": "1",
                "distribution": {"npx": {"package": "cached@1.0.0"}},
            }
        ]
    }
    store.write_registry_cache({"payload": payload})

    async def invalid(*args, **kwargs):
        return httpx.Response(200, json={"wrong": []}, request=httpx.Request("GET", "https://example.org"))

    monkeypatch.setattr(httpx.AsyncClient, "get", invalid)
    catalog = await RegistryClient(store).catalog()
    assert catalog[0].id == "cached"
    assert store.read_registry_cache()["payload"] == payload
    fresh = RegistryClient(ExternalAgentStore(tmp_path / "empty"))
    with pytest.raises(RegistryError):
        await fresh.catalog()
