from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from coloride_desktop.agents.config import AgentProviderSettings
from coloride_desktop.agents.provider import (
    CLOUD_SESSION_EXPIRED,
    AgentProviderError,
    FireworksResponsesProvider,
    GeminiResponsesProvider,
    OpenAIChatCompletionsProvider,
    OpenAIResponsesProvider,
    XAIResponsesProvider,
    is_cloud_session_expired_error,
)


class DelayedSSEStream(httpx.AsyncByteStream):
    def __init__(self, release: asyncio.Event) -> None:
        self.release = release

    async def __aiter__(self):
        yield (
            b'event: response.reasoning_summary_text.delta\n'
            b'data: {"type":"response.reasoning_summary_text.delta","delta":"Checking"}\n\n'
            b'event: response.output_text.delta\n'
            b'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n'
        )
        await self.release.wait()
        yield (
            b'data: {"type":"response.reasoning_summary_text.delta","delta":" context."}\n\n'
            b'data: {"type":"response.output_text.delta","delta":" world"}\n\n'
            b'data: {"type":"response.completed","response":{"id":"resp-stream",'
            b'"output":[{"type":"message","role":"assistant","content":'
            b'[{"type":"output_text","text":"Hello world"}]}],"usage":'
            b'{"input_tokens":4,"output_tokens":2,"total_tokens":6}}}\n\n'
        )


