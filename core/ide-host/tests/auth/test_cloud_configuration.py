import pytest
from fastapi.testclient import TestClient

from coloride_desktop.agents.cloud_token import clear_cloud_access_token, set_cloud_access_token
from coloride_desktop.agents.config import AgentConfigStore, InMemoryAgentSecretStore
from coloride_desktop.api.app import create_app
from coloride_desktop.cloud import cloud_api_base
from coloride_desktop.config import LaunchConfig


def test_disabled_cloud_blocks_proxy_and_token_push(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("COLORIDE_CLOUD_ENABLED", "0")

    def unexpected_network(*args, **kwargs):
        pytest.fail("Disabled cloud must not create an upstream HTTP client")

    monkeypatch.setattr("coloride_desktop.api.app.httpx.AsyncClient", unexpected_network)
    app = create_app(LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test"))
    with TestClient(app) as client:
        headers = {"Authorization": "Bearer test", "X-Cloud-Authorization": "Bearer stale-cloud-token"}
        assert client.get("/api/health", headers=headers).status_code == 200
        for method, path in [
            ("POST", "/api/cloud-auth/device/code"),
            ("GET", "/api/cloud-auth/me"),
            ("GET", "/api/cloud-v1/me"),
            ("POST", "/api/cloud-v1/projects"),
            ("PUT", "/api/cloud-auth/agent-token"),
        ]:
            assert (
                client.request(method, path, headers=headers, json={"accessToken": "stale"}).status_code
                == 403
            )


async def test_disabled_cloud_ignores_cached_token_and_keeps_byok(tmp_path, monkeypatch):
    monkeypatch.setenv("COLORIDE_CLOUD_ACCESS_TOKEN_PATH", str(tmp_path / "cloud-token"))
    set_cloud_access_token("cached-cloud-token")
    try:
        store = AgentConfigStore(
            path=tmp_path / "agent.json",
            secrets=InMemoryAgentSecretStore(),
            environ={
                "COLORIDE_CLOUD_ENABLED": "0",
                "COLORIDE_MANAGED_LLM": "1",
                "OPENAI_API_KEY": "local-test-key",
            },
        )
        await store.update(provider="openai", model="gpt-5.3-codex")
        resolved = await store.resolve()
        assert resolved.api_key == "local-test-key"
        assert resolved.base_url == "https://api.openai.com/v1"
        assert resolved.credential_source == "environment"
        assert (await store.status())["managedLlm"] is False
    finally:
        clear_cloud_access_token()


def test_custom_api_and_invalid_endpoints():
    assert (
        cloud_api_base({"COLORIDE_CLOUD_AUTH_BASE": "https://cloud.example.test/api/"})
        == "https://cloud.example.test/api"
    )
    for value in [
        "http://cloud.example.test",
        "https://user:secret@example.test",
        "https://example.test/?key=secret",
    ]:
        with pytest.raises(ValueError):
            cloud_api_base({"COLORIDE_CLOUD_AUTH_BASE": value})


def test_access_token_path_is_separate_for_custom_cloud(monkeypatch):
    from coloride_desktop.agents.cloud_token import token_path

    monkeypatch.delenv("COLORIDE_CLOUD_ACCESS_TOKEN_PATH", raising=False)
    monkeypatch.setenv("COLORIDE_CLOUD_AUTH_BASE", "https://api.coloride.com")
    official = token_path()
    monkeypatch.setenv("COLORIDE_CLOUD_AUTH_BASE", "https://api.example.test")
    assert token_path() != official


def test_proxy_uses_custom_api_without_contacting_official_cloud(tmp_path, monkeypatch):
    import httpx

    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("COLORIDE_CLOUD_ENABLED", "1")
    monkeypatch.setenv("COLORIDE_CLOUD_AUTH_BASE", "https://cloud.example.test/api/")
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"ok": True})

    client_class = httpx.AsyncClient
    monkeypatch.setattr(
        "coloride_desktop.api.app.httpx.AsyncClient",
        lambda **kwargs: client_class(transport=httpx.MockTransport(respond), **kwargs),
    )
    app = create_app(LaunchConfig(host="127.0.0.1", port=8788, bearer_token="local-test"))
    with TestClient(app) as client:
        response = client.get(
            "/api/cloud-v1/me",
            headers={"Authorization": "Bearer local-test", "X-Cloud-Authorization": "Bearer cloud-test"},
        )
    assert response.status_code == 200
    assert len(requests) == 1
    assert str(requests[0].url) == "https://cloud.example.test/api/v1/me"
    assert requests[0].headers["authorization"] == "Bearer cloud-test"
