from __future__ import annotations

from dataclasses import replace
import json
import httpx
import pytest
from fastapi.testclient import TestClient
from coloride_desktop.agents import model_discovery
from coloride_desktop.agents.config import AgentConfigStore, InMemoryAgentSecretStore
from coloride_desktop.agents.provider_registry import ProviderRegistry, ModelCapabilities, custom_definition, create_provider, validate_endpoint
from coloride_desktop.agents.gateway import ModelGateway
from coloride_desktop.agents.provider import AgentProviderError, OpenAIChatCompletionsProvider, ResponsesAPIProvider, GeminiResponsesProvider
from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig


def definition(**overrides):
    return {'id': 'custom:example', 'label': 'Example', 'protocol': 'chat-completions',
            'baseUrl': 'https://example.test/v1', 'requiresKey': True, **overrides}


@pytest.mark.parametrize('url', ['http://example.com/v1', 'https://user:secret@example.com/v1', 'https://example.com/v1?api_key=secret', 'https://example.com/#fragment', 'file:///tmp/data', 'http://127.0.0.1:0/v1'])
def test_untrusted_endpoint_shapes_are_rejected(url):
    with pytest.raises(ValueError):
        validate_endpoint(url)


def test_registry_rejects_override_and_keeps_unknown_features_disabled():
    registry = ProviderRegistry([definition()])
    assert registry.get('custom:example').protocol == 'chat-completions'
    assert registry.capabilities('custom:example', 'gpt-6.1-sol') == ModelCapabilities()
    with pytest.raises(ValueError):
        registry.register(custom_definition(definition()))
    with pytest.raises(ValueError):
        custom_definition(definition(id='openai'))
    assert registry.capabilities('openai', 'gpt-6.1-sol').tools
    assert not registry.capabilities('deepseek', 'deepseek-flash').images
    assert registry.get('ollama').requires_key is False
    assert registry.capabilities('ollama', 'qwen2.5-coder:7b').tools
    assert not registry.capabilities('ollama', 'nomic-embed-text').tools
    assert registry.capabilities('groq', 'openai/gpt-oss-120b').tools
    assert not registry.capabilities('groq', 'openai/gpt-oss-120b').reasoning


def test_capability_definitions_validate_types_and_context():
    with pytest.raises(ValueError):
        custom_definition(definition(models={'model': {'tools': 'true'}}))
    with pytest.raises(ValueError):
        custom_definition(definition(models={'model': {'context_tokens': -1}}))
    with pytest.raises(ValueError):
        custom_definition(definition(models={'model': {'encrypted_reasoning': True}}))
    caps = ModelCapabilities.from_dict({'context_tokens': 8192})
    assert caps.context_characters == int(8192 * 3.2)


async def test_custom_catalog_persistence_secret_isolation_and_protocol_dispatch(monkeypatch, tmp_path):
    captured = []
    client_type = httpx.AsyncClient
    def catalog(request):
        captured.append(request)
        assert request.url == 'https://example.test/v1/models'
        assert request.headers['authorization'] == 'Bearer custom-secret'
        return httpx.Response(200, json={'data': [
            {'id': 'unknown-text'}, {'id': 'text-embedding-model'},
            {'id': 'coding', 'context_length': 8192, 'supported_parameters': ['tools'], 'capabilities': {'streaming': True}},
        ]})
    monkeypatch.setattr(model_discovery.httpx, 'AsyncClient', lambda **kwargs: client_type(transport=httpx.MockTransport(catalog), **kwargs))
    secrets = InMemoryAgentSecretStore()
    store = AgentConfigStore(path=tmp_path/'config.json', secrets=secrets, environ={'COLORIDE_MANAGED_LLM': '0'})
    store.register_provider(definition())
    status = await store.connect_provider('custom:example', 'custom-secret')
    assert status['provider'] == 'custom:example'
    assert status['model'] == 'coding'
    assert status['capabilities']['tools'] is True
    assert status['capabilities']['images'] is False
    reloaded = AgentConfigStore(path=store.path, secrets=secrets, environ={})
    assert reloaded.registry().capabilities('custom:example', 'coding').streaming
    assert not reloaded.registry().capabilities('custom:example', 'unknown-text').tools
    assert 'custom-secret' not in store.path.read_text() + json.dumps(status)
    settings = await reloaded.resolve()
    provider = create_provider(settings)
    assert isinstance(provider, OpenAIChatCompletionsProvider)
    assert isinstance(create_provider(replace(settings, protocol='responses')), ResponsesAPIProvider)
    assert isinstance(create_provider(replace(settings, protocol='gemini')), GeminiResponsesProvider)


