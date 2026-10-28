from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, cast

from .provider import AgentModelProvider, ModelResponse, AgentProviderError
from .vision import count_vision_parts


class ModelGateway:
    """Single sidecar entry to the provider adapters. No model-if spaghetti here."""
            
    def __init__(self, provider: AgentModelProvider) -> None:
        self.provider = provider

    @property
    def model(self) -> str:
        return getattr(self.provider, "model", "")

    @staticmethod
    def cache_key(session_id: str) -> str:
        cleaned = str(session_id or "").strip()
        return f"coloride:{cleaned}" if cleaned else ""

    async def generate(
        self,
        *,
        instructions: str,
        input_items: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str | dict[str, Any] | None = None,
        prompt_cache_key: str | None = None,
        on_text_delta: Callable[[str], Awaitable[None]] | None = None,
        on_reasoning_delta: Callable[[str], Awaitable[None]] | None = None,
        on_tool_args_delta: Callable[[str, str, str], Awaitable[None]] | None = None,
        complete_stream: Callable[..., Awaitable[ModelResponse]] | None = None,
        stream_kwargs: dict[str, Any] | None = None,
    ) -> ModelResponse:
        caps = getattr(self.provider, "capabilities", None)
        if not getattr(caps, "images", True) and count_vision_parts(input_items):
            raise AgentProviderError("This model does not declare image support. Select an image-capable model.")
        if not getattr(caps, "tools", True):
            tools = []
            tool_choice = None
            if stream_kwargs:
                stream_kwargs = {**stream_kwargs, "tools": [], "tool_choice": None}
        cache_key = (prompt_cache_key or "").strip()
        stream = complete_stream or getattr(self.provider, "complete_stream", None)
        if getattr(caps, "streaming", True) and callable(stream) and on_text_delta is not None and on_reasoning_delta is not None:
            kwargs: dict[str, Any] = {
                "instructions": instructions,
                "input_items": input_items,
                "tools": tools,
                "tool_choice": tool_choice,
                "prompt_cache_key": cache_key or None,
                "on_text_delta": on_text_delta,
                "on_reasoning_delta": on_reasoning_delta,
                "on_tool_args_delta": on_tool_args_delta,
            }
            if stream_kwargs:
                kwargs = stream_kwargs
            streamed = cast(Callable[..., Awaitable[ModelResponse]], stream)
            return await streamed(**kwargs)
        try:
            return await self.provider.complete(
                instructions=instructions,
                input_items=input_items,
                tools=tools,
                tool_choice=tool_choice,
                prompt_cache_key=cache_key or None,
            )
        except TypeError:
            try:
                return await self.provider.complete(
                    instructions=instructions,
                    input_items=input_items,
                    tools=tools,
                    tool_choice=tool_choice,
                )
            except TypeError:
                return await self.provider.complete(
                    instructions=instructions,
                    input_items=input_items,
                    tools=tools,
                )
