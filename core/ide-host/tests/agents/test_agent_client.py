from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from typing import Any

import pytest

from coloride_desktop.agents.client import AgentProxyClient, AgentTurnActiveError
from coloride_desktop.agents.domain import AgentMode, AgentSession, AgentSessionState
from coloride_desktop.agents.engine import _compatible_stream_kwargs
from coloride_desktop.agents.provider import (
    AgentProviderError,
    ModelResponse,
    ModelToolCall,
    ModelUsage,
)
from coloride_desktop.agents.policy import ScopedGrant
from coloride_desktop.agents.store import AgentSessionStore
from coloride_desktop.agents.task import AgentTaskStatus
from coloride_desktop.agents.telemetry import AgentTelemetryStore


class FakeFiles:
    async def realpath(self, path: str) -> str:
        return path.rstrip("/") or "/"

    async def read(self, path: str) -> tuple[str, str, bool]:
        raise FileNotFoundError(path)


@pytest.mark.asyncio
async def test_list_sessions_is_scoped_to_workspace_root(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    local = AgentSession.create(
        agent="coloride",
        cwd="/Users/example/project/",
        mode=AgentMode.ACT,
        workspace_kind="local",
        connection_id="local",
    )
    remote = AgentSession.create(
        agent="coloride",
        cwd="/home/coloride/workspaces/project",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        connection_id="server-a",
        filesystem_scope="workspace",
    )
    server_wide = AgentSession.create(
        agent="coloride",
        cwd="/home/coloride",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        connection_id="server-a",
        filesystem_scope="server",
    )
    store.save_session(local)
    store.save_session(remote)
    store.save_session(server_wide)

    client = AgentProxyClient(store=store)
    sessions = await client.list_sessions(cwd="/Users/example/project")

    assert [session.session_id for session in sessions] == [local.session_id]

    local_sessions = await client.list_sessions(
        workspace_kind="local",
        connection_id="local",
    )
    remote_sessions = await client.list_sessions(
        workspace_kind="ssh",
        connection_id="server-a",
    )
    workspace_sessions = await client.list_sessions(
        workspace_kind="ssh",
        connection_id="server-a",
        filesystem_scope="workspace",
    )
    server_sessions = await client.list_sessions(
        workspace_kind="ssh",
        connection_id="server-a",
        filesystem_scope="server",
    )
    assert [session.session_id for session in local_sessions] == [local.session_id]
    assert {session.session_id for session in remote_sessions} == {
        remote.session_id,
        server_wide.session_id,
    }
    assert [session.session_id for session in workspace_sessions] == [remote.session_id]
    assert [session.session_id for session in server_sessions] == [server_wide.session_id]


async def test_session_summary_clears_deprecated_fresh_token_pause(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    session = AgentSession.create(
        agent="coloride",
        cwd="/srv/app",
        mode=AgentMode.ACT,
    )
    session.state = AgentSessionState.PAUSED_GUARD
    store.save_session(session)
    task = store.ensure_task(session)
    task.status = AgentTaskStatus.PAUSED_GUARD
    task.guard_pause = {
        "reason": "fresh-tokens",
        "message": "This task used the configured fresh-token budget.",
    }
    store.save_task(task)

    client = AgentProxyClient(store=store)
    summary = await client.get_session(session.session_id)

    assert summary is not None
    assert summary.state == AgentSessionState.IDLE.value
    assert summary.guard_pause is None
    restored_task = store.get_task(session.session_id)
    assert restored_task is not None
    assert restored_task.status == AgentTaskStatus.IDLE


def test_retryable_guard_is_released_by_the_next_user_message(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    session.state = AgentSessionState.PAUSED_GUARD
    store.save_session(session)
    task = store.ensure_task(session)
    task.status = AgentTaskStatus.PAUSED_GUARD
    task.guard_pause = {
        "reason": "provider-errors",
        "message": "The model provider failed repeatedly.",
    }
    store.save_task(task)

    client = AgentProxyClient(store=store)
    client._clear_retryable_guard_for_new_message(session)

    restored_task = store.get_task(session.session_id)
    restored_session = store.get_session(session.session_id)
    assert restored_task is not None and restored_task.guard_pause is None
    assert restored_task.status == AgentTaskStatus.IDLE
    assert restored_session is not None and restored_session.state == AgentSessionState.IDLE


@dataclass(slots=True)
class FakeCommandResult:
    stdout: str
    stderr: str = ""
    exit_status: int = 0


class ScriptedProvider:
    model = "coloride-test-model"

    def __init__(self, responses: list[ModelResponse]) -> None:
        self.responses = responses
        self.inputs: list[list[dict[str, Any]]] = []
        self.tool_sets: list[list[dict[str, Any]]] = []

    async def complete(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: object | None = None,
    ) -> ModelResponse:
        assert "Coloride Agent" in instructions
        self.inputs.append(input_items)
        self.tool_sets.append(tools)
        if not self.responses:
            # Plan-mode forced submit_plan retry with no scripted follow-up.
            return ModelResponse(
                response_id="response-empty",
                text="Done.",
                tool_calls=(),
                output_items=(
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": "Done."}],
                    },
                ),
                usage=ModelUsage(input_tokens=1, output_tokens=1, total_tokens=2),
            )
        return self.responses.pop(0)


class RecoveringProvider(ScriptedProvider):
    def __init__(self, response: ModelResponse) -> None:
        super().__init__([response])
        self.calls = 0
        self.transient_failures = 0

    async def complete(self, **kwargs: Any) -> ModelResponse:
        self.calls += 1
        if self.calls == 1:
            self.transient_failures += 1
            self.inputs.append(kwargs.get("input_items") or [])
            return ModelResponse(
                response_id="response-retry",
                text="",
                tool_calls=(),
                output_items=(),
                usage=ModelUsage(),
                provider_retry=True,
            )
        return await super().complete(**kwargs)

    async def generate_title(self, _message: str) -> str:
        return "Automatic recovery"


class TitleGeneratingProvider(ScriptedProvider):
    def __init__(self, responses: list[ModelResponse]) -> None:
        super().__init__(responses)
        self.title_requests: list[str] = []

    async def generate_title(self, message: str) -> str:
        self.title_requests.append(message)
        return '  "Inspect Remote Git Status."  '


class PausedStreamingProvider:
    model = "coloride-streaming-model"

    def __init__(self) -> None:
        self.first_delta = asyncio.Event()
        self.release = asyncio.Event()

    async def complete_stream(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text_delta,
        on_reasoning_delta,
        tool_choice: object | None = None,
    ) -> ModelResponse:
        assert "Coloride Agent" in instructions
        # First user turn only — ignore hidden plan-force nudges.
        assert any(
            item.get("role") == "user" and item.get("content") == "Stream a response"
            for item in input_items
        )
        assert tools
        await on_reasoning_delta("Inspecting the workspace context.")
        await on_text_delta("Streaming")
        self.first_delta.set()
        await self.release.wait()
        await on_text_delta(" works.")
        return ModelResponse(
            response_id="response-stream",
            text="Streaming works.",
            tool_calls=(),
            output_items=(
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "Streaming works."}],
                },
            ),
            usage=ModelUsage(input_tokens=8, output_tokens=3, total_tokens=11),
            streamed=True,
        )


