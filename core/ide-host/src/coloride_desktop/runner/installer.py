from __future__ import annotations

import json
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

import asyncssh


RunCommand = Callable[[str], Awaitable[object]]
GetSftp = Callable[[], Awaitable[asyncssh.SFTPClient]]

RUNNER_VERSION = "0.1.0"
RUNNER_ROOT = "~/.coloride/runner"
RUNNER_TMUX_SESSION = "coloride_runner"


@dataclass(frozen=True, slots=True)
class RunnerPlatform:
    operating_system: str
    architecture: str

    @property
    def artifact_name(self) -> str:
        return f"coloride-runner-linux-{self.architecture}"


class RunnerInstallError(RuntimeError):
    """A clear, actionable compatibility or installation error."""


class RemoteRunnerInstaller:
    """Install and operate the immutable runner artifact over a verified SSH link."""

    def __init__(self, run_command: RunCommand, get_sftp: GetSftp, resources: Path | None = None) -> None:
        self._run_command = run_command
        self._get_sftp = get_sftp
        self._resources = resources or Path(__file__).resolve().parents[3] / "resources" / "runner"
        self._sftp_root: str | None = None

    async def detect_platform(self) -> RunnerPlatform:
        result = await self._run_command("uname -s; uname -m")
        if _status(result) != 0:
            raise RunnerInstallError(_output(result) or "Unable to detect VPS operating system")
        lines = [line.strip().lower() for line in _output(result).splitlines() if line.strip()]
        if len(lines) < 2 or lines[0] != "linux":
            got = lines[0] if lines else "unknown"
            raise RunnerInstallError(
                f"Persistent Coloride Agent currently supports Linux VPSs only (this server: {got})."
            )
        aliases = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "arm64", "arm64": "arm64"}
        architecture = aliases.get(lines[1])
        if architecture is None:
            raise RunnerInstallError(
                f"Persistent Coloride Agent supports Linux x86_64 and arm64 only (this VPS: {lines[1]})."
            )
        return RunnerPlatform("linux", architecture)

    async def ensure_ready(self) -> RunnerPlatform:
        platform = await self.detect_platform()
        tmux = await self._run_command("command -v tmux >/dev/null 2>&1")
        if _status(tmux) != 0:
            raise RunnerInstallError(
                "This VPS does not have tmux. Coloride Runner cannot persist safely without it; "
                "install tmux once on the VPS and reconnect."
            )
        artifact = self._resources / platform.artifact_name
        if not artifact.is_file():
            raise RunnerInstallError(
                f"The Coloride Runner artifact for Linux {platform.architecture} is not bundled in this build. "
                "Update Coloride and try again."
            )
        remote_bin = f"{RUNNER_ROOT}/bin/coloride-runner"
        await self._run_command(f"mkdir -p {RUNNER_ROOT}/bin && chmod 700 {RUNNER_ROOT} {RUNNER_ROOT}/bin")
        sftp = await self._get_sftp()
        # SFTP paths do not consistently expand '~', unlike shell commands.
        # Resolve the home directory before uploading so the artifact cannot end
        # up in a literal `~` directory on stricter SSH servers.
        remote_tmp = f"{await self._absolute_root()}/bin/.coloride-runner-{RUNNER_VERSION}.next"
        await sftp.put(str(artifact), remote_tmp)
        install = (
            f"chmod 700 {shlex.quote(remote_tmp)} && "
            f"mv {shlex.quote(remote_tmp)} {shlex.quote(remote_bin)} && "
            f"{shlex.quote(remote_bin)} --root {RUNNER_ROOT} health"
        )
        result = await self._run_command(install)
        if _status(result) != 0:
            raise RunnerInstallError(_output(result) or "Coloride Runner failed its health check")
        launch = (
            f"tmux has-session -t {RUNNER_TMUX_SESSION} 2>/dev/null || "
            f"tmux new-session -d -s {RUNNER_TMUX_SESSION} "
            f"{shlex.quote(remote_bin)} --root {RUNNER_ROOT} serve"
        )
        result = await self._run_command(launch)
        if _status(result) != 0:
            raise RunnerInstallError(_output(result) or "Unable to start Coloride Runner in tmux")
        return platform

    async def _absolute_root(self) -> str:
        if self._sftp_root is not None:
            return self._sftp_root
        result = await self._run_command('printf %s "$HOME"')
        home = _output(result).strip()
        if _status(result) != 0 or not home.startswith("/"):
            raise RunnerInstallError("Unable to resolve the VPS home directory for runner installation")
        self._sftp_root = f"{home}/.coloride/runner"
        return self._sftp_root

    async def submit(self, job: dict[str, Any]) -> dict[str, Any]:
        raw = json.dumps(job, ensure_ascii=True, separators=(",", ":"))
        command = (
            f"{RUNNER_ROOT}/bin/coloride-runner --root {RUNNER_ROOT} submit --job {shlex.quote(raw)}"
        )
        return await self._json_command(command)

    async def events(self, job_id: str, after_sequence: int = 0) -> list[dict[str, Any]]:
        command = (
            f"{RUNNER_ROOT}/bin/coloride-runner --root {RUNNER_ROOT} events "
            f"--job-id {shlex.quote(job_id)} --after {max(0, after_sequence)}"
        )
        value = await self._json_command(command)
        return value if isinstance(value, list) else []

    async def stop(self, job_id: str) -> dict[str, Any]:
        return await self._json_command(
            f"{RUNNER_ROOT}/bin/coloride-runner --root {RUNNER_ROOT} stop --job-id {shlex.quote(job_id)}"
        )

    async def _json_command(self, command: str) -> Any:
        result = await self._run_command(command)
        if _status(result) != 0:
            raise RunnerInstallError(_output(result) or "Coloride Runner command failed")
        try:
            return json.loads(_output(result))
        except ValueError as exc:
            raise RunnerInstallError("Coloride Runner returned an invalid response") from exc


def _status(result: object) -> int:
    value = getattr(result, "exit_status", 0)
    return int(value) if isinstance(value, int) else 0


def _output(result: object) -> str:
    stdout = str(getattr(result, "stdout", "") or "")
    stderr = str(getattr(result, "stderr", "") or "")
    return "\n".join(value for value in (stdout.strip(), stderr.strip()) if value)
