from __future__ import annotations

import base64

from coloride_desktop.agents.checkpoints import AgentCheckpointManager
from coloride_desktop.agents.domain import AgentMode, AgentSession
from coloride_desktop.agents.provider import ModelToolCall


class FakeFiles:
    def __init__(self) -> None:
        self.values = {"/srv/app/existing.txt": b"before\n"}
        self.etags = {"/srv/app/existing.txt": "etag-before"}

    async def read(self, path: str) -> tuple[str, str, bool]:
        if path not in self.values:
            raise FileNotFoundError(path)
        return (
            base64.b64encode(self.values[path]).decode("ascii"),
            self.etags[path],
            False,
        )

    async def write(self, path: str, content: str, _etag: str | None) -> str:
        self.values[path] = base64.b64decode(content)
        self.etags[path] = f"etag-{len(self.etags) + 1}"
        return self.etags[path]

    async def delete(self, path: str) -> None:
        if path not in self.values:
            raise FileNotFoundError(path)
        del self.values[path]
        self.etags.pop(path, None)

    async def mkdir(self, _path: str) -> None:
        return None


async def test_checkpoint_restores_changed_and_new_files(tmp_path) -> None:
    files = FakeFiles()
    manager = AgentCheckpointManager(files, tmp_path / "checkpoints")  # type: ignore[arg-type]
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    call = ModelToolCall(call_id="call-edit", name="write_file", arguments={})

    checkpoint = await manager.capture(
        call,
        session,
        ["/srv/app/existing.txt", "/srv/app/new.txt"],
    )
    assert checkpoint is not None
    await files.write(
        "/srv/app/existing.txt",
        base64.b64encode(b"after\n").decode("ascii"),
        None,
    )
    await files.write(
        "/srv/app/new.txt",
        base64.b64encode(b"created\n").decode("ascii"),
        None,
    )

    await manager.restore(checkpoint.checkpoint_id, session.session_id)

    assert files.values["/srv/app/existing.txt"] == b"before\n"
    assert "/srv/app/new.txt" not in files.values
    checkpoint_path = tmp_path / "checkpoints" / f"{checkpoint.checkpoint_id}.json"
    assert checkpoint_path.stat().st_mode & 0o777 == 0o600
    assert manager.list(session.session_id)[0].checkpoint_id == checkpoint.checkpoint_id