async def test_stream_signature_compatibility_does_not_retry_provider_type_errors() -> None:
    async def legacy_stream(
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text_delta,
        on_reasoning_delta,
        tool_choice: object | None = None,
    ) -> ModelResponse:
        raise AssertionError("The test only inspects this callable's signature")

    kwargs = {
        "instructions": "Test",
        "input_items": [],
        "tools": [],
        "tool_choice": None,
        "on_text_delta": lambda _text: None,
        "on_reasoning_delta": lambda _text: None,
        "on_tool_args_delta": lambda *_args: None,
    }
    compatible = _compatible_stream_kwargs(legacy_stream, **kwargs)
    assert "on_tool_args_delta" not in compatible
    assert "tool_choice" in compatible

    calls = 0

    async def broken_stream(**_kwargs) -> ModelResponse:
        nonlocal calls
        calls += 1
        raise TypeError("provider internal failure")

    with pytest.raises(TypeError, match="provider internal failure"):
        await broken_stream(**_compatible_stream_kwargs(broken_stream, **kwargs))
    assert calls == 1


async def test_request_approval_only_collects_the_policy_engine_decision(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    published: list[tuple[str, dict[str, object]]] = []

    async def publish(topic: str, payload: dict[str, object]) -> None:
        published.append((topic, payload))

    client = AgentProxyClient(store=store, publish=publish)
    call = ModelToolCall(
        call_id="call-command",
        name="execute_command",
        arguments={"command": "npm test", "cwd": "."},
    )
    details = {
        "tool": "execute_command",
        "risk": "execute",
        "command": "npm test",
        "cwd": ".",
        "suggestedGrant": ScopedGrant(
            capability="execute_command",
            executable="npm",
            argument_class="test",
            cwd="/srv/app",
            connection_id="local",
            network_scope="none",
        ).to_dict(),
    }

    act = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    store.save_session(act)

    decision_task = asyncio.create_task(
        client._request_approval(act.session_id, call, details)  # noqa: SLF001
    )
    for _ in range(20):
        approvals = store.list_approvals(act.session_id, pending_only=True)
        if approvals:
            break
        await asyncio.sleep(0)
    else:
        raise AssertionError("Act mode did not create an approval")

    approval = approvals[0]
    assert await client.resolve_approval(approval.approval_id, "approve-session") is True
    assert await decision_task == "approve-session"
    assert store.get_session(act.session_id).state == AgentSessionState.RUNNING  # type: ignore[union-attr]
    assert any(
        topic == "agent:event" and payload.get("type") == "approval_required"
        for topic, payload in published
    )
    # For commands, "Allow for session" means all commands in this session,
    # not only npm test or the current cwd.
    rebuilt = AgentProxyClient(store=store)
    restored = rebuilt._active_session_grants(act.session_id)  # noqa: SLF001
    assert len(restored) == 1
    assert restored[0].expires_at is None
    assert restored[0].capability == "command:*"
    assert restored[0].executable == "*"


@pytest.mark.asyncio
async def test_internal_progress_events_are_audited_but_not_published(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    published: list[tuple[str, dict[str, object]]] = []

    async def publish(topic: str, payload: dict[str, object]) -> None:
        published.append((topic, payload))

    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    store.save_session(session)
    client = AgentProxyClient(store=store, publish=publish)

    await client._emit(  # noqa: SLF001
        session.session_id,
        "soft_replan",
        {"internal": True, "strategyId": 2},
    )

    events = store.list_events(session.session_id)
    assert any(event.type == "soft_replan" for event in events)
    assert not any(
        topic == "agent:event" and payload.get("type") == "soft_replan"
        for topic, payload in published
    )


async def test_reconcile_ssh_workspaces_migrates_source_tree_and_reauthorizes_grant(
    tmp_path,
) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    client = AgentProxyClient(store=store)

    exact = AgentSession.create(
        agent="coloride",
        cwd="/var/www/app",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        connection_id="prof_server",
        filesystem_scope="workspace",
    )
    server_wide = AgentSession.create(
        agent="coloride",
        cwd="/var/www/app",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        connection_id="prof_server",
        filesystem_scope="server",
    )
    child = AgentSession.create(
        agent="coloride",
        cwd="/var/www/app/packages/web",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        connection_id="prof_server",
    )
    other = AgentSession.create(
        agent="coloride",
        cwd="/var/www/other",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        connection_id="prof_server",
    )
    other.last_error = (
        "This chat workspace is no longer authorized for the active SSH profile. "
        "Choose or prepare an allowed workspace before continuing."
    )
    different_server = AgentSession.create(
        agent="coloride",
        cwd="/var/www/app",
        mode=AgentMode.ACT,
        workspace_kind="ssh",
        connection_id="prof_other",
    )
    for session in (exact, child, other, different_server, server_wide):
        store.save_session(session)

    result = await client.reconcile_ssh_workspaces(
        connection_id="prof_server",
        allowed_roots=["/home/coloride", "/tmp/coloride", "/var/www/other"],
        migrations={"/var/www/app": "/home/coloride/workspace/app"},
    )

    assert set(result["migrated"]) == {exact.session_id, child.session_id}
    assert result["invalidated"] == []
    assert result["reauthorized"] == [other.session_id]
    assert store.get_session(exact.session_id).cwd == "/home/coloride/workspace/app"  # type: ignore[union-attr]
    assert store.get_session(child.session_id).cwd == "/home/coloride/workspace/app/packages/web"  # type: ignore[union-attr]
    assert store.get_session(other.session_id).last_error is None  # type: ignore[union-attr]
    assert store.get_session(different_server.session_id).cwd == "/var/www/app"  # type: ignore[union-attr]
    assert store.get_session(server_wide.session_id).cwd == "/var/www/app"  # type: ignore[union-attr]
    assert store.get_session(server_wide.session_id).last_error is None  # type: ignore[union-attr]


async def test_native_agent_runs_model_tool_loop_without_codex_process(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    provider = ScriptedProvider(
        [
            ModelResponse(
                response_id="response-tool",
                text="",
                tool_calls=(
                    ModelToolCall(
                        call_id="call-status",
                        name="git_status",
                        arguments={},
                    ),
                ),
                output_items=(
                    {
                        "type": "function_call",
                        "call_id": "call-status",
                        "name": "git_status",
                        "arguments": "{}",
                    },
                ),
                usage=ModelUsage(input_tokens=12, output_tokens=4, total_tokens=16),
            ),
            ModelResponse(
                response_id="response-final",
                text="The workspace is clean.",
                tool_calls=(),
                output_items=(
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {"type": "output_text", "text": "The workspace is clean."}
                        ],
                    },
                ),
                usage=ModelUsage(input_tokens=20, output_tokens=6, total_tokens=26),
            ),
        ]
    )

    async def provider_factory() -> ScriptedProvider:
        return provider

    async def run_command(command: str) -> FakeCommandResult:
        assert command == "git -C /srv/app status --short --branch"
        return FakeCommandResult(stdout="## main")

    client = AgentProxyClient(
        files=FakeFiles(),  # type: ignore[arg-type]
        run_command=run_command,
        store=store,
        provider_factory=provider_factory,
        telemetry=AgentTelemetryStore(tmp_path / "agent-metrics.jsonl"),
    )
    session_id = await client.start_session(
        agent="coloride",
        task=None,
        cwd="/srv/app",
        budget_usd=None,
        mode=AgentMode.PLAN,
    )
    assert await client.send(session_id, "Inspect the Git status") is True

    for _ in range(500):
        session = store.get_session(session_id)
        if session is not None and session.state == AgentSessionState.IDLE:
            break
        await asyncio.sleep(0.01)
    else:
        raise AssertionError("Native agent turn did not complete")

    event_types = [event.type for event in store.list_events(session_id)]
    assert "runtime_started" in event_types
    assert event_types.index("context_snapshot") < event_types.index("activity")
    assert "tool_call" in event_types
    assert "tool_output" in event_types
    assert "text" in event_types or "text_delta" in event_types
    assert "done" in event_types
    assert len(provider.inputs) == 2
    assert any(
        item.get("type") == "function_call_output"
        for item in provider.inputs[1]
    )
    assert {tool["name"] for tool in provider.tool_sets[0]} >= {
        "read_file",
        "git_status",
    }
    assert "execute_command" not in {tool["name"] for tool in provider.tool_sets[0]}


class ReadableFakeFiles(FakeFiles):
    def __init__(self) -> None:
        self.reads: list[str] = []

    async def read(self, path: str) -> tuple[str, str, bool]:
        self.reads.append(path)
        body = f"contents of {path}\n".encode("utf-8")
        return (
            base64.b64encode(body).decode("ascii"),
            "etag-1",
            False,
        )


async def test_native_agent_runs_parallel_reads_in_one_model_round(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    provider = ScriptedProvider(
        [
            ModelResponse(
                response_id="response-tools",
                text="",
                tool_calls=(
                    ModelToolCall(
                        call_id="call-a",
                        name="read_file",
                        arguments={"path": "a.ts", "start_line": 1, "end_line": 20},
                    ),
                    ModelToolCall(
                        call_id="call-b",
                        name="read_file",
                        arguments={"path": "b.ts", "start_line": 1, "end_line": 20},
                    ),
                ),
                output_items=(
                    {
                        "type": "function_call",
                        "call_id": "call-a",
                        "name": "read_file",
                        "arguments": '{"path":"a.ts","start_line":1,"end_line":20}',
                    },
                    {
                        "type": "function_call",
                        "call_id": "call-b",
                        "name": "read_file",
                        "arguments": '{"path":"b.ts","start_line":1,"end_line":20}',
                    },
                ),
                usage=ModelUsage(input_tokens=12, output_tokens=8, total_tokens=20),
            ),
            ModelResponse(
                response_id="response-final",
                text="Both files loaded.",
                tool_calls=(),
                output_items=(
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {"type": "output_text", "text": "Both files loaded."}
                        ],
                    },
                ),
                usage=ModelUsage(input_tokens=30, output_tokens=6, total_tokens=36),
            ),
        ]
    )

    async def provider_factory() -> ScriptedProvider:
        return provider

    files = ReadableFakeFiles()

    async def run_command(_command: str) -> FakeCommandResult:
        return FakeCommandResult(stdout="")

    client = AgentProxyClient(
        files=files,  # type: ignore[arg-type]
        run_command=run_command,
        store=store,
        provider_factory=provider_factory,
        telemetry=AgentTelemetryStore(tmp_path / "agent-metrics.jsonl"),
    )
    session_id = await client.start_session(
        agent="coloride",
        task=None,
        cwd="/srv/app",
        budget_usd=None,
        mode=AgentMode.ASK,
    )
    assert await client.send(session_id, "Read a.ts and b.ts") is True

    for _ in range(100):
        session = store.get_session(session_id)
        if session is not None and session.state == AgentSessionState.IDLE:
            break
        await asyncio.sleep(0.01)
    else:
        raise AssertionError("Native agent turn did not complete")

    assert len(provider.inputs) == 2
    outputs = [
        item
        for item in provider.inputs[1]
        if item.get("type") == "function_call_output"
    ]
    assert {item.get("call_id") for item in outputs} == {"call-a", "call-b"}
    assert {"/srv/app/a.ts", "/srv/app/b.ts"}.issubset(files.reads)