async def test_openai_provider_parses_text_tools_and_usage() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.openai.test/v1/responses"
        assert request.headers["authorization"] == "Bearer sk-test"
        payload = json.loads(request.content)
        assert payload["store"] is False
        assert payload["parallel_tool_calls"] is True
        assert payload["include"] == ["reasoning.encrypted_content"]
        assert payload["prompt_cache_key"] == "sess_cache"
        assert request.headers.get("x-grok-conv-id") is None
        return httpx.Response(
            200,
            json={
                "id": "resp-1",
                "output": [
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": "Checking."}],
                    },
                    {
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "read_file",
                        "arguments": '{"path":"README.md","start_line":1,"end_line":20}',
                    },
                ],
                "usage": {
                    "input_tokens": 10,
                    "input_tokens_details": {"cached_tokens": 7},
                    "output_tokens": 5,
                    "total_tokens": 15,
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = OpenAIResponsesProvider(
            AgentProviderSettings(
                provider="openai",
                model="gpt-test",
                base_url="https://api.openai.test/v1",
                api_key="sk-test",
                credential_source="test",
            ),
            client=client,
        )
        response = await provider.complete(
            instructions="Inspect safely",
            input_items=[{"role": "user", "content": "Read the README"}],
            tools=[{"type": "function", "name": "read_file"}],
            prompt_cache_key="sess_cache",
        )

    assert response.response_id == "resp-1"
    assert response.text == "Checking."
    assert response.tool_calls[0].name == "read_file"
    assert response.tool_calls[0].arguments["path"] == "README.md"
    assert response.usage.cached_input_tokens == 7
    assert response.usage.total_tokens == 15


async def test_managed_llm_401_is_cloud_session_expired(tmp_path, monkeypatch) -> None:
    from coloride_desktop.agents.cloud_token import (
        clear_cloud_access_token,
        set_cloud_access_token,
    )

    monkeypatch.setenv("COLORIDE_CLOUD_ACCESS_TOKEN_PATH", str(tmp_path / "cloud.jwt"))
    clear_cloud_access_token()
    set_cloud_access_token("user-jwt")

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer user-jwt"
        return httpx.Response(401, json={"error": "unauthorized", "message": "expired"})

    try:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = OpenAIResponsesProvider(
                AgentProviderSettings(
                    provider="xai",
                    model="grok-4.5",
                    base_url="https://api.coloride.com/v1/llm",
                    api_key="user-jwt",
                    credential_source="coloride",
                ),
                client=client,
            )
            with pytest.raises(AgentProviderError, match=CLOUD_SESSION_EXPIRED):
                await provider.complete(
                    instructions="Inspect safely",
                    input_items=[{"role": "user", "content": "Hi"}],
                    tools=[],
                )
    finally:
        clear_cloud_access_token()


async def test_byok_401_is_not_cloud_session_expired() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid_api_key"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = OpenAIResponsesProvider(
            AgentProviderSettings(
                provider="openai",
                model="gpt-test",
                base_url="https://api.openai.test/v1",
                api_key="sk-bad",
                credential_source="keyring",
            ),
            client=client,
        )
        with pytest.raises(AgentProviderError) as caught:
            await provider.complete(
                instructions="Inspect safely",
                input_items=[{"role": "user", "content": "Hi"}],
                tools=[],
            )
    assert not is_cloud_session_expired_error(caught.value)


async def test_unknown_model_error_is_not_retryable() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "model_not_found"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = OpenAIResponsesProvider(
            AgentProviderSettings(
                provider="gemini",
                model="gemini-not-real",
                base_url="https://api.coloride.com/v1/llm",
                api_key="managed-token",
                credential_source="coloride",
            ),
            client=client,
        )
        with pytest.raises(AgentProviderError) as caught:
            await provider.complete(
                instructions="Inspect safely",
                input_items=[{"role": "user", "content": "Hi"}],
                tools=[],
            )
    assert caught.value.retryable is False


async def test_managed_headers_use_live_cloud_token(tmp_path, monkeypatch) -> None:
    from coloride_desktop.agents.cloud_token import (
        clear_cloud_access_token,
        set_cloud_access_token,
        token_path,
    )

    monkeypatch.setenv("COLORIDE_CLOUD_ACCESS_TOKEN_PATH", str(tmp_path / "cloud.jwt"))
    clear_cloud_access_token()
    set_cloud_access_token("fresh-live-jwt")
    seen: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers["authorization"])
        return httpx.Response(
            200,
            json={"id": "ok", "output": [], "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}},
        )

    try:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = OpenAIResponsesProvider(
                AgentProviderSettings(
                    provider="xai",
                    model="grok-4.5",
                    base_url="https://api.coloride.com/v1/llm",
                    api_key="stale-jwt",
                    credential_source="coloride",
                ),
                client=client,
            )
            await provider.complete(
                instructions="Inspect safely",
                input_items=[{"role": "user", "content": "Hi"}],
                tools=[],
            )
    finally:
        clear_cloud_access_token()
        path = token_path()
        if path.is_file():
            path.unlink()

    assert seen == ["Bearer fresh-live-jwt"]


async def test_xai_provider_sends_extra_high_reasoning_for_grok_47() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["model"] == "grok-4.7"
        assert payload["reasoning"] == {"effort": "xhigh", "summary": "detailed"}
        return httpx.Response(200, json={"id": "xai-xhigh", "output": [], "usage": {}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = XAIResponsesProvider(
            AgentProviderSettings(
                provider="xai",
                model="grok-4.7",
                base_url="https://api.x.ai/v1",
                api_key="xai-test",
                credential_source="test",
                reasoning_effort="xhigh",
            ),
            client=client,
        )
        await provider.complete(
            instructions="Think harder",
            input_items=[{"role": "user", "content": "Solve it"}],
            tools=[],
        )


async def test_xai_provider_requests_reasoning_continuation() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.x.ai/v1/responses"
        assert request.headers["authorization"] == "Bearer xai-test"
        payload = json.loads(request.content)
        assert payload["model"] == "grok-4.5"
        assert payload["store"] is False
        assert payload["include"] == ["reasoning.encrypted_content"]
        assert payload["reasoning"] == {"effort": "high", "summary": "detailed"}
        assert payload["prompt_cache_key"] == "sess_xai_cache"
        assert request.headers["x-grok-conv-id"] == "sess_xai_cache"
        return httpx.Response(
            200,
            json={
                "id": "xai-response-1",
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "call-xai-1",
                        "name": "list_files",
                        "arguments": '{"path":"."}',
                    }
                ],
                "usage": {"input_tokens": 8, "output_tokens": 3, "total_tokens": 11},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = XAIResponsesProvider(
            AgentProviderSettings(
                provider="xai",
                model="grok-4.5",
                base_url="https://api.x.ai/v1",
                api_key="xai-test",
                credential_source="test",
                reasoning_effort="high",
            ),
            client=client,
        )
        response = await provider.complete(
            instructions="Inspect safely",
            input_items=[{"role": "user", "content": "List the workspace"}],
            tools=[{"type": "function", "name": "list_files"}],
            prompt_cache_key="sess_xai_cache",
        )

    assert response.response_id == "xai-response-1"
    assert response.tool_calls[0].name == "list_files"
    assert response.tool_calls[0].arguments == {"path": "."}
    assert response.usage.total_tokens == 11


async def test_xai_provider_emits_text_before_stream_completes() -> None:
    release = asyncio.Event()
    first_delta = asyncio.Event()
    deltas: list[str] = []
    reasoning_deltas: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["stream"] is True
        assert request.headers["accept"] == "text/event-stream"
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=DelayedSSEStream(release),
        )

    async def on_delta(text: str) -> None:
        deltas.append(text)
        first_delta.set()

    async def on_reasoning_delta(text: str) -> None:
        reasoning_deltas.append(text)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = XAIResponsesProvider(
            AgentProviderSettings(
                provider="xai",
                model="grok-4.5",
                base_url="https://api.x.ai/v1",
                api_key="xai-test",
                credential_source="test",
            ),
            client=client,
        )
        completion = asyncio.create_task(
            provider.complete_stream(
                instructions="Answer briefly",
                input_items=[{"role": "user", "content": "Say hello"}],
                tools=[],
                on_text_delta=on_delta,
                on_reasoning_delta=on_reasoning_delta,
            )
        )
        await asyncio.wait_for(first_delta.wait(), timeout=1)
        assert deltas == ["Hello"]
        assert completion.done() is False
        release.set()
        response = await completion

    assert deltas == ["Hello", " world"]
    assert reasoning_deltas == ["Checking", " context."]
    assert response.text == "Hello world"
    assert response.streamed is True
    assert response.usage.total_tokens == 6


async def test_fireworks_uses_chat_completions_and_preserves_reasoning() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.fireworks.test/inference/v1/chat/completions"
        payload = json.loads(request.content)
        assert payload["reasoning_effort"] == "high"
        assert payload["messages"][0] == {"role": "system", "content": "Inspect safely"}
        assert payload["messages"][1] == {
            "role": "system",
            "content": "CURRENT TASK: inspect docs",
        }
        assert payload["messages"][2] == {"role": "user", "content": "Read the README"}
        assert payload["parallel_tool_calls"] is True
        assert payload["tools"] == [
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ]
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-fireworks-1",
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "I will inspect it.",
                            "reasoning_content": "First read the requested file.",
                            "tool_calls": [
                                {
                                    "id": "call-fw-1",
                                    "type": "function",
                                    "function": {
                                        "name": "read_file",
                                        "arguments": '{"path":"README.md"}',
                                    },
                                }
                            ],
                        }
                    }
                ],
                "usage": {"prompt_tokens": 8, "completion_tokens": 4, "total_tokens": 12},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = FireworksResponsesProvider(
            AgentProviderSettings(
                provider="fireworks",
                model="accounts/fireworks/models/deepseek-v4-flash",
                base_url="https://api.fireworks.test/inference/v1",
                api_key="fw-test",
                credential_source="test",
                reasoning_effort="high",
            ),
            client=client,
        )
        response = await provider.complete(
            instructions="Inspect safely",
            input_items=[
                {"role": "developer", "content": "CURRENT TASK: inspect docs"},
                {"role": "user", "content": "Read the README"},
            ],
            tools=[{"type": "function", "name": "read_file"}],
        )

    assert response.response_id == "chatcmpl-fireworks-1"
    assert response.text == "I will inspect it."
    assert response.tool_calls[0].arguments == {"path": "README.md"}
    assert response.output_items[0]["reasoning_content"] == "First read the requested file."
    assert response.usage.total_tokens == 12


