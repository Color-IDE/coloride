from __future__ import annotations

from pathlib import Path

from coloride_desktop.agents.runtime import bundled_runtime_script, runtime_executable


def test_override_path_is_used_when_it_exists(tmp_path, monkeypatch) -> None:
    script = tmp_path / "coloride-runtime.mjs"
    script.write_text("// host\n", encoding="utf-8")
    monkeypatch.setenv("COLORIDE_AGENT_RUNTIME", str(script))
    assert bundled_runtime_script() == script.resolve()


def test_missing_override_falls_through_to_later_candidate(tmp_path, monkeypatch) -> None:
    missing = tmp_path / "missing.mjs"
    real = tmp_path / "real.mjs"
    real.write_text("// host\n", encoding="utf-8")
    monkeypatch.setenv("COLORIDE_AGENT_RUNTIME", str(missing))
    monkeypatch.setattr(
        "coloride_desktop.agents.runtime._runtime_candidates",
        lambda: [missing, real],
    )
    assert bundled_runtime_script() == real.resolve()


def test_runtime_executable_uses_existing_electron_binary(tmp_path, monkeypatch) -> None:
    electron = tmp_path / "electron.exe"
    electron.write_bytes(b"")
    monkeypatch.setenv("COLORIDE_AGENT_NODE", str(electron))
    assert Path(runtime_executable() or "") == electron


def test_runtime_executable_ignores_stale_electron_path(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("COLORIDE_AGENT_NODE", str(tmp_path / "gone" / "electron.exe"))
    monkeypatch.setattr(
        "coloride_desktop.agents.runtime.shutil.which",
        lambda name: str(tmp_path / "node.exe") if name in {"node", "node.exe"} else None,
    )
    assert runtime_executable() == str(tmp_path / "node.exe")


async def test_parallel_stop_waits_for_outstanding_tool_replies():
    import asyncio
    import pytest
    from coloride_desktop.agents.runtime import AgentRuntime

    if not bundled_runtime_script() or not runtime_executable():
        pytest.skip("Bundled runtime and Node are required")
    runtime = AgentRuntime()
    cancel = asyncio.Event()
    calls = [
        {"call_id": f"read-{i}", "name": "read_file", "arguments": {"path": f"file-{i}"}}
        for i in range(8)
    ]
    try:
        await runtime.start(session_id="parallel-stop", mode="act", tools=[{
            "name": "read_file", "executionMode": "parallel",
            "parameters": {"type": "object", "properties": {"path": {"type": "string"}}},
        }])
        request = await asyncio.wait_for(runtime.receive(cancel), 5)
        assert request["op"] == "model"
        await runtime.reply(request, {"tool_calls": calls})
        replied = set()
        while True:
            request = await asyncio.wait_for(runtime.receive(cancel), 5)
            if request["op"] == "tool":
                if not replied:
                    await runtime.reply(request, {"output": "already read", "stopReason": "No progress"})
                    # Allow the runtime's stop path to run before the next reply.
                    await asyncio.sleep(0.1)
                else:
                    await runtime.reply(request, {"output": "already read"})
                replied.add(request["call"]["call_id"])
            elif request["op"] == "done":
                assert request["stopReason"] == "No progress"
                break
            else:
                assert request["op"] not in {"fatal", "model"}
        assert replied == {call["call_id"] for call in calls}
    finally:
        await runtime.close()


async def test_closed_uvloop_writer_reports_runtime_error_and_close_cleans_up():
    import asyncio
    from types import SimpleNamespace
    import pytest
    from coloride_desktop.agents.runtime import AgentRuntime, AgentRuntimeError

    class ClosedWriter:
        def is_closing(self):
            return False  # The pipe can close between the check and write.

        def write(self, _data):
            raise RuntimeError("unable to perform operation; the handler is closed")

    waited = False

    async def wait():
        nonlocal waited
        waited = True
        return 1

    runtime = AgentRuntime()
    runtime.process = SimpleNamespace(stdin=ClosedWriter(), returncode=None, wait=wait)
    runtime._stderr = "runtime stopped"
    runtime._stderr_task = asyncio.create_task(asyncio.sleep(60))
    with pytest.raises(AgentRuntimeError, match="runtime stopped"):
        await runtime.reply({"id": 1}, {"output": "finished"})
    await runtime.close()
    assert waited
    assert runtime._stderr_task.done()
