"""Versioned installs for registry agents. Codex uses an exact npm package."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from urllib.request import urlopen

from .models import InstallationRecord, RegistryEntryRecord, utc_now
from .runtimes import (
    RuntimeMissing,
    clean_env,
    ensure_runtime,
    extract_archive,
    node_env,
    resolve_node,
    resolve_npm,
    resolve_uv,
)
from .store import ExternalAgentStore


class InstallError(RuntimeError):
    pass


class ExternalAgentInstaller:
    def __init__(self, store: ExternalAgentStore) -> None:
        self.store = store
        self._lock = asyncio.Lock()
        self.runtime_root = store.root / "runtimes"

    def installation_id(self, agent_id: str, version: str) -> str:
        return f"{agent_id}@{version}"

    def destination(self, agent_id: str, version: str) -> Path:
        return self.store.packages / agent_id / version

    async def install(self, entry: RegistryEntryRecord) -> InstallationRecord:
        async with self._lock:
            return await self._install(entry)

    async def _install(self, entry: RegistryEntryRecord) -> InstallationRecord:
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
            await ensure_runtime(entry.distribution_kind, self.runtime_root)
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
            location = Path(record.location).resolve()
            if (
                not location.is_relative_to(self.store.packages.resolve())
                or location == self.store.packages.resolve()
            ):
                raise InstallError("Installation path is outside the managed packages directory.")
            shutil.rmtree(location, ignore_errors=True)
        self.store.remove_installation(record.id)

    def launch_command(self, record: InstallationRecord) -> tuple[str, list[str], dict[str, str]]:
        if record.distribution == "npx":
            node = resolve_node(self.runtime_root)
            executable = record.executable or ""
            if not executable or not Path(executable).is_file():
                raise InstallError("Installed agent executable is missing.")
            header = Path(executable).read_bytes()[:128]
            env = {**node_env(node), **record.env}
            if Path(executable).resolve().suffix in {".js", ".mjs", ".cjs"} or (
                header.startswith(b"#!") and b"node" in header.split(b"\n", 1)[0]
            ):
                return node.executable, [executable, *record.args], env
            return executable, list(record.args), env
        if record.distribution == "uvx":
            root = Path(record.location or "")
            python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            command = json.loads((root / "entrypoint.json").read_text())["command"]
            script = (
                "import importlib.metadata as m,sys;sys.argv=sys.argv[1:];"
                "next(e for e in m.entry_points(group='console_scripts') "
                "if e.name==sys.argv[0]).load()()"
            )
            return str(python), ["-c", script, command, *record.args], {**clean_env(), **record.env}
        if record.executable:
            return record.executable, list(record.args), {**clean_env(), **record.env}
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
        npm = resolve_npm(self.runtime_root)
        node = resolve_node(self.runtime_root)
        spec = entry.package_spec or ""
        if not re.fullmatch(r"(?:@[\w.-]+/)?[\w.-]+@\d+\.\d+\.\d+(?:[-+][\w.-]+)?", spec):
            raise InstallError("npm installs must use an exact version from the registry.")
        manifest = {"name": "coloride-external-agent", "private": True, "version": "0.0.0"}
        (directory / "package.json").write_text(json.dumps(manifest), encoding="utf-8")
        process = await asyncio.create_subprocess_exec(
            npm.executable,
            *npm.prefix,
            "install",
            "--omit=dev",
            "--no-audit",
            "--no-fund",
            "--save-exact",
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
        # Installing is an explicit user action: registry packages may need their runtime setup scripts.
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
        uv = resolve_uv(self.runtime_root)
        spec = entry.package_spec or ""
        spec = re.sub(r"(?<=[\w-])@(?=\d)", "==", spec)
        process = await asyncio.create_subprocess_exec(
            uv.executable,
            "venv",
            "--python",
            "3.12",
            str(directory / ".venv"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await process.communicate()
        if process.returncode != 0:
            raise InstallError("Could not create a uv environment for this agent.")
        python = directory / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
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
        inspect_script = (
            "import importlib.metadata as m,json;print(json.dumps([e.name for d in m.distributions() "
            "if d.metadata['Name'].lower().replace('_','-') == "
            + repr(spec.split("==", 1)[0].lower().replace("_", "-"))
            + " for e in d.entry_points if e.group=='console_scripts']))"
        )
        inspect_process = await asyncio.create_subprocess_exec(
            str(python), "-c", inspect_script, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await inspect_process.communicate()
        commands = json.loads(stdout) if inspect_process.returncode == 0 else []
        if not commands:
            raise InstallError("The Python package does not expose a console command.")
        preferred = spec.split("==", 1)[0]
        command = preferred if preferred in commands else commands[0]
        (directory / "entrypoint.json").write_text(json.dumps({"command": command}))

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
            extract_archive(download, extract, zip_format=True)
        elif name.endswith((".tar.gz", ".tgz", ".tar.bz2", ".tbz2")):
            extract_archive(download, extract)
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
        if entry.distribution_kind == "uvx" and (
            not (directory / ".venv").is_dir() or not (directory / "entrypoint.json").is_file()
        ):
            raise InstallError("uv environment is incomplete.")
        if entry.distribution_kind == "binary":
            if not entry.command:
                raise InstallError("Binary distribution has no command.")
            root = (directory / "extract").resolve()
            executable = (root / entry.command[0]).resolve()
            if not executable.is_relative_to(root) or not executable.is_file():
                raise InstallError("The archive does not contain its declared executable.")
            executable.chmod(executable.stat().st_mode | 0o700)

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
        record.env = entry.env
        self.store.upsert_installation(record)
        return record
