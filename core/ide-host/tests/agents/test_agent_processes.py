from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

from coloride_desktop.agents.processes import AgentProcessRegistry


@dataclass(slots=True)
class FakeCommandResult:
    stdout: str = ""
    stderr: str = ""
    exit_status: int = 0


class FakeRunner:
    def __init__(self, *, tmux: bool) -> None:
        self.tmux = tmux
        self.commands: list[str] = []

    async def __call__(self, command: str) -> FakeCommandResult:
        self.commands.append(command)
        if command.startswith("command -v tmux"):
            return FakeCommandResult(exit_status=0 if self.tmux else 1)
        if command.startswith("tmux new-session") and not self.tmux:
            return FakeCommandResult(stderr="zsh:1: command not found: tmux", exit_status=127)
        if "echo $! >" in command:
            pid_path = command.rsplit(">", 1)[-1].strip().strip("'\"")
            Path(pid_path).write_text("4242\n", encoding="utf-8")
        if command.startswith("kill -0"):
            return FakeCommandResult(exit_status=0)
        return FakeCommandResult()


async def test_start_uses_tmux_when_available(tmp_path: Path) -> None:
    runner = FakeRunner(tmux=True)
    registry = AgentProcessRegistry(runner, root=tmp_path)

    process = await registry.start("sess_1", "npm run dev", "/tmp/app")

    assert process.backend == "tmux"
    assert any(command.startswith("tmux new-session") for command in runner.commands)
    assert not any("nohup" in command for command in runner.commands)


async def test_start_falls_back_locally_when_tmux_is_missing(tmp_path: Path) -> None:
    runner = FakeRunner(tmux=False)
    registry = AgentProcessRegistry(runner, root=tmp_path)

    process = await registry.start("sess_1", "npm run dev", "/tmp/app")

    assert process.backend == "local"
    assert process.pid == 4242
    assert process.log_path is not None
    assert Path(process.log_path).name == f"{process.process_id}.log"
    assert any("nohup /bin/zsh -lc" in command for command in runner.commands)
    assert not any(command.startswith("tmux new-session") for command in runner.commands)

    Path(process.log_path).write_text("ready\nlistening\n", encoding="utf-8")
    _, output, alive = await registry.read("sess_1", process.process_id, 20)
    assert alive is True
    assert "listening" in output

    await registry.stop("sess_1", process.process_id)
    assert any("kill -TERM -4242" in command for command in runner.commands)


async def test_local_native_start_does_not_require_tmux(tmp_path: Path) -> None:
    runner = FakeRunner(tmux=False)
    registry = AgentProcessRegistry(runner, root=tmp_path)
    cwd = tmp_path / "app"
    cwd.mkdir()

    process = await registry.start(
        "sess_1",
        "printf 'hello-local\\n'",
        str(cwd),
        local=True,
    )

    assert process.backend == "local"
    assert process.pid is not None
    assert process.log_path is not None
    for _ in range(50):
        _, output, alive = await registry.read("sess_1", process.process_id, 20)
        if "hello-local" in output or not alive:
            break
        await asyncio.sleep(0.02)
    assert "hello-local" in Path(process.log_path).read_text(encoding="utf-8")
    await registry.stop("sess_1", process.process_id)
    assert not any(command.startswith("tmux new-session") for command in runner.commands)