@pytest.mark.parametrize("provider,model,base_url", [
    ("groq", "openai/gpt-oss-120b", "https://api.groq.com/openai/v1"),
    ("ollama", "qwen2.5-coder:7b", "http://127.0.0.1:11434/v1"),
])
async def test_chat_providers_omit_flags_those_servers_reject(provider: str, model: str, base_url: str) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == f"{base_url}/chat/completions"
        payload = json.loads(request.content)
        assert "reasoning_effort" not in payload
        assert "parallel_tool_calls" not in payload
        assert payload["tools"][0]["function"]["name"] == "read_file"
        return httpx.Response(200, json={
            "id": "chatcmpl-local",
            "choices": [{"message": {"role": "assistant", "content": "ok"}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        })

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        adapter = OpenAIChatCompletionsProvider(
            AgentProviderSettings(provider=provider, model=model, base_url=base_url, api_key="", credential_source="local", reasoning_effort="high"),
            client=client,
        )
        response = await adapter.complete(instructions="Inspect", input_items=[{"role": "user", "content": "Read"}], tools=[{"type": "function", "name": "read_file"}])
    assert response.text == "ok"


@pytest.mark.parametrize("model", ["gemini-3.7-flash", "gemini-4-argon"])
async def test_gemini_uses_native_generate_content_and_tools(model: str) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == (
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        )
        assert request.headers["x-goog-api-key"] == "gemini-test"
        payload = json.loads(request.content)
        assert payload["systemInstruction"]["parts"][0]["text"] == "Inspect safely"
        assert payload["generationConfig"]["thinkingConfig"]["thinkingLevel"] == "HIGH"
        assert payload["generationConfig"]["thinkingConfig"]["includeThoughts"] is True
        assert payload["tools"][0]["functionDeclarations"][0]["name"] == "read_file"
        assert payload["toolConfig"]["functionCallingConfig"]["mode"] == "AUTO"
        assert payload["contents"][0]["role"] == "user"
        return httpx.Response(
            200,
            json={
                "responseId": "gen-gemini-1",
                "candidates": [
                    {
                        "content": {
                            "role": "model",
                            "parts": [{"text": "Reading it."}],
                        }
                    }
                ],
                "usageMetadata": {
                    "promptTokenCount": 5,
                    "candidatesTokenCount": 2,
                    "cachedContentTokenCount": 3,
                    "totalTokenCount": 7,
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = GeminiResponsesProvider(
            AgentProviderSettings(
                provider="gemini",
                model=model,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai",
                api_key="gemini-test",
                credential_source="keychain",
                reasoning_effort="high",
            ),
            client=client,
        )
        response = await provider.complete(
            instructions="Inspect safely",
            input_items=[{"role": "user", "content": "Read the README"}],
            tools=[{"type": "function", "name": "read_file"}],
            prompt_cache_key="session-cache-that-gemini-does-not-use",
        )

    assert response.response_id == "gen-gemini-1"
    assert response.text == "Reading it."
    assert response.usage.total_tokens == 7
    assert response.usage.cached_input_tokens == 3


async def test_gemini_round_trips_thought_signatures_on_tool_turns() -> None:
    seen: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        seen["contents"] = payload["contents"]
        return httpx.Response(
            200,
            json={
                "responseId": "gen-gemini-2",
                "candidates": [
                    {
                        "content": {
                            "role": "model",
                            "parts": [
                                {"thought": True, "text": "Need the file."},
                                {
                                    "functionCall": {
                                        "name": "read_file",
                                        "args": {"path": "app/page.tsx"},
                                    },
                                    "thoughtSignature": "sig-next",
                                },
                            ],
                        }
                    }
                ],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = GeminiResponsesProvider(
            AgentProviderSettings(
                provider="gemini",
                model="gemini-2.5-pro",
                base_url="https://generativelanguage.googleapis.com/v1beta",
                api_key="gemini-test",
                credential_source="environment",
                reasoning_effort="medium",
            ),
            client=client,
        )
        response = await provider.complete(
            instructions="Inspect safely",
            input_items=[
                {"role": "user", "content": "Open the page"},
                {
                    "type": "function_call",
                    "call_id": "call_prev",
                    "name": "read_file",
                    "arguments": '{"path":"README.md"}',
                    "thought_signature": "sig-prev",
                },
                {
                    "type": "function_call_output",
                    "call_id": "call_prev",
                    "output": "hello",
                },
            ],
            tools=[{"type": "function", "name": "read_file", "parameters": {"type": "object"}}],
        )

    contents = seen["contents"]
    assert contents[0]["role"] == "user"
    assert contents[1]["role"] == "model"
    assert contents[1]["parts"][0]["functionCall"]["name"] == "read_file"
    assert contents[1]["parts"][0]["thoughtSignature"] == "sig-prev"
    assert contents[2]["role"] == "user"
    assert contents[2]["parts"][0]["functionResponse"]["name"] == "read_file"
    assert contents[2]["parts"][0]["functionResponse"]["response"] == {"output": "hello"}
    assert response.tool_calls[0].name == "read_file"
    assert response.tool_calls[0].arguments["path"] == "app/page.tsx"
    assert response.output_items[1]["thought_signature"] == "sig-next"
    assert response.output_items[0]["reasoning_content"] == "Need the file."


@pytest.mark.parametrize("model", ["gemini-2.5-flash", "gemini-4-argon"])
async def test_gemini_streams_thoughts_and_function_calls(model: str) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert "streamGenerateContent" in str(request.url)
        assert "alt=sse" in str(request.url)
        payload = json.loads(request.content)
        thinking = payload["generationConfig"]["thinkingConfig"]
        if model == "gemini-4-argon":
            assert thinking == {"thinkingLevel": "LOW", "includeThoughts": True}
            assert "/models/gemini-4-argon:streamGenerateContent" in str(request.url)
        else:
            assert thinking["thinkingBudget"] == 1024
        body = (
            b'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"Look "}]}}]}\n\n'
            b'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read_file",'
            b'"args":{"path":"a.py"}},"thoughtSignature":"sig-stream"}]},'
            b'"finishReason":"STOP"}],"responseId":"gen-stream",'
            b'"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2,'
            b'"thoughtsTokenCount":1,"totalTokenCount":7}}\n\n'
        )
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    thoughts: list[str] = []
    tools: list[tuple[str, str]] = []

    async def on_text(_text: str) -> None:
        return None

    async def on_thought(text: str) -> None:
        thoughts.append(text)

    async def on_tool(call_id: str, name: str, _arguments: str) -> None:
        tools.append((call_id, name))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = GeminiResponsesProvider(
            AgentProviderSettings(
                provider="gemini",
                model=model,
                base_url="https://generativelanguage.googleapis.com/v1beta",
                api_key="gemini-test",
                credential_source="environment",
                reasoning_effort="low",
            ),
            client=client,
        )
        response = await provider.complete_stream(
            instructions="Inspect safely",
            input_items=[{"role": "user", "content": "Read a.py"}],
            tools=[{"type": "function", "name": "read_file"}],
            on_text_delta=on_text,
            on_reasoning_delta=on_thought,
            on_tool_args_delta=on_tool,
        )

    assert thoughts == ["Look "]
    assert tools[0][1] == "read_file"
    assert response.streamed is True
    assert response.tool_calls[0].arguments["path"] == "a.py"
    assert response.usage.total_tokens == 7


async def test_fireworks_enables_reasoning_for_each_supported_model() -> None:
    seen_models: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        seen_models.append(str(payload["model"]))
        # DeepSeek V4 advertises low/high/max. Medium is equally far from low
        # and high, so a tie keeps the deeper level.
        model = str(payload["model"])
        expected = "high" if "deepseek-v4" in model else "medium"
        assert payload["reasoning_effort"] == expected
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-reasoning",
                "choices": [{"message": {"role": "assistant", "content": "ok"}}],
            },
        )

    models = (
        "accounts/fireworks/models/deepseek-v4-flash",
        "accounts/fireworks/models/minimax-m3",
        "accounts/fireworks/models/kimi-k3",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        for model in models:
            provider = FireworksResponsesProvider(
                AgentProviderSettings(
                    provider="fireworks",
                    model=model,
                    base_url="https://api.fireworks.test/inference/v1",
                    api_key="fw-test",
                    credential_source="test",
                    reasoning_effort="medium",
                ),
                client=client,
            )
            response = await provider.complete(
                instructions="Answer briefly",
                input_items=[{"role": "user", "content": "Hello"}],
                tools=[],
            )
            assert response.text == "ok"

    assert seen_models == list(models)


async def test_managed_fireworks_keeps_the_coloride_responses_endpoint() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.coloride.test/v1/llm/responses"
        payload = json.loads(request.content)
        assert payload["model"] == "accounts/fireworks/models/deepseek-v4-flash"
        return httpx.Response(
            200,
            json={
                "id": "resp-managed-fireworks",
                "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Hello"}]}],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = FireworksResponsesProvider(
            AgentProviderSettings(
                provider="fireworks",
                model="accounts/fireworks/models/deepseek-v4-flash",
                base_url="https://api.coloride.test/v1/llm",
                api_key="user-jwt",
                credential_source="coloride",
            ),
            client=client,
        )
        response = await provider.complete(
            instructions="Answer briefly",
            input_items=[{"role": "user", "content": "Hello"}],
            tools=[],
        )

    assert response.text == "Hello"


@pytest.mark.parametrize("model", ["gemini-3.7-flash", "gemini-4-argon"])
async def test_managed_gemini_uses_coloride_responses_endpoint(model: str) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.coloride.test/v1/llm/responses"
        assert request.headers["authorization"].startswith("Bearer ")
        payload = json.loads(request.content)
        assert payload["model"] == model
        assert payload["instructions"] == "Answer briefly"
        return httpx.Response(
            200,
            json={
                "id": "resp-managed-gemini",
                "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Hello"}]}],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = GeminiResponsesProvider(
            AgentProviderSettings(
                provider="gemini",
                model=model,
                base_url="https://api.coloride.test/v1/llm",
                api_key="user-jwt",
                credential_source="coloride",
            ),
            client=client,
        )
        response = await provider.complete(
            instructions="Answer briefly",
            input_items=[{"role": "user", "content": "Hello"}],
            tools=[],
        )

    assert response.text == "Hello"


class EmptySSEStream(httpx.AsyncByteStream):
    async def __aiter__(self):
        if False:  # pragma: no cover
            yield b""


async def test_stream_without_final_response_falls_back_to_json() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        if payload.get("stream"):
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                stream=EmptySSEStream(),
            )
        return httpx.Response(
            200,
            json={
                "id": "resp-fallback",
                "output": [
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": "Recovered"}],
                    }
                ],
            },
        )

    deltas: list[str] = []

    async def on_delta(text: str) -> None:
        deltas.append(text)

    async def on_reasoning(_text: str) -> None:
        return None

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = XAIResponsesProvider(
            AgentProviderSettings(
                provider="xai",
                model="grok-4.5",
                base_url="https://api.x.ai/v1",
                api_key="xai-test",
                credential_source="test",
            ),
            client=client,
        )
        response = await provider.complete_stream(
            instructions="Answer briefly",
            input_items=[{"role": "user", "content": "Hello"}],
            tools=[],
            on_text_delta=on_delta,
            on_reasoning_delta=on_reasoning,
        )

    assert response.text == "Recovered"
    assert response.streamed is True
    assert deltas == ["Recovered"]


