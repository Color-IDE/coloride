from __future__ import annotations

import json

from coloride_desktop.agents.config import AgentConfigStore, InMemoryAgentSecretStore


async def test_agent_config_keeps_api_key_out_of_json(tmp_path) -> None:
    path = tmp_path / "agent-config.json"
    secrets = InMemoryAgentSecretStore()
    store = AgentConfigStore(
        path=path,
        secrets=secrets,
        environ={"COLORIDE_MANAGED_LLM": "0"},
    )

    status = await store.update(
        provider="openai",
        model="gpt-5.3-codex",
        api_key="sk-secret-value",
    )

    assert status["configured"] is True
    assert status["credentialSource"] == "keychain"
    assert "sk-secret-value" not in path.read_text(encoding="utf-8")
    assert json.loads(path.read_text(encoding="utf-8")) == {
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-5.3-codex",
        "provider": "openai",
        "providers": {
            "xai": {"model": "grok-4.5", "baseUrl": "https://api.x.ai/v1"},
            "openai": {"model": "gpt-5.3-codex", "baseUrl": "https://api.openai.com/v1"},
        },
    }
    assert path.stat().st_mode & 0o777 == 0o600
    resolved = await store.resolve()
    assert resolved.api_key == "sk-secret-value"
    assert resolved.credential_source == "keychain"


async def test_environment_credential_takes_precedence(tmp_path) -> None:
    secrets = InMemoryAgentSecretStore()
    await secrets.save_api_key("openai", "sk-keychain")
    store = AgentConfigStore(
        path=tmp_path / "agent-config.json",
        secrets=secrets,
        environ={"OPENAI_API_KEY": "sk-environment", "COLORIDE_MANAGED_LLM": "0"},
    )
    await store.update(provider="openai", model="gpt-5.3-codex")

    resolved = await store.resolve()

    assert resolved.api_key == "sk-environment"
    assert resolved.credential_source == "environment"


async def test_xai_uses_separate_credentials_and_defaults(tmp_path) -> None:
    secrets = InMemoryAgentSecretStore()
    await secrets.save_api_key("openai", "sk-openai")
    # Force BYOK-only so this unit test does not prefer managed LLM.
    store = AgentConfigStore(
        path=tmp_path / "agent-config.json",
        secrets=secrets,
        environ={"COLORIDE_MANAGED_LLM": "0"},
    )

    status = await store.update(
        provider="xai",
        model="grok-4.5",
        api_key="xai-secret",
    )
    resolved = await store.resolve()

    assert status == {
        "provider": "xai",
        "model": "grok-4.5",
        "baseUrl": "https://api.x.ai/v1",
        "configured": True,
        "availability": "available",
        "credentialSource": "keychain",
        "managedLlm": False,
        "capabilities": {
            "tools": True,
            "streaming": True,
            "images": True,
            "reasoning": True,
            "encryptedReasoning": True,
            "maxContextCharacters": 1_360_000,
            "maxContextTokens": 500_000,
            "maxRetries": 3,
        },
    }
    assert resolved.api_key == "xai-secret"
    assert await secrets.get_api_key("openai") == "sk-openai"
    assert await secrets.get_api_key("xai") == "xai-secret"


async def test_fireworks_kimi_k3_uses_managed_llm_and_its_1m_context(tmp_path) -> None:
    from coloride_desktop.agents.cloud_token import clear_cloud_access_token, set_cloud_access_token

    clear_cloud_access_token()
    set_cloud_access_token("user-jwt-fireworks")
    try:
        store = AgentConfigStore(
            path=tmp_path / "agent-config.json",
            secrets=InMemoryAgentSecretStore(),
            environ={
                "COLORIDE_MANAGED_LLM": "1",
                "COLORIDE_CLOUD_AUTH_BASE": "https://api.coloride.com",
            },
        )
        await store.update(
            provider="fireworks",
            model="accounts/fireworks/models/kimi-k3",
        )
        status = await store.status()
        resolved = await store.resolve()

        assert status["baseUrl"] == "https://api.fireworks.ai/inference/v1"
        assert status["managedLlm"] is True
        assert status["configured"] is True
        assert status["capabilities"] == {
            "tools": True,
            "streaming": True,
            "images": True,
            "reasoning": True,
            "encryptedReasoning": False,
            "maxContextCharacters": 2_720_000,
            "maxContextTokens": 1_000_000,
            "maxRetries": 3,
        }
        assert resolved.api_key == "user-jwt-fireworks"
        assert resolved.base_url == "https://api.coloride.com/v1/llm"
        assert resolved.credential_source == "coloride"
    finally:
        clear_cloud_access_token()


