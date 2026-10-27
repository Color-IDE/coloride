"""App-wide remote browser sessions on the client VPS (Playwright + Chromium).

Owned by Coloride Desktop, not the agent. Consumers:

- UI explorer tabs (terminal link → open in side-by-side browser)
- Agent tools (thin wrappers over the same service)
- Future features (preview panel, manual navigation, etc.)
"""

from __future__ import annotations

import base64
import json
import re
import secrets
import shlex
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

from ..files.service import RemoteFileService

RunCommand = Callable[[str], Awaitable[object]]

_SAFE_BROWSER_ID = re.compile(r"^br_[a-f0-9]{16}$")
_SAFE_OWNER = re.compile(r"^[A-Za-z0-9._:-]{1,120}$")
PLAYWRIGHT_VERSION = "1.49.1"
RUNTIME_MARKER = "ready.json"
MAX_IMAGE_CHARS = 1_200_000  # base64 budget in tool/API payloads


@dataclass(frozen=True, slots=True)
class BrowserSession:
    """One Chromium context on the VPS, tracked on the desktop host."""

    browser_id: str
    owner: str
    url: str
    title: str
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, str]:
        return {
            "id": self.browser_id,
            "owner": self.owner,
            "url": self.url,
            "title": self.title,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


class BrowserService:
    """Bootstrap Playwright on the VPS and drive browser actions over SSH.

    Ownership is a free-form label (``ui``, ``agent:<session_id>``, …), not an
    agent-session exclusive lock. Multiple consumers share the same runtime.
    """

    def __init__(
        self,
        *,
        run_command: RunCommand,
        files: RemoteFileService,
        root: Path | None = None,
    ) -> None:
        self.run_command = run_command
        self.files = files
        self.root = root or Path.home() / ".coloride" / "desktop" / "browsers"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._runtime_ready = False
        self._launch: dict[str, str] | None = None

    async def open(
        self,
        url: str,
        *,
        owner: str = "ui",
        browser_id: str | None = None,
        reuse_owner: bool = False,
    ) -> dict[str, Any]:
        """Open or navigate a browser. Optionally reuse the first tab for ``owner``."""
        self._validate_owner(owner)
        url = _validate_url(url)
        await self.ensure_runtime()

        existing: BrowserSession | None = None
        if browser_id:
            existing = self.get(browser_id)
            if existing is None:
                raise KeyError(browser_id)
        elif reuse_owner:
            existing = self._find_for_owner(owner)

        resolved_id = existing.browser_id if existing else f"br_{secrets.token_hex(8)}"
        result = await self._driver(
            "open",
            browser_id=resolved_id,
            extra=[f"--url {shlex.quote(url)}"],
        )
        now = datetime.now(UTC).isoformat()
        record = BrowserSession(
            browser_id=resolved_id,
            owner=owner if existing is None else existing.owner,
            url=str(result.get("url") or url),
            title=str(result.get("title") or ""),
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        self._write(record)
        return {
            **result,
            "browserId": resolved_id,
            "owner": record.owner,
        }

    async def snapshot(self, browser_id: str) -> dict[str, Any]:
        record = self._require(browser_id)
        result = await self._driver("snapshot", browser_id=browser_id)
        self._touch(record, url=str(result.get("url") or record.url), title=str(result.get("title") or record.title))
        return result

    async def screenshot(self, browser_id: str) -> dict[str, Any]:
        record = self._require(browser_id)
        result = await self._driver("screenshot", browser_id=browser_id)
        image = str(result.get("imageBase64") or "")
        if len(image) > MAX_IMAGE_CHARS:
            result["imageBase64"] = image[:MAX_IMAGE_CHARS]
            result["truncated"] = True
        self._touch(record, url=str(result.get("url") or record.url), title=str(result.get("title") or record.title))
        return result

    async def frame(self, browser_id: str, *, quality: int = 52) -> dict[str, Any]:
        """JPEG frame for the live embedded browser stream."""
        record = self._require(browser_id)
        result = await self._driver(
            "frame",
            browser_id=browser_id,
            extra=[f"--quality {int(quality)}"],
        )
        image = str(result.get("imageBase64") or "")
        if len(image) > MAX_IMAGE_CHARS:
            result["imageBase64"] = image[:MAX_IMAGE_CHARS]
            result["truncated"] = True
        self._touch(record, url=str(result.get("url") or record.url), title=str(result.get("title") or record.title))
        return result

    async def click_xy(
        self,
        browser_id: str,
        x: float,
        y: float,
        *,
        button: str = "left",
        click_count: int = 1,
    ) -> dict[str, Any]:
        record = self._require(browser_id)
        result = await self._driver(
            "click_xy",
            browser_id=browser_id,
            extra=[
                f"--x {float(x)}",
                f"--y {float(y)}",
                f"--button {shlex.quote(str(button or 'left'))}",
                f"--click-count {int(click_count)}",
            ],
        )
        self._touch(record, url=str(result.get("url") or record.url), title=str(result.get("title") or record.title))
        return result

    async def wheel(
        self,
        browser_id: str,
        *,
        x: float = 0,
        y: float = 0,
        delta_x: float = 0,
        delta_y: float = 0,
    ) -> dict[str, Any]:
        record = self._require(browser_id)
        result = await self._driver(
            "wheel",
            browser_id=browser_id,
            extra=[
                f"--x {float(x)}",
                f"--y {float(y)}",
                f"--delta-x {float(delta_x)}",
                f"--delta-y {float(delta_y)}",
            ],
        )
        self._touch(record, url=str(result.get("url") or record.url), title=str(result.get("title") or record.title))
        return result

    async def type_raw(self, browser_id: str, text: str) -> dict[str, Any]:
        record = self._require(browser_id)
        if len(text) > 8_000:
            raise ValueError("Text is too long")
        result = await self._driver(
            "type_raw",
            browser_id=browser_id,
            extra=[f"--text {shlex.quote(text)}"],
        )
        self._touch(record, url=str(result.get("url") or record.url), title=str(result.get("title") or record.title))
        return result

    async def click(self, browser_id: str, ref: str) -> dict[str, Any]:
        record = self._require(browser_id)
        ref = _validate_ref(ref)
        result = await self._driver(
            "click",
            browser_id=browser_id,
            extra=[f"--ref {shlex.quote(ref)}"],
        )
        self._touch(record, url=str(result.get("url") or record.url), title=str(result.get("title") or record.title))
        return result

    async def type_text(
        self,
        browser_id: str,
        ref: str,
        text: str,
        *,
        submit: bool = False,
        slowly: bool = False,
    ) -> dict[str, Any]:
        record = self._require(browser_id)
        ref = _validate_ref(ref)
        if len(text) > 20_000:
            raise ValueError("Text is too long")
        extra = [f"--ref {shlex.quote(ref)}", f"--text {shlex.quote(text)}"]
        if submit:
            extra.append("--submit")
        if slowly:
            extra.append("--slowly")
        result = await self._driver("type", browser_id=browser_id, extra=extra)
        self._touch(record, url=str(result.get("url") or record.url), title=str(result.get("title") or record.title))
        return result

    async def press(
        self,
        browser_id: str,
        key: str,
        ref: str | None = None,
    ) -> dict[str, Any]:
        record = self._require(browser_id)
        key = key.strip()
        if not key or len(key) > 40:
            raise ValueError("Invalid key")
        extra = [f"--key {shlex.quote(key)}"]
        if ref:
            extra.append(f"--ref {shlex.quote(_validate_ref(ref))}")
        result = await self._driver("press", browser_id=browser_id, extra=extra)
        self._touch(record, url=str(result.get("url") or record.url), title=str(result.get("title") or record.title))
        return result

    async def close(self, browser_id: str) -> dict[str, Any]:
        record = self.get(browser_id)
        if record is None:
            return {"ok": True, "browserId": browser_id, "closed": True, "missing": True}
        try:
            result = await self._driver("close", browser_id=browser_id, require_ok=False)
        except Exception as exc:  # noqa: BLE001
            result = {"ok": False, "error": str(exc), "browserId": browser_id}
        path = self._path(record.browser_id)
        if path.exists():
            path.unlink()
        return {**result, "browserId": browser_id, "closed": True}

    async def close_owner(self, owner: str) -> int:
        closed = 0
        for record in list(self.list(owner=owner)):
            try:
                await self.close(record.browser_id)
                closed += 1
            except Exception:
                continue
        return closed

    async def close_all(self) -> int:
        closed = 0
        for record in list(self.list()):
            try:
                await self.close(record.browser_id)
                closed += 1
            except Exception:
                continue
        return closed

    def get(self, browser_id: str) -> BrowserSession | None:
        try:
            return self._read(self._path(browser_id))
        except ValueError:
            return None

    def list(self, *, owner: str | None = None) -> list[BrowserSession]:
        values: list[BrowserSession] = []
        for path in self.root.glob("br_*.json"):
            record = self._read(path)
            if record is None:
                continue
            if owner is not None and record.owner != owner:
                continue
            values.append(record)
        return sorted(values, key=lambda value: value.updated_at, reverse=True)

    async def ensure_runtime(self) -> dict[str, Any]:
        if self._runtime_ready:
            return {"ready": True, "cached": True}

        probe = await self._run(
            "set -e; "
            "command -v python3 >/dev/null; "
            "python3 - <<'PY'\n"
            "import os, shutil, sys\n"
            "mem=0\n"
            "try:\n"
            "  for line in open('/proc/meminfo'):\n"
            "    if line.startswith('MemAvailable:'):\n"
            "      mem=int(line.split()[1])//1024; break\n"
            "except OSError:\n"
            "  pass\n"
            "print(sys.version.split()[0])\n"
            "print(os.uname().machine)\n"
            "print(mem)\n"
            "print(shutil.which('python3') or '')\n"
            "PY"
        )
        lines = [line.strip() for line in _output(probe).splitlines() if line.strip()]
        if _status(probe) != 0 or len(lines) < 3:
            raise RuntimeError(
                "This VPS needs python3 to run the remote browser. "
                f"Probe failed: {_output(probe) or 'unknown error'}"
            )
        py_version, arch, mem_mb = lines[0], lines[1], _safe_int(lines[2], 0)
        if mem_mb and mem_mb < 400:
            raise RuntimeError(
                f"This VPS only has ~{mem_mb}MB available RAM. "
                "Remote Chromium needs roughly 1GB free for a stable session."
            )

        home_result = await self._run("printf '%s' \"$HOME\"")
        home = _output(home_result).strip() or "/tmp"
        runtime_root = f"{home.rstrip('/')}/.coloride/browser-runtime"
        sessions_root = f"{home.rstrip('/')}/.coloride/browser-sessions"
        await self._run(
            "mkdir -p "
            f"{shlex.quote(runtime_root)} {shlex.quote(sessions_root)} "
            f"{shlex.quote(runtime_root + '/venv')} "
            f"{shlex.quote(runtime_root + '/prefix')}"
        )

        driver_source = _local_driver_source()
        driver_remote = f"{runtime_root}/driver.py"
        await self._write_remote_text(driver_remote, driver_source)

        marker_remote = f"{runtime_root}/{RUNTIME_MARKER}"
        marker = await self._read_remote_json(marker_remote)
        needs_install = (
            not marker
            or marker.get("playwright") != PLAYWRIGHT_VERSION
            or marker.get("arch") != arch
            or marker.get("python") != py_version
            or marker.get("mode") not in {"venv", "prefix"}
        )
        # Also reinstall if a previous half-failed bootstrap left a broken tree.
        if not needs_install:
            probe_launch = await self._resolve_launch(runtime_root)
            probe_check = await self._run(probe_launch["check_cmd"])
            if _status(probe_check) != 0:
                needs_install = True

        if needs_install:
            # Ubuntu/Debian often ship python3 without ensurepip. Avoid apt install
            # of python3-pip (pulls gcc/python-dev and breaks on stale mirrors).
            # Strategy:
            # 1) venv --without-pip + get-pip.py into the venv (preferred)
            # 2) if root: apt only python3-venv (--no-install-recommends), retry
            # 3) prefix: get-pip.py --target + pip --target (never system site-packages)
            install_script = f"""set -euo pipefail
RUNTIME={shlex.quote(runtime_root)}
PW={shlex.quote(PLAYWRIGHT_VERSION)}
MARKER={shlex.quote(marker_remote)}
LOG=/tmp/coloride-browser-pip.log
GETPIP=/tmp/coloride-get-pip.py
: > "$LOG"
# Keep ms-playwright browser cache (~/.cache/ms-playwright) — only reset our runtime tree.
rm -rf "$RUNTIME/venv" "$RUNTIME/prefix"
mkdir -p "$RUNTIME/venv" "$RUNTIME/prefix"
MODE=""
# Playwright may exit non-zero when host libs are missing even after a good download.
export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1

download_get_pip() {{
  if [ -f "$GETPIP" ]; then return 0; fi
  curl -fsSL https://bootstrap.pypa.io/get-pip.py -o "$GETPIP" >>"$LOG" 2>&1 \\
    || wget -qO "$GETPIP" https://bootstrap.pypa.io/get-pip.py >>"$LOG" 2>&1
}}

bootstrap_venv_pip() {{
  download_get_pip
  "$RUNTIME/venv/bin/python" "$GETPIP" >>"$LOG" 2>&1
}}

try_make_venv() {{
  rm -rf "$RUNTIME/venv"
  mkdir -p "$RUNTIME/venv"
  if python3 -m venv --without-pip "$RUNTIME/venv" >>"$LOG" 2>&1 \\
    || python3 -m venv "$RUNTIME/venv" >>"$LOG" 2>&1; then
    if [ ! -x "$RUNTIME/venv/bin/python" ]; then
      return 1
    fi
    if [ ! -x "$RUNTIME/venv/bin/pip" ]; then
      bootstrap_venv_pip || return 1
    fi
    MODE=venv
    return 0
  fi
  return 1
}}

wait_for_apt() {{
  # Previous bootstrap steps (or unattended-upgrades) may hold apt locks briefly.
  for i in $(seq 1 45); do
    if command -v fuser >/dev/null 2>&1; then
      if ! fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \\
        && ! fuser /var/lib/apt/lists/lock >/dev/null 2>&1 \\
        && ! fuser /var/lib/dpkg/lock >/dev/null 2>&1; then
        return 0
      fi
    else
      # No fuser: try a no-op apt-get that fails fast if locked.
      if apt-get -qq check >/dev/null 2>&1; then
        return 0
      fi
    fi
    echo "waiting for apt lock ($i)..." >>"$LOG"
    sleep 2
  done
  return 0
}}

install_host_deps() {{
  # Best-effort OS libs for headless Chromium. Never fail the whole bootstrap.
  if [ "$(id -u)" -ne 0 ] || ! command -v apt-get >/dev/null 2>&1; then
    return 0
  fi
  export DEBIAN_FRONTEND=noninteractive
  wait_for_apt
  apt-get update -y >>"$LOG" 2>&1 || true
  # Ubuntu 24.04 uses t64 package names; older releases use the classic names.
  apt-get install -y --no-install-recommends \\
    libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libxcomposite1 \\
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 libatspi2.0-0t64 \\
    libnspr4 libnss3 libpango-1.0-0 libcairo2 libxkbcommon0 libgtk-3-0t64 \\
    fonts-liberation ca-certificates >>"$LOG" 2>&1 \\
  || apt-get install -y --no-install-recommends \\
    libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 \\
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libatspi2.0-0 \\
    libnspr4 libnss3 libpango-1.0-0 libcairo2 libxkbcommon0 libgtk-3-0 \\
    fonts-liberation ca-certificates >>"$LOG" 2>&1 \\
  || true
  # Playwright's own helper if still available (ignore lock races).
  if [ -n "${{PW_BIN:-}}" ]; then
    wait_for_apt
    $PW_BIN install-deps chromium >>"$LOG" 2>&1 || true
  fi
}}

verify_playwright() {{
  # playwright Python package has no stable __version__ attribute — probe import + CLI.
  local py="$1"
  local envp="${{2:-}}"
  if [ -n "$envp" ]; then
    env $envp "$py" -c 'import playwright; from playwright.sync_api import sync_playwright; print("ok")' >>"$LOG" 2>&1
  else
    "$py" -c 'import playwright; from playwright.sync_api import sync_playwright; print("ok")' >>"$LOG" 2>&1
  fi
}}

echo "=== creating venv ===" >>"$LOG"
if try_make_venv; then
  echo "venv ready" >>"$LOG"
else
  echo "venv create failed; trying apt python3-venv only" >>"$LOG"
  if [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    wait_for_apt
    apt-get update -y >>"$LOG" 2>&1 || true
    PY_MINOR=$(python3 -c 'import sys; print("%d.%d" % (sys.version_info.major, sys.version_info.minor))')
    apt-get install -y --no-install-recommends "python${{PY_MINOR}}-venv" >>"$LOG" 2>&1 \\
      || apt-get install -y --no-install-recommends python3-venv >>"$LOG" 2>&1 \\
      || true
    try_make_venv || true
  fi
fi

if [ "$MODE" = venv ]; then
  echo "=== pip install playwright (venv) ===" >>"$LOG"
  "$RUNTIME/venv/bin/pip" install --upgrade pip setuptools wheel >>"$LOG" 2>&1
  "$RUNTIME/venv/bin/pip" install "playwright==$PW" >>"$LOG" 2>&1
  # Download browsers; host-dep validation must not abort bootstrap.
  "$RUNTIME/venv/bin/playwright" install chromium >>"$LOG" 2>&1 || true
  PW_BIN="$RUNTIME/venv/bin/playwright"
  install_host_deps
  verify_playwright "$RUNTIME/venv/bin/python"
else
  echo "=== falling back to prefix install ===" >>"$LOG"
  MODE=prefix
  download_get_pip
  python3 "$GETPIP" --target "$RUNTIME/prefix" >>"$LOG" 2>&1
  export PYTHONPATH="$RUNTIME/prefix${{PYTHONPATH:+:$PYTHONPATH}}"
  python3 -m pip install --upgrade --target "$RUNTIME/prefix" \\
    setuptools wheel "playwright==$PW" >>"$LOG" 2>&1
  python3 -m playwright install chromium >>"$LOG" 2>&1 || true
  PW_BIN="python3 -m playwright"
  install_host_deps
  verify_playwright python3 "PYTHONPATH=$RUNTIME/prefix"
fi

export COLORIDE_BROWSER_MODE="$MODE"
python3 - <<'PY'
import json, os, pathlib
path = pathlib.Path({marker_remote!r})
path.write_text(json.dumps({{
  "playwright": {PLAYWRIGHT_VERSION!r},
  "arch": {arch!r},
  "python": {py_version!r},
  "mode": os.environ.get("COLORIDE_BROWSER_MODE", "venv"),
  "ready": True,
}}, indent=2))
print(os.environ.get("COLORIDE_BROWSER_MODE", ""))
PY
"""
            install = await self._run(install_script)
            if _status(install) != 0:
                log = await self._run("tail -n 80 /tmp/coloride-browser-pip.log 2>/dev/null || true")
                raise RuntimeError(
                    "Failed to install Playwright/Chromium on the VPS.\n"
                    "Coloride tried: venv --without-pip + get-pip → apt python3-venv only → prefix install.\n"
                    f"{_output(install)}\n{_output(log)}"
                )

        # Resolve how to invoke python for this runtime.
        launch = await self._resolve_launch(runtime_root)
        check = await self._run(launch["check_cmd"])
        if _status(check) != 0:
            raise RuntimeError(
                "Playwright installed but failed to import on the VPS. "
                f"{_output(check)}"
            )

        self._runtime_ready = True
        self._launch = launch
        return {
            "ready": True,
            "cached": not needs_install,
            "python": py_version,
            "arch": arch,
            "memMb": mem_mb,
            "mode": launch.get("mode"),
            "runtimeRoot": runtime_root,
            "sessionsRoot": sessions_root,
            "playwright": PLAYWRIGHT_VERSION,
        }

    async def _resolve_launch(self, runtime_root: str) -> dict[str, str]:
        """Pick venv python or system python + PYTHONPATH prefix."""
        marker = await self._read_remote_json(f"{runtime_root}/{RUNTIME_MARKER}")
        mode = str((marker or {}).get("mode") or "")
        venv_python = f"{runtime_root}/venv/bin/python"
        prefix = f"{runtime_root}/prefix"

        # Prefer live probe over stale marker.
        # Note: playwright has no reliable module-level __version__.
        _check = "from playwright.sync_api import sync_playwright; print('ok')"
        venv_ok = await self._run(
            f"test -x {shlex.quote(venv_python)} && "
            f"{shlex.quote(venv_python)} -c {shlex.quote(_check)} >/dev/null 2>&1"
        )
        if _status(venv_ok) == 0:
            return {
                "mode": "venv",
                "python": venv_python,
                "env_prefix": "",
                "check_cmd": f"{shlex.quote(venv_python)} -c {shlex.quote(_check)}",
            }

        prefix_ok = await self._run(
            f"test -d {shlex.quote(prefix)} && "
            f"PYTHONPATH={shlex.quote(prefix)}:${{PYTHONPATH:-}} "
            f"python3 -c {shlex.quote(_check)} >/dev/null 2>&1"
        )
        if _status(prefix_ok) == 0 or mode == "prefix":
            env_prefix = f"PYTHONPATH={shlex.quote(prefix)}:${{PYTHONPATH:-}} "
            return {
                "mode": "prefix",
                "python": "python3",
                "env_prefix": env_prefix,
                "check_cmd": f"{env_prefix}python3 -c {shlex.quote(_check)}",
            }

        # Last resort: whatever marker claimed.
        if mode == "venv":
            return {
                "mode": "venv",
                "python": venv_python,
                "env_prefix": "",
                "check_cmd": f"{shlex.quote(venv_python)} -c {shlex.quote(_check)}",
            }
        env_prefix = f"PYTHONPATH={shlex.quote(prefix)}:${{PYTHONPATH:-}} "
        return {
            "mode": mode or "prefix",
            "python": "python3",
            "env_prefix": env_prefix,
            "check_cmd": f"{env_prefix}python3 -c {shlex.quote(_check)}",
        }

    async def _driver(
        self,
        command: str,
        *,
        browser_id: str,
        extra: list[str] | None = None,
        require_ok: bool = True,
    ) -> dict[str, Any]:
        if not _SAFE_BROWSER_ID.fullmatch(browser_id):
            raise ValueError("Invalid browser id")
        home_result = await self._run("printf '%s' \"$HOME\"")
        home = _output(home_result).strip() or "/tmp"
        runtime_root = f"{home.rstrip('/')}/.coloride/browser-runtime"
        sessions_root = f"{home.rstrip('/')}/.coloride/browser-sessions"
        launch = getattr(self, "_launch", None)
        if not isinstance(launch, dict) or not launch.get("python"):
            launch = await self._resolve_launch(runtime_root)
            self._launch = launch
        python = str(launch["python"])
        env_prefix = str(launch.get("env_prefix") or "")
        driver = f"{runtime_root}/driver.py"
        parts = [
            shlex.quote(python) if python != "python3" else "python3",
            shlex.quote(driver),
            f"--root {shlex.quote(sessions_root)}",
            shlex.quote(command),
            f"--browser-id {shlex.quote(browser_id)}",
        ]
        if extra:
            parts.extend(extra)
        script = (
            "set -euo pipefail; "
            f"export HOME={shlex.quote(home)}; "
            "export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1; "
            f"{env_prefix}"
            + " ".join(parts)
        )
        result = await self._run(script)
        raw = _output(result)
        payload = _parse_json_output(raw)
        if require_ok and not payload.get("ok", False):
            raise RuntimeError(str(payload.get("error") or raw or "Browser driver failed"))
        if require_ok and _status(result) != 0 and not payload.get("ok"):
            raise RuntimeError(str(payload.get("error") or raw or f"exit {_status(result)}"))
        return payload

    async def _run(self, command: str) -> object:
        return await self.run_command(command)

    async def _write_remote_text(self, path: str, content: str) -> None:
        encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
        try:
            parent = str(PurePosixPath(path).parent)
            await self.files.mkdir(parent)
            await self._run(f"rm -f -- {shlex.quote(path)}")
            await self.files.write(path, encoded, etag=None)
        except Exception:
            await self._run(
                "python3 - <<'PY'\n"
                "import base64, pathlib\n"
                f"path=pathlib.Path({path!r})\n"
                "path.parent.mkdir(parents=True, exist_ok=True)\n"
                f"path.write_bytes(base64.b64decode({encoded!r}))\n"
                "PY"
            )

    async def _read_remote_json(self, path: str) -> dict[str, Any] | None:
        result = await self._run(
            f"python3 - <<'PY'\n"
            "import json, pathlib, sys\n"
            f"p=pathlib.Path({path!r})\n"
            "if not p.exists():\n"
            "  sys.exit(0)\n"
            "print(p.read_text())\n"
            "PY"
        )
        raw = _output(result).strip()
        if not raw:
            return None
        try:
            value = json.loads(raw)
        except ValueError:
            return None
        return value if isinstance(value, dict) else None

    def _find_for_owner(self, owner: str) -> BrowserSession | None:
        items = self.list(owner=owner)
        return items[0] if items else None

    def _require(self, browser_id: str) -> BrowserSession:
        record = self.get(browser_id)
        if record is None:
            raise LookupError(
                f"Browser {browser_id!r} is not open. It may have been closed when the "
                "agent turn was paused or the tab was closed — call browser_open again "
                "and use the new browser_id."
            )
        return record

    def _touch(self, record: BrowserSession, *, url: str, title: str) -> None:
        updated = BrowserSession(
            browser_id=record.browser_id,
            owner=record.owner,
            url=url,
            title=title,
            created_at=record.created_at,
            updated_at=datetime.now(UTC).isoformat(),
        )
        self._write(updated)

    def _write(self, record: BrowserSession) -> None:
        path = self._path(record.browser_id)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(record.to_dict(), ensure_ascii=True), encoding="utf-8")
        temporary.chmod(0o600)
        temporary.replace(path)
        path.chmod(0o600)

    def _read(self, path: Path) -> BrowserSession | None:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            # Back-compat: older agent-only records used sessionId.
            owner = str(value.get("owner") or value.get("sessionId") or "ui")
            return BrowserSession(
                browser_id=str(value["id"]),
                owner=owner,
                url=str(value.get("url") or ""),
                title=str(value.get("title") or ""),
                created_at=str(value["createdAt"]),
                updated_at=str(value.get("updatedAt") or value["createdAt"]),
            )
        except (OSError, ValueError, TypeError, KeyError):
            return None

    def _path(self, browser_id: str) -> Path:
        if not _SAFE_BROWSER_ID.fullmatch(browser_id):
            raise ValueError("Invalid browser id")
        return self.root / f"{browser_id}.json"

    @staticmethod
    def _validate_owner(owner: str) -> None:
        if not _SAFE_OWNER.fullmatch(owner):
            raise ValueError("Invalid browser owner")


def _local_driver_source() -> str:
    try:
        return resources.files(__package__ + ".runtime").joinpath("driver.py").read_text(encoding="utf-8")
    except Exception:
        path = Path(__file__).resolve().parent / "runtime" / "driver.py"
        return path.read_text(encoding="utf-8")


def _validate_url(url: str) -> str:
    url = url.strip()
    if not url or len(url) > 2_000:
        raise ValueError("URL is required")
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only http and https URLs are allowed")
    if not parsed.netloc:
        raise ValueError("URL must include a host")
    if "\0" in url:
        raise ValueError("Invalid URL")
    return url


def _validate_ref(ref: str) -> str:
    ref = ref.strip()
    if not re.fullmatch(r"e\d{1,4}", ref):
        raise ValueError("ref must look like e1, e2, … from browser_snapshot")
    return ref


def _parse_json_output(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        return {"ok": False, "error": "Empty browser driver output"}
    for line in reversed(text.splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            return value
    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return value
    except ValueError:
        pass
    return {"ok": False, "error": text[:2_000]}


def _status(result: object) -> int:
    value = getattr(result, "exit_status", 0)
    return int(value) if isinstance(value, int) else 0


def _output(result: object) -> str:
    stdout = str(getattr(result, "stdout", "") or "")
    stderr = str(getattr(result, "stderr", "") or "")
    return "\n".join(value for value in (stdout.strip(), stderr.strip()) if value)


def _safe_int(value: str, default: int) -> int:
    try:
        return int(value)
    except ValueError:
        return default