async def test_json_fallback_times_out_instead_of_hanging() -> None:
    from coloride_desktop.agents import provider as provider_mod
    from coloride_desktop.agents.provider import AgentProviderError

    original = provider_mod._JSON_FALLBACK_READ_SECONDS
    provider_mod._JSON_FALLBACK_READ_SECONDS = 0.05
    try:
        async def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            if payload.get("stream"):
                return httpx.Response(
                    200,
                    headers={"content-type": "text/event-stream"},
                    stream=EmptySSEStream(),
                )
            await asyncio.sleep(2)
            return httpx.Response(200, json={"id": "too-late", "output": []})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = XAIResponsesProvider(
                AgentProviderSettings(
                    provider="xai",
                    model="grok-4.5",
                    base_url="https://api.x.ai/v1",
                    api_key="xai-test",
                    credential_source="test",
                ),
                client=client,
            )
            async def noop(_text: str) -> None:
                return None

            with pytest.raises(AgentProviderError, match="fallback timed out"):
                await provider.complete_stream(
                    instructions="Answer briefly",
                    input_items=[{"role": "user", "content": "Hello"}],
                    tools=[],
                    on_text_delta=noop,
                    on_reasoning_delta=noop,
                )
    finally:
        provider_mod._JSON_FALLBACK_READ_SECONDS = original


