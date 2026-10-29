from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

import httpx
import pytest

from coloride_desktop.agents.runtime import AgentRuntime
from coloride_desktop.agents.completion import complete, record_result, verification_command
from coloride_desktop.agents.config import AgentProviderSettings
from coloride_desktop.agents.provider import (
    AgentProviderError,
    FireworksResponsesProvider,
    GeminiResponsesProvider,
    ModelToolCall,
    OpenAIResponsesProvider,
    XAIResponsesProvider,
)


@pytest.mark.asyncio
async def test_empty_response_after_tool_cannot_complete_unverified_task():
    """Reproduces the real incident: tools executed -> empty response -> task marked completed.

    The engine/runtime must NOT mark the task completed on empty response; it must
    issue recovery requests instead.
    """
    runtime = AgentRuntime()
    cancel = asyncio.Event()
    models = 0
    try:
        await runtime.start(
            session_id='completion-regression',
            mode='act',
            tools=[{'name': 'write_file', 'parameters': {'type': 'object', 'properties': {}}}],
            retry_delay_ms=0,
        )
        while True:
            request = await asyncio.wait_for(runtime.receive(cancel), 10)
            if request['op'] == 'model':
                models += 1
                if models == 3:
                    break  # Recovery instructions triggered; not a premature completion.
                await runtime.reply(request, {
                    'tool_calls': [{'call_id': 'write-1', 'name': 'write_file', 'arguments': {}}] if models == 1 else [],
                    'text': '',
                    'verificationRequired': True,
                    'completionAccepted': False,
                    'finishReason': 'tool-calls' if models == 1 else 'stop',
                })
            elif request['op'] == 'tool':
                await runtime.reply(request, {'output': 'written', 'verificationRequired': True})
            elif request['op'] == 'done':
                pytest.fail(f'Expected recovery, got unexpected done: {request}')
            else:
                assert request['op'] != 'fatal'
    finally:
        await runtime.close()


# ---------------------------------------------------------------------------
# Cross-Adapter Contract Test Suite
# ---------------------------------------------------------------------------

PROVIDERS = [
    ("openai", OpenAIResponsesProvider, "https://api.openai.test/v1", "gpt-5.3-codex", "sk-test", False),
    ("xai", XAIResponsesProvider, "https://api.x.ai/v1", "grok-4.5", "xai-test", False),
    ("fireworks", FireworksResponsesProvider, "https://api.fireworks.ai/inference/v1", "accounts/fireworks/models/kimi-k3", "fw-test", False),
    ("gemini-direct", GeminiResponsesProvider, "https://generativelanguage.googleapis.com/v1beta", "gemini-3.8-flash", "gem-key", False),
    ("gemini-managed", GeminiResponsesProvider, "https://api.coloride.test/v1/llm", "gemini-3.8-flash", "coloride-jwt", True),
]


def _build_provider(spec, client):
    kind, provider_cls, base_url, model, api_key, is_managed = spec
    settings = AgentProviderSettings(
        provider="gemini" if "gemini" in kind else kind,
        model=model,
        base_url=base_url,
        api_key=api_key,
        credential_source="coloride" if is_managed else "user",
    )
    return provider_cls(settings, client=client)


