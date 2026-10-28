from __future__ import annotations

import asyncio
import re
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

import httpx

from .config import AgentProviderSettings
from .thought_tags import ThoughtTagParser, split_thought_tags


class AgentProviderError(RuntimeError):
    """Provider failure with retry semantics preserved across the agent loop."""

    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.status_code: int | None = None
        self.history_recovery_attempted = False


TextDeltaCallback = Callable[[str], Awaitable[None]]
ReasoningDeltaCallback = Callable[[str], Awaitable[None]]
# call_id, tool_name, arguments_json_so_far
ToolArgsDeltaCallback = Callable[[str, str, str], Awaitable[None]]

_WRITE_STREAM_TOOLS = frozenset({"write_file", "replace_in_file"})
_WRITE_STREAM_MIN_GROWTH = 16
_WRITE_STREAM_MIN_INTERVAL_S = 0.035
_WRITE_STREAM_MAX_CONTENT_CHARS = 256_000


def _extract_json_string_field(blob: str, key: str) -> str | None:
    """Best-effort extract of a JSON string field, including partial (unterminated) values."""
    pattern = rf'"{re.escape(key)}"\s*:\s*"'
    match = re.search(pattern, blob)
    if not match:
        return None
    i = match.end()
    out: list[str] = []
    while i < len(blob):
        ch = blob[i]
        if ch == "\\" and i + 1 < len(blob):
            nxt = blob[i + 1]
            if nxt == "u" and i + 5 < len(blob):
                hex_part = blob[i + 2 : i + 6]
                try:
                    out.append(chr(int(hex_part, 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
            escapes = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\", "/": "/"}
            out.append(escapes.get(nxt, nxt))
            i += 2
            continue
        if ch == '"':
            return "".join(out)
        out.append(ch)
        i += 1
    # Unterminated string — return what we have so far (live typing).
    return "".join(out)


def _extract_write_stream_payload(tool_name: str, arguments: str) -> dict[str, Any] | None:
    if tool_name not in _WRITE_STREAM_TOOLS or not arguments:
        return None
    path: str | None = None
    content: str | None = None
    old_text: str | None = None
    new_text: str | None = None
    replace_all: bool | None = None
    try:
        obj = json.loads(arguments)
        if isinstance(obj, dict):
            raw_path = obj.get("path")
            if isinstance(raw_path, str) and raw_path.strip():
                path = raw_path.strip()
            if tool_name == "write_file":
                raw_content = obj.get("content")
                if isinstance(raw_content, str):
                    content = raw_content
            elif tool_name == "replace_in_file":
                raw_old = obj.get("old_text")
                if isinstance(raw_old, str):
                    old_text = raw_old
                raw_new = obj.get("new_text")
                if isinstance(raw_new, str):
                    new_text = raw_new
                if isinstance(obj.get("replace_all"), bool):
                    replace_all = obj["replace_all"]
    except json.JSONDecodeError:
        path = _extract_json_string_field(arguments, "path")
        if tool_name == "write_file":
            content = _extract_json_string_field(arguments, "content")
        elif tool_name == "replace_in_file":
            old_text = _extract_json_string_field(arguments, "old_text")
            new_text = _extract_json_string_field(arguments, "new_text")
    if not path:
        return None
    if content is not None and len(content) > _WRITE_STREAM_MAX_CONTENT_CHARS:
        content = content[:_WRITE_STREAM_MAX_CONTENT_CHARS]
    if old_text is not None and len(old_text) > _WRITE_STREAM_MAX_CONTENT_CHARS:
        old_text = old_text[:_WRITE_STREAM_MAX_CONTENT_CHARS]
    if new_text is not None and len(new_text) > _WRITE_STREAM_MAX_CONTENT_CHARS:
        new_text = new_text[:_WRITE_STREAM_MAX_CONTENT_CHARS]
    result: dict[str, Any] = {"path": path, "content": content}
    if old_text is not None:
        result["old_text"] = old_text
    if new_text is not None:
        result["new_text"] = new_text
    if replace_all is not None:
        result["replace_all"] = replace_all
    return result


@dataclass(frozen=True, slots=True)
class ProviderCapabilities:
    streaming: bool
    encrypted_reasoning: bool
    max_context_characters: int
    max_context_tokens: int = 128_000
    max_retries: int = 3
    tools: bool = True
    images: bool = True
    reasoning: bool = False


@dataclass(frozen=True, slots=True)
class ModelToolCall:
    call_id: str
    name: str
    arguments: dict[str, Any]
    # Raw argument text when the provider emitted JSON the runtime must reject.
    # Absent for a parsed object. The workspace never sees this text directly.
    raw_arguments: str | None = None


@dataclass(frozen=True, slots=True)
class ModelUsage:
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


@dataclass(frozen=True, slots=True)
class ModelResponse:
    response_id: str
    text: str
    tool_calls: tuple[ModelToolCall, ...]
    output_items: tuple[dict[str, Any], ...]
    usage: ModelUsage = field(default_factory=ModelUsage)
    streamed: bool = False
    # Set when the provider call failed transiently. The vendored runtime
    # retries that turn; Python does not start a second recovery loop.
    provider_retry: bool = False
    finish_reason: str = "stop"
    stream_complete: bool = True


class AgentModelProvider(Protocol):
    @property
    def model(self) -> str: ...

    @property
    def capabilities(self) -> ProviderCapabilities: ...

    async def complete(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str | dict[str, Any] | None = None,
        prompt_cache_key: str | None = None,
    ) -> ModelResponse: ...


class ResponsesAPIProvider:
    """OpenResponses-compatible adapter with streaming and bounded retries."""

    def __init__(
        self,
        settings: AgentProviderSettings,
        *,
        client: httpx.AsyncClient | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.settings = settings
        self._client = client
        self._sleep = sleep

    @property
    def model(self) -> str:
        return self.settings.model

    @property
    def capabilities(self) -> ProviderCapabilities:
        from .provider_registry import ProviderRegistry, ModelCapabilities
        caps = self.settings.model_capabilities
        if caps is None:
            try:
                caps = ProviderRegistry().capabilities(self.settings.provider, self.settings.model)
            except ValueError:
                caps = ModelCapabilities()
        return ProviderCapabilities(tools=caps.tools, streaming=caps.streaming, images=caps.images,
            reasoning=caps.reasoning, encrypted_reasoning=caps.encrypted_reasoning,
            max_context_characters=caps.context_characters, max_context_tokens=caps.context_tokens)

    async def complete(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str | dict[str, Any] | None = None,
        prompt_cache_key: str | None = None,
    ) -> ModelResponse:
        payload = self._payload(
            instructions=instructions,
            input_items=input_items,
            tools=tools,
            stream=False,
            tool_choice=tool_choice,
            prompt_cache_key=prompt_cache_key,
        )
        body = await self._request_json(payload)
        return _parse_response_body(body)

    async def generate_title(self, message: str) -> str:
        response = await self.complete(
            instructions=(
                "You name coding-agent chats for a professional desktop IDE sidebar. "
                "Write a clear Title Case label in 3 to 6 words that captures the user's goal. "
                "Prefer concrete nouns (files, features, bugs, APIs) over vague verbs. "
                "Examples: Fix Login Redirect, Add Stripe Webhooks, Refactor Auth Middleware. "
                "Return only the title — no quotes, markdown, labels, or ending punctuation."
            ),
            input_items=[
                {
                    "role": "user",
                    "content": (
                        "Create a short sidebar title for this first user message:\n\n"
                        f"{message}"
                    ),
                }
            ],
            tools=[],
        )
        return response.text

    async def complete_stream(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text_delta: TextDeltaCallback,
        on_reasoning_delta: ReasoningDeltaCallback,
        on_tool_args_delta: ToolArgsDeltaCallback | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        prompt_cache_key: str | None = None,
    ) -> ModelResponse:
        payload = self._payload(
            instructions=instructions,
            input_items=input_items,
            tools=tools,
            stream=True,
            tool_choice=tool_choice,
            prompt_cache_key=prompt_cache_key,
        )
        from .debug_log import agent_debug

        agent_debug(
            "provider_stream_start",
            provider=self.settings.provider,
            model=self.settings.model,
            inputItems=len(input_items),
            tools=len(tools),
        )
        try:
            body, streamed_text = await self._request_stream(
                payload,
                on_text_delta,
                on_reasoning_delta,
                on_tool_args_delta,
            )
            agent_debug(
                "provider_stream_done",
                provider=self.settings.provider,
                model=self.settings.model,
                streamedChars=len(streamed_text or ""),
            )
        except AgentProviderError as stream_error:
            # xAI sometimes dies mid-SSE after reasoning (esp. before large tool calls).
            # Fall back once to a non-streaming request so the turn can finish.
            from .debug_log import agent_debug

            agent_debug(
                "provider_stream_error",
                provider=self.settings.provider,
                model=self.settings.model,
                error=_format_exc(stream_error),
            )
            if not _should_fallback_to_json(stream_error):
                raise
            try:
                agent_debug(
                    "provider_fallback_json_start",
                    provider=self.settings.provider,
                    model=self.settings.model,
                    timeoutSeconds=_JSON_FALLBACK_READ_SECONDS,
                )
                # Bound the silent JSON retry. The UI watchdog used to kill the
                # turn while this hung for minutes with no progress events.
                try:
                    body = await asyncio.wait_for(
                        self._request_json(
                            self._payload(
                                instructions=instructions,
                                input_items=input_items,
                                tools=tools,
                                stream=False,
                                tool_choice=tool_choice,
                                prompt_cache_key=prompt_cache_key,
                            )
                        ),
                        timeout=_JSON_FALLBACK_READ_SECONDS,
                    )
                except TimeoutError as timeout_error:
                    raise AgentProviderError(
                        f"{_provider_label(self.settings.provider)} fallback timed out "
                        f"after {_JSON_FALLBACK_READ_SECONDS:.0f}s"
                    ) from timeout_error
                parsed = _parse_response_body(body)
                # Surface any final assistant text that non-stream produced.
                if parsed.text:
                    await on_text_delta(parsed.text)
                agent_debug(
                    "provider_fallback_json_ok",
                    provider=self.settings.provider,
                    toolCalls=len(parsed.tool_calls),
                    textChars=len(parsed.text or ""),
                )
                return ModelResponse(
                    response_id=parsed.response_id,
                    text=parsed.text,
                    tool_calls=parsed.tool_calls,
                    output_items=parsed.output_items,
                    usage=parsed.usage,
                    streamed=True,
                    finish_reason=parsed.finish_reason,
                    stream_complete=parsed.stream_complete,
                )
            except Exception as fallback_error:
                agent_debug(
                    "provider_fallback_json_failed",
                    provider=self.settings.provider,
                    streamError=_format_exc(stream_error),
                    fallbackError=_format_exc(fallback_error),
                )
                raise AgentProviderError(
                    f"{_provider_label(self.settings.provider)} stream failed "
                    f"({_format_exc(stream_error)}); fallback also failed: {_format_exc(fallback_error)}"
                ) from fallback_error

        parsed = _parse_response_body(body)
        return ModelResponse(
            response_id=parsed.response_id,
            text=parsed.text or streamed_text,
            tool_calls=parsed.tool_calls,
            output_items=parsed.output_items,
            usage=parsed.usage,
            streamed=True,
            finish_reason=parsed.finish_reason,
            stream_complete=parsed.stream_complete,
        )

    def _payload(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        stream: bool,
        tool_choice: str | dict[str, Any] | None = None,
        prompt_cache_key: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.settings.model,
            "instructions": instructions,
            "input": input_items,
            "tools": tools,
            # One model round may emit several independent tools (reads especially).
            # Empty-tool requests (titles) omit the flag.
            "store": False,
            "stream": stream,
        }
        if tools:
            payload["parallel_tool_calls"] = True
        cache_key = (prompt_cache_key or "").strip()
        if cache_key:
            payload["prompt_cache_key"] = cache_key
        if tool_choice is not None:
            payload["tool_choice"] = tool_choice
        if self.capabilities.encrypted_reasoning:
            payload["include"] = ["reasoning.encrypted_content"]
        if self.capabilities.reasoning:
            effort = _provider_reasoning_effort(
                self.settings.provider,
                self.settings.model,
                getattr(self.settings, "reasoning_effort", "medium"),
            )
            # Off omits the parameter.
            if effort is not None:
                # "detailed" streams a richer human-readable summary into the UI Thought row.
                # Raw chain-of-thought stays encrypted (include below) — never fully visible.
                payload["reasoning"] = {
                    "effort": effort,
                    "summary": "detailed",
                }
        return payload

    def _headers(self, *, stream: bool, prompt_cache_key: str | None = None) -> dict[str, str]:
        token = self.settings.api_key
        if getattr(self.settings, "credential_source", "") == "coloride":
            from .cloud_token import get_cloud_access_token

            live = get_cloud_access_token()
            if live:
                token = live
        headers = {
            **({"Authorization": f"Bearer {token}"} if token else {}),
            "Content-Type": "application/json",
            "Accept": "text/event-stream" if stream else "application/json",
        }
        cache_key = (prompt_cache_key or "").strip()
        if cache_key and self.settings.provider == "xai":
            headers["x-grok-conv-id"] = cache_key
        return headers

    async def _request_json(self, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(self.capabilities.max_retries):
            try:
                if self._client is not None:
                    response = await self._client.post(
                        f"{self.settings.base_url}/responses",
                        headers=self._headers(
                            stream=False,
                            prompt_cache_key=str(payload.get("prompt_cache_key") or "") or None,
                        ),
                        json=payload,
                    )
                else:
                    async with _default_client() as client:
                        response = await client.post(
                            f"{self.settings.base_url}/responses",
                            headers=self._headers(
                                stream=False,
                                prompt_cache_key=str(payload.get("prompt_cache_key") or "") or None,
                            ),
                            json=payload,
                        )
                response.raise_for_status()
                body = response.json()
                if not isinstance(body, dict):
                    raise AgentProviderError("The model provider returned an invalid response")
                return body
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if (
                    not _provider_status_error(self.settings.provider, exc).retryable
                    or attempt + 1 >= self.capabilities.max_retries
                ):
                    raise _provider_status_error(self.settings.provider, exc) from exc
                await self._sleep(_retry_delay(exc.response, attempt))
            except AgentProviderError:
                raise
            except (httpx.HTTPError, ValueError, TypeError) as exc:
                last_error = exc
                if attempt + 1 >= self.capabilities.max_retries:
                    raise AgentProviderError(
                        f"{_provider_label(self.settings.provider)} request failed: {_format_exc(exc)}"
                    ) from exc
                await self._sleep(_backoff(attempt))
        raise AgentProviderError(f"Model request failed: {last_error}")

    async def _request_stream(
        self,
        payload: dict[str, Any],
        on_text_delta: TextDeltaCallback,
        on_reasoning_delta: ReasoningDeltaCallback,
        on_tool_args_delta: ToolArgsDeltaCallback | None = None,
    ) -> tuple[dict[str, Any], str]:
        last_error: Exception | None = None
        for attempt in range(self.capabilities.max_retries):
            emitted = False

            async def tracked_delta(text: str) -> None:
                nonlocal emitted
                emitted = True
                await on_text_delta(text)

            async def tracked_reasoning_delta(text: str) -> None:
                nonlocal emitted
                emitted = True
                await on_reasoning_delta(text)

            try:
                if self._client is not None:
                    async with self._client.stream(
                        "POST",
                        f"{self.settings.base_url}/responses",
                        headers=self._headers(
                            stream=True,
                            prompt_cache_key=str(payload.get("prompt_cache_key") or "") or None,
                        ),
                        json=payload,
                    ) as response:
                        await _raise_stream_status(response)
                        return await _consume_sse(
                            response,
                            tracked_delta,
                            tracked_reasoning_delta,
                            on_tool_args_delta,
                        )
                async with _default_client() as client, client.stream(
                    "POST",
                    f"{self.settings.base_url}/responses",
                    headers=self._headers(
                        stream=True,
                        prompt_cache_key=str(payload.get("prompt_cache_key") or "") or None,
                    ),
                    json=payload,
                ) as response:
                    await _raise_stream_status(response)
                    return await _consume_sse(
                        response,
                        tracked_delta,
                        tracked_reasoning_delta,
                        on_tool_args_delta,
                    )
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if (
                    emitted
                    or not _provider_status_error(self.settings.provider, exc).retryable
                    or attempt + 1 >= self.capabilities.max_retries
                ):
                    raise _provider_status_error(self.settings.provider, exc) from exc
                await self._sleep(_retry_delay(exc.response, attempt))
            except AgentProviderError:
                raise
            except (httpx.HTTPError, ValueError, TypeError, asyncio.TimeoutError) as exc:
                last_error = exc
                if emitted or attempt + 1 >= self.capabilities.max_retries:
                    raise AgentProviderError(
                        f"{_provider_label(self.settings.provider)} stream failed: {_format_exc(exc)}"
                    ) from exc
                await self._sleep(_backoff(attempt))
        raise AgentProviderError(f"Model stream failed: {_format_exc(last_error)}")


class OpenAIResponsesProvider(ResponsesAPIProvider):
    """OpenAI Responses API adapter."""


class XAIResponsesProvider(ResponsesAPIProvider):
    """xAI Responses API adapter for Grok models."""


class OpenAIChatCompletionsProvider(ResponsesAPIProvider):
    """Fireworks Chat Completions adapter.

    Fireworks is OpenAI-compatible, but its serverless inference endpoint is
    ``/chat/completions`` rather than the Responses endpoint used by OpenAI/xAI.
    Keep the public provider contract in Responses-shaped items so the engine can
    share its tool loop with the other providers.
    """

    @property
    def _uses_coloride_managed_gateway(self) -> bool:
        # Users' provider keys live on api.coloride.com. That gateway exposes the
        # Responses contract and performs its own Responses ↔ Fireworks bridge;
        # never append /chat/completions to a managed gateway URL.
        return self.settings.credential_source == "coloride"

    def _chat_payload(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        stream: bool,
        tool_choice: str | dict[str, Any] | None = None,
        prompt_cache_key: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.settings.model,
            "messages": _fireworks_messages(instructions, input_items),
            "stream": stream,
            "stream_options": {"include_usage": True} if stream else None,
        }
        cache_key = (prompt_cache_key or "").strip()
        if cache_key:
            payload["prompt_cache_key"] = cache_key
        if not stream:
            payload.pop("stream_options", None)
        chat_tools = _fireworks_tools(tools)
        if chat_tools:
            payload["tools"] = chat_tools
            # Groq rejects parallel tool calls on several production models, and
            # Ollama ignores the flag. Keep it for the servers that accept it.
            if self.settings.provider not in {"groq", "ollama"}:
                payload["parallel_tool_calls"] = True
        mapped_choice = _fireworks_tool_choice(tool_choice)
        if mapped_choice is not None:
            payload["tool_choice"] = mapped_choice
        # Fireworks and DeepSeek expose chain-of-thought as `reasoning_content`.
        # Groq, Mistral and Ollama reject reasoning_effort on this endpoint.
        if self.capabilities.reasoning and self.settings.provider in {"fireworks", "deepseek"}:
            effort = _fireworks_reasoning_effort(
                self.settings.model,
                getattr(self.settings, "reasoning_effort", "medium"),
            )
            if effort is not None:
                payload["reasoning_effort"] = effort
        return payload

    async def complete(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str | dict[str, Any] | None = None,
        prompt_cache_key: str | None = None,
    ) -> ModelResponse:
        if self._uses_coloride_managed_gateway:
            return await super().complete(
                instructions=instructions,
                input_items=input_items,
                tools=tools,
                tool_choice=tool_choice,
                prompt_cache_key=prompt_cache_key,
            )
        payload = self._chat_payload(
            instructions=instructions,
            input_items=input_items,
            tools=tools,
            stream=False,
            tool_choice=tool_choice,
            prompt_cache_key=prompt_cache_key,
        )
        body = await self._fireworks_request_json(payload)
        return _parse_fireworks_chat_response(body)

    async def complete_stream(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text_delta: TextDeltaCallback,
        on_reasoning_delta: ReasoningDeltaCallback,
        on_tool_args_delta: ToolArgsDeltaCallback | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        prompt_cache_key: str | None = None,
    ) -> ModelResponse:
        if self._uses_coloride_managed_gateway:
            return await super().complete_stream(
                instructions=instructions,
                input_items=input_items,
                tools=tools,
                on_text_delta=on_text_delta,
                on_reasoning_delta=on_reasoning_delta,
                on_tool_args_delta=on_tool_args_delta,
                tool_choice=tool_choice,
                prompt_cache_key=prompt_cache_key,
            )
        payload = self._chat_payload(
            instructions=instructions,
            input_items=input_items,
            tools=tools,
            stream=True,
            tool_choice=tool_choice,
            prompt_cache_key=prompt_cache_key,
        )
        return await self._fireworks_request_stream(
            payload,
            on_text_delta,
            on_reasoning_delta,
            on_tool_args_delta,
        )

    async def _fireworks_request_json(self, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(self.capabilities.max_retries):
            try:
                if self._client is not None:
                    response = await self._client.post(
                        f"{self.settings.base_url}/chat/completions",
                        headers=self._headers(
                            stream=False,
                            prompt_cache_key=str(payload.get("prompt_cache_key") or "") or None,
                        ),
                        json=payload,
                    )
                else:
                    async with _default_client() as client:
                        response = await client.post(
                            f"{self.settings.base_url}/chat/completions",
                            headers=self._headers(
                                stream=False,
                                prompt_cache_key=str(payload.get("prompt_cache_key") or "") or None,
                            ),
                            json=payload,
                        )
                response.raise_for_status()
                body = response.json()
                if not isinstance(body, dict):
                    raise AgentProviderError(
                        f"{_provider_label(self.settings.provider)} returned an invalid response"
                    )
                return body
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if (
                    not _provider_status_error(self.settings.provider, exc).retryable
                    or attempt + 1 >= self.capabilities.max_retries
                ):
                    raise _provider_status_error(self.settings.provider, exc) from exc
                await self._sleep(_retry_delay(exc.response, attempt))
            except AgentProviderError:
                raise
            except (httpx.HTTPError, ValueError, TypeError) as exc:
                last_error = exc
                if attempt + 1 >= self.capabilities.max_retries:
                    raise AgentProviderError(
                        f"{_provider_label(self.settings.provider)} request failed: {_format_exc(exc)}"
                    ) from exc
                await self._sleep(_backoff(attempt))
        raise AgentProviderError(f"Model request failed: {last_error}")

    async def _fireworks_request_stream(
        self,
        payload: dict[str, Any],
        on_text_delta: TextDeltaCallback,
        on_reasoning_delta: ReasoningDeltaCallback,
        on_tool_args_delta: ToolArgsDeltaCallback | None,
    ) -> ModelResponse:
        async def consume(response: httpx.Response) -> ModelResponse:
            return await _consume_fireworks_chat_sse(
                response,
                on_text_delta,
                on_reasoning_delta,
                on_tool_args_delta,
            )
        try:
            if self._client is not None:
                async with self._client.stream(
                    "POST",
                    f"{self.settings.base_url}/chat/completions",
                    headers=self._headers(
                        stream=True,
                        prompt_cache_key=str(payload.get("prompt_cache_key") or "") or None,
                    ),
                    json=payload,
                ) as response:
                    await _raise_stream_status(response)
                    return await consume(response)
            async with _default_client() as client, client.stream(
                "POST",
                f"{self.settings.base_url}/chat/completions",
                headers=self._headers(
                    stream=True,
                    prompt_cache_key=str(payload.get("prompt_cache_key") or "") or None,
                ),
                json=payload,
            ) as response:
                await _raise_stream_status(response)
                return await consume(response)
        except httpx.HTTPStatusError as exc:
            raise _provider_status_error(self.settings.provider, exc) from exc
        except AgentProviderError:
            raise
        except (httpx.HTTPError, ValueError, TypeError, asyncio.TimeoutError) as exc:
            raise AgentProviderError(
                f"{_provider_label(self.settings.provider)} stream failed: {_format_exc(exc)}"
            ) from exc


class FireworksResponsesProvider(OpenAIChatCompletionsProvider):
    """Compatibility alias for the generic Chat Completions adapter."""


class GeminiResponsesProvider(ResponsesAPIProvider):
    """Gemini adapter.

    Direct Google traffic uses generateContent so function calls keep their
    thought signatures. Managed Coloride LLM still uses the Responses gateway.
    """

    def _payload(self, *, input_items: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        from .gemini_native import gemini_input_items

        return super()._payload(
            input_items=gemini_input_items(input_items, model=self.model), **kwargs,
        )

    @property
    def _uses_coloride_managed_gateway(self) -> bool:
        return self.settings.credential_source == "coloride"

    @staticmethod
    def _normalize_thought_tags(response: ModelResponse) -> ModelResponse:
        text, _ = split_thought_tags(response.text)
        items = []
        for item in response.output_items:
            if item.get("type") == "message" and isinstance(item.get("content"), list):
                content = item["content"]
                raw = "".join(
                    part.get("text", "") for part in content
                    if part.get("type") == "output_text"
                )
                visible, reasoning = split_thought_tags(raw)
                if reasoning or visible != raw:
                    item = dict(item)
                    item["content"] = [
                        part for part in content if part.get("type") != "output_text"
                    ]
                    if visible:
                        item["content"].append({"type": "output_text", "text": visible})
                    if reasoning:
                        item["reasoning_content"] = (
                            item.get("reasoning_content", "") + reasoning
                        )
            items.append(item)
        return replace(response, text=text, output_items=tuple(items))

    _portable_history = False

    async def _with_history_recovery(
        self, call: Callable[..., Awaitable[ModelResponse]], kwargs: dict[str, Any],
        *, output_started: Callable[[], bool] = lambda: False,
    ) -> ModelResponse:
        from .gemini_native import gemini_portable_history

        history = kwargs.get("input_items", [])
        if self._portable_history:
            portable = gemini_portable_history(history)
            if portable is not None:
                kwargs = {**kwargs, "input_items": portable}
        try:
            return await call(**kwargs)
        except AgentProviderError as exc:
            detail = str(exc).lower()
            invalid_argument = "invalid argument" in detail or "invalid_argument" in detail
            if self._portable_history or exc.status_code != 400 or not invalid_argument or output_started():
                raise
            portable = gemini_portable_history(history)
            if portable is None:
                raise
            # One rejected request, one portable replay. No tools are executed
            # here, no transcript is rewritten, and no partial output is retried.
            self._portable_history = True
            try:
                return await call(**{**kwargs, "input_items": portable})
            except AgentProviderError as recovery_error:
                recovery_error.history_recovery_attempted = True
                raise

    async def complete(self, **kwargs: Any) -> ModelResponse:
        response = await self._with_history_recovery(self._complete_raw, kwargs)
        return self._normalize_thought_tags(response)

    async def complete_stream(
        self,
        *,
        on_text_delta: TextDeltaCallback,
        on_reasoning_delta: ReasoningDeltaCallback,
        **kwargs: Any,
    ) -> ModelResponse:
        parser = ThoughtTagParser()
        started = False

        async def emit(chunks: list[tuple[str, str]]) -> None:
            for kind, value in chunks:
                await (on_reasoning_delta if kind == "reasoning" else on_text_delta)(value)

        async def on_raw_text(text: str) -> None:
            nonlocal started
            started = started or bool(text)
            await emit(parser.feed(text))

        async def on_raw_reasoning(text: str) -> None:
            nonlocal started
            started = started or bool(text)
            await on_reasoning_delta(text)

        tool_delta = kwargs.get("on_tool_args_delta")

        async def on_raw_tool(call_id: str, name: str, arguments: str) -> None:
            nonlocal started
            started = True
            if tool_delta is not None:
                await tool_delta(call_id, name, arguments)

        response = await self._with_history_recovery(
            self._complete_stream_raw,
            {**kwargs, "on_text_delta": on_raw_text, "on_reasoning_delta": on_raw_reasoning,
             "on_tool_args_delta": on_raw_tool},
            output_started=lambda: started,
        )
        await emit(parser.feed("", final=True))
        return self._normalize_thought_tags(response)

    async def _complete_raw(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str | dict[str, Any] | None = None,
        prompt_cache_key: str | None = None,
    ) -> ModelResponse:
        if self._uses_coloride_managed_gateway:
            return await super().complete(
                instructions=instructions,
                input_items=input_items,
                tools=tools,
                tool_choice=tool_choice,
                prompt_cache_key=prompt_cache_key,
            )
        from .gemini_native import GeminiNativeError, gemini_payload, parse_gemini_generate_content

        payload = gemini_payload(
            model=self.settings.model,
            instructions=instructions,
            input_items=input_items,
            tools=tools,
            tool_choice=tool_choice,
            reasoning_effort=str(getattr(self.settings, "reasoning_effort", "medium") or "medium"),
        )
        try:
            body = await self._gemini_request_json(payload)
            return _model_response_from_gemini(parse_gemini_generate_content(body))
        except GeminiNativeError as exc:
            error = AgentProviderError(str(exc), retryable=exc.retryable)
            raise error from exc

    async def _complete_stream_raw(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text_delta: TextDeltaCallback,
        on_reasoning_delta: ReasoningDeltaCallback,
        on_tool_args_delta: ToolArgsDeltaCallback | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        prompt_cache_key: str | None = None,
    ) -> ModelResponse:
        if self._uses_coloride_managed_gateway:
            return await super().complete_stream(
                instructions=instructions,
                input_items=input_items,
                tools=tools,
                on_text_delta=on_text_delta,
                on_reasoning_delta=on_reasoning_delta,
                on_tool_args_delta=on_tool_args_delta,
                tool_choice=tool_choice,
                prompt_cache_key=prompt_cache_key,
            )
        from .debug_log import agent_debug
        from .gemini_native import GeminiNativeError

        agent_debug(
            "provider_stream_start",
            provider=self.settings.provider,
            model=self.settings.model,
            inputItems=len(input_items),
            tools=len(tools),
        )
        try:
            parsed = await self._gemini_request_stream(
                instructions=instructions,
                input_items=input_items,
                tools=tools,
                tool_choice=tool_choice,
                on_text_delta=on_text_delta,
                on_reasoning_delta=on_reasoning_delta,
                on_tool_args_delta=on_tool_args_delta,
            )
            agent_debug(
                "provider_stream_done",
                provider=self.settings.provider,
                model=self.settings.model,
                streamedChars=len(parsed.text or ""),
            )
            return parsed
        except (AgentProviderError, GeminiNativeError) as stream_error:
            wrapped = (
                stream_error
                if isinstance(stream_error, AgentProviderError)
                else AgentProviderError(str(stream_error), retryable=stream_error.retryable)
            )
            agent_debug(
                "provider_stream_error",
                provider=self.settings.provider,
                model=self.settings.model,
                error=_format_exc(wrapped),
            )
            if not _should_fallback_to_json(wrapped):
                raise wrapped from stream_error
            parsed = await self._complete_raw(
                instructions=instructions,
                input_items=input_items,
                tools=tools,
                tool_choice=tool_choice,
                prompt_cache_key=prompt_cache_key,
            )
            if parsed.text:
                await on_text_delta(parsed.text)
            return ModelResponse(
                response_id=parsed.response_id,
                text=parsed.text,
                tool_calls=parsed.tool_calls,
                output_items=parsed.output_items,
                usage=parsed.usage,
                streamed=True,
                finish_reason=parsed.finish_reason,
                stream_complete=parsed.stream_complete,
            )

    def _gemini_headers(self, *, stream: bool) -> dict[str, str]:
        from .gemini_native import gemini_headers

        return gemini_headers(self.settings.api_key, stream=stream)

    def _gemini_url(self, *, stream: bool) -> str:
        from .gemini_native import gemini_generate_url

        return gemini_generate_url(self.settings.base_url, self.settings.model, stream=stream)

    async def _gemini_request_json(self, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: Exception | None = None
        url = self._gemini_url(stream=False)
        for attempt in range(self.capabilities.max_retries):
            try:
                if self._client is not None:
                    response = await self._client.post(
                        url,
                        headers=self._gemini_headers(stream=False),
                        json=payload,
                    )
                else:
                    async with _default_client() as client:
                        response = await client.post(
                            url,
                            headers=self._gemini_headers(stream=False),
                            json=payload,
                        )
                response.raise_for_status()
                body = response.json()
                if not isinstance(body, dict):
                    raise AgentProviderError("Gemini returned an invalid response")
                return body
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if (
                    not _provider_status_error(self.settings.provider, exc).retryable
                    or attempt + 1 >= self.capabilities.max_retries
                ):
                    raise _provider_status_error(self.settings.provider, exc) from exc
                await self._sleep(_retry_delay(exc.response, attempt))
            except AgentProviderError:
                raise
            except (httpx.HTTPError, ValueError, TypeError) as exc:
                last_error = exc
                if attempt + 1 >= self.capabilities.max_retries:
                    raise AgentProviderError(
                        f"{_provider_label(self.settings.provider)} request failed: {_format_exc(exc)}"
                    ) from exc
                await self._sleep(_backoff(attempt))
        raise AgentProviderError(f"Model request failed: {last_error}")

    async def _gemini_request_stream(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str | dict[str, Any] | None,
        on_text_delta: TextDeltaCallback,
        on_reasoning_delta: ReasoningDeltaCallback,
        on_tool_args_delta: ToolArgsDeltaCallback | None,
    ) -> ModelResponse:
        from .gemini_native import GeminiNativeError, consume_gemini_sse, gemini_payload

        payload = gemini_payload(
            model=self.settings.model,
            instructions=instructions,
            input_items=input_items,
            tools=tools,
            tool_choice=tool_choice,
            reasoning_effort=str(getattr(self.settings, "reasoning_effort", "medium") or "medium"),
        )
        url = self._gemini_url(stream=True)

        async def consume(response: httpx.Response) -> ModelResponse:
            try:
                parsed = await consume_gemini_sse(
                    response,
                    on_text_delta,
                    on_reasoning_delta,
                    on_tool_args_delta,
                )
            except GeminiNativeError as exc:
                raise AgentProviderError(str(exc), retryable=exc.retryable) from exc
            return _model_response_from_gemini(parsed, streamed=True)

        try:
            if self._client is not None:
                async with self._client.stream(
                    "POST",
                    url,
                    headers=self._gemini_headers(stream=True),
                    json=payload,
                ) as response:
                    await _raise_stream_status(response)
                    return await consume(response)
            async with _default_client() as client, client.stream(
                "POST",
                url,
                headers=self._gemini_headers(stream=True),
                json=payload,
            ) as response:
                await _raise_stream_status(response)
                return await consume(response)
        except httpx.HTTPStatusError as exc:
            raise _provider_status_error(self.settings.provider, exc) from exc
        except AgentProviderError:
            raise
        except (httpx.HTTPError, ValueError, TypeError, asyncio.TimeoutError) as exc:
            raise AgentProviderError(
                f"{_provider_label(self.settings.provider)} stream failed: {_format_exc(exc)}"
            ) from exc


def _model_response_from_gemini(parsed: dict[str, Any], *, streamed: bool | None = None) -> ModelResponse:
    calls = tuple(
        ModelToolCall(
            call_id=str(item.get("call_id") or ""),
            name=str(item.get("name") or ""),
            arguments=(
                dict(raw_arguments)
                if isinstance((raw_arguments := item.get("arguments")), dict)
                else {}
            ),
        )
        for item in parsed.get("tool_calls") or []
        if isinstance(item, dict) and item.get("call_id") and item.get("name")
    )
    raw_usage = parsed.get("usage")
    usage_value: dict[str, Any] = raw_usage if isinstance(raw_usage, dict) else {}
    streamed_flag = streamed if streamed is not None else bool(parsed.get("streamed"))
    return ModelResponse(
        response_id=str(parsed.get("response_id") or ""),
        text=str(parsed.get("text") or ""),
        tool_calls=calls,
        output_items=tuple(item for item in parsed.get("output_items") or [] if isinstance(item, dict)),
        usage=ModelUsage(
            input_tokens=_integer(usage_value.get("input_tokens")),
            cached_input_tokens=_integer(usage_value.get("cached_input_tokens")),
            output_tokens=_integer(usage_value.get("output_tokens")),
            total_tokens=_integer(usage_value.get("total_tokens")),
        ),
        streamed=streamed_flag,
        finish_reason=_finish_reason(str(parsed.get("finish_reason") or ""), bool(calls)),
        stream_complete=bool(parsed.get("stream_complete", False)),
    )


# If the SSE stalls with no meaningful progress for this long, abort and fall back.
# High reasoning often thinks silently for several minutes; do not treat that as dead.
# Empty/heartbeat lines must NOT reset this timer.
_STREAM_STALL_SECONDS = 300.0
# Hard ceiling for a single model stream (even if keepalives keep arriving).
_STREAM_MAX_SECONDS = 900.0
# Non-stream retry after an SSE stall. High JSON completions are also slow.
_JSON_FALLBACK_READ_SECONDS = 360.0


async def _consume_sse(
    response: httpx.Response,
    on_text_delta: TextDeltaCallback,
    on_reasoning_delta: ReasoningDeltaCallback,
    on_tool_args_delta: ToolArgsDeltaCallback | None = None,
) -> tuple[dict[str, Any], str]:
    """Consume OpenResponses SSE.

    xAI often streams function-call arguments as deltas. Large write_file payloads
    can drop the final ``response.completed`` frame; we therefore also assemble
    tool calls live from output_item / arguments deltas so the turn can still run.
    """
    final_response: dict[str, Any] | None = None
    text_parts: list[str] = []
    reasoning_parts: list[str] = []
    event_name = ""
    data_lines: list[str] = []
    # Live assembly of function_call items keyed by canonical call key.
    pending_calls: dict[str, dict[str, Any]] = {}
    call_aliases: dict[str, str] = {}
    call_order: list[str] = []
    response_id = ""
    # Meaningful SSE progress counter (not heartbeats / response.created alone).
    progress_holder: dict[str, int] = {"n": 0}
    # Throttle live write_file / replace_in_file content previews to the UI.
    write_stream_last: dict[str, tuple[float, int]] = {}

    async def _emit_write_stream_if_needed(entry: dict[str, Any]) -> None:
        if on_tool_args_delta is None:
            return
        name = str(entry.get("name") or "")
        if name not in _WRITE_STREAM_TOOLS:
            return
        arguments = entry.get("arguments")
        if not isinstance(arguments, str) or not arguments:
            return
        call_id = str(entry.get("call_id") or entry.get("id") or "")
        if not call_id:
            return
        payload = _extract_write_stream_payload(name, arguments)
        if not payload or not payload.get("path"):
            return
        stream_text = payload.get("content")
        if not isinstance(stream_text, str):
            new_part = payload.get("new_text")
            old_part = payload.get("old_text")
            if isinstance(new_part, str) or isinstance(old_part, str):
                stream_text = f"{old_part or ''}\n{new_part or ''}"
        content_len = len(stream_text) if isinstance(stream_text, str) else -1
        now = time.monotonic()
        prev = write_stream_last.get(call_id)
        if prev is not None:
            last_t, last_len = prev
            if content_len >= 0 and content_len - last_len < _WRITE_STREAM_MIN_GROWTH:
                if now - last_t < _WRITE_STREAM_MIN_INTERVAL_S:
                    return
            elif content_len < 0 and now - last_t < _WRITE_STREAM_MIN_INTERVAL_S:
                return
        write_stream_last[call_id] = (now, max(content_len, 0))
        await on_tool_args_delta(call_id, name, arguments)

    def _candidate_tokens(value: dict[str, Any], item: dict[str, Any] | None = None) -> list[str]:
        tokens: list[str] = []
        if item is not None:
            for field in ("call_id", "id"):
                raw = item.get(field)
                if isinstance(raw, str) and raw:
                    tokens.append(raw)
        for field in ("call_id", "item_id", "id"):
            raw = value.get(field)
            if isinstance(raw, str) and raw:
                tokens.append(raw)
        out_idx = value.get("output_index")
        if out_idx is not None and str(out_idx) != "":
            tokens.append(f"idx:{out_idx}")
        return tokens

    def _call_key(value: dict[str, Any], item: dict[str, Any] | None = None) -> str:
        tokens = _candidate_tokens(value, item)
        for token in tokens:
            canonical = call_aliases.get(token)
            if canonical:
                for alias in tokens:
                    call_aliases[alias] = canonical
                return canonical
        canonical = tokens[0] if tokens else f"call-{len(call_order)}"
        for alias in tokens:
            call_aliases[alias] = canonical
        return canonical

    def _ensure_call(key: str) -> dict[str, Any]:
        entry = pending_calls.get(key)
        if entry is None:
            entry = {
                "type": "function_call",
                "id": key,
                "call_id": key,
                "name": "",
                "arguments": "",
            }
            pending_calls[key] = entry
            call_order.append(key)
        return entry

    def _apply_item(item: dict[str, Any], value: dict[str, Any]) -> None:
        if str(item.get("type") or "") != "function_call":
            return
        key = _call_key(value, item)
        entry = _ensure_call(key)
        call_id = item.get("call_id") or item.get("id")
        if isinstance(call_id, str) and call_id:
            entry["call_id"] = call_id
            entry["id"] = call_id
            call_aliases[call_id] = key
        name = item.get("name")
        if isinstance(name, str) and name:
            entry["name"] = name
        arguments = item.get("arguments")
        if isinstance(arguments, str):
            entry["arguments"] = arguments
        elif isinstance(arguments, dict):
            entry["arguments"] = json.dumps(arguments, ensure_ascii=False)
        extra = item.get("extra_content")
        if extra is not None:
            entry["extra_content"] = extra

    def _assembled_output() -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        if text_parts:
            output.append(
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "".join(text_parts)}],
                }
            )
        for key in call_order:
            entry = pending_calls.get(key)
            if not entry:
                continue
            name = str(entry.get("name") or "")
            arguments = entry.get("arguments")
            call_id = str(entry.get("call_id") or entry.get("id") or key)
            if not name:
                continue
            if not isinstance(arguments, str):
                arguments = json.dumps(arguments or {}, ensure_ascii=False)
            # Skip incomplete JSON arguments — fallback request can recover.
            try:
                json.loads(arguments or "{}")
            except json.JSONDecodeError:
                continue
            item = {
                "type": "function_call",
                "id": call_id,
                "call_id": call_id,
                "name": name,
                "arguments": arguments or "{}",
            }
            extra = entry.get("extra_content")
            if extra is not None:
                item["extra_content"] = extra
            output.append(item)
        return output

    async def consume_event() -> None:
        nonlocal final_response, event_name, response_id
        if not data_lines:
            event_name = ""
            return
        raw = "\n".join(data_lines)
        data_lines.clear()
        if raw == "[DONE]":
            event_name = ""
            return
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise AgentProviderError(
                f"The model provider stream returned invalid JSON: {exc.msg}"
            ) from exc
        if not isinstance(value, dict):
            event_name = ""
            return

        rid = value.get("response_id") or value.get("id")
        if isinstance(rid, str) and rid.startswith("resp"):
            response_id = rid
        response_obj = value.get("response")
        if isinstance(response_obj, dict):
            rid2 = response_obj.get("id")
            if isinstance(rid2, str) and rid2:
                response_id = rid2

        event_type = str(value.get("type") or event_name)
        if event_type == "response.output_text.delta":
            delta = value.get("delta")
            if isinstance(delta, str) and delta:
                text_parts.append(delta)
                await on_text_delta(delta)
        elif event_type in {
            "response.reasoning_summary_text.delta",
            "response.reasoning_text.delta",
            "response.reasoning.delta",
            "response.reasoning_summary_part.delta",
        }:
            delta = value.get("delta")
            if isinstance(delta, str) and delta:
                reasoning_parts.append(delta)
                await on_reasoning_delta(delta)
            # Some payloads nest the crumb under "text"
            nested = value.get("text")
            if isinstance(nested, str) and nested and nested != delta:
                reasoning_parts.append(nested)
                await on_reasoning_delta(nested)
        elif event_type in {
            "response.output_item.added",
            "response.output_item.done",
        }:
            item = value.get("item")
            if isinstance(item, dict):
                _apply_item(item, value)
        elif event_type in {
            "response.function_call_arguments.delta",
            "response.function_call_arguments.delta.partial",
        }:
            key = _call_key(value)
            entry = _ensure_call(key)
            delta = value.get("delta")
            if isinstance(delta, str) and delta:
                entry["arguments"] = str(entry.get("arguments") or "") + delta
            name = value.get("name")
            if isinstance(name, str) and name:
                entry["name"] = name
            await _emit_write_stream_if_needed(entry)
        elif event_type == "response.function_call_arguments.done":
            key = _call_key(value)
            entry = _ensure_call(key)
            arguments = value.get("arguments")
            if isinstance(arguments, str):
                entry["arguments"] = arguments
            elif isinstance(arguments, dict):
                entry["arguments"] = json.dumps(arguments, ensure_ascii=False)
            name = value.get("name")
            if isinstance(name, str) and name:
                entry["name"] = name
            call_id = value.get("call_id")
            if isinstance(call_id, str) and call_id:
                entry["call_id"] = call_id
                entry["id"] = call_id
            await _emit_write_stream_if_needed(entry)
        elif event_type in {"response.completed", "response.done", "response.incomplete"}:
            candidate = value.get("response")
            if isinstance(candidate, dict):
                final_response = {**candidate, "status": candidate.get("status") or ("incomplete" if event_type == "response.incomplete" else "completed"), "_stream_complete": True}
                # Merge any streamed function calls missing from the final payload.
                final_output = candidate.get("output")
                if isinstance(final_output, list):
                    for item in final_output:
                        if isinstance(item, dict):
                            _apply_item(item, value)
            elif isinstance(value.get("output"), list):
                final_response = {**value, "status": value.get("status") or "completed", "_stream_complete": True}
        elif event_type in {"response.failed", "error"}:
            detail = _stream_error_detail(value)
            raise AgentProviderError(f"The model provider stream failed: {detail}")
        # Meaningful progress: content or terminal frames (not bare response.created).
        if event_type in {
            "response.output_text.delta",
            "response.reasoning_summary_text.delta",
            "response.reasoning_text.delta",
            "response.reasoning.delta",
            "response.function_call_arguments.delta",
            "response.function_call_arguments.delta.partial",
            "response.function_call_arguments.done",
            "response.output_item.added",
            "response.output_item.done",
            "response.content_part.added",
            "response.content_part.done",
            "response.completed",
            "response.done",
        }:
            progress_holder["n"] = int(progress_holder.get("n") or 0) + 1
        event_name = ""

    line_iter = response.aiter_lines().__aiter__()
    first_byte_logged = False
    stream_t0 = time.monotonic()
    last_progress_at = stream_t0
    last_heartbeat_log = stream_t0

    async def consume_event_tracked() -> None:
        nonlocal last_progress_at
        before = int(progress_holder.get("n") or 0)
        await consume_event()
        after = int(progress_holder.get("n") or 0)
        if after > before:
            last_progress_at = time.monotonic()

    while True:
        now = time.monotonic()
        if now - stream_t0 >= _STREAM_MAX_SECONDS:
            from .debug_log import agent_debug

            agent_debug(
                "provider_stream_max_wall",
                maxSeconds=_STREAM_MAX_SECONDS,
                elapsedMs=round((now - stream_t0) * 1000),
                progressEvents=int(progress_holder.get("n") or 0),
                responseId=response_id or "",
            )
            assembled = _assembled_output()
            if any(item.get("type") == "function_call" for item in assembled) or text_parts:
                final_response = {
                    "id": response_id or "stream-recovered",
                    "output": assembled if assembled else None,
                    "usage": {},
                }
                if final_response["output"] is None and text_parts:
                    final_response = {
                        "id": response_id or "stream-recovered",
                        "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "".join(text_parts)}]}],
                        "usage": {},
                    }
                break
            raise AgentProviderError(
                f"The model provider stream exceeded {_STREAM_MAX_SECONDS:.0f}s without finishing"
            )

        silent_for = now - last_progress_at
        if silent_for >= _STREAM_STALL_SECONDS:
            from .debug_log import agent_debug

            agent_debug(
                "provider_stream_stall",
                stallSeconds=_STREAM_STALL_SECONDS,
                elapsedMs=round((now - stream_t0) * 1000),
                silentMs=round(silent_for * 1000),
                hadFirstByte=first_byte_logged,
                progressEvents=int(progress_holder.get("n") or 0),
                responseId=response_id or "",
            )
            assembled = _assembled_output()
            if any(item.get("type") == "function_call" for item in assembled) or text_parts:
                final_response = {
                    "id": response_id or "stream-recovered",
                    "output": assembled,
                    "usage": {},
                }
                break
            raise AgentProviderError(
                f"The model provider stream stalled for {_STREAM_STALL_SECONDS:.0f}s with no data"
            )

        # Wait at most until the next stall deadline (not a full fresh 45s each line).
        wait_for = max(0.5, _STREAM_STALL_SECONDS - silent_for)
        try:
            line = await asyncio.wait_for(line_iter.__anext__(), timeout=wait_for)
        except StopAsyncIteration:
            break
        except asyncio.TimeoutError:
            # Loop back — stall/max checks run at the top.
            continue

        if not first_byte_logged and line:
            first_byte_logged = True
            from .debug_log import agent_debug

            agent_debug(
                "provider_stream_first_byte",
                elapsedMs=round((time.monotonic() - stream_t0) * 1000),
                linePreview=str(line)[:120],
            )
            # First network byte is weak progress (avoids stalling before any delta).
            last_progress_at = time.monotonic()

        now = time.monotonic()
        if now - last_heartbeat_log >= 15.0:
            last_heartbeat_log = now
            from .debug_log import agent_debug

            agent_debug(
                "provider_stream_heartbeat",
                elapsedMs=round((now - stream_t0) * 1000),
                silentMs=round((now - last_progress_at) * 1000),
                progressEvents=int(progress_holder.get("n") or 0),
            )

        if not line:
            # Blank SSE separator → flush buffered data event.
            await consume_event_tracked()
        elif line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    await consume_event_tracked()

    if final_response is None:
        assembled = _assembled_output()
        if any(item.get("type") == "function_call" for item in assembled) or text_parts:
            final_response = {
                "id": response_id or "stream-recovered",
                "output": assembled,
                "usage": {},
            }
        else:
            raise AgentProviderError("The model provider stream ended without a final response")
    else:
        # If the model only returned a full reasoning summary at the end (common with
        # encrypted CoT + delayed summary), surface it so the Thought row is not empty.
        final_summary = _extract_reasoning_summary(final_response)
        streamed_reasoning = "".join(reasoning_parts)
        if final_summary and final_summary.strip() and final_summary.strip() not in streamed_reasoning:
            # Prefer the fuller final summary when stream was empty/partial.
            missing = final_summary if not streamed_reasoning.strip() else final_summary[len(streamed_reasoning) :]
            if missing.strip():
                await on_reasoning_delta(missing if streamed_reasoning else final_summary)
        # Prefer assembled function calls when the completed payload omitted them
        # or only had partial argument strings (common on large write_file).
        assembled = _assembled_output()
        assembled_calls = [item for item in assembled if item.get("type") == "function_call"]
        if assembled_calls:
            existing = final_response.get("output")
            kept: list[dict[str, Any]] = []
            if isinstance(existing, list):
                for item in existing:
                    if isinstance(item, dict) and item.get("type") != "function_call":
                        kept.append(item)
            # If final payload already has complete calls, keep those; else use assembled.
            final_calls = [
                item
                for item in (existing or [])
                if isinstance(item, dict) and item.get("type") == "function_call"
            ]
            use_assembled = not final_calls
            if final_calls:
                for item in final_calls:
                    args = item.get("arguments")
                    if not isinstance(args, str) or not args.strip():
                        use_assembled = True
                        break
                    try:
                        json.loads(args)
                    except json.JSONDecodeError:
                        use_assembled = True
                        break
            final_response = {
                **final_response,
                "output": kept + (assembled_calls if use_assembled else final_calls),
            }

    return final_response, "".join(text_parts)


async def _raise_stream_status(response: httpx.Response) -> None:
    if response.status_code >= 400:
        await response.aread()
        response.raise_for_status()


def _fireworks_messages(
    instructions: str,
    input_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Translate the durable Responses-style transcript into chat messages."""
    messages: list[dict[str, Any]] = [{"role": "system", "content": instructions}]
    pending_assistant: dict[str, Any] | None = None

    def flush_assistant() -> None:
        nonlocal pending_assistant
        if pending_assistant is not None:
            messages.append(pending_assistant)
            pending_assistant = None

    for item in input_items:
        item_type = str(item.get("type") or "")
        if item_type == "function_call_output":
            flush_assistant()
            content = item.get("output")
            if not isinstance(content, str):
                content = json.dumps(content if content is not None else {}, ensure_ascii=False)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": str(item.get("call_id") or ""),
                    "content": content,
                }
            )
            continue
        if item_type == "function_call":
            if pending_assistant is None:
                pending_assistant = {"role": "assistant", "content": None, "tool_calls": []}
            calls = pending_assistant.setdefault("tool_calls", [])
            if isinstance(calls, list):
                arguments = item.get("arguments")
                calls.append(
                    {
                        "id": str(item.get("call_id") or item.get("id") or ""),
                        "type": "function",
                        "function": {
                            "name": str(item.get("name") or ""),
                            "arguments": (
                                arguments
                                if isinstance(arguments, str)
                                else json.dumps(arguments or {}, ensure_ascii=False)
                            ),
                        },
                    }
                )
            continue

        role = str(item.get("role") or "user")
        content = _fireworks_content(item.get("content"))
        # The durable Responses transcript uses `developer` for Coloride-owned
        # working state. Fireworks' Chat Completions compatibility is safest
        # with the traditional system/user/assistant/tool role set.
        if role == "developer":
            role = "system"
        # Responses output assistant messages may be followed by a function_call
        # item. Keep both parts in the same Chat Completions assistant message.
        if role == "assistant":
            if pending_assistant is None:
                pending_assistant = {"role": "assistant", "content": content}
            elif pending_assistant.get("content") is None:
                pending_assistant["content"] = content
            reasoning = item.get("reasoning_content")
            if isinstance(reasoning, str) and reasoning:
                pending_assistant["reasoning_content"] = reasoning
            continue
        flush_assistant()
        messages.append({"role": role, "content": content})
    flush_assistant()
    return messages


def _fireworks_content(content: object) -> str | list[dict[str, Any]]:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content or "")
    parts: list[dict[str, Any]] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        kind = str(part.get("type") or "")
        if kind in {"input_text", "output_text", "text"}:
            text = part.get("text")
            if isinstance(text, str):
                parts.append({"type": "text", "text": text})
        elif kind == "input_image":
            url = part.get("image_url")
            if isinstance(url, str) and url:
                parts.append({"type": "image_url", "image_url": {"url": url}})
            elif isinstance(url, dict):
                parts.append({"type": "image_url", "image_url": url})
    return parts or ""


def _fireworks_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    mapped: list[dict[str, Any]] = []
    for tool in tools:
        if str(tool.get("type") or "") != "function":
            continue
        function = tool.get("function")
        if isinstance(function, dict):
            mapped.append({"type": "function", "function": function})
            continue
        name = tool.get("name")
        if not isinstance(name, str) or not name:
            continue
        mapped.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": str(tool.get("description") or ""),
                    "parameters": tool.get("parameters") or {"type": "object", "properties": {}},
                },
            }
        )
    return mapped


def _fireworks_tool_choice(choice: str | dict[str, Any] | None) -> str | dict[str, Any] | None:
    if not isinstance(choice, dict):
        return choice
    if choice.get("type") == "function" and isinstance(choice.get("name"), str):
        return {"type": "function", "function": {"name": choice["name"]}}
    return choice


def _fireworks_reasoning_effort(model: str, effort: object) -> str | None:
    # DeepSeek V4 advertises max; its chat API still speaks low/medium/high,
    # so max leaves as high. Off omits the parameter.
    from .reasoning import wire_reasoning_effort

    value = wire_reasoning_effort(model, effort)
    if value is None:
        return None
    if value not in {"low", "medium", "high"}:
        return "high"
    return value


def _fireworks_output(
    *,
    content: str,
    reasoning: str,
    calls: list[dict[str, Any]],
) -> tuple[tuple[dict[str, Any], ...], tuple[ModelToolCall, ...]]:
    output: list[dict[str, Any]] = []
    if content or reasoning:
        message: dict[str, Any] = {
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": content}] if content else [],
        }
        if reasoning:
            # Persist it for the next Fireworks tool loop. Their docs require
            # reasoning_content to be carried forward for interleaved thinking.
            message["reasoning_content"] = reasoning
        output.append(message)
    parsed_calls: list[ModelToolCall] = []
    for call in calls:
        call_id = str(call.get("id") or "")
        function = call.get("function")
        if not isinstance(function, dict):
            continue
        name = str(function.get("name") or "")
        raw_arguments = function.get("arguments")
        if not call_id or not name:
            continue
        args_text = raw_arguments if isinstance(raw_arguments, str) else json.dumps(raw_arguments or {})
        output.append(
            {
                "type": "function_call",
                "id": call_id,
                "call_id": call_id,
                "name": name,
                "arguments": args_text,
            }
        )
        arguments, raw = _decode_arguments(args_text)
        parsed_calls.append(
            ModelToolCall(call_id=call_id, name=name, arguments=arguments, raw_arguments=raw)
        )
    return tuple(output), tuple(parsed_calls)


def _parse_fireworks_chat_response(body: dict[str, Any]) -> ModelResponse:
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise AgentProviderError("Fireworks returned no completion choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise AgentProviderError("Fireworks returned an invalid completion message")
    content = message.get("content")
    reasoning = message.get("reasoning_content")
    calls = message.get("tool_calls")
    output, parsed_calls = _fireworks_output(
        content=content if isinstance(content, str) else "",
        reasoning=reasoning if isinstance(reasoning, str) else "",
        calls=[call for call in calls if isinstance(call, dict)] if isinstance(calls, list) else [],
    )
    usage_value = body.get("usage")
    prompt_tokens = _integer(usage_value.get("prompt_tokens")) if isinstance(usage_value, dict) else 0
    completion_tokens = _integer(usage_value.get("completion_tokens")) if isinstance(usage_value, dict) else 0
    prompt_details = usage_value.get("prompt_tokens_details") if isinstance(usage_value, dict) else None
    cached = _integer(prompt_details.get("cached_tokens")) if isinstance(prompt_details, dict) else 0
    return ModelResponse(
        finish_reason=_finish_reason(str(choices[0].get("finish_reason") or ""), bool(parsed_calls)),
        stream_complete=bool(choices[0].get("finish_reason")),
        response_id=str(body.get("id") or ""),
        text=content if isinstance(content, str) else "",
        tool_calls=parsed_calls,
        output_items=output,
        usage=ModelUsage(
            input_tokens=prompt_tokens,
            cached_input_tokens=cached,
            output_tokens=completion_tokens,
            total_tokens=_integer(usage_value.get("total_tokens")) if isinstance(usage_value, dict) else prompt_tokens + completion_tokens,
        ),
    )


async def _consume_fireworks_chat_sse(
    response: httpx.Response,
    on_text_delta: TextDeltaCallback,
    on_reasoning_delta: ReasoningDeltaCallback,
    on_tool_args_delta: ToolArgsDeltaCallback | None,
) -> ModelResponse:
    text_parts: list[str] = []
    reasoning_parts: list[str] = []
    calls: dict[int, dict[str, Any]] = {}
    usage: dict[str, Any] = {}
    response_id = ""
    finish_reason = ""
    async for line in response.aiter_lines():
        if not line or not line.startswith("data:"):
            continue
        raw = line[5:].strip()
        if raw == "[DONE]":
            continue
        try:
            event = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise AgentProviderError(f"Fireworks stream returned invalid JSON: {exc.msg}") from exc
        if not isinstance(event, dict):
            continue
        response_id = str(event.get("id") or response_id)
        if isinstance(event.get("usage"), dict):
            usage = event["usage"]
        choices = event.get("choices")
        if not isinstance(choices, list):
            continue
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            finish_reason = str(choice.get("finish_reason") or finish_reason)
            delta = choice.get("delta")
            if not isinstance(delta, dict):
                continue
            content = delta.get("content")
            if isinstance(content, str) and content:
                text_parts.append(content)
                await on_text_delta(content)
            reasoning = delta.get("reasoning_content")
            if isinstance(reasoning, str) and reasoning:
                reasoning_parts.append(reasoning)
                await on_reasoning_delta(reasoning)
            delta_calls = delta.get("tool_calls")
            if not isinstance(delta_calls, list):
                continue
            for raw_call in delta_calls:
                if not isinstance(raw_call, dict):
                    continue
                index = _integer(raw_call.get("index"))
                call = calls.setdefault(index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                raw_id = raw_call.get("id")
                if isinstance(raw_id, str) and raw_id:
                    call["id"] = raw_id
                function = raw_call.get("function")
                if not isinstance(function, dict):
                    continue
                target = call["function"]
                raw_name = function.get("name")
                if isinstance(raw_name, str) and raw_name:
                    target["name"] = raw_name
                if isinstance(function.get("arguments"), str):
                    target["arguments"] += function["arguments"]
                    call_id = str(call.get("id") or f"call_{index}")
                    if on_tool_args_delta is not None and target.get("name"):
                        await on_tool_args_delta(call_id, str(target["name"]), str(target["arguments"]))
    output, parsed_calls = _fireworks_output(
        content="".join(text_parts),
        reasoning="".join(reasoning_parts),
        calls=[calls[index] for index in sorted(calls)],
    )
    if not output:
        raise AgentProviderError("Fireworks stream ended without text or a tool call")
    prompt_tokens = _integer(usage.get("prompt_tokens"))
    completion_tokens = _integer(usage.get("completion_tokens"))
    details = usage.get("prompt_tokens_details")
    return ModelResponse(
        response_id=response_id,
        text="".join(text_parts),
        tool_calls=parsed_calls,
        output_items=output,
        usage=ModelUsage(
            input_tokens=prompt_tokens,
            cached_input_tokens=_integer(details.get("cached_tokens")) if isinstance(details, dict) else 0,
            output_tokens=completion_tokens,
            total_tokens=_integer(usage.get("total_tokens")) or prompt_tokens + completion_tokens,
        ),
        finish_reason=_finish_reason(finish_reason, bool(parsed_calls)),
        stream_complete=bool(finish_reason),
        streamed=True,
    )


def _finish_reason(value: str, has_tools: bool = False) -> str:
    value = value.lower()
    if value in {"completed", "stop", "end_turn", "tool_calls", "function_call"}:
        return "tool_calls" if has_tools else "stop"
    if value in {"length", "max_tokens", "max_output_tokens", "incomplete"}:
        return "length"
    if value in {"safety", "content_filter", "blocked", "blocklist", "prohibited_content"}:
        return "blocked"
    if value in {"failed", "error", "cancelled"}:
        return "error"
    return "unknown"


def _parse_response_body(body: dict[str, Any]) -> ModelResponse:
    raw_output = body.get("output")
    if not isinstance(raw_output, list):
        raise AgentProviderError("The model provider returned no output items")

    output_items = tuple(item for item in raw_output if isinstance(item, dict))
    text_parts: list[str] = []
    tool_calls: list[ModelToolCall] = []
    for item in output_items:
        item_type = str(item.get("type") or "")
        if item_type == "message":
            content = item.get("content")
            if isinstance(content, list):
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    if part.get("type") in {"output_text", "text"}:
                        text = part.get("text")
                        if isinstance(text, str):
                            text_parts.append(text)
        elif item_type == "function_call":
            call_id = str(item.get("call_id") or item.get("id") or "")
            name = str(item.get("name") or "")
            arguments, raw_arguments = _decode_arguments(item.get("arguments"))
            if call_id and name:
                tool_calls.append(
                    ModelToolCall(
                        call_id=call_id,
                        name=name,
                        arguments=arguments,
                        raw_arguments=raw_arguments,
                    )
                )

    usage_value = body.get("usage")
    usage = ModelUsage()
    if isinstance(usage_value, dict):
        input_details = usage_value.get("input_tokens_details")
        usage = ModelUsage(
            input_tokens=_integer(usage_value.get("input_tokens")),
            cached_input_tokens=(
                _integer(input_details.get("cached_tokens"))
                if isinstance(input_details, dict)
                else 0
            ),
            output_tokens=_integer(usage_value.get("output_tokens")),
            total_tokens=_integer(usage_value.get("total_tokens")),
        )
    return ModelResponse(
        response_id=str(body.get("id") or ""),
        text="".join(text_parts),
        tool_calls=tuple(tool_calls),
        output_items=output_items,
        usage=usage,
        finish_reason=_finish_reason(str(body.get("status") or ""), bool(tool_calls)),
        stream_complete=bool(body.get("_stream_complete", body.get("status") in {"completed","incomplete","failed","cancelled"})),
    )


def _decode_arguments(value: object) -> tuple[dict[str, Any], str | None]:
    """Return parsed arguments, or the raw text when the runtime must reject them.

    A malformed payload is not a provider failure. The turn runtime records
    one error result and continues; raising here would skip that result and
    could retry the same model request.
    """
    if isinstance(value, dict):
        return value, None
    if not isinstance(value, str):
        return {}, json.dumps(value)
    try:
        decoded = json.loads(value)
    except json.JSONDecodeError:
        return {}, value
    if not isinstance(decoded, dict):
        return {}, value
    return decoded, None


def _extract_reasoning_summary(response: dict[str, Any]) -> str:
    """Pull human-readable reasoning summary text from a completed Responses payload."""
    chunks: list[str] = []
    output = response.get("output")
    if not isinstance(output, list):
        return ""
    for item in output:
        if not isinstance(item, dict):
            continue
        item_type = str(item.get("type") or "")
        if item_type not in {"reasoning", "reasoning_summary"}:
            continue
        summary = item.get("summary")
        if isinstance(summary, list):
            for part in summary:
                if isinstance(part, dict):
                    text = part.get("text")
                    if isinstance(text, str) and text.strip():
                        chunks.append(text.strip())
                elif isinstance(part, str) and part.strip():
                    chunks.append(part.strip())
        content = item.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    chunks.append(text.strip())
        text_direct = item.get("text")
        if isinstance(text_direct, str) and text_direct.strip():
            chunks.append(text_direct.strip())
    # De-dupe consecutive identical chunks
    cleaned: list[str] = []
    for chunk in chunks:
        if not cleaned or cleaned[-1] != chunk:
            cleaned.append(chunk)
    return "\n".join(cleaned).strip()


def _format_exc(exc: object) -> str:
    if exc is None:
        return "unknown error"
    if isinstance(exc, AgentProviderError):
        message = str(exc).strip()
        return message or exc.__class__.__name__
    if isinstance(exc, httpx.TimeoutException):
        return f"timeout ({exc.__class__.__name__})"
    if isinstance(exc, httpx.HTTPError):
        message = str(exc).strip()
        return message or exc.__class__.__name__
    message = str(exc).strip()
    return message or type(exc).__name__


def _should_fallback_to_json(exc: AgentProviderError) -> bool:
    """Retry once without SSE when the stream dies mid-turn (common with xAI)."""
    message = str(exc).lower()
    markers = (
        "stream failed",
        "stream stalled",
        "without a final response",
        "timeout",
        "disconnected",
        "connection reset",
        "remote protocol",
        "incomplete",
        "invalid json",
    )
    return any(marker in message for marker in markers)


def _stream_error_detail(value: dict[str, Any]) -> str:
    error = value.get("error")
    if isinstance(error, dict):
        for key in ("message", "detail", "code", "type"):
            item = error.get(key)
            if isinstance(item, str) and item.strip():
                return item.strip()
        return json.dumps(error, ensure_ascii=False)[:300]
    if isinstance(error, str) and error.strip():
        return error.strip()
    message = value.get("message")
    if isinstance(message, str) and message.strip():
        return message.strip()
    return "stream failed"


CLOUD_SESSION_EXPIRED = "cloud_session_expired"
CLOUD_SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again."


def is_cloud_session_expired_error(exc: BaseException) -> bool:
    text = str(exc).strip().lower()
    return (
        text == CLOUD_SESSION_EXPIRED
        or CLOUD_SESSION_EXPIRED in text
        or ("session has expired" in text and "sign in" in text)
    )


def _status_error(provider: str, exc: httpx.HTTPStatusError) -> AgentProviderError:
    status_code = exc.response.status_code
    detail = _provider_error_detail(exc.response)
    # Managed LLM (api.coloride.com) — map product errors to an internal marker
    # so the engine can refresh the JWT and retry once before failing the turn.
    managed = "api.coloride.com" in str(getattr(exc.request, "url", "") or "")
    normalized_detail = detail.lower()
    if status_code == 401 and any(marker in normalized_detail for marker in (
        "incorrect api key", "invalid api key", "invalid_api_key",
    )):
        if managed:
            message = (
                "Coloride's provider API key is missing or invalid. The account administrator "
                "must correct the provider configuration. Choose a model from another provider."
            )
        else:
            message = "Your provider API key is missing or invalid. Check your provider credentials."
        # An upstream provider key failure is not an expired user JWT. Do not
        # expose provider key fragments or send the user through login again.
        return AgentProviderError(message, retryable=False)
    if status_code in {402, 429} and any(marker in normalized_detail for marker in (
        "monthly spending cap", "spending limit", "spend limit", "billing hard limit",
    )):
        owner = "Coloride's provider account" if managed else "Your provider account"
        action = (
            "The account administrator must resolve the provider billing limit."
            if managed else "Review your provider billing limit."
        )
        return AgentProviderError(
            f"{owner} has reached its spending limit. {action} Choose a model from another provider.",
            retryable=False,
        )
    if "account" in normalized_detail and "suspended" in normalized_detail:
        owner = "Coloride's provider account" if managed else "Your provider account"
        return AgentProviderError(
            f"{owner} is suspended. The account administrator must resolve billing "
            "or spending limits with the provider. Choose a model from another provider.",
            retryable=False,
        )
    if "no longer available to new users" in normalized_detail:
        replacement = (
            "Gemini 3.1 Pro (Preview)" if "2.5-pro" in normalized_detail
            else "Gemini 3.8 Flash"
        )
        return AgentProviderError(
            f"Google does not allow this account to use the selected Gemini 2.5 model. "
            f"Select {replacement} from the model menu. Your selected model has not been changed.",
            retryable=False,
        )
    if status_code == 404 and "model" in normalized_detail:
        return AgentProviderError(
            f"The selected model is unavailable, inaccessible or not deployed: {detail}. "
            "Select an available model or ask the provider administrator to enable it.",
            retryable=False,
        )
    if status_code == 401:
        if managed:
            return AgentProviderError(CLOUD_SESSION_EXPIRED)
        return AgentProviderError(
            detail
            if detail and "http 401" not in detail.lower()
            else "The model provider rejected this API key. Check your credentials."
        )
    if status_code == 402:
        # Dedicated UI state for out_of_credits — keep a stable marker string.
        if detail and "out_of_credits" in detail.lower():
            return AgentProviderError(detail)
        if detail and detail.lower() not in {"http 402", "payment required"}:
            return AgentProviderError(f"out_of_credits: {detail}")
        return AgentProviderError(
            "out_of_credits: You’ve used all AI credits included in your current plan."
        )
    if status_code == 429:
        return AgentProviderError(
            detail
            if detail and "http 429" not in detail.lower() and "too many" in detail.lower()
            else "Too many AI requests. Wait a moment and try again."
        )
    if status_code == 503:
        code = (detail or "").lower()
        if "billing_configuration" in code or "misconfigured" in code:
            return AgentProviderError(
                "AI is temporarily unavailable for this model. Your credits were not charged."
            )
        if "provider_unavailable" in code or "unavailable" in code:
            return AgentProviderError(
                "The AI service is temporarily unavailable. Your credits were not charged."
            )
        return AgentProviderError(
            detail
            if detail and "http 503" not in detail.lower()
            else "The AI service is temporarily unavailable. Your credits were not charged."
        )
    # Managed LLM goes through api.coloride.com — don't blame "xAI" for gateway errors.
    label = "Coloride AI" if managed else _provider_label(provider)
    if status_code == 413:
        return AgentProviderError(
            "This request is too large for the model (HTTP 413). "
            "Large screenshots or a very long chat history can cause this."
        )
    if status_code == 502 and managed:
        return AgentProviderError(
            detail
            if detail and "http 502" not in detail.lower()
            else "The AI service is temporarily unavailable. Your credits were not charged."
        )
    return AgentProviderError(f"{label} request failed: {detail}")


def _provider_status_error(provider: str, exc: httpx.HTTPStatusError) -> AgentProviderError:
    """Attach the HTTP retry policy to the durable provider error."""
    error = _status_error(provider, exc)
    error.status_code = exc.response.status_code
    error.retryable = error.retryable and _retryable_status(exc.response.status_code)
    return error


def _provider_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except (ValueError, httpx.ResponseNotRead):
        return f"HTTP {response.status_code}"
    if isinstance(payload, dict):
        # Product API: { "error": "out_of_credits", "message": "..." }
        error = payload.get("error")
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"]
        if isinstance(error, str) and error.strip():
            code = error.strip()
            if code == "out_of_credits":
                return "out_of_credits: You’ve used all AI credits included in your current plan."
            if code in {"misconfigured", "billing_configuration_error"}:
                return "billing_configuration_error"
            if code == "provider_unavailable":
                return "provider_unavailable"
            if code == "unauthorized":
                return "Your session has expired. Sign in again."
            return code
    return f"HTTP {response.status_code}"


def _retryable_status(status_code: int) -> bool:
    # Never retry payment-required / auth failures (avoids double charge noise).
    if status_code in {401, 402, 403}:
        return False
    return status_code in {408, 409, 425, 429} or status_code >= 500


def _retry_delay(response: httpx.Response, attempt: int) -> float:
    retry_after = response.headers.get("retry-after")
    if retry_after:
        try:
            return max(0.0, min(float(retry_after), 30.0))
        except ValueError:
            pass
    return _backoff(attempt)


def _backoff(attempt: int) -> float:
    return min(0.5 * (2**attempt), 4.0)


def _default_client() -> httpx.AsyncClient:
    # connect/write short; read longer than High silent-thinking so httpx
    # does not kill the stream before the stall watchdog can recover.
    return httpx.AsyncClient(
        timeout=httpx.Timeout(connect=20.0, read=420.0, write=60.0, pool=20.0)
    )


def _integer(value: object) -> int:
    return int(value) if isinstance(value, int | float) else 0


def _provider_reasoning_effort(provider: str, model: str, effort: object) -> str | None:
    """Map the composer choice to a value the selected model accepts.

    Exact advertised level, otherwise the nearest one,
    tie keeps the deeper level. None means omit the parameter (Off, or a
    model that rejects reasoningEffort, such as Grok Build 0.1).
    """
    from .reasoning import wire_reasoning_effort

    del provider
    return wire_reasoning_effort(model, effort)


def _supports_reasoning(provider: str, model: str) -> bool:
    normalized = model.strip().lower()
    if provider == "openai":
        return normalized.startswith(("gpt-6", "gpt-5", "o1", "o3", "o4"))
    if provider == "xai":
        # Grok Build 0.1 rejects the reasoningEffort parameter (xAI HTTP 400).
        # It reasons with its own model default, so omit the parameter entirely.
        return normalized.startswith(("grok-3-mini", "grok-4"))
    if provider in {"fireworks", "deepseek"}:
        # These models accept reasoning_effort and stream their thought process
        # in reasoning_content.
        return any(
            family in normalized
            for family in ("deepseek", "minimax-m3", "kimi-k3")
        )
    if provider == "mistral":
        return normalized.startswith(("mistral-large", "mistral-medium", "magistral"))
    if provider == "gemini":
        return normalized.startswith("gemini-")
    return False


# Published model context windows (tokens). Compaction triggers at 85%, not 100%.
_GROK_4_5_CONTEXT_TOKENS = 500_000
_GROK_4_3_CONTEXT_TOKENS = 1_000_000
_KIMI_K3_CONTEXT_TOKENS = 1_000_000
_MINIMAX_M3_CONTEXT_TOKENS = 512_000
_GROK_BUILD_CONTEXT_TOKENS = 256_000
_DEEPSEEK_V4_FLASH_CONTEXT_TOKENS = 1_000_000
_GROK_3_CONTEXT_TOKENS = 131_072
_OPENAI_LARGE_CONTEXT_TOKENS = 200_000
_GEMINI_4_ARGON_CONTEXT_TOKENS = 1_048_576
_GEMINI_3_CONTEXT_TOKENS = 1_000_000
_GEMINI_2_5_CONTEXT_TOKENS = 1_000_000
_DEFAULT_CONTEXT_TOKENS = 128_000

# Grok Build is served through our managed proxy, which has a 60s upstream
# gateway deadline. Sending its whole 256k window (plus 26 tool schemas) caused
# reproducible 502s on long chats before xAI returned a first byte. Keep a
# summarized working set around 37k tokens; durable history is never discarded.
_GROK_BUILD_ACTIVE_CONTEXT_CHARACTERS = 120_000

# Compact at 85% of the full window — leave headroom for system prompt, tool
# schemas, reasoning overhead, and the model completion (never wait for 100%).
CONTEXT_COMPACT_FRACTION = 0.85
# Code-heavy agent transcripts are denser than plain English (~4 chars/tok).
_CHARS_PER_TOKEN = 3.2
# Back-compat alias used by the engine token backstop.
CONTEXT_COMPACT_TOKEN_FRACTION = CONTEXT_COMPACT_FRACTION


def _max_context_tokens(provider: str, model: str) -> int:
    """Full model context window in tokens (published limits)."""
    normalized = (model or "").strip().lower()
    if provider == "xai":
        if normalized.startswith("grok-build-0.1"):
            return _GROK_BUILD_CONTEXT_TOKENS
        if normalized.startswith(("grok-4.3", "grok4.3", "grok-4.20", "grok4.20")):
            return _GROK_4_3_CONTEXT_TOKENS
        if (
            normalized.startswith("grok-4")
            or "grok-4.7" in normalized
            or "grok-4.6" in normalized
            or "grok-4.5" in normalized
            or normalized in {"grok-4", "grok-4.5", "grok-4.6", "grok-4.7", "grok4", "grok4.5", "grok4.6", "grok4.7"}
        ):
            return _GROK_4_5_CONTEXT_TOKENS
        if normalized.startswith("grok-3"):
            return _GROK_3_CONTEXT_TOKENS
        # Unknown xAI model — assume current flagship class.
        return _GROK_4_5_CONTEXT_TOKENS
    if provider in {"fireworks", "deepseek", "mistral", "groq", "ollama"}:
        if provider == "mistral":
            return 1_000_000 if "large" in normalized or "codestral" in normalized else 128_000
        if provider == "groq":
            return 131_072
        if provider == "ollama":
            return 32_768
        if provider == "deepseek" or "deepseek-v4-flash" in normalized or "deepseek-v4p1-flash" in normalized:
            return _DEEPSEEK_V4_FLASH_CONTEXT_TOKENS
        if "kimi-k3" in normalized:
            return _KIMI_K3_CONTEXT_TOKENS
        if "minimax-m3" in normalized:
            return _MINIMAX_M3_CONTEXT_TOKENS
        return _DEFAULT_CONTEXT_TOKENS
    if provider == "openai":
        if normalized.startswith(("gpt-5", "gpt-4.1", "o3", "o4")):
            return _OPENAI_LARGE_CONTEXT_TOKENS
        return _DEFAULT_CONTEXT_TOKENS
    if provider == "gemini":
        if normalized.startswith("gemini-4-argon"):
            return _GEMINI_4_ARGON_CONTEXT_TOKENS
        if normalized.startswith("gemini-3"):
            return _GEMINI_3_CONTEXT_TOKENS
        if normalized.startswith("gemini-2.5"):
            return _GEMINI_2_5_CONTEXT_TOKENS
        return _DEFAULT_CONTEXT_TOKENS
    return _DEFAULT_CONTEXT_TOKENS


def _max_context_characters(provider: str, model: str) -> int:
    """Character budget that triggers prompt-only compaction (85% of the window).

    Grok 4.5 ≈ 500K tokens → compact around 425K tokens / ~1.36M history chars.
    """
    normalized = (model or "").strip().lower()
    if provider == "xai" and normalized.startswith("grok-build-0.1"):
        return _GROK_BUILD_ACTIVE_CONTEXT_CHARACTERS
    tokens = _max_context_tokens(provider, model)
    return max(24_000, int(tokens * CONTEXT_COMPACT_FRACTION * _CHARS_PER_TOKEN))


def _provider_label(provider: str) -> str:
    if provider == "fireworks":
        return "Fireworks"
    if provider == "deepseek":
        return "DeepSeek"
    if provider == "mistral":
        return "Mistral"
    if provider == "groq":
        return "Groq"
    if provider == "ollama":
        return "Ollama"
    if provider == "gemini":
        return "Google Gemini"
    return "xAI" if provider == "xai" else "OpenAI" if provider == "openai" else provider