async def test_native_agent_recovers_from_transient_provider_error_without_user_prompt(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("COLORIDE_AGENT_FAST_RETRY", "1")
    store = AgentSessionStore(tmp_path / "agents")
    provider = RecoveringProvider(
        ModelResponse(
            response_id="response-recovered",
            text="Recovered without user input.",
            tool_calls=(),
            output_items=(
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        {"type": "output_text", "text": "Recovered without user input."}
                    ],
                },
            ),
            usage=ModelUsage(input_tokens=10, output_tokens=4, total_tokens=14),
        )
    )

    async def provider_factory() -> RecoveringProvider:
        return provider

    async def run_command(_command: str) -> FakeCommandResult:
        return FakeCommandResult(stdout="")

    client = AgentProxyClient(
        files=FakeFiles(),  # type: ignore[arg-type]
        run_command=run_command,
        store=store,
        provider_factory=provider_factory,
        telemetry=AgentTelemetryStore(tmp_path / "agent-metrics.jsonl"),
    )
    session_id = await client.start_session(
        agent="coloride",
        task=None,
        cwd="/srv/app",
        budget_usd=None,
        mode=AgentMode.ACT,
    )
    assert await client.send(session_id, "Recover by yourself") is True

    for _ in range(500):
        session = store.get_session(session_id)
        if session is not None and session.state == AgentSessionState.IDLE:
            break
        await asyncio.sleep(0.01)
    else:
        raise AssertionError("Agent did not recover from a transient provider error")

    assert provider.transient_failures == 1
    assert provider.calls >= 2
    events = store.list_events(session_id)
    assert any(event.type in {"text", "text_delta"} for event in events)
    assert not any(event.type in {"approval_required", "guard_paused"} for event in events)
    task = store.get_task(session_id)
    assert task is not None
    assert task.budget_usage.consecutive_provider_errors == 0