@pytest.mark.parametrize("stream", [False, True])
async def test_gemini_managed_switch_accepts_existing_foreign_reasoning_and_tool_history(
    stream: bool,
) -> None:
    from copy import deepcopy

    history = [
        {"role": "user", "content": "Inspect project"},
        {"type": "reasoning", "id": "grok-reasoning", "encrypted_content": "foreign-opaque-state",
         "summary": [{"type": "summary_text", "text": "Inspecting"}]},
        {"type": "function_call", "call_id": "old", "name": "read_file", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "old", "output": "project contents"},
        {"role": "user", "content": "continue"},
        {"type": "function_call", "call_id": "current", "name": "read_file", "arguments": "{}",
         "extra_content": {"google": {"thought_signature": "real-current-signature"}}},
        {"type": "function_call_output", "call_id": "current", "output": "The user declined this action"},
    ]
    original = deepcopy(history)

    async def handler(request: httpx.Request) -> httpx.Response:
        items = json.loads(request.content)["input"]
        assert not any(item.get("type") == "reasoning" for item in items)
        old = next(item for item in items if item.get("call_id") == "old")
        assert old["extra_content"]["google"]["thought_signature"] == "skip_thought_signature_validator"
        current = next(item for item in items if item.get("call_id") == "current")
        assert current["extra_content"]["google"]["thought_signature"] == "real-current-signature"
        assert items[-1]["output"] == "The user declined this action"
        body = {"id": "resumed", "output": [
            {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Resumed"}]}
        ]}
        if stream:
            event = json.dumps({"type": "response.completed", "response": body})
            return httpx.Response(
                200, text=f"data: {event}\n\n", headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(200, json=body)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = GeminiResponsesProvider(AgentProviderSettings(
            provider="gemini", model="gemini-4-argon", api_key="test-token",
            base_url="https://managed.test/v1", credential_source="coloride",
        ), client=client)
        async def noop(_text: str) -> None:
            pass

        if stream:
            response = await provider.complete_stream(
                instructions="Continue safely", input_items=history, tools=[],
                on_text_delta=noop, on_reasoning_delta=noop,
            )
        else:
            response = await provider.complete(instructions="Continue safely", input_items=history, tools=[])
    assert response.text == "Resumed"
    assert history == original


@pytest.mark.parametrize("stream", [False, True])
async def test_gemini_recovers_rejected_completed_tool_history_once(stream: bool) -> None:
    from copy import deepcopy

    history = [
        {"role": "user", "content": "Inspect"},
        {"type": "function_call", "call_id": "past", "name": "read_file", "arguments": '{"path":"a.ts"}',
         "extra_content": {"google": {"thought_signature": "rejected-old-signature"}}},
        {"type": "function_call_output", "call_id": "past", "output": "The user declined this action"},
        {"role": "user", "content": "continue"},
        {"type": "function_call", "call_id": "current", "name": "read_file", "arguments": "{}",
         "extra_content": {"google": {"thought_signature": "current-real-signature"}}},
        {"type": "function_call_output", "call_id": "current", "output": "current result"},
    ]
    original = deepcopy(history)
    requests = []

    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        requests.append(payload)
        if len(requests) == 1:
            assert payload["input"][1]["type"] == "function_call"
            return httpx.Response(400, json={"error": {"message": "Request contains an invalid argument."}})
        items = payload["input"]
        assert not any(x.get("call_id") == "past" for x in items)
        assert "a.ts" in str(items[1])
        assert "The user declined this action" in str(items[2])
        assert items[-3:] == history[-3:]
        body = {"id": "recovered", "output": [
            {"type": "message", "role": "assistant",
             "content": [{"type": "output_text", "text": "Recovered"}]}
        ]}
        if payload.get("stream"):
            event = json.dumps({"type": "response.completed", "response": body})
            return httpx.Response(
                200, text=f"data: {event}\n\n", headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(200, json=body)

    async def noop(_text: str) -> None:
        pass

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = GeminiResponsesProvider(AgentProviderSettings(
            provider="gemini", model="gemini-4-argon", api_key="test",
            base_url="https://managed.test/v1", credential_source="coloride",
        ), client=client)
        kwargs = {"instructions": "Continue safely", "input_items": history, "tools": []}
        if stream:
            response = await provider.complete_stream(**kwargs, on_text_delta=noop, on_reasoning_delta=noop)
        else:
            response = await provider.complete(**kwargs)
        assert response.text == "Recovered"
        assert len(requests) == 2
        # Subsequent iterations retain portable historical context rather than
        # issuing the same known-invalid request again.
        await provider.complete(**kwargs)
        assert len(requests) == 3
    assert history == original


@pytest.mark.parametrize("status", [400, 401, 402, 429])
async def test_gemini_history_recovery_is_bounded_and_preserves_http_failures(status: int) -> None:
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(status, json={"error": {"message": "Request contains an invalid argument."}})

    async def noop_sleep(_seconds: float) -> None:
        pass

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = GeminiResponsesProvider(AgentProviderSettings(
            provider="gemini", model="gemini-4-argon", api_key="test",
            base_url="https://managed.test/v1", credential_source="coloride",
        ), client=client, sleep=noop_sleep)
        with pytest.raises(AgentProviderError) as caught:
            await provider.complete(instructions="Continue", input_items=[
                {"type": "function_call", "call_id": "past", "name": "read_file", "arguments": "{}"},
                {"type": "function_call_output", "call_id": "past", "output": "old"},
                {"role": "user", "content": "continue"},
            ], tools=[])
        assert caught.value.status_code == status
        if status == 400:
            assert attempts == 2
        elif status in {401, 402}:
            assert attempts == 1
        else:
            assert attempts == provider.capabilities.max_retries


async def test_gemini_does_not_replay_current_turn_or_partial_stream() -> None:
    calls = 0
    provider = GeminiResponsesProvider(AgentProviderSettings(
        provider="gemini", model="gemini-4-argon", api_key="test",
        base_url="https://managed.test/v1", credential_source="coloride",
    ))

    async def failing_call(**kwargs):
        nonlocal calls
        calls += 1
        error = AgentProviderError("Request contains an invalid argument.", retryable=False)
        error.status_code = 400
        raise error

    # Current-turn tools have not become historical context. Their validation
    # failure must reach the caller rather than be silently converted to text.
    with pytest.raises(AgentProviderError):
        await provider._with_history_recovery(failing_call, {"input_items": [
            {"role": "user", "content": "Read"},
            {"type": "function_call", "call_id": "current", "name": "read_file", "arguments": "{}"},
            {"type": "function_call_output", "call_id": "current", "output": "result"},
        ]})
    assert calls == 1
    # A visible or tool-stream delta makes delivery uncertain; never replay it.
    with pytest.raises(AgentProviderError):
        await provider._with_history_recovery(failing_call, {"input_items": [
            {"type": "function_call", "call_id": "old", "name": "read_file", "arguments": "{}"},
            {"type": "function_call_output", "call_id": "old", "output": "result"},
            {"role": "user", "content": "continue"},
        ]}, output_started=lambda: True)
    assert calls == 2


async def test_sse_streams_replace_in_file_progressively_when_deltas_use_output_index() -> None:
    from coloride_desktop.agents.provider import _extract_write_stream_payload

    partial = '{"path":"src/app.ts","old_text":"const a = 1;","new_text":"const a = 2;\\nconst b = 3;'
    extracted = _extract_write_stream_payload("replace_in_file", partial)
    assert extracted == {
        "path": "src/app.ts",
        "content": None,
        "old_text": "const a = 1;",
        "new_text": "const a = 2;\nconst b = 3;",
    }

    frames = [
        {"type": "response.output_item.added", "output_index": 0, "item": {"type": "function_call", "id": "fc_1", "call_id": "call_live_1", "name": "replace_in_file"}},
        {"type": "response.function_call_arguments.delta", "output_index": 0, "delta": '{"path":"src/app.ts","old_text":"old line","new_text":"line 1\\nline 2\\nline 3'},
        {"type": "response.function_call_arguments.delta", "output_index": 0, "delta": '\\nline 4\\nline 5\\nline 6\\nline 7","replace_all":false}'},
        {
            "type": "response.completed",
            "response": {
                "id": "resp-stream-replace",
                "status": "completed",
                "output": [
                    {
                        "type": "function_call",
                        "id": "fc_1",
                        "call_id": "call_live_1",
                        "name": "replace_in_file",
                        "arguments": '{"path":"src/app.ts","old_text":"old line","new_text":"line 1\\nline 2\\nline 3\\nline 4\\nline 5\\nline 6\\nline 7","replace_all":false}',
                    }
                ],
            },
        },
    ]
    sse_body = "".join(f"data: {json.dumps(frame)}\n\n" for frame in frames) + "data: [DONE]\n\n"

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=sse_body, headers={"content-type": "text/event-stream"})

    streamed_deltas: list[tuple[str, str, dict[str, object] | None]] = []

    async def noop(_text: str) -> None:
        return None

    async def on_tool_delta(call_id: str, name: str, arguments: str) -> None:
        streamed_deltas.append((call_id, name, _extract_write_stream_payload(name, arguments)))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = OpenAIResponsesProvider(
            AgentProviderSettings(
                provider="openai",
                model="gpt-5.3-codex",
                base_url="https://api.openai.test/v1",
                api_key="sk-test",
                credential_source="user",
            ),
            client=client,
        )
        response = await provider.complete_stream(
            instructions="Edit file",
            input_items=[{"role": "user", "content": "Update app.ts"}],
            tools=[{"type": "function", "name": "replace_in_file"}],
            on_text_delta=noop,
            on_reasoning_delta=noop,
            on_tool_args_delta=on_tool_delta,
        )

    assert len(streamed_deltas) >= 2
    assert all(call_id == "call_live_1" for call_id, _, _ in streamed_deltas)
    assert all(name == "replace_in_file" for _, name, _ in streamed_deltas)
    assert streamed_deltas[0][2] is not None
    assert streamed_deltas[0][2]["new_text"] == "line 1\nline 2\nline 3"
    assert response.tool_calls[0].call_id == "call_live_1"
