from __future__ import annotations

import httpx
import pytest

from coloride_desktop.agents.config import AgentProviderSettings
from coloride_desktop.agents.provider import AgentProviderError, FireworksResponsesProvider, GeminiResponsesProvider


@pytest.mark.parametrize('model,status,detail,expected', [
    ('gemini-2.5-flash', 404, 'This model models/gemini-2.5-flash is no longer available to new users.', 'Gemini 3.8 Flash'),
    ('gemini-2.5-pro', 404, 'This model models/gemini-2.5-pro is no longer available to new users.', 'Gemini 3.1 Pro'),
    ('accounts/fireworks/models/kimi-k3', 412, 'Account coloride-team is suspended, possibly due to failure to pay past invoices.', "Coloride's provider account is suspended"),
    ('accounts/fireworks/models/minimax-m3', 412, 'Account coloride-team is suspended, possibly due to reaching the monthly spending limit.', "Coloride's provider account is suspended"),
    ('accounts/fireworks/models/deepseek-v4-flash', 404, 'Model not found, inaccessible, and/or not deployed', 'not deployed'),
])
@pytest.mark.asyncio
async def test_managed_model_availability_errors_are_actionable_without_retries(model, status, detail, expected):
    requests = []
    async def handler(request):
        requests.append(request)
        return httpx.Response(status, json={'error': 'invalid_request', 'message': detail})

    provider_name = 'gemini' if model.startswith('gemini') else 'fireworks'
    provider_type = GeminiResponsesProvider if provider_name == 'gemini' else FireworksResponsesProvider
    settings = AgentProviderSettings(provider=provider_name, model=model, base_url='https://api.coloride.com/v1/llm', api_key='test', credential_source='coloride')
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = provider_type(settings, client=client)
        with pytest.raises(AgentProviderError) as error:
            await provider.complete(instructions='Test', input_items=[{'role': 'user', 'content': 'OK'}], tools=[])
    assert expected in str(error.value)
    assert error.value.retryable is False
    assert len(requests) == 1
    assert provider.model == model
    assert 'out_of_credits' not in str(error.value)


def test_current_deepseek_model_keeps_context_and_reasoning_capabilities():
    from coloride_desktop.agents.provider import _max_context_tokens, _supports_reasoning
    model = 'accounts/fireworks/models/deepseek-v4p1-flash'
    assert _max_context_tokens('fireworks', model) == 1_000_000
    assert _supports_reasoning('fireworks', model)