def _make_json_response(spec, *, text="", tool_calls=None, finish_reason="stop", prompt_tokens=20, completion_tokens=15):
    kind = spec[0]
    total_tokens = prompt_tokens + completion_tokens
    tool_calls = tool_calls or []

    if kind == "gemini-direct":
        parts: list[dict[str, Any]] = []
        if text:
            parts.append({"text": text})
        for call in tool_calls:
            parts.append({
                "id": call["call_id"],
                "functionCall": {"name": call["name"], "args": call["arguments"]},
            })
        gemini_finish = "MAX_TOKENS" if finish_reason == "length" else "STOP"
        return httpx.Response(200, json={
            "id": "gem-resp-1",
            "candidates": [{
                "content": {"parts": parts},
                "finishReason": gemini_finish,
            }],
            "usageMetadata": {
                "promptTokenCount": prompt_tokens,
                "candidatesTokenCount": completion_tokens,
                "totalTokenCount": total_tokens,
            },
        })

    elif kind == "fireworks":
        fw_calls = [
            {
                "id": call["call_id"],
                "type": "function",
                "function": {
                    "name": call["name"],
                    "arguments": json.dumps(call["arguments"]) if isinstance(call["arguments"], dict) else str(call["arguments"]),
                },
            }
            for call in tool_calls
        ]
        fw_finish = "tool_calls" if fw_calls else finish_reason
        return httpx.Response(200, json={
            "id": "fw-resp-1",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": text or None,
                    "tool_calls": fw_calls or None,
                },
                "finish_reason": fw_finish,
            }],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            },
        })

    else:
        # Responses API (OpenAI, xAI, Gemini managed gateway)
        output_items: list[dict[str, Any]] = []
        if text:
            output_items.append({
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text}],
            })
        for call in tool_calls:
            output_items.append({
                "type": "function_call",
                "call_id": call["call_id"],
                "name": call["name"],
                "arguments": json.dumps(call["arguments"]) if isinstance(call["arguments"], dict) else str(call["arguments"]),
            })
        status = "incomplete" if finish_reason == "length" else "completed"
        return httpx.Response(200, json={
            "id": "resp-contract-1",
            "status": status,
            "output": output_items,
            "usage": {
                "input_tokens": prompt_tokens,
                "output_tokens": completion_tokens,
                "total_tokens": total_tokens,
            },
        })