async def test_agent_publishes_text_deltas_before_turn_finishes(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    provider = PausedStreamingProvider()
    published: list[tuple[str, dict[str, object]]] = []

    async def provider_factory() -> PausedStreamingProvider:
        return provider

    async def publish(topic: str, payload: dict[str, object]) -> None:
        published.append((topic, payload))

    async def run_command(command: str) -> FakeCommandResult:
        return FakeCommandResult(stdout="")

    client = AgentProxyClient(
        files=FakeFiles(),  # type: ignore[arg-type]
        run_command=run_command,
        publish=publish,
        store=store,
        provider_factory=provider_factory,
        telemetry=AgentTelemetryStore(tmp_path / "agent-metrics.jsonl"),
    )
    session_id = await client.start_session(
        agent="coloride",
        task=None,
        cwd="/srv/app",
        budget_usd=None,
        mode=AgentMode.PLAN,
    )
    assert await client.send(session_id, "Stream a response") is True

    await asyncio.wait_for(provider.first_delta.wait(), timeout=5)
    for _ in range(20):
        event_types = [event.type for event in store.list_events(session_id)]
        if "text_delta" in event_types and "reasoning_delta" in event_types:
            break
        await asyncio.sleep(0.01)
    else:
        raise AssertionError("Stream deltas were not flushed while the turn was active")
    assert "text_delta" in event_types
    assert "reasoning_delta" in event_types
    assert "activity" in event_types
    assert "done" not in event_types
    assert any(
        topic == "agent:event"
        and payload.get("type") == "text_delta"
        and isinstance(payload.get("data"), dict)
        and payload["data"].get("text") == "Streaming"
        for topic, payload in published
    )
    assert any(
        topic == "agent:event"
        and payload.get("type") == "reasoning_delta"
        and isinstance(payload.get("data"), dict)
        and bool(payload["data"].get("activityId"))
        and payload["data"].get("text") == "Inspecting the workspace context."
        for topic, payload in published
    )

    provider.release.set()
    for _ in range(500):
        session = store.get_session(session_id)
        if session is not None and session.state == AgentSessionState.IDLE:
            break
        await asyncio.sleep(0.01)
    else:
        raise AssertionError("Streaming agent turn did not complete")

    # IDLE is the public signal that queued follow-ups may be dispatched. The
    # task registry must already be clear when that signal becomes observable.
    assert session_id not in client._turn_tasks
    done_index = next(
        index
        for index, (topic, payload) in enumerate(published)
        if topic == "agent:event" and payload.get("type") == "done"
    )
    # start_session also publishes an initial IDLE; the last one belongs to
    # this completed turn.
    idle_index = max(
        index
        for index, (topic, payload) in enumerate(published)
        if topic == "agent:state" and payload.get("state") == "idle"
    )
    assert done_index < idle_index

    events = store.list_events(session_id)
    # History merges deltas that share an activity. The live publish above is
    # what proves the first crumb arrived before the turn finished.
    assert any(
        event.type == "text_delta" and "Streaming" in str(event.data.get("text") or "")
        for event in events
    )
    assert [
        event.data["text"] for event in events if event.type == "reasoning_delta"
    ] == ["Inspecting the workspace context."]
    assert all(event.type != "text" for event in events)
    assert any(event.type == "done" for event in events)


async def test_first_turn_generates_and_publishes_session_title(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    provider = TitleGeneratingProvider(
        [
            ModelResponse(
                response_id="response-title-test",
                text="The repository is clean.",
                tool_calls=(),
                output_items=(
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {"type": "output_text", "text": "The repository is clean."}
                        ],
                    },
                ),
            )
        ]
    )
    published: list[tuple[str, dict[str, object]]] = []

    async def provider_factory() -> TitleGeneratingProvider:
        return provider

    async def publish(topic: str, payload: dict[str, object]) -> None:
        published.append((topic, payload))

    async def run_command(command: str) -> FakeCommandResult:
        return FakeCommandResult(stdout="")

    client = AgentProxyClient(
        files=FakeFiles(),  # type: ignore[arg-type]
        run_command=run_command,
        publish=publish,
        store=store,
        provider_factory=provider_factory,
        telemetry=AgentTelemetryStore(tmp_path / "agent-metrics.jsonl"),
    )
    session_id = await client.start_session(
        agent="coloride",
        task="Please inspect the remote Git status and summarize any changes",
        cwd="/srv/app",
        budget_usd=None,
        mode=AgentMode.PLAN,
    )

    for _ in range(500):
        session = store.get_session(session_id)
        if session is not None and session.state == AgentSessionState.IDLE:
            break
        await asyncio.sleep(0.01)
    else:
        raise AssertionError("Titled agent turn did not complete")

    saved = store.get_session(session_id)
    assert saved is not None
    assert saved.task == "Inspect Remote Git Status"
    assert provider.title_requests == [
        "Please inspect the remote Git status and summarize any changes"
    ]
    assert any(
        topic == "agent:session"
        and payload.get("sessionId") == session_id
        and payload.get("task") == "Inspect Remote Git Status"
        for topic, payload in published
    )


