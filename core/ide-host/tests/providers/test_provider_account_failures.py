"""Regressions from live multi-provider QA: credentials and spending caps."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from coloride_desktop.agents.config import AgentProviderSettings
from coloride_desktop.agents.provider import (
    AgentProviderError,
    FireworksResponsesProvider,
    GeminiResponsesProvider,
    OpenAIResponsesProvider,
    _provider_status_error,
    is_cloud_session_expired_error,
)


@pytest.mark.parametrize("managed", [False, True])
@pytest.mark.parametrize(
    "status,message",
    [
        (
            401,
            "Incorrect API key provided: ''. You can find your API key at "
            "https://platform.openai.com/account/api-keys.",
        ),
        (
            429,
            "Your billing account has exceeded its monthly spending cap. "
            "Please go to AI Studio to manage your billing.",
        ),
    ],
)
def test_provider_configuration_errors_do_not_request_login_or_retry(managed, status, message):
    base = "https://api.coloride.com/v1/llm" if managed else "https://api.example.test/v1"
    response = httpx.Response(
        status,
        json={"error": "invalid_request", "message": message},
        request=httpx.Request("POST", base + "/responses"),
    )
    with pytest.raises(httpx.HTTPStatusError) as caught:
        response.raise_for_status()
    error = _provider_status_error("openai", caught.value)
    assert error.retryable is False
    assert not is_cloud_session_expired_error(error)
    assert "provider" in str(error).lower()
    assert "administrator" in str(error).lower() if managed else "your" in str(error).lower()


@pytest.mark.parametrize(
    "adapter,provider,base_url,model",
    [
        (OpenAIResponsesProvider, "openai", "https://api.coloride.com/v1/llm", "gpt-5.3-codex"),
        (
            GeminiResponsesProvider,
            "gemini",
            "https://generativelanguage.googleapis.com/v1beta",
            "gemini-3.8-flash",
        ),
        (
            FireworksResponsesProvider,
            "fireworks",
            "https://api.fireworks.ai/inference/v1",
            "accounts/fireworks/models/kimi-k3",
        ),
    ],
)
@pytest.mark.parametrize("stream", [False, True])
async def test_spending_cap_is_not_retried_inside_adapter(adapter, provider, base_url, model, stream):
    calls = 0

    async def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(
            429, json={"error": {"message": "Your billing account has exceeded its monthly spending cap."}}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        settings = AgentProviderSettings(provider, model, base_url, "fixture-key", "test")
        model_provider = adapter(settings, client=client, sleep=lambda _: asyncio.sleep(0))
        with pytest.raises(AgentProviderError) as caught:
            if stream:
                await model_provider.complete_stream(
                    instructions="Say OK",
                    input_items=[{"role": "user", "content": "Hi"}],
                    tools=[],
                    tool_choice=None,
                    on_text_delta=lambda _: asyncio.sleep(0),
                    on_reasoning_delta=lambda _: asyncio.sleep(0),
                )
            else:
                await model_provider.complete(
                    instructions="Say OK",
                    input_items=[{"role": "user", "content": "Hi"}],
                    tools=[],
                )
    assert caught.value.retryable is False
    assert calls == 1