async def test_managed_llm_uses_cloud_jwt_and_coloride_base(tmp_path) -> None:
    from coloride_desktop.agents.cloud_token import clear_cloud_access_token, set_cloud_access_token

    clear_cloud_access_token()
    set_cloud_access_token("user-jwt-test")
    try:
        store = AgentConfigStore(
            path=tmp_path / "agent-config.json",
            secrets=InMemoryAgentSecretStore(),
            environ={"COLORIDE_MANAGED_LLM": "1", "COLORIDE_CLOUD_AUTH_BASE": "https://api.coloride.com"},
        )
        await store.update(provider="xai", model="grok-4.5")
        resolved = await store.resolve()
        status = await store.status()

        assert resolved.credential_source == "coloride"
        assert resolved.api_key == "user-jwt-test"
        assert resolved.base_url == "https://api.coloride.com/v1/llm"
        assert status["managedLlm"] is True
        assert status["configured"] is True
    finally:
        clear_cloud_access_token()


async def test_xai_environment_credential_is_supported(tmp_path) -> None:
    store = AgentConfigStore(
        path=tmp_path / "agent-config.json",
        secrets=InMemoryAgentSecretStore(),
        environ={"XAI_API_KEY": "xai-environment", "COLORIDE_MANAGED_LLM": "0"},
    )
    await store.update(provider="xai", model="grok-4.5")

    resolved = await store.resolve()

    assert resolved.api_key == "xai-environment"
    assert resolved.credential_source == "environment"


async def test_gemini_uses_managed_coloride_gateway_and_large_context(tmp_path) -> None:
    secrets = InMemoryAgentSecretStore()
    from coloride_desktop.agents.cloud_token import clear_cloud_access_token, set_cloud_access_token

    clear_cloud_access_token()
    set_cloud_access_token("user-jwt-gemini")
    store = AgentConfigStore(
        path=tmp_path / "agent-config.json",
        secrets=secrets,
        environ={
            "COLORIDE_MANAGED_LLM": "1",
            "COLORIDE_CLOUD_AUTH_BASE": "https://api.coloride.com",
        },
    )
    try:
        await store.update(provider="gemini", model="gemini-3.7-flash")
        status = await store.status()
        resolved = await store.resolve()

        assert status["baseUrl"] == "https://generativelanguage.googleapis.com/v1beta"
        assert status["managedLlm"] is True
        assert status["credentialSource"] == "coloride"
        assert status["capabilities"]["maxContextTokens"] == 1_000_000
        assert resolved.api_key == "user-jwt-gemini"
        assert resolved.base_url == "https://api.coloride.com/v1/llm"
    finally:
        clear_cloud_access_token()


async def test_gemini_environment_credential_accepts_google_ai_studio_name(tmp_path) -> None:
    store = AgentConfigStore(
        path=tmp_path / "agent-config.json",
        secrets=InMemoryAgentSecretStore(),
        environ={"GEMINI_API_KEY": "gemini-environment", "COLORIDE_MANAGED_LLM": "0"},
    )
    await store.update(provider="gemini", model="gemini-2.5-flash")

    resolved = await store.resolve()

    assert resolved.api_key == "gemini-environment"
    assert resolved.credential_source == "environment"


async def test_multiple_provider_profiles_survive_reload_without_activation(tmp_path) -> None:
    path = tmp_path / "agent-config.json"
    secrets = InMemoryAgentSecretStore()
    store = AgentConfigStore(path=path, secrets=secrets, environ={"COLORIDE_MANAGED_LLM": "0"})
    await store.update(provider="openai", model="custom-openai", api_key="openai-private", activate=False)
    await store.update(provider="gemini", model="custom-gemini", api_key="gemini-private", activate=False)
    assert store.public_settings()["provider"] == "xai"
    reloaded = AgentConfigStore(path=path, secrets=secrets, environ={"COLORIDE_MANAGED_LLM": "0"})
    public = await reloaded.status(include_providers=True)
    entries = {entry["provider"]: entry for entry in public["providers"]}
    assert entries["openai"]["model"] == "custom-openai"
    assert entries["gemini"]["model"] == "custom-gemini"
    assert entries["openai"]["configured"] and entries["gemini"]["configured"]
    assert entries["xai"]["active"] and not entries["openai"]["active"]
    for secret in ("openai-private", "gemini-private"):
        assert secret not in json.dumps(public)
        assert secret not in path.read_text()
    await reloaded.update(provider="openai", model=entries["openai"]["model"])
    assert (await reloaded.resolve()).api_key == "openai-private"
    assert await secrets.get_api_key("gemini") == "gemini-private"
    await reloaded.update(provider="gemini", model=entries["gemini"]["model"])
    assert (await reloaded.resolve()).api_key == "gemini-private"


async def test_failed_key_save_preserves_all_provider_settings(tmp_path, monkeypatch) -> None:
    import pytest
    path = tmp_path / "agent-config.json"
    secrets = InMemoryAgentSecretStore()
    store = AgentConfigStore(path=path, secrets=secrets, environ={"COLORIDE_MANAGED_LLM": "0"})
    await store.update(provider="openai", model="original", api_key="original-key")
    before = path.read_bytes()
    async def fail_save(provider, key):
        raise RuntimeError("credential store unavailable")
    monkeypatch.setattr(secrets, "save_api_key", fail_save)
    with pytest.raises(RuntimeError, match="credential store unavailable"):
        await store.update(provider="gemini", model="other", api_key="new-key", activate=False)
    assert path.read_bytes() == before
    assert (await store.resolve()).api_key == "original-key"
