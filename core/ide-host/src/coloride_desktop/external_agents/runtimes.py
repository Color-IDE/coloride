"""Resolve Node, npm and uv without changing Coloride's own package.json."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path


class RuntimeMissing(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class RuntimeCommand:
    executable: str
    prefix: tuple[str, ...] = ()
    env: dict[str, str] | None = None


def resolve_node() -> RuntimeCommand:
    forced = (os.environ.get("COLORIDE_NODE") or os.environ.get("COLORIDE_AGENT_NODE") or "").strip()
    if forced and Path(forced).exists():
        return RuntimeCommand(forced)
    discovered = shutil.which("node")
    if discovered:
        return RuntimeCommand(discovered)
    managed = Path(os.environ.get("COLORIDE_MANAGED_NODE", "")).expanduser()
    if managed.is_file():
        return RuntimeCommand(str(managed))
    raise RuntimeMissing(
        "Node.js 22 is required to install Codex. Development can use a local Node; "
        "the packaged app needs the managed Node runtime."
    )


def resolve_npm() -> RuntimeCommand:
    forced = (os.environ.get("COLORIDE_NPM") or "").strip()
    if forced and Path(forced).exists():
        return RuntimeCommand(forced)
    discovered = shutil.which("npm")
    if discovered:
        return RuntimeCommand(discovered)
    node = resolve_node()
    sibling = Path(node.executable).with_name("npm")
    if sibling.is_file():
        return RuntimeCommand(str(sibling), env=node.env)
    raise RuntimeMissing("npm was not found next to the selected Node runtime.")


def resolve_uv() -> RuntimeCommand:
    forced = (os.environ.get("COLORIDE_UV") or "").strip()
    if forced and Path(forced).exists():
        return RuntimeCommand(forced)
    discovered = shutil.which("uv")
    if discovered:
        return RuntimeCommand(discovered)
    raise RuntimeMissing("uv is required for uvx distributions and is not installed.")


def node_env(node: RuntimeCommand) -> dict[str, str]:
    env = dict(os.environ)
    if node.env:
        env.update(node.env)
    bindir = str(Path(node.executable).parent)
    env["PATH"] = bindir + os.pathsep + env.get("PATH", "")
    # Keep the user's HOME so Codex can find its own login state.
    return env