@pytest.mark.asyncio
@pytest.mark.parametrize("spec", PROVIDERS, ids=[p[0] for p in PROVIDERS])
async def test_adapter_contract_json_mode(spec):
    """JSON mode: handles both text and tool calls with normalized finish_reason and stream_complete."""
    async def handler(request: httpx.Request) -> httpx.Response:
        return _make_json_response(
            spec,
            text="Refactoring completed successfully.",
            tool_calls=[{"call_id": "call-read-1", "name": "read_file", "arguments": {"path": "src/index.ts"}}],
            finish_reason="tool_calls",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _build_provider(spec, client)
        response = await provider.complete(
            instructions="Execute checks",
            input_items=[{"role": "user", "content": "Start"}],
            tools=[{"type": "function", "name": "read_file"}],
        )

    assert response.finish_reason == "tool_calls"
    assert response.stream_complete is True
    assert len(response.tool_calls) == 1
    assert response.tool_calls[0].name == "read_file"
    assert response.tool_calls[0].arguments == {"path": "src/index.ts"}
    assert "Refactoring completed" in response.text
    assert response.usage.total_tokens == 35


@pytest.mark.asyncio
@pytest.mark.parametrize("spec", PROVIDERS, ids=[p[0] for p in PROVIDERS])
async def test_adapter_contract_multiple_tool_calls(spec):
    """Multiple tool calls: all calls preserved with arguments and unique call_ids."""
    calls = [
        {"call_id": "call-1", "name": "read_file", "arguments": {"path": "src/a.ts"}},
        {"call_id": "call-2", "name": "write_file", "arguments": {"path": "src/b.ts", "content": "export {}"}},
    ]

    async def handler(request: httpx.Request) -> httpx.Response:
        return _make_json_response(spec, tool_calls=calls, finish_reason="tool_calls")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _build_provider(spec, client)
        response = await provider.complete(
            instructions="Multi tool execution",
            input_items=[{"role": "user", "content": "Read and write"}],
            tools=[{"type": "function", "name": "read_file"}, {"type": "function", "name": "write_file"}],
        )

    assert len(response.tool_calls) == 2
    assert response.tool_calls[0].name == "read_file"
    assert response.tool_calls[0].arguments == {"path": "src/a.ts"}
    assert response.tool_calls[1].name == "write_file"
    assert response.tool_calls[1].arguments == {"path": "src/b.ts", "content": "export {}"}
    assert response.finish_reason == "tool_calls"


@pytest.mark.asyncio
@pytest.mark.parametrize("spec", PROVIDERS, ids=[p[0] for p in PROVIDERS])
async def test_adapter_contract_long_arguments(spec):
    """Long arguments: large JSON payloads (e.g. 50KB code files) parsed without loss or truncation."""
    large_code = "console.log('line');\n" * 3000  # ~63KB
    calls = [{"call_id": "call-long-1", "name": "write_file", "arguments": {"path": "src/large.js", "content": large_code}}]

    async def handler(request: httpx.Request) -> httpx.Response:
        return _make_json_response(spec, tool_calls=calls, finish_reason="tool_calls")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _build_provider(spec, client)
        response = await provider.complete(
            instructions="Save large file",
            input_items=[{"role": "user", "content": "Write large file"}],
            tools=[{"type": "function", "name": "write_file"}],
        )

    assert len(response.tool_calls) == 1
    assert response.tool_calls[0].arguments["path"] == "src/large.js"
    assert response.tool_calls[0].arguments["content"] == large_code
    assert len(response.tool_calls[0].arguments["content"]) == len(large_code)


@pytest.mark.asyncio
@pytest.mark.parametrize("spec", PROVIDERS, ids=[p[0] for p in PROVIDERS])
async def test_adapter_contract_truncation_detection(spec):
    """Truncation: incomplete responses flagged with finish_reason='length'."""
    async def handler(request: httpx.Request) -> httpx.Response:
        return _make_json_response(spec, text="Partial output due to limit...", finish_reason="length")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _build_provider(spec, client)
        response = await provider.complete(
            instructions="Run long task",
            input_items=[{"role": "user", "content": "Explain everything"}],
            tools=[],
        )

    assert response.finish_reason == "length"


@pytest.mark.asyncio
@pytest.mark.parametrize("spec", PROVIDERS, ids=[p[0] for p in PROVIDERS])
async def test_adapter_contract_streaming_mode(spec):
    """Streaming mode: yields deltas and ends with stream_complete=True and streamed=True."""
    kind = spec[0]
    text_deltas: list[str] = []

    async def on_text(delta: str) -> None:
        text_deltas.append(delta)

    async def handler(request: httpx.Request) -> httpx.Response:
        if kind == "gemini-direct":
            sse = (
                'data: {"candidates":[{"content":{"parts":[{"text":"Streamed "}]}}]}\n\n'
                'data: {"candidates":[{"content":{"parts":[{"text":"token chunk."}]},"finishReason":"STOP"}]}\n\n'
            )
        elif kind == "fireworks":
            sse = (
                'data: {"id":"resp-stream","choices":[{"delta":{"content":"Streamed "}}]}\n\n'
                'data: {"id":"resp-stream","choices":[{"delta":{"content":"token chunk."},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":4,"total_tokens":9}}\n\n'
                'data: [DONE]\n\n'
            )
        else:
            sse = (
                'event: response.output_text.delta\n'
                'data: {"type":"response.output_text.delta","delta":"Streamed "}\n\n'
                'event: response.output_text.delta\n'
                'data: {"type":"response.output_text.delta","delta":"token chunk."}\n\n'
                'event: response.completed\n'
                'data: {"type":"response.completed","response":{"id":"resp-stream","status":"completed","output":'
                '[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Streamed token chunk."}]}],'
                '"usage":{"input_tokens":5,"output_tokens":4,"total_tokens":9}}}\n\n'
            )
        return httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _build_provider(spec, client)
        response = await provider.complete_stream(
            instructions="Stream output",
            input_items=[{"role": "user", "content": "Hello"}],
            tools=[],
            tool_choice=None,
            on_text_delta=on_text,
            on_reasoning_delta=lambda _: asyncio.sleep(0),
            on_tool_args_delta=None,
        )

    assert "".join(text_deltas) == "Streamed token chunk."
    assert response.text == "Streamed token chunk."
    assert response.streamed is True
    assert response.stream_complete is True
    assert response.finish_reason == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("spec", PROVIDERS, ids=[p[0] for p in PROVIDERS])
async def test_adapter_contract_disconnection_is_not_treated_as_success(spec):
    """Disconnection: a stream closing abruptly before completion is not treated as a successful completion."""
    kind = spec[0]

    async def handler(request: httpx.Request) -> httpx.Response:
        # Abrupt cutoff without completed event or without finishReason
        if kind == "gemini-direct":
            sse = 'data: {"candidates":[{"content":{"parts":[{"text":"Halfway message..."}]}}]}\n\n'
        elif kind == "fireworks":
            sse = 'data: {"id":"resp-stream","choices":[{"delta":{"content":"Halfway message..."}}]}\n\n'
        else:
            sse = (
                'event: response.output_text.delta\n'
                'data: {"type":"response.output_text.delta","delta":"Halfway message..."}\n\n'
            )
        return httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _build_provider(spec, client)
        try:
            response = await provider.complete_stream(
                instructions="Stream output",
                input_items=[{"role": "user", "content": "Hello"}],
                tools=[],
                tool_choice=None,
                on_text_delta=lambda _: asyncio.sleep(0),
                on_reasoning_delta=lambda _: asyncio.sleep(0),
                on_tool_args_delta=None,
            )
            # If provider didn't raise, it must explicitly report an incomplete/unknown stream finish
            assert response.stream_complete is False or response.finish_reason in {"unknown", "length", "error"}
        except (AgentProviderError, RuntimeError):
            pass  # Raising is also expected for interrupted connections


@pytest.mark.asyncio
@pytest.mark.parametrize("spec", PROVIDERS, ids=[p[0] for p in PROVIDERS])
async def test_adapter_contract_transient_error_recovery(spec):
    """Errors & recovery: a 503 Service Unavailable triggers retries and succeeds if recovered."""
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(503, text="Service Unavailable")
        return _make_json_response(spec, text="Recovered!")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _build_provider(spec, client)
        provider._sleep = lambda _: asyncio.sleep(0)
        response = await provider.complete(
            instructions="Test retry",
            input_items=[{"role": "user", "content": "Ping"}],
            tools=[],
        )

    assert attempts == 2
    assert response.text == "Recovered!"


# ---------------------------------------------------------------------------
# Policy & Completion Ledger Contracts
# ---------------------------------------------------------------------------

@dataclass
class DummyTask:
    goal: str = "Implement user authentication"
    completion: dict[str, Any] = field(default_factory=dict)
    verification_required: bool = False
    verification_attempted: bool = False
    files_changed: set[str] = field(default_factory=set)
    unresolved_questions: list[str] = field(default_factory=list)


@dataclass
class DummyCall:
    call_id: str
    name: str
    arguments: dict[str, Any]


def test_verification_command_detection():
    """Recognize checks and safe query suffixes; reject masked exits and arbitrary commands."""
    assert verification_command("npm test") is True
    assert verification_command("npm run test") is True
    assert verification_command("pnpm test:unit") is True
    assert verification_command("yarn check") is True
    assert verification_command("pytest tests/") is True
    assert verification_command("python -m pytest") is True
    assert verification_command("vitest run") is True
    assert verification_command("cargo test --lib") is True
    assert verification_command("cargo check") is True
    assert verification_command("ruff check .") is True
    assert verification_command("tsc --noEmit") is True

    # Compound, masked, or arbitrary commands must NOT be treated as verification
    assert verification_command("echo 'test'") is False
    assert verification_command("npm test || true") is False
    assert verification_command("npm test && ls") is True
    assert verification_command("pytest $(which test)") is False
    assert verification_command("ls -la") is False
    assert verification_command("cat src/App.tsx") is False


def test_prose_does_not_complete_act_task():
    """Plain text progress like 'Escribamos src/App.tsx' cannot complete an implementation task."""
    task = DummyTask()
    from coloride_desktop.agents.completion import state
    s = state(task)
    assert s["outcome"] == "unknown"
    assert s["accepted"] is False


def test_failed_verification_keeps_task_pending():
    """A failed test (exit code 1) records failure and cannot certify completion."""
    task = DummyTask(files_changed={"src/auth.ts"})
    cwd = "/workspace"

    # Step 1: write file (mutation)
    record_result(task, DummyCall("w-1", "write_file", {"path": "src/auth.ts", "content": "..."}),
                  failed=False, metadata={}, cwd=cwd)
    assert task.completion["revision"] == 1
    assert task.verification_required is True

    # Step 2: run npm test which fails
    record_result(task, DummyCall("test-1", "execute_command", {"command": "npm test", "cwd": cwd}),
                  failed=True, metadata={"exitCode": 1}, cwd=cwd)

    # Attempting to complete must be rejected
    with pytest.raises(ValueError, match="A current verification check is still failing|Completion requires successful verification"):
        complete(task, {
            "outcome": "completed",
            "summary": "Finished auth",
            "requirements": ["goal"],
            "verification_ids": ["test-1"],
            "reason": "",
        }, cwd=cwd)

    assert task.completion["accepted"] is False
    assert task.completion["outcome"] == "pending_verification"


def test_subsequent_mutation_invalidates_prior_verification():
    """Modifying a file after a test passes invalidates prior verification."""
    task = DummyTask(files_changed={"src/auth.ts"})
    cwd = "/workspace"

    # Step 1: Initial mutation
    record_result(task, DummyCall("w-1", "write_file", {"path": "src/auth.ts", "content": "v1"}),
                  failed=False, metadata={}, cwd=cwd)

    # Step 2: Verification passes
    record_result(task, DummyCall("test-1", "execute_command", {"command": "npm test", "cwd": cwd}),
                  failed=False, metadata={"exitCode": 0}, cwd=cwd)
    assert task.verification_required is False

    # Step 3: Second mutation without subsequent verification
    record_result(task, DummyCall("w-2", "write_file", {"path": "src/auth.ts", "content": "v2"}),
                  failed=False, metadata={}, cwd=cwd)
    assert task.completion["revision"] == 2
    assert task.verification_required is True

    # Attempting to cite test-1 from revision 1 must be rejected
    with pytest.raises(ValueError, match="Completion requires successful verification tool IDs after the last modification"):
        complete(task, {
            "outcome": "completed",
            "summary": "Finished auth v2",
            "requirements": ["goal"],
            "verification_ids": ["test-1"],
            "reason": "",
        }, cwd=cwd)


def test_successful_verification_after_all_edits_allows_completion():
    """A passing verification covering all changed files allows completion."""
    task = DummyTask(files_changed={"src/auth.ts"})
    cwd = "/workspace"

    # Mutation
    record_result(task, DummyCall("w-1", "write_file", {"path": "src/auth.ts", "content": "final"}),
                  failed=False, metadata={}, cwd=cwd)

    # Passing test on same revision
    record_result(task, DummyCall("test-2", "execute_command", {"command": "npm test", "cwd": cwd}),
                  failed=False, metadata={"exitCode": 0}, cwd=cwd)

    res = complete(task, {
        "outcome": "completed",
        "summary": "Auth implementation complete and verified",
        "requirements": ["goal"],
        "verification_ids": ["test-2"],
        "reason": "",
    }, cwd=cwd)

    assert res["outcome"] == "completed"
    assert task.completion["accepted"] is True
    assert task.completion["outcome"] == "completed"
    assert task.verification_required is False


@pytest.mark.parametrize('scope', ['other', '..', 'src/../../other'])
def test_check_in_other_directory_does_not_verify_changed_files(scope):
    task=DummyTask(files_changed={'src/auth.ts'})
    record_result(task,DummyCall('write','write_file',{'path':'src/auth.ts'}),failed=False,metadata={},cwd='/workspace')
    record_result(task,DummyCall('check','execute_command',{'command':'npm test','cwd':scope}),failed=False,metadata={'exitCode':0},cwd='/workspace')
    assert task.verification_required is True


def test_failed_check_after_success_keeps_verification_pending():
    task=DummyTask(files_changed={'src/auth.ts'})
    record_result(task,DummyCall('write','write_file',{'path':'src/auth.ts'}),failed=False,metadata={},cwd='/workspace')
    record_result(task,DummyCall('test','execute_command',{'command':'npm test','cwd':'.'}),failed=False,metadata={'exitCode':0},cwd='/workspace')
    record_result(task,DummyCall('lint','execute_command',{'command':'npm run lint','cwd':'.'}),failed=False,metadata={'exitCode':1},cwd='/workspace')
    assert task.verification_required is True


def test_read_only_analysis_can_complete_without_code_verification():
    task = DummyTask()
    record_result(task, DummyCall('inspect', 'read_file', {'path': 'src/auth.ts'}),
                  failed=False, metadata={}, cwd='/workspace')
    result = complete(task, {'outcome': 'completed', 'summary': 'Analysis delivered',
                            'requirements': ['goal'], 'verification_ids': [], 'reason': ''}, '/workspace')
    assert result['outcome'] == 'completed'
    assert task.verification_required is False


@pytest.mark.parametrize('command', ['git status -sb', 'git show HEAD:README.md',
                                     'git log -1 --oneline && git rev-parse HEAD'])
def test_git_inspection_preserves_passing_verification(command):
    task = DummyTask(files_changed={'README.md'})
    record_result(task, DummyCall('write', 'write_file', {}), failed=False, metadata={}, cwd='/workspace')
    record_result(task, DummyCall('test', 'execute_command', {'command': 'npm test'}),
                  failed=False, metadata={'exitCode': 0}, cwd='/workspace')
    record_result(task, DummyCall('inspect', 'execute_command', {'command': command}),
                  failed=False, metadata={'exitCode': 0}, cwd='/workspace')
    assert complete(task, {'outcome': 'completed', 'summary': 'Verified', 'requirements': ['goal'],
                           'verification_ids': ['test'], 'reason': ''}, '/workspace')['outcome'] == 'completed'


@pytest.mark.parametrize('command', ['npm test && git status -sb', 'npx vitest run --reporter=verbose'])
def test_successful_check_chain_can_finish_modified_task(command):
    task = DummyTask(files_changed={'README.md'})
    record_result(task, DummyCall('write', 'write_file', {}), failed=False, metadata={}, cwd='/workspace')
    record_result(task, DummyCall('check', 'execute_command', {'command': command}),
                  failed=False, metadata={'exitCode': 0}, cwd='/workspace')
    assert complete(task, {'outcome': 'completed', 'summary': 'Verified', 'requirements': ['goal'],
                           'verification_ids': ['check'], 'reason': ''}, '/workspace')['outcome'] == 'completed'


@pytest.mark.parametrize('command', ['git show HEAD --output=README.md', 'git reset --hard',
                                     'npm test && touch README.md', 'npm test || true',
                                     'npm test; true', 'npm test | cat', 'git status > README.md'])
def test_unknown_or_mutating_commands_still_invalidate_checks(command):
    task = DummyTask(files_changed={'README.md'})
    record_result(task, DummyCall('write', 'write_file', {}), failed=False, metadata={}, cwd='/workspace')
    record_result(task, DummyCall('test', 'execute_command', {'command': 'npm test'}),
                  failed=False, metadata={'exitCode': 0}, cwd='/workspace')
    record_result(task, DummyCall('command', 'execute_command', {'command': command}),
                  failed=False, metadata={'exitCode': 0}, cwd='/workspace')
    assert task.verification_required
    with pytest.raises(ValueError, match='Completion requires successful verification'):
        complete(task, {'outcome': 'completed', 'summary': 'Done', 'requirements': ['goal'],
                        'verification_ids': ['test'], 'reason': ''}, '/workspace')


@pytest.mark.asyncio
async def test_rejected_completion_stops_even_with_successful_inspections_between():
    runtime = AgentRuntime()
    cancel = asyncio.Event()
    rejected = 0
    models = 0
    try:
        await runtime.start(session_id='completion-loop', mode='act', retry_delay_ms=0,
                            tools=[{'name': name, 'parameters': {'type': 'object', 'properties': {}}}
                                   for name in ['complete_task', 'read_file']])
        while True:
            request = await asyncio.wait_for(runtime.receive(cancel), 10)
            if request['op'] == 'model':
                models += 1
                assert models <= 6
                name = 'complete_task' if models % 2 else 'read_file'
                await runtime.reply(request, {'tool_calls': [{'call_id': f'call-{models}', 'name': name,
                                                             'arguments': {}}], 'text': '',
                                             'finishReason': 'tool-calls', 'completionRequired': True})
            elif request['op'] == 'tool':
                failed = request['call']['name'] == 'complete_task'
                rejected += int(failed)
                await runtime.reply(request, {'output': 'Invalid verification ID' if failed else 'Contents',
                                             'failed': failed, 'completionRequired': True})
            elif request['op'] in {'done', 'fatal'}:
                assert rejected == 3
                assert 'rejected three times' in str(request)
                break
            else:
                await runtime.reply(request, {})
    finally:
        await runtime.close()
