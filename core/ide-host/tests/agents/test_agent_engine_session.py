from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from coloride_desktop.agents.domain import AgentMode, AgentSession
from coloride_desktop.agents.engine import ColorideAgentEngine, _tool_is_parallel_safe
from coloride_desktop.agents.loop_detect import AgentLoopDetector
from coloride_desktop.agents.provider import (
    CLOUD_SESSION_EXPIRED,
    CLOUD_SESSION_EXPIRED_MESSAGE,
    AgentProviderError,
    ModelResponse,
    ModelToolCall,
    ModelUsage,
)
from coloride_desktop.agents.task import AgentTask


class _FakeProvider:
    def __init__(self, results: list[object]) -> None:
        self.settings = SimpleNamespace(credential_source="coloride")
        self.model = "grok-4.5"
        self.capabilities = SimpleNamespace(
            streaming=True,
            encrypted_reasoning=False,
            max_context_characters=32_000,
            max_context_tokens=8_000,
        )
        self.results = list(results)
        self.calls = 0

    async def complete(self, **_kwargs):
        self.calls += 1
        item = self.results.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class _FakeStore:
    def get_session_plan(self, _session_id: str):
        return None


class _FakeTools:
    def schemas_for(self, _mode, _session=None):
        return []


def _session() -> AgentSession:
    return AgentSession(session_id="s1", agent="coloride", cwd="/tmp", mode=AgentMode.ACT)


def _ok() -> ModelResponse:
    return ModelResponse(
        response_id="ok",
        text="hi",
        tool_calls=(),
        output_items=(),
        usage=ModelUsage(),
    )


async def _emit(*_args, **_kwargs) -> None:
    return None


@pytest.mark.asyncio
async def test_complete_retries_after_cloud_session_refresh(monkeypatch) -> None:
    provider = _FakeProvider([AgentProviderError(CLOUD_SESSION_EXPIRED), _ok()])
    engine = ColorideAgentEngine(
        provider=provider,
        tools=_FakeTools(),
        store=_FakeStore(),
        emit=_emit,
        request_approval=_emit,
        save_session=lambda _session: None,
    )

    async def _skip() -> None:
        return None

    async def _ok_refresh() -> bool:
        return True

    monkeypatch.setattr(engine, "_ensure_cloud_session", _skip)
    monkeypatch.setattr(engine, "_refresh_cloud_session", _ok_refresh)

    result = await engine._complete(
        session=_session(),
        history=[{"role": "user", "content": "hi"}],
        project_instructions="",
        activity_id="a1",
    )
    assert result.text == "hi"
    assert provider.calls == 2


@pytest.mark.asyncio
async def test_complete_maps_failed_refresh_to_sign_in(monkeypatch) -> None:
    provider = _FakeProvider([AgentProviderError(CLOUD_SESSION_EXPIRED)])
    engine = ColorideAgentEngine(
        provider=provider,
        tools=_FakeTools(),
        store=_FakeStore(),
        emit=_emit,
        request_approval=_emit,
        save_session=lambda _session: None,
    )

    async def _skip() -> None:
        return None

    async def _fail_refresh() -> bool:
        return False

    monkeypatch.setattr(engine, "_ensure_cloud_session", _skip)
    monkeypatch.setattr(engine, "_refresh_cloud_session", _fail_refresh)

    with pytest.raises(AgentProviderError, match=CLOUD_SESSION_EXPIRED_MESSAGE):
        await engine._complete(
            session=_session(),
            history=[{"role": "user", "content": "hi"}],
            project_instructions="",
            activity_id="a1",
        )


def test_independent_reads_are_parallel_safe() -> None:
    assert _tool_is_parallel_safe("read_file", local_workspace=False) is True
    assert _tool_is_parallel_safe("fetch_url", local_workspace=False) is True
    assert _tool_is_parallel_safe("search_chat_history", local_workspace=False) is True
    assert _tool_is_parallel_safe("list_files", local_workspace=False) is False
    assert _tool_is_parallel_safe("list_files", local_workspace=True) is True
    assert _tool_is_parallel_safe("search_files", local_workspace=True) is True
    assert _tool_is_parallel_safe("write_file", local_workspace=True) is False
    assert _tool_is_parallel_safe("execute_command", local_workspace=False) is False
    assert _tool_is_parallel_safe("browser_snapshot", local_workspace=True) is False


def _engine_for_tool_round() -> ColorideAgentEngine:
    return ColorideAgentEngine(
        provider=_FakeProvider([]),
        tools=_FakeTools(),
        store=_FakeStore(),
        emit=_emit,
        request_approval=_emit,
        save_session=lambda _session: None,
    )


@pytest.mark.asyncio
async def test_parallel_read_tools_overlap_in_one_response() -> None:
    engine = _engine_for_tool_round()
    started = 0
    max_inflight = 0
    release = asyncio.Event()

    async def slow_run_tool(_session, call, _cancel, *, task=None, loop_detector=None):
        nonlocal started, max_inflight
        started += 1
        max_inflight = max(max_inflight, started)
        if started < 2:
            await release.wait()
        else:
            release.set()
        started -= 1
        return None

    engine._run_tool = slow_run_tool  # type: ignore[method-assign]
    session = _session()
    task = AgentTask.create(conversation_id=session.session_id, workspace_id=session.cwd)
    calls = (
        ModelToolCall(call_id="c1", name="read_file", arguments={"path": "a.ts"}),
        ModelToolCall(call_id="c2", name="read_file", arguments={"path": "b.ts"}),
    )
    turn_stats = {"tool_calls": 0}
    await engine._run_response_tools(
        session=session,
        calls=calls,
        cancel_event=asyncio.Event(),
        task=task,
        loop_detector=AgentLoopDetector(task.progress),
        turn_stats=turn_stats,
        guard_instruction="",
    )
    assert max_inflight == 2
    assert turn_stats["tool_calls"] == 2


