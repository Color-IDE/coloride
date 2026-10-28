"""Versioned installs for registry agents. Codex uses an exact npm package."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import tarfile
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlopen

from .models import InstallationRecord, RegistryEntryRecord, utc_now
from .runtimes import RuntimeMissing, node_env, resolve_node, resolve_npm, resolve_uv
from .store import ExternalAgentStore


class InstallError(RuntimeError):
    pass


class ExternalAgentInstaller:
    def __init__(self, store: ExternalAgentStore) -> None:
        self.store = store

    def installation_id(self, agent_id: str, version: str) -> str:
        return f"{agent_id}@{version}"

    def destination(self, agent_id: str, version: str) -> Path:
        return self.store.packages / agent_id / version

    async def install(self, entry: RegistryEntryRecord) -> InstallationRecord:
        record = InstallationRecord(
            id=self.installation_id(entry.id, entry.version),
            agentId=entry.id,
            name=entry.name,
            version=entry.version,
            distribution=entry.distribution_kind,
            status="installing",
            packageSpec=entry.package_spec,
        )
        self.store.upsert_installation(record)
        destination = self.destination(entry.id, entry.version)
        if destination.exists() and self._verified(destination, entry):
            return self._finalize(record, destination, entry)
        temporary = Path(tempfile.mkdtemp(prefix=f"{entry.id}-", dir=self.store.packages))
        try:
            await self._install_into(temporary, entry)
            self._verify(temporary, entry)
            if destination.exists():
                shutil.rmtree(destination)
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(temporary, destination)
        except Exception as exc:
            shutil.rmtree(temporary, ignore_errors=True)
            record.status = "missing-runtime" if isinstance(exc, RuntimeMissing) else "failed"
            record.error = str(exc)
            self.store.upsert_installation(record)
            raise InstallError(str(exc)) from exc
        return self._finalize(record, destination, entry)

    async def uninstall(self, record: InstallationRecord) -> None:
        if record.location:
            shutil.rmtree(record.location, ignore_errors=True)
        self.store.remove_installation(record.id)

    def launch_command(self, record: InstallationRecord) -> tuple[str, list[str], dict[str, str]]:
        if record.distribution == "npx":
            node = resolve_node()
            executable = record.executable or ""
            if not executable or not Path(executable).is_file():
                raise InstallError("Installed Codex executable is missing.")
            return node.executable, [executable, *record.args], node_env(node)
        if record.distribution == "uvx":
            uv = resolve_uv()
            return uv.executable, ["run", "--offline", record.package_spec or record.agent_id, *record.args], dict(os.environ)
        if record.executable:
            return record.executable, list(record.args), dict(os.environ)
        raise InstallError("Installed agent has no executable.")

    async def _install_into(self, directory: Path, entry: RegistryEntryRecord) -> None:
        if entry.distribution_kind == "npx":
            await self._install_npm(directory, entry)
            return
        if entry.distribution_kind == "uvx":
            await self._install_uv(directory, entry)
            return
        if entry.distribution_kind == "binary":
            await asyncio.to_thread(self._install_binary, directory, entry)
            return
        raise InstallError(f"Unsupported distribution {entry.distribution_kind}.")

    async def _install_npm(self, directory: Path, entry: RegistryEntryRecord) -> None:
        npm = resolve_npm()
        node = resolve_node()
        spec = entry.package_spec or ""
        if "@" not in spec.split("/")[-1]:
            raise InstallError("npm installs must use an exact version from the registry.")
        manifest = {"name": "coloride-external-agent", "private": True, "version": "0.0.0"}
        (directory / "package.json").write_text(json.dumps(manifest), encoding="utf-8")
        process = await asyncio.create_subprocess_exec(
            npm.executable,
            "install",
            "--omit=dev",
            "--no-audit",
            "--no-fund",
            "--ignore-scripts",
            spec,
            cwd=directory,
            env=node_env(node),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await process.communicate()
        if process.returncode != 0:
            detail = stderr.decode("utf-8", errors="replace").strip()
            raise InstallError(detail or f"npm install failed for {spec}.")
        # ignore-scripts skips the adapter's own build. The published package is already built.
        bin_name = spec.split("@")[-2].split("/")[-1] if spec.startswith("@") else spec.split("@")[0]
        candidate = directory / "node_modules" / ".bin" / bin_name
        if not candidate.exists():
            package_dir = self._npm_package_dir(directory, spec)
            package_json = json.loads((package_dir / "package.json").read_text(encoding="utf-8"))
            binary = package_json.get("bin")
            relative = next(iter(binary.values())) if isinstance(binary, dict) else binary
            if not isinstance(relative, str):
                raise InstallError(f"{spec} does not publish an executable.")
            candidate = package_dir / relative
        if not candidate.is_file():
            raise InstallError(f"Installed package has no executable at {candidate}.")

    async def _install_uv(self, directory: Path, entry: RegistryEntryRecord) -> None:
        uv = resolve_uv()
        spec = entry.package_spec or ""
        process = await asyncio.create_subprocess_exec(
            uv.executable,
            "venv",
            str(directory / ".venv"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await process.communicate()
        if process.returncode != 0:
            raise InstallError("Could not create a uv environment for this agent.")
        python = directory / ".venv" / "bin" / "python"
        install = await asyncio.create_subprocess_exec(
            uv.executable,
            "pip",
            "install",
            "--python",
            str(python),
            spec,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await install.communicate()
        if install.returncode != 0:
            raise InstallError(stderr.decode("utf-8", errors="replace").strip() or "uv install failed.")

    def _install_binary(self, directory: Path, entry: RegistryEntryRecord) -> None:
        if not entry.archive_url:
            raise InstallError("Binary distribution has no archive.")
        download = directory / "archive"
        digest = hashlib.sha256()
        with urlopen(entry.archive_url, timeout=60) as response, download.open("wb") as handle:  # noqa: S310
            while True:
                chunk = response.read(1024 * 256)
                if not chunk:
                    break
                digest.update(chunk)
                handle.write(chunk)
        if entry.archive_sha256 and digest.hexdigest().lower() != entry.archive_sha256.lower():
            raise InstallError("Downloaded archive does not match the registry digest.")
        extract = directory / "extract"
        extract.mkdir()
        name = entry.archive_url.lower()
        if name.endswith(".zip"):
            with zipfile.ZipFile(download) as archive:
                archive.extractall(extract)
        elif name.endswith((".tar.gz", ".tgz", ".tar.bz2", ".tbz2")):
            with tarfile.open(download) as archive:
                archive.extractall(extract, filter="data")
        else:
            target = extract / Path(entry.command[0]).name
            shutil.copyfile(download, target)
            target.chmod(0o755)
        download.unlink(missing_ok=True)

    def _verify(self, directory: Path, entry: RegistryEntryRecord) -> None:
        if entry.distribution_kind == "npx":
            if not self._npm_executable(directory, entry).is_file():
                raise InstallError("npm package installed without its executable.")
            return
        if entry.distribution_kind == "uvx" and not (directory / ".venv").is_dir():
            raise InstallError("uv environment is incomplete.")

    def _verified(self, directory: Path, entry: RegistryEntryRecord) -> bool:
        try:
            self._verify(directory, entry)
        except InstallError:
            return False
        return True

    def _npm_package_dir(self, directory: Path, spec: str) -> Path:
        name = spec.rsplit("@", 1)[0]
        return directory / "node_modules" / name

    def _npm_executable(self, directory: Path, entry: RegistryEntryRecord) -> Path:
        spec = entry.package_spec or ""
        bin_name = spec.rsplit("@", 1)[0].split("/")[-1]
        linked = directory / "node_modules" / ".bin" / bin_name
        if linked.exists():
            return linked
        package_dir = self._npm_package_dir(directory, spec)
        package_json_path = package_dir / "package.json"
        if not package_json_path.is_file():
            return linked
        package_json = json.loads(package_json_path.read_text(encoding="utf-8"))
        binary = package_json.get("bin")
        relative = next(iter(binary.values())) if isinstance(binary, dict) else binary
        if isinstance(relative, str):
            return package_dir / relative
        return linked

    def _finalize(
        self,
        record: InstallationRecord,
        destination: Path,
        entry: RegistryEntryRecord,
    ) -> InstallationRecord:
        executable = None
        if entry.distribution_kind == "npx":
            executable = str(self._npm_executable(destination, entry))
        elif entry.distribution_kind == "binary" and entry.command:
            executable = str((destination / "extract" / entry.command[0]).resolve())
        record.status = "installed"
        record.error = None
        record.installed_at = utc_now()
        record.executable = executable
        record.args = entry.command if entry.distribution_kind != "binary" else entry.command[1:]
        record.location = str(destination)
        self.store.upsert_installation(record)
        return record