def test_null_provider_text_is_not_rendered_as_none() -> None:
    assert AgentProxyClient._text(None) == ""  # noqa: SLF001


async def test_mode_change_preserves_provider_history(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.PLAN)
    session.state = AgentSessionState.IDLE
    session.provider_thread_id = "response-existing"
    store.save_session(session)
    client = AgentProxyClient(store=store)

    updated = await client.set_mode(session.session_id, AgentMode.ACT)

    assert updated is not None
    assert updated.mode == AgentMode.ACT.value
    assert updated.state == AgentSessionState.IDLE.value
    saved = store.get_session(session.session_id)
    assert saved is not None
    assert saved.provider_thread_id == "response-existing"
    assert saved.mode == AgentMode.ACT
    assert any(event.type == "mode_changed" for event in store.list_events(session.session_id))


async def test_reasoning_effort_persists_on_session(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    session.state = AgentSessionState.IDLE
    store.save_session(session)
    client = AgentProxyClient(store=store)

    updated = await client.set_reasoning_effort(session.session_id, "xhigh")

    assert updated is not None
    assert updated.reasoning_effort == "xhigh"
    saved = store.get_session(session.session_id)
    assert saved is not None
    assert saved.reasoning_effort == "xhigh"
    assert any(event.type == "reasoning_changed" for event in store.list_events(session.session_id))


async def test_mode_change_is_rejected_during_active_turn(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.PLAN)
    session.state = AgentSessionState.RUNNING
    store.save_session(session)
    client = AgentProxyClient(store=store)

    try:
        await client.set_mode(session.session_id, AgentMode.ACT)
    except RuntimeError as error:
        assert "active turn" in str(error)
    else:
        raise AssertionError("Mode changed during an active turn")


async def test_second_message_is_rejected_during_active_turn(tmp_path) -> None:
    store = AgentSessionStore(tmp_path / "agents")
    session = AgentSession.create(agent="coloride", cwd="/srv/app", mode=AgentMode.ACT)
    session.state = AgentSessionState.RUNNING
    store.save_session(session)
    client = AgentProxyClient(store=store)

    try:
        await client.send(session.session_id, "Run another task")
    except AgentTurnActiveError as error:
        assert "active turn" in str(error)
    else:
        raise AssertionError("A second message started during an active turn")

    assert store.list_events(session.session_id) == []


async def test_nonretryable_provider_error_keeps_actual_reason_and_failed_activity(tmp_path) -> None:
    class RejectedProvider(ScriptedProvider):
        async def complete(self, **kwargs):
            error = AgentProviderError("Fireworks account suspended: review provider billing.")
            error.retryable = False
            raise error

        async def generate_title(self, _message):
            return "Provider rejection"

    provider = RejectedProvider([])
    store = AgentSessionStore(tmp_path / "agents")

    async def factory():
        return provider

    async def command(_cmd):
        return FakeCommandResult(stdout="")

    client = AgentProxyClient(
        files=FakeFiles(), run_command=command, store=store, provider_factory=factory,
        telemetry=AgentTelemetryStore(tmp_path / "metrics.jsonl"),
    )
    session_id = await client.start_session(agent="coloride", task=None, cwd="/srv/app", budget_usd=None)
    await client.send(session_id, "Hello")
    for _ in range(500):
        if store.get_session(session_id).state == AgentSessionState.PAUSED_GUARD:
            break
        await asyncio.sleep(0.01)
    task = store.get_task(session_id)
    assert task.guard_pause["message"] == "Fireworks account suspended: review provider billing."
    events = store.list_events(session_id)
    assert any(event.type == "activity" and event.data.get("state") == "failed" for event in events)


@pytest.mark.parametrize("tool_name", ["git_status", "nonexistent_tool"])
async def test_tool_loops_pause_and_seal_unexecuted_batch(tmp_path, monkeypatch, tool_name) -> None:
    import json

    monkeypatch.setenv("COLORIDE_AGENT_PROJECT_MEMORY_V1", "0")
    store = AgentSessionStore(tmp_path / "agents")
    # The vendored loop stops at five identical calls. The rest of the batch
    # must be sealed, never executed, and never sent back to the model.
    responses = []
    for batch in range(2):
        calls = tuple(
            ModelToolCall(call_id=f"batch-{batch}-{index}", name=tool_name, arguments={})
            for index in range(8)
        )
        responses.append(ModelResponse(
            response_id=f"response-{batch}", text="", tool_calls=calls,
            output_items=tuple({"type": "function_call", "call_id": call.call_id,
                                "name": call.name, "arguments": "{}"} for call in calls),
            usage=ModelUsage(),
        ))
    provider = ScriptedProvider(responses)
    executions = []

    async def provider_factory():
        return provider

    async def run_command(command):
        executions.append(command)
        return FakeCommandResult(stdout="## main")

    client = AgentProxyClient(
        files=FakeFiles(), run_command=run_command, store=store,
        provider_factory=provider_factory,
        telemetry=AgentTelemetryStore(tmp_path / "metrics.jsonl"),
    )
    session_id = await client.start_session(
        agent="coloride", task=None, cwd="/srv/app", budget_usd=None, mode=AgentMode.ASK,
    )
    await client.send(session_id, "Inspect the workspace", generate_title=False)
    await asyncio.wait_for(client._turn_tasks[session_id], timeout=10)
    task = store.get_task(session_id)
    assert task.guard_pause["reason"] == "runaway"
    assert task.progress.hard_stops == 0
    assert task.progress.hard_stops_baseline == 0
    assert len(provider.inputs) == 1
    assert len(executions) < 20
    history = store.list_conversation_items(session_id, limit=2000)
    call_ids = [item["call_id"] for item in history if item.get("type") == "function_call"]
    outputs = [item for item in history if item.get("type") == "function_call_output"]
    assert sorted(call_ids) == sorted(item["call_id"] for item in outputs)
    assert any(
        json.loads(item["output"]).get("cancelled") or json.loads(item["output"]).get("skipped")
        for item in outputs
    )
    assert store.close_orphan_function_calls(session_id) == []
    cancelled_results = [
        event for event in store.list_events(session_id)
        if event.type == "tool_result" and event.data.get("cancelled")
    ]
    assert cancelled_results
    assert all(event.data["failed"] for event in cancelled_results)
    if tool_name == "nonexistent_tool":
        assert not executions
        assert any("Unknown tool" in item["output"] for item in outputs)


@pytest.mark.parametrize("recovers", [True, False])
async def test_empty_model_response_has_one_bounded_retry(tmp_path, monkeypatch, recovers) -> None:
    monkeypatch.setenv("COLORIDE_AGENT_PROJECT_MEMORY_V1", "0")
    empty = ModelResponse(response_id="empty", text="", tool_calls=(), output_items=(), usage=ModelUsage())
    provider = ScriptedProvider([empty] if recovers else [empty, empty, empty])
    store = AgentSessionStore(tmp_path / "agents")

    async def provider_factory():
        return provider

    async def run_command(command):
        raise AssertionError(f"Unexpected command: {command}")

    client = AgentProxyClient(
        files=FakeFiles(), run_command=run_command, store=store, provider_factory=provider_factory,
        telemetry=AgentTelemetryStore(tmp_path / "metrics.jsonl"),
    )
    session_id = await client.start_session(
        agent="coloride", task=None, cwd="/srv/app", budget_usd=None, mode=AgentMode.ASK,
    )
    await client.send(session_id, "Explain the workspace", generate_title=False)
    await asyncio.wait_for(client._turn_tasks[session_id], timeout=10)
    assert len(provider.inputs) == (2 if recovers else 3)
    events = store.list_events(session_id)
    if recovers:
        assert not any(event.type in {"error", "guard_paused"} for event in events)
        assert store.get_session(session_id).state == AgentSessionState.IDLE
    else:
        assert any(event.type == "guard_paused" for event in events)
        assert store.get_session(session_id).state == AgentSessionState.PAUSED_GUARD


@pytest.mark.parametrize("new_evidence", [False, True])
async def test_repeated_read_batch_gets_recovery_before_pause(tmp_path, new_evidence):
    import json

    class ReadableFiles(FakeFiles):
        async def read(self, path):
            if '/file-' not in path:
                raise FileNotFoundError(path)
            return base64.b64encode(f'contents of {path}'.encode()).decode(), 'v1', False

    responses = []
    for batch in range(2):
        calls = tuple(ModelToolCall(
            call_id=f'read-{batch}-{i}', name='read_file',
            arguments={'path': f'/srv/app/file-{i}.txt'},
        ) for i in range(8))
        if batch == 1 and new_evidence:
            calls += (ModelToolCall(call_id='new-evidence', name='read_file',
                                   arguments={'path': '/srv/app/file-new.txt'}),)
        responses.append(ModelResponse(
            response_id=f'batch-{batch}', text='', tool_calls=calls,
            output_items=tuple({'type': 'function_call', 'call_id': c.call_id,
                                'name': c.name, 'arguments': json.dumps(c.arguments)} for c in calls),
            usage=ModelUsage(),
        ))
    class CapturingProvider(ScriptedProvider):
        async def complete(self, **kwargs):
            self.last_instructions = kwargs['instructions']
            return await super().complete(**kwargs)

    provider = CapturingProvider(responses)

    async def provider_factory():
        return provider

    async def run_command(command):
        return FakeCommandResult(stdout='')

    store = AgentSessionStore(tmp_path / 'agents')
    client = AgentProxyClient(
        files=ReadableFiles(), run_command=run_command, store=store,
        provider_factory=provider_factory,
        telemetry=AgentTelemetryStore(tmp_path / 'metrics.jsonl'),
    )
    session_id = await client.start_session(
        agent='coloride', task=None, cwd='/srv/app', budget_usd=None, mode=AgentMode.ASK,
    )
    await client.send(session_id, 'Inspect these files and explain the app', generate_title=False)
    await asyncio.wait_for(client._turn_tasks[session_id], 10)
    events = store.list_events(session_id)
    assert not any(e.type in {'guard_paused', 'error'} for e in events)
    assert len(provider.inputs) == 3
    assert ('previous tool batch returned no new information' in provider.last_instructions) is (not new_evidence)
    assert 'contents of /srv/app/file-0.txt' in str(provider.inputs[-1])
    assert store.get_task(session_id).progress.hard_stops == 0


@pytest.mark.parametrize('greeting', ['hey', 'Explícame cómo funciona React', 'Compara estos algoritmos', '¿Qué opinas de esta arquitectura?'])
async def test_act_answer_without_pending_changes_finishes_once(tmp_path, greeting):
    answer = 'Hey! How can I help you with your project today?'
    provider = ScriptedProvider([ModelResponse(
        response_id='greeting', text=answer, tool_calls=(),
        output_items=({'type':'message','role':'assistant','content':[{'type':'output_text','text':answer}]},),
    )])
    store = AgentSessionStore(tmp_path / 'agents')
    async def provider_factory():
        return provider
    async def run_command(command):
        raise AssertionError(f'Greeting must not run {command}')
    client = AgentProxyClient(files=FakeFiles(), run_command=run_command, store=store,
                              provider_factory=provider_factory, telemetry=AgentTelemetryStore(tmp_path/'metrics.jsonl'))
    session_id = await client.start_session(agent='coloride',task=None,cwd='/srv/app',budget_usd=None,mode=AgentMode.ACT)
    await client.send(session_id,greeting,generate_title=False)
    await asyncio.wait_for(client._turn_tasks[session_id],10)
    events=store.list_events(session_id)
    assert len(provider.inputs)==1
    assert ''.join(str(e.data.get('text') or '') for e in events if e.type in {'text','text_delta'})==answer
    assert not any(e.type in {'error','guard_paused','task_recovery','tool_call'} for e in events)
    assert store.get_session(session_id).state==AgentSessionState.IDLE


@pytest.mark.parametrize('tool', ['read_file', 'execute_command'])
async def test_act_analysis_with_inspection_finishes_without_repeating_answer(tmp_path, tool):
    import json
    class ReadableFiles(FakeFiles):
        async def read(self,path):
            return base64.b64encode(b'export const value = 1;').decode(), 'v1', False
    args={'path':'src/main.ts','start_line':1,'end_line':10} if tool=='read_file' else {'command':'wc -l src/main.ts && ls -la','cwd':'.'}
    call=ModelToolCall(call_id='inspect-1',name=tool,arguments=args)
    answer='El proyecto separa física, integración y renderizado. El integrador es aproximado.'
    provider=ScriptedProvider([
        ModelResponse(response_id='inspect',text='',tool_calls=(call,),output_items=({'type':'function_call','call_id':call.call_id,'name':tool,'arguments':json.dumps(args)},)),
        ModelResponse(response_id='answer',text=answer,tool_calls=(),output_items=({'type':'message','role':'assistant','content':[{'type':'output_text','text':answer}]},)),
    ])
    store=AgentSessionStore(tmp_path/'agents')
    async def factory(): return provider
    async def run_command(command): return FakeCommandResult(stdout='20 src/main.ts')
    client=AgentProxyClient(files=ReadableFiles(),run_command=run_command,store=store,
                            provider_factory=factory,telemetry=AgentTelemetryStore(tmp_path/'metrics.jsonl'))
    sid=await client.start_session(agent='coloride',task=None,cwd='/srv/app',budget_usd=None,mode=AgentMode.ACT,access_level='full')
    await client.send(sid,'Analiza mi proyecto',generate_title=False)
    await asyncio.wait_for(client._turn_tasks[sid],10)
    events=store.list_events(sid)
    assert len(provider.inputs)==2
    assert ''.join(str(e.data.get('text') or '') for e in events if e.type in {'text','text_delta'})==answer
    assert not any(e.type in {'error','guard_paused','task_recovery'} for e in events)
    assert store.get_task(sid).verification_required is False
    assert store.get_task(sid).completion['outcome']=='completed'


@pytest.mark.parametrize('accepted, with_text', [(False, False), (True, False), (True, True)])
async def test_completion_summary_is_shown_once_and_only_after_acceptance(tmp_path, accepted, with_text):
    import json
    summary='Verified completion summary.' if accepted else 'Incorrect success claim.'
    arguments={'outcome':'blocked' if accepted else 'completed','summary':summary,
               'requirements':['goal'] if accepted else [],'verification_ids':[],'reason':'Missing external access' if accepted else ''}
    call=ModelToolCall(call_id='finish-1',name='complete_task',arguments=arguments)
    fallback='The request could not be verified.'
    provider=ScriptedProvider([
        ModelResponse(response_id='finish',text=summary if with_text else '',tool_calls=(call,),output_items=({'type':'function_call','call_id':call.call_id,'name':call.name,'arguments':json.dumps(arguments)},)),
        ModelResponse(response_id='recover',text=fallback,tool_calls=(),output_items=({'type':'message','role':'assistant','content':[{'type':'output_text','text':fallback}]},)),
    ])
    store=AgentSessionStore(tmp_path/'agents')
    async def factory(): return provider
    async def run_command(command): raise AssertionError(command)
    client=AgentProxyClient(files=FakeFiles(),run_command=run_command,store=store,provider_factory=factory,
                           telemetry=AgentTelemetryStore(tmp_path/'metrics.jsonl'))
    sid=await client.start_session(agent='coloride',task=None,cwd='/srv/app',budget_usd=None,mode=AgentMode.ACT)
    await client.send(sid,'Check task status',generate_title=False)
    await asyncio.wait_for(client._turn_tasks[sid],10)
    events=store.list_events(sid)
    visible=''.join(str(e.data.get('text') or '') for e in events if e.type in {'text','text_delta'})
    assert visible == (summary if accepted else fallback)


async def test_read_only_completion_tool_finishes_without_regenerating_analysis(tmp_path):
    import json
    summary = 'Project analysis delivered.'
    inspect = ModelToolCall(call_id='inspect', name='list_files', arguments={'path': '.'})
    finish = ModelToolCall(call_id='finish', name='complete_task', arguments={
        'outcome': 'completed', 'summary': summary, 'requirements': ['goal'],
        'verification_ids': ['inspect'], 'reason': 'Read-only analysis; no edits.'})
    provider = ScriptedProvider([
        ModelResponse(response_id=str(index), text='', tool_calls=(call,), output_items=({
            'type': 'function_call', 'call_id': call.call_id, 'name': call.name,
            'arguments': json.dumps(call.arguments)},))
        for index, call in enumerate((inspect, finish))
    ])
    store = AgentSessionStore(tmp_path / 'agents')
    async def factory(): return provider
    async def run_command(command): raise AssertionError(command)
    client = AgentProxyClient(files=FakeFiles(), run_command=run_command, store=store,
        provider_factory=factory, telemetry=AgentTelemetryStore(tmp_path / 'metrics.jsonl'))
    sid = await client.start_session(agent='coloride', task=None, cwd='/srv/app',
                                    budget_usd=None, mode=AgentMode.ACT)
    await client.send(sid, 'Analyze the project', generate_title=False)
    await asyncio.wait_for(client._turn_tasks[sid], 10)
    events = store.list_events(sid)
    assert len(provider.inputs) == 2
    assert ''.join(str(e.data.get('text') or '') for e in events
                   if e.type in {'text', 'text_delta'}) == summary
    assert not any(e.type in {'error', 'guard_paused', 'task_recovery'} for e in events)
    assert store.get_task(sid).completion['outcome'] == 'completed'