@pytest.mark.asyncio
async def test_mixed_write_and_read_stay_serial() -> None:
    engine = _engine_for_tool_round()
    order: list[str] = []
    inflight = 0
    max_inflight = 0

    async def serial_probe_run_tool(_session, call, _cancel, *, task=None, loop_detector=None):
        nonlocal inflight, max_inflight
        inflight += 1
        max_inflight = max(max_inflight, inflight)
        order.append(call.name)
        await asyncio.sleep(0.01)
        inflight -= 1
        return None

    engine._run_tool = serial_probe_run_tool  # type: ignore[method-assign]
    session = _session()
    task = AgentTask.create(conversation_id=session.session_id, workspace_id=session.cwd)
    calls = (
        ModelToolCall(call_id="c1", name="write_file", arguments={"path": "a.ts", "content": "x"}),
        ModelToolCall(call_id="c2", name="read_file", arguments={"path": "a.ts"}),
    )
    await engine._run_response_tools(
        session=session,
        calls=calls,
        cancel_event=asyncio.Event(),
        task=task,
        loop_detector=AgentLoopDetector(task.progress),
        turn_stats={"tool_calls": 0},
        guard_instruction="",
    )
    assert order == ["write_file", "read_file"]
    assert max_inflight == 1


@pytest.mark.parametrize('repeat_retry', [False, True])
async def test_reasoning_loop_retries_once_without_reusing_false_claims(monkeypatch, repeat_retry):
    sentence = 'I have already created all the source files and validated the build successfully.'

    class RepeatingProvider(_FakeProvider):
        def __init__(self):
            super().__init__([])
            self.histories = []

        async def complete_stream(self, *, input_items, on_reasoning_delta, on_text_delta, **kwargs):
            self.calls += 1
            self.histories.append(input_items)
            if self.calls == 1 or repeat_retry:
                output = ' '.join(f'{i}) {sentence}' for i in range(1, 54))
                for offset in range(0, len(output), 13):
                    await on_reasoning_delta(output[offset:offset + 13])
                pytest.fail('Repetition was not interrupted')
            await on_text_delta('Voy a comprobar los archivos.')
            return ModelResponse(response_id='recovered', text='Voy a comprobar los archivos.',
                                 tool_calls=(), output_items=(), usage=ModelUsage())

    provider = RepeatingProvider()
    events = []

    async def emit(kind, data):
        events.append((kind, data))

    engine = ColorideAgentEngine(provider=provider, tools=_FakeTools(), store=_FakeStore(),
                               emit=emit, request_approval=_emit, save_session=lambda session: None)

    async def no_refresh():
        pass

    monkeypatch.setattr(engine, '_ensure_cloud_session', no_refresh)
    history = [{'role': 'user', 'content': 'Continúa creando la app'}]
    args = dict(session=_session(), history=history, project_instructions='', activity_id='a1')
    if repeat_retry:
        with pytest.raises(AgentProviderError) as caught:
            await engine._complete(**args)
        assert caught.value.retryable is False
    else:
        result = await engine._complete(**args)
        assert result.text == 'Voy a comprobar los archivos.'
    assert provider.calls == 2
    assert sentence not in str(provider.histories[1])
    assert 'No tools from that generation executed' in str(provider.histories[1])
    assert history == [{'role': 'user', 'content': 'Continúa creando la app'}]
    assert sum(len(data.get('text', '')) for kind, data in events if kind == 'reasoning_delta') < 1500


async def test_normal_reasoning_and_repetitive_source_text_are_not_blocked():
    from coloride_desktop.agents.engine import _StreamDeltaCoalescer
    stream = _StreamDeltaCoalescer(_emit, 'normal')
    try:
        for index in range(20):
            await stream.on_reasoning(f'I will inspect file {index} for its particular responsibilities and dependencies. ')
        await stream.on_text('const item = { enabled: true };\n' * 100)
    finally:
        await stream.aclose()


async def test_recovery_is_a_new_instruction_after_assistant_without_rewriting_history(monkeypatch):
    from coloride_desktop.agents.gemini_native import gemini_contents
    class CaptureProvider(_FakeProvider):
        async def complete(self, **kwargs):
            self.request_history = kwargs['input_items']
            return _ok()
    provider = CaptureProvider([])
    engine = ColorideAgentEngine(provider=provider, tools=_FakeTools(), store=_FakeStore(),
                                emit=_emit, request_approval=_emit, save_session=lambda s: None)
    async def skip_cloud():
        pass
    monkeypatch.setattr(engine, '_ensure_cloud_session', skip_cloud)
    history = [{'role':'user','content':'Implement the feature'},
               {'type':'message','role':'assistant','content':[{'type':'output_text','text':'I will check it.'}]}]
    await engine._complete(session=_session(),history=history,project_instructions='',activity_id='r1',
                           guard_instruction='Run the pending validation without repeating your answer')
    assert len(history)==2
    assert provider.request_history[-1]['role']=='developer'
    assert provider.request_history[-1]['colorideInternal'] is True
    assert gemini_contents(provider.request_history,model='gemini-4-argon')[-1]['role']=='user'