async def test_generic_chat_adapter_executes_registered_tool_protocol(tmp_path):
    store = AgentConfigStore(path=tmp_path/'config.json', secrets=InMemoryAgentSecretStore(), environ={})
    store.register_provider(definition(models={'coder': {'tools': True, 'streaming': False}}))
    await store.update(provider='custom:example', model='coder', api_key='private-key')
    settings = await store.resolve()
    def completion(request):
        assert request.url.path == '/v1/chat/completions'
        payload = json.loads(request.content)
        assert payload['tools'][0]['function']['name'] == 'read_file'
        assert payload['stream'] is False
        assert 'reasoning_effort' not in payload
        return httpx.Response(200, json={'choices': [{'message': {'content': None, 'tool_calls': [
            {'id': 'call_test', 'type': 'function', 'function': {'name': 'read_file', 'arguments': '{"path":"README.md"}'}}
        ]}, 'finish_reason': 'tool_calls'}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(completion)) as client:
        provider = OpenAIChatCompletionsProvider(settings, client=client)
        result = await ModelGateway(provider).generate(instructions='Read', input_items=[{'role':'user','content':'Read README'}],
            tools=[{'type':'function','name':'read_file','description':'Read file','parameters':{'type':'object','properties':{'path':{'type':'string'}}}}])
    assert result.tool_calls[0].name == 'read_file'


async def test_local_text_only_model_never_streams_or_receives_tools_or_images(monkeypatch, tmp_path):
    client_type = httpx.AsyncClient
    def catalog(request):
        assert 'Authorization' not in request.headers
        return httpx.Response(200, json={'data': [{'id': 'small-local'}]})
    monkeypatch.setattr(model_discovery.httpx, 'AsyncClient', lambda **kwargs: client_type(transport=httpx.MockTransport(catalog), **kwargs))
    secrets = InMemoryAgentSecretStore()
    store = AgentConfigStore(path=tmp_path/'local.json', secrets=secrets, environ={})
    store.register_provider(definition(baseUrl='http://127.0.0.1:11434/v1', requiresKey=False))
    status = await store.connect_provider('custom:example')
    assert status['credentialSource'] == 'local'
    assert status['capabilities']['tools'] is False
    assert status['capabilities']['streaming'] is False
    settings = await store.resolve()
    calls = []
    def completion(request):
        calls.append(request)
        payload = json.loads(request.content)
        assert 'Authorization' not in request.headers
        assert not payload.get('tools')
        assert payload['stream'] is False
        return httpx.Response(200, json={'choices': [{'message': {'content':'Hello'}, 'finish_reason':'stop'}]})
    async with client_type(transport=httpx.MockTransport(completion)) as client:
        gateway = ModelGateway(OpenAIChatCompletionsProvider(settings, client=client))
        async def delta(value):
            raise AssertionError('Streaming must be disabled')
        result = await gateway.generate(instructions='Chat', input_items=[{'role':'user','content':'Hello'}], tools=[{'name':'write_file'}], on_text_delta=delta, on_reasoning_delta=delta)
        assert result.text == 'Hello'
        with pytest.raises(AgentProviderError, match='image support'):
            await gateway.generate(instructions='Look', input_items=[{'role':'user','content':[{'type':'input_image','image_url':'data:image/png;base64,AA=='}]}], tools=[])
    assert len(calls) == 1
    assert await secrets.get_api_key('custom:example') is None


def test_custom_provider_registration_api_requires_auth_and_survives_reload(tmp_path):
    app = create_app(LaunchConfig(host='127.0.0.1', port=8788, bearer_token='test-token'))
    secrets = InMemoryAgentSecretStore()
    app.state.agent_config = AgentConfigStore(path=tmp_path/'config.json', secrets=secrets, environ={})
    headers = {'authorization':'Bearer test-token'}
    with TestClient(app) as client:
        assert client.get('/api/agents/providers').status_code == 401
        assert client.post('/api/agents/providers', json=definition()).status_code == 401
        registered = client.post('/api/agents/providers', headers=headers, json=definition())
        assert registered.status_code == 201
        assert registered.json()['id'] == 'custom:example'
        assert client.post('/api/agents/providers', headers=headers, json=definition()).status_code == 400
        assert any(item['id'] == 'custom:example' for item in client.get('/api/agents/providers', headers=headers).json())
        profiles = client.get('/api/agents/config?includeProviders=true', headers=headers).json()['providers']
        assert any(item['provider']=='custom:example' and not item['configured'] for item in profiles)


async def test_catalog_refresh_can_revoke_features_instead_of_reusing_cached_claims(monkeypatch, tmp_path):
    tools_supported = True
    client_type = httpx.AsyncClient
    def catalog(request):
        return httpx.Response(200, json={'data':[{'id':'coding', 'capabilities':{'tools':tools_supported}}]})
    monkeypatch.setattr(model_discovery.httpx, 'AsyncClient', lambda **kwargs: client_type(transport=httpx.MockTransport(catalog), **kwargs))
    store = AgentConfigStore(path=tmp_path/'config.json', secrets=InMemoryAgentSecretStore(), environ={})
    store.register_provider(definition(requiresKey=False))
    await store.connect_provider('custom:example')
    assert store.registry().capabilities('custom:example', 'coding').tools
    tools_supported = False
    stored = store._read()
    stored['providers']['custom:example']['modelsCheckedAt'] = 0
    store._write(stored)
    await store.connect_provider('custom:example')
    assert not store.registry().capabilities('custom:example', 'coding').tools


async def test_removed_declaration_does_not_survive_via_cached_model_metadata(monkeypatch, tmp_path):
    client_type = httpx.AsyncClient
    monkeypatch.setattr(model_discovery.httpx, 'AsyncClient', lambda **kwargs: client_type(transport=httpx.MockTransport(lambda request: httpx.Response(200,json={'data':[{'id':'coding'}]})), **kwargs))
    store = AgentConfigStore(path=tmp_path/'config.json', secrets=InMemoryAgentSecretStore(), environ={})
    store.register_provider(definition(requiresKey=False, models={'coding':{'tools':True}}))
    await store.connect_provider('custom:example')
    assert store.registry().capabilities('custom:example','coding').tools
    stored = store._read()
    stored['customProviders'][0]['models'] = {}
    store._write(stored)
    assert not store.registry().capabilities('custom:example','coding').tools
    profiles = await store.provider_configurations()
    assert not next(p for p in profiles if p['provider']=='custom:example')['availableModels'][0]['capabilities']['tools']
