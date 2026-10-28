from __future__ import annotations

import json
import httpx
import pytest
from coloride_desktop.agents import model_discovery
from coloride_desktop.agents.config import AgentConfigStore, InMemoryAgentSecretStore


def mock_provider(monkeypatch, handler):
    client = httpx.AsyncClient
    monkeypatch.setattr(model_discovery.httpx, 'AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(handler), **kwargs))


@pytest.mark.parametrize('provider,payload,expected', [
    ('openai', {'data': [{'id': 'gpt-image-2'}, {'id': 'gpt-5.3-codex'}, {'id': 'gpt-6.1-sol'}, {'id': 'ft:custom'}]}, ['gpt-6.1-sol', 'gpt-5.3-codex']),
    ('gemini', {'models': [{'name': 'models/gemini-3.8-flash', 'supportedGenerationMethods': ['generateContent']}, {'name': 'models/gemini-4-argon', 'supportedGenerationMethods': ['embedContent']}]}, ['gemini-3.8-flash']),
    ('xai', {'data': [{'id': 'grok-4.7-202610', 'aliases': ['grok-4.7']}, {'id': 'grok-imagine-image'}]}, ['grok-4.7']),
    ('fireworks', {'models': [{'name': 'accounts/fireworks/models/kimi-k3', 'supportsServerless': True}, {'name': 'accounts/fireworks/models/minimax-m3', 'supportsServerless': False}]}, ['accounts/fireworks/models/kimi-k3']),
])
async def test_account_catalog_is_intersected_with_coding_shortlist(monkeypatch, provider, payload, expected):
    def respond(request):
        assert 'test-private-key' not in str(request.url)
        assert request.headers.get('x-goog-api-key' if provider == 'gemini' else 'Authorization') == ('test-private-key' if provider == 'gemini' else 'Bearer test-private-key')
        return httpx.Response(200, json=payload)
    mock_provider(monkeypatch, respond)
    models = await model_discovery.discover_models(provider, 'test-private-key')
    assert [model['id'] for model in models] == expected


async def test_gemini_pagination_retains_headers_and_filters(monkeypatch):
    requests = []
    def respond(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(200, json={'models': [], 'nextPageToken': 'next'})
        assert request.url.params['pageToken'] == 'next'
        return httpx.Response(200, json={'models': [{'name': 'models/gemini-4-argon', 'supportedGenerationMethods': ['generateContent']}]})
    mock_provider(monkeypatch, respond)
    assert (await model_discovery.discover_models('gemini', 'private'))[0]['id'] == 'gemini-4-argon'
    assert len(requests) == 2


@pytest.mark.parametrize('status', [401, 403, 429, 500, 302])
async def test_provider_errors_never_echo_credentials(monkeypatch, status):
    mock_provider(monkeypatch, lambda request: httpx.Response(status, json={'error': 'secret-private-key'}, headers={'Location': 'https://other.invalid'}))
    with pytest.raises(model_discovery.ModelDiscoveryError) as error:
        await model_discovery.discover_models('openai', 'secret-private-key')
    assert 'secret-private-key' not in str(error.value)


async def test_mistral_and_groq_catalogs_keep_reviewed_coding_models(monkeypatch):
    def respond(request):
        host = request.url.host
        if host == 'api.mistral.ai':
            assert request.headers['authorization'] == 'Bearer test-private-key'
            return httpx.Response(200, json={'data': [
                {'id': 'mistral-embed'}, {'id': 'mistral-large-latest'}, {'id': 'codestral-latest'},
            ]})
        assert host == 'api.groq.com'
        return httpx.Response(200, json={'data': [
            {'id': 'whisper-large-v3'}, {'id': 'openai/gpt-oss-120b'}, {'id': 'llama-3.3-70b-versatile'},
        ]})
    mock_provider(monkeypatch, respond)
    mistral = await model_discovery.discover_models('mistral', 'test-private-key')
    groq = await model_discovery.discover_models('groq', 'test-private-key')
    assert [model['id'] for model in mistral] == ['mistral-large-latest', 'codestral-latest']
    assert [model['id'] for model in groq] == ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile']


async def test_ollama_lists_installed_tool_models_and_skips_embeddings(monkeypatch):
    def respond(request):
        assert request.url == 'http://127.0.0.1:11434/v1/models'
        assert 'authorization' not in {name.lower() for name in request.headers}
        return httpx.Response(200, json={'data': [
            {'id': 'nomic-embed-text:latest'}, {'id': 'qwen2.5-coder:7b'}, {'id': 'llama3.1:8b'},
        ]})
    mock_provider(monkeypatch, respond)
    models = await model_discovery.discover_models('ollama', '')
    assert [model['id'] for model in models] == ['llama3.1:8b', 'qwen2.5-coder:7b']


async def test_ollama_unreachable_does_not_invent_a_model(monkeypatch):
    def fail(request):
        raise httpx.ConnectError('refused', request=request)
    mock_provider(monkeypatch, fail)
    with pytest.raises(model_discovery.ModelDiscoveryError, match='not running'):
        await model_discovery.discover_models('ollama', '')


@pytest.mark.parametrize('payload', [{'data': []}, {'data': [{'id': 'text-embedding-3-large'}]}, {'data': None}, []])
async def test_empty_unsupported_or_malformed_catalog_is_not_saved(monkeypatch, payload):
    mock_provider(monkeypatch, lambda request: httpx.Response(200, json=payload))
    with pytest.raises(model_discovery.ModelDiscoveryError):
        await model_discovery.discover_models('openai', 'private')


async def test_automatic_connection_validates_before_saving_and_preserves_other_keys(monkeypatch, tmp_path):
    calls = []
    async def discover(provider, key):
        calls.append((provider, key))
        if key == 'invalid':
            raise model_discovery.ModelDiscoveryError('Rejected')
        return [{'id': 'gpt-6.1-sol' if provider == 'openai' else 'gemini-4-argon', 'label': 'Recommended'}]
    monkeypatch.setattr(model_discovery, 'discover_models', discover)
    secrets = InMemoryAgentSecretStore()
    store = AgentConfigStore(path=tmp_path/'config.json', secrets=secrets, environ={'COLORIDE_MANAGED_LLM': '0'})
    result = await store.connect_provider('openai', ' first-key ')
    assert result['provider'] == 'openai'
    assert result['model'] == 'gpt-6.1-sol'
    assert result['capabilities']['tools'] is True
    original = store.path.read_bytes()
    with pytest.raises(ValueError):
        await store.connect_provider('openai', 'invalid')
    assert store.path.read_bytes() == original
    assert await secrets.get_api_key('openai') == 'first-key'
    result = await store.connect_provider('gemini', 'second-key')
    assert result['provider'] == 'openai'
    profiles = {entry['provider']: entry for entry in result['providers']}
    assert profiles['gemini']['availableModels'][0]['id'] == 'gemini-4-argon'
    await store.connect_provider('gemini')
    assert len(calls) == 3  # Validated once, then cached on refresh.
    reloaded = AgentConfigStore(path=store.path, secrets=secrets, environ={'COLORIDE_MANAGED_LLM': '0'})
    assert (await reloaded.provider_configurations())[0]['provider'] == 'fireworks'
    assert 'first-key' not in json.dumps(result) + store.path.read_text()
    assert 'second-key' not in json.dumps(result) + store.path.read_text()
    # Composer changes preserve the discovered list.
    await store.update(provider='gemini', model='gemini-4-argon')
    assert next(p for p in await store.provider_configurations() if p['provider'] == 'gemini')['availableModels']


async def test_environment_key_is_discovered_without_overwriting_keychain(monkeypatch, tmp_path):
    async def discover(provider, key):
        assert key == 'environment-key'
        return [{'id': 'gpt-6.1-sol', 'label': 'GPT-6.1 Sol'}]
    monkeypatch.setattr(model_discovery, 'discover_models', discover)
    secrets = InMemoryAgentSecretStore()
    store = AgentConfigStore(path=tmp_path/'config.json', secrets=secrets, environ={'OPENAI_API_KEY': 'environment-key', 'COLORIDE_MANAGED_LLM': '0'})
    await store.connect_provider('openai')
    assert await secrets.get_api_key('openai') is None
    with pytest.raises(ValueError, match='environment'):
        await store.connect_provider('openai', 'replacement-key')


async def test_failed_metadata_write_restores_previous_secret(monkeypatch, tmp_path):
    async def discover(provider, key):
        return [{'id': 'gpt-6.1-sol', 'label': 'GPT-6.1 Sol'}]
    monkeypatch.setattr(model_discovery, 'discover_models', discover)
    secrets = InMemoryAgentSecretStore()
    store = AgentConfigStore(path=tmp_path/'config.json', secrets=secrets, environ={'COLORIDE_MANAGED_LLM': '0'})
    await store.connect_provider('openai', 'original-key')
    original = store.path.read_bytes()
    def fail_write(value):
        raise OSError('disk unavailable')
    monkeypatch.setattr(store, '_write', fail_write)
    with pytest.raises(OSError):
        await store.connect_provider('openai', 'replacement-key')
    assert await secrets.get_api_key('openai') == 'original-key'
    assert store.path.read_bytes() == original
