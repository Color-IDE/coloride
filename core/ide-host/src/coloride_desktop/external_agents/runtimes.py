"""Resolve or provision private runtimes when the user installs an ACP agent."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import platform
import shutil
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.request import Request, urlopen


class RuntimeMissing(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class RuntimeCommand:
    executable: str
    prefix: tuple[str, ...] = ()
    env: dict[str, str] | None = None


def clean_env() -> dict[str, str]:
    env = dict(os.environ)
    # External programs must not inherit Electron's Node bootstrap or pnpm hooks.
    for key in ("ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH"):
        env.pop(key, None)
    return env


def resolve_node(root: Path | None = None) -> RuntimeCommand:
    forced = (os.environ.get("COLORIDE_NODE") or "").strip()
    candidates = [Path(forced)] if forced else []
    if root:
        candidates.append(root / "node" / ("node.exe" if os.name == "nt" else "bin/node"))
    managed = os.environ.get("COLORIDE_MANAGED_NODE")
    if managed:
        candidates.append(Path(managed).expanduser())
    found = shutil.which("node")
    if found:
        candidates.append(Path(found))
    for candidate in candidates:
        if candidate.is_file() and candidate.name.lower() not in {"electron", "electron.exe"}:
            return RuntimeCommand(str(candidate))
    raise RuntimeMissing("A compatible Node.js runtime is not available.")


def resolve_npm(root: Path | None = None) -> RuntimeCommand:
    node = resolve_node(root)
    forced = os.environ.get("COLORIDE_NPM", "").strip()
    candidates = [Path(forced)] if forced else []
    node_dir = Path(node.executable).parent
    candidates.extend(
        [
            node_dir / "npm",
            node_dir / "node_modules/npm/bin/npm-cli.js",
            node_dir.parent / "lib/node_modules/npm/bin/npm-cli.js",
        ]
    )
    discovered = shutil.which("npm")
    if discovered:
        candidates.append(Path(discovered))
    for candidate in candidates:
        if candidate.is_file():
            resolved = candidate.resolve()
            # npm is JS. Launch it using the selected Node, never pnpm or Electron.
            if resolved.name in {"npm-cli.js", "npm.js"}:
                return RuntimeCommand(node.executable, (str(resolved),))
            if candidate.name in {"npm", "npm.cmd"}:
                return RuntimeCommand(str(candidate))
    raise RuntimeMissing("npm is not available for the selected Node runtime.")


def resolve_uv(root: Path | None = None) -> RuntimeCommand:
    forced = os.environ.get("COLORIDE_UV", "").strip()
    candidates = [Path(forced)] if forced else []
    if root:
        candidates.append(root / "uv" / ("uv.exe" if os.name == "nt" else "uv"))
    found = shutil.which("uv")
    if found:
        candidates.append(Path(found))
    for candidate in candidates:
        if candidate.is_file():
            return RuntimeCommand(str(candidate))
    raise RuntimeMissing("The uv runtime is not available.")


def node_env(node: RuntimeCommand) -> dict[str, str]:
    env = clean_env()
    if node.env:
        env.update(node.env)
    env["PATH"] = str(Path(node.executable).parent) + os.pathsep + env.get("PATH", "")
    return env


def extract_archive(archive_path: Path, destination: Path, *, zip_format: bool = False) -> None:
    if zip_format:
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                target = (destination / member.filename).resolve()
                if not target.is_relative_to(destination.resolve()):
                    raise RuntimeMissing("Archive contains an unsafe path.")
                if (member.external_attr >> 16) & 0o170000 == 0o120000:
                    raise RuntimeMissing("Archive contains an unsupported symbolic link.")
            archive.extractall(destination)
            for member in archive.infolist():
                mode = (member.external_attr >> 16) & 0o777
                if mode and not member.is_dir():
                    (destination / member.filename).chmod(mode)
    else:
        with tarfile.open(archive_path) as archive:
            archive.extractall(destination, filter="data")


def _json(url: str):
    with urlopen(Request(url, headers={"User-Agent": "Coloride"}), timeout=45) as response:
        return json.load(response)


def _download(url: str, destination: Path, digest: str) -> None:
    hashed = hashlib.sha256()
    with (
        urlopen(Request(url, headers={"User-Agent": "Coloride"}), timeout=90) as response,
        destination.open("wb") as output,
    ):
        while chunk := response.read(256 * 1024):
            hashed.update(chunk)
            output.write(chunk)
    if hashed.hexdigest() != digest.lower():
        raise RuntimeMissing("Runtime download failed its SHA-256 integrity check.")


def _provision_node(root: Path) -> None:
    system = {"Darwin": "darwin", "Linux": "linux", "Windows": "win"}.get(platform.system())
    architecture = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "amd64": "x64"}.get(
        platform.machine().lower()
    )
    if not system or not architecture:
        raise RuntimeMissing("Node.js is not available for this platform.")
    releases = _json("https://nodejs.org/dist/index.json")
    release = next(
        item for item in releases if item.get("lts") and int(item["version"].split(".")[0][1:]) >= 22
    )
    version = release["version"]
    name = f"node-{version}-{system}-{architecture}"
    filename = name + (".zip" if system == "win" else ".tar.gz")
    base = f"https://nodejs.org/dist/{version}/"
    with urlopen(base + "SHASUMS256.txt", timeout=45) as response:
        checksums = dict(
            (line.split()[1], line.split()[0])
            for line in response.read().decode().splitlines()
            if len(line.split()) == 2
        )
    with tempfile.TemporaryDirectory(dir=root, prefix="node-download-") as temporary:
        directory = Path(temporary)
        archive = directory / filename
        _download(base + filename, archive, checksums[filename])
        extract_archive(archive, directory, zip_format=system == "win")
        target = root / "node"
        if target.exists():
            shutil.rmtree(target)
        os.replace(directory / name, target)


def _provision_uv(root: Path) -> None:
    system = {"Darwin": "apple-darwin", "Linux": "unknown-linux-gnu", "Windows": "pc-windows-msvc"}.get(
        platform.system()
    )
    architecture = {"arm64": "aarch64", "aarch64": "aarch64", "x86_64": "x86_64", "amd64": "x86_64"}.get(
        platform.machine().lower()
    )
    if not system or not architecture:
        raise RuntimeMissing("uv is not available for this platform.")
    filename = f"uv-{architecture}-{system}" + (".zip" if os.name == "nt" else ".tar.gz")
    release = _json("https://api.github.com/repos/astral-sh/uv/releases/latest")
    asset = next((item for item in release["assets"] if item["name"] == filename), None)
    if not asset or not str(asset.get("digest", "")).startswith("sha256:"):
        raise RuntimeMissing("A verified uv release is not available for this platform.")
    with tempfile.TemporaryDirectory(dir=root, prefix="uv-download-") as temporary:
        directory = Path(temporary)
        archive = directory / filename
        _download(asset["browser_download_url"], archive, asset["digest"].split(":", 1)[1])
        extract_archive(archive, directory, zip_format=os.name == "nt")
        binary = next(directory.rglob("uv.exe" if os.name == "nt" else "uv"))
        target = root / "uv"
        target.mkdir(exist_ok=True)
        shutil.copy2(binary, target / binary.name)


async def ensure_runtime(kind: str, root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    if kind == "npx":
        try:
            node = resolve_node(root)
            resolve_npm(root)
            process = await asyncio.create_subprocess_exec(
                node.executable,
                "--version",
                env=node_env(node),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=10)
            if process.returncode == 0 and int(stdout.decode().strip().lstrip("v").split(".")[0]) >= 22:
                return
        except (RuntimeMissing, OSError, ValueError, TimeoutError):
            pass
        await asyncio.to_thread(_provision_node, root)
    elif kind == "uvx":
        try:
            resolve_uv(root)
            return
        except RuntimeMissing:
            await asyncio.to_thread(_provision_uv, root)
