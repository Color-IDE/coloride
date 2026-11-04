from __future__ import annotations

import asyncio
import contextlib
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

from ..cloud import cloud_api_base, cloud_enabled
from .cloud_token import get_cloud_access_token

DEFAULT_PROVIDER = "xai"
DEFAULT_MODEL = "grok-4.5"
DEFAULT_BASE_URL = "https://api.x.ai/v1"

from .provider_registry import ProviderRegistry, ModelCapabilities, custom_definition

# Coloride's hosted gateway holds credentials for every product provider. BYOK
# remains an explicit development/enterprise fallback, never a normal user flow.
MANAGED_LLM_PROVIDERS = frozenset({"fireworks", "gemini", "openai", "xai"})


class AgentSecretStore(Protocol):
    async def has_api_key(self, provider: str) -> bool: ...

    async def get_api_key(self, provider: str) -> str | None: ...

    async def save_api_key(self, provider: str, api_key: str) -> None: ...

    async def delete_api_key(self, provider: str) -> None: ...


class InMemoryAgentSecretStore:
    def __init__(self) -> None:
        self._keys: dict[str, str] = {}

    async def has_api_key(self, provider: str) -> bool:
        return bool(self._keys.get(provider))

    async def get_api_key(self, provider: str) -> str | None:
        return self._keys.get(provider)

    async def save_api_key(self, provider: str, api_key: str) -> None:
        self._keys[provider] = api_key

    async def delete_api_key(self, provider: str) -> None:
        self._keys.pop(provider, None)


class KeyringAgentSecretStore:
    """Store model credentials in the operating-system credential vault."""

    SERVICE = "coloride-agents"

    @staticmethod
    def _account(provider: str) -> str:
        return f"{provider}:api-key"

    async def has_api_key(self, provider: str) -> bool:
        if sys.platform != "darwin":
            return bool(await self.get_api_key(provider))
        # Query item attributes only. Never pass -g or -w: those request the
        # protected password and can display a Python keychain permission dialog.
        def exists() -> bool:
            try:
                result = subprocess.run(
                    ["/usr/bin/security", "find-generic-password",
                     "-s", self.SERVICE, "-a", self._account(provider)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    timeout=5, check=False,
                )
                return result.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                return False
        return await asyncio.to_thread(exists)

    async def get_api_key(self, provider: str) -> str | None:
        try:
            return await asyncio.to_thread(
                keyring.get_password,
                self.SERVICE,
                self._account(provider),
            )
        except KeyringError:
            return None

    async def save_api_key(self, provider: str, api_key: str) -> None:
        await asyncio.to_thread(
            keyring.set_password,
            self.SERVICE,
            self._account(provider),
            api_key,
        )

    async def delete_api_key(self, provider: str) -> None:
        with contextlib.suppress(PasswordDeleteError, KeyringError):
            await asyncio.to_thread(
                keyring.delete_password,
                self.SERVICE,
                self._account(provider),
            )


@dataclass(frozen=True, slots=True)
class AgentProviderSettings:
    provider: str
    model: str
    base_url: str
    api_key: str
    credential_source: str
    reasoning_effort: str = "medium"
    protocol: str | None = None
    model_capabilities: ModelCapabilities | None = None


class AgentConfigStore:
    """Persist non-secret provider settings and resolve credentials privately."""

    def __init__(
        self,
        path: Path | None = None,
        secrets: AgentSecretStore | None = None,
        environ: dict[str, str] | None = None,
    ) -> None:
        self._connect_lock = asyncio.Lock()
        self.path = path or Path.home() / ".coloride" / "desktop" / "agent-config.json"
        self.secrets = secrets or KeyringAgentSecretStore()
        self.environ = environ if environ is not None else os.environ

    def registry(self) -> ProviderRegistry:
        stored = self._read()
        custom = stored.get("customProviders", [])
        profiles = stored.get("providers", {})
        return ProviderRegistry(custom if isinstance(custom, list) else [], profiles if isinstance(profiles, dict) else {})

    def register_provider(self, value: dict[str, object]) -> dict[str, object]:
        definition = custom_definition(value)
        registry = self.registry()
        registry.register(definition)
        stored = self._read()
        stored["customProviders"] = [*stored.get("customProviders", []), {**value, "baseUrl": definition.base_url}]
        self._write(stored)
        return definition.public()

    def public_settings(self) -> dict[str, str]:
        stored = self._read()
        provider = str(stored.get("provider") or DEFAULT_PROVIDER).strip().lower()
        registry = self.registry()
        try:
            definition = registry.get(provider)
        except ValueError:
            provider = DEFAULT_PROVIDER
            definition = registry.get(provider)
        default_model, default_base_url = definition.default_model, definition.base_url
        provider_base_url_env = {
            "fireworks": "COLORIDE_FIREWORKS_BASE_URL",
            "gemini": "COLORIDE_GEMINI_BASE_URL",
            "openai": "COLORIDE_OPENAI_BASE_URL",
            "xai": "COLORIDE_XAI_BASE_URL",
            "deepseek": "COLORIDE_DEEPSEEK_BASE_URL",
            "mistral": "COLORIDE_MISTRAL_BASE_URL",
            "groq": "COLORIDE_GROQ_BASE_URL",
            "ollama": "COLORIDE_OLLAMA_BASE_URL",
        }.get(provider, "")
        return {
            "provider": provider,
            "model": str(
                self.environ.get("COLORIDE_AGENT_MODEL")
                or stored.get("model")
                or default_model
            ),
            "baseUrl": str(
                self.environ.get("COLORIDE_AGENT_BASE_URL")
                or self.environ.get(provider_base_url_env)
                or stored.get("baseUrl")
                or default_base_url
            ),
        }

    def _stored_provider_settings(self, provider: str, stored: dict[str, object] | None = None) -> dict[str, str]:
        stored = self._read() if stored is None else stored
        profiles = stored.get("providers")
        profile = profiles.get(provider) if isinstance(profiles, dict) else None
        if not isinstance(profile, dict):
            profile = stored if stored.get("provider", DEFAULT_PROVIDER) == provider else {}
        definition = self.registry().get(provider)
        model, base_url = definition.default_model, definition.base_url
        return {"model": str(profile.get("model") or model), "baseUrl": str(profile.get("baseUrl") or base_url)}

    async def provider_configurations(self) -> list[dict[str, object]]:
        stored = self._read()
        active = self.public_settings()
        providers: list[dict[str, object]] = []
        registry = self.registry()
        for definition in registry.all():
            provider = definition.id
            source = "environment" if self._environment_key(provider) else "none"
            if not definition.requires_key:
                source = "local"
            if source == "none" and await self.secrets.has_api_key(provider):
                source = "keychain"
            values = self._stored_provider_settings(provider, stored)
            if active["provider"] == provider:
                values = {"model": active["model"], "baseUrl": active["baseUrl"]}
            profiles = stored.get("providers", {})
            profile = profiles.get(provider, {}) if isinstance(profiles, dict) else {}
            models = profile.get("availableModels", []) if isinstance(profile, dict) else []
            if not definition.builtin:
                from dataclasses import asdict
                models = [{**model, "capabilities": asdict(registry.capabilities(provider, str(model["id"])))} for model in models]
            providers.append({"label": definition.label, "protocol": definition.protocol, "requiresKey": definition.requires_key, "showInSettings": definition.show_in_settings, "availableModels": models, "provider": provider, **values, "configured": source != "none",
                              "credentialSource": source, "active": active["provider"] == provider})
        return providers

    async def status(self, *, include_providers: bool = False) -> dict[str, object]:
        # Lazy import avoids config ↔ provider circular dependency.
        from .cloud_token import cloud_access_token_needs_refresh

        settings = self.public_settings()
        caps = self.registry().capabilities(str(settings["provider"]), str(settings["model"]))
        provider = str(settings["provider"])
        managed_llm = self._managed_llm_enabled() and provider in MANAGED_LLM_PROVIDERS
        source = await self._credential_source(provider)
        # When using managed LLM, public baseUrl still shows the logical provider
        # default — actual requests go to api.coloride.com/v1/llm.
        result: dict[str, object] = {
            **settings,
            "configured": source != "none",
            "availability": ("missing_credentials" if source == "none" else "auth_expired" if source == "coloride" and cloud_access_token_needs_refresh() else "available"),
            "credentialSource": source,
            # True whenever product path is on (even before sign-in) so UI hides BYOK.
            "managedLlm": managed_llm,
            "capabilities": {
                "tools": caps.tools,
                "streaming": caps.streaming,
                "images": caps.images,
                "reasoning": caps.reasoning,
                "encryptedReasoning": caps.encrypted_reasoning,
                # Derived from real token windows (Grok 4.5 ≈ 500K) — see provider.
                "maxContextCharacters": caps.context_characters,
                "maxContextTokens": caps.context_tokens,
                "maxRetries": 3,
            },
        }

        if include_providers:
            result["providers"] = await self.provider_configurations()
        return result

    async def resolve(self) -> AgentProviderSettings:
        public = self.public_settings()
        provider = str(public["provider"])
        source, api_key = await self._resolve_credentials(provider)
        if (not api_key and source != "local") or source == "none":
            if self._managed_llm_enabled():
                raise RuntimeError(
                    "Sign in to your Coloride account to use the agent. "
                    "Model access is included with your plan — no API key needed."
                )
            raise RuntimeError(
                f"Configure a {self._provider_label(provider)} API key for Coloride Agent "
                "before starting a task"
            )
        base_url = str(public["baseUrl"])
        if source == "coloride":
            base_url = self._managed_llm_base_url()
        return AgentProviderSettings(
            provider=provider,
            model=str(public["model"]),
            base_url=base_url,
            api_key=api_key or "",
            credential_source=source,
            protocol=self.registry().get(provider).protocol,
            model_capabilities=self.registry().capabilities(provider, str(public["model"])),
        )

    async def _credential_source(self, provider: str) -> str:
        """Inspect availability without reading protected macOS passwords."""
        definition = self.registry().get(provider)
        if not definition.requires_key:
            return "local"
        if self._managed_llm_enabled() and definition.managed and get_cloud_access_token():
            return "coloride"
        if self._environment_key(provider):
            return "environment"
        return "keychain" if await self.secrets.has_api_key(provider) else "none"

    async def _resolve_credentials(self, provider: str) -> tuple[str, str | None]:
        """Return (credential_source, secret). Prefer managed Coloride LLM."""
        definition = self.registry().get(provider)
        if not definition.requires_key:
            return "local", ""
        managed_llm = self._managed_llm_enabled() and definition.managed
        # 1) Managed: user JWT → api.coloride.com holds provider keys.
        if managed_llm:
            cloud_token = get_cloud_access_token()
            if cloud_token:
                return "coloride", cloud_token

        # 2) Explicit BYOK / env (dev, enterprise, or COLORIDE_AGENT_BYOK=1).
        if self._byok_allowed() or not managed_llm:
            env_key = self._environment_key(provider)
            if env_key:
                return "environment", env_key
            keychain = await self.secrets.get_api_key(provider)
            if keychain:
                return "keychain", keychain

        # 3) Soft fallback: if managed is on but user is signed out, still honor
        # a local key so alpha builds keep working until cloud keys are set.
        if managed_llm:
            env_key = self._environment_key(provider)
            if env_key:
                return "environment", env_key
            keychain = await self.secrets.get_api_key(provider)
            if keychain:
                return "keychain", keychain

        return "none", None

    def _managed_llm_enabled(self) -> bool:
        """Default ON. Set COLORIDE_MANAGED_LLM=0 to force classic BYOK only."""
        raw = str(self.environ.get("COLORIDE_MANAGED_LLM", "1")).strip().lower()
        return cloud_enabled(self.environ) and raw not in {"0", "false", "no", "off"}

    def _byok_allowed(self) -> bool:
        """Opt-in BYOK even when managed is enabled (advanced / emergency)."""
        raw = str(self.environ.get("COLORIDE_AGENT_BYOK", "0")).strip().lower()
        return raw in {"1", "true", "yes", "on"}

    def _managed_llm_base_url(self) -> str:
        cloud = cloud_api_base(self.environ)
        # Provider posts to `{base_url}/responses` → /v1/llm/responses
        return f"{cloud}/v1/llm"

    async def update(
        self,
        *,
        provider: str,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        activate: bool = True,
        available_models: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        provider = provider.strip().lower()
        model = model.strip()
        self.registry().get(provider)
        if not model or len(model) > 120:
            raise ValueError("Choose a valid model name")
        current = self.public_settings()
        selected_base_url = base_url
        if selected_base_url is None:
            selected_base_url = (
                str(current["baseUrl"])
                if current["provider"] == provider
                else self._stored_provider_settings(provider)["baseUrl"]
            )
        normalized_base_url = selected_base_url.strip().rstrip("/")
        from .provider_registry import validate_endpoint
        normalized_base_url = validate_endpoint(normalized_base_url)

        previous_key = None
        # A failed credential save must not change the selected provider or model.
        if api_key is not None:
            normalized_key = api_key.strip()
            if not normalized_key:
                raise ValueError("The API key cannot be empty")
            previous_key = await self.secrets.get_api_key(provider)
            await self.secrets.save_api_key(provider, normalized_key)
        # Read after the async credential write to preserve other provider edits.
        stored = self._read()
        raw_profiles = stored.get("providers")
        profiles = dict(raw_profiles) if isinstance(raw_profiles, dict) else {}
        previous = str(stored.get("provider") or DEFAULT_PROVIDER)
        if previous not in profiles:
            profiles[previous] = self._stored_provider_settings(previous, stored)
        profiles[provider] = {**(profiles.get(provider) if isinstance(profiles.get(provider), dict) else {}), "model": model, "baseUrl": normalized_base_url}
        if api_key is not None:
            profiles[provider].pop("availableModels", None)
            profiles[provider].pop("modelsCheckedAt", None)
        if available_models is not None:
            profiles[provider].update({"availableModels": available_models, "modelsCheckedAt": time.time()})
        value = {**stored, "providers": profiles}
        if activate or self.public_settings()["provider"] == provider:
            value.update({"provider": provider, "model": model, "baseUrl": normalized_base_url})
        try:
            self._write(value)
        except Exception:
            if api_key is not None:
                if previous_key:
                    await self.secrets.save_api_key(provider, previous_key)
                else:
                    await self.secrets.delete_api_key(provider)
            raise
        return await self.status(include_providers=not activate)

    async def connect_provider(self, provider: str, api_key: str | None = None) -> dict[str, object]:
        from .model_discovery import discover_models, ModelDiscoveryError

        try:
            definition = self.registry().get(provider)
        except ValueError:
            raise ModelDiscoveryError("Choose a registered provider.") from None
        key = api_key.strip() if api_key is not None else None
        if api_key is not None and not key:
            raise ModelDiscoveryError("The API key cannot be empty.")
        environment_key = self._environment_key(provider)
        if key and environment_key:
            raise ModelDiscoveryError("This provider uses an environment API key. Update that environment variable instead.")
        key = key or environment_key or await self.secrets.get_api_key(provider)
        if not key and definition.requires_key:
            raise ModelDiscoveryError("Enter an API key to discover available models.")
        stored = self._read()
        profiles = stored.get("providers", {})
        profile = profiles.get(provider, {}) if isinstance(profiles, dict) else {}
        checked_at = profile.get("modelsCheckedAt", 0) if isinstance(profile, dict) else 0
        if api_key is None and isinstance(checked_at, (float, int)) and time.time() - checked_at < 600 and profile.get("availableModels"):
            return await self.status(include_providers=True)
        models = await discover_models(provider, key) if definition.builtin else await self._discover_custom(definition, key or "")
        async with self._connect_lock:
            current = await self.status()
            selected = self._stored_provider_settings(provider)["model"]
            model = selected if api_key is None and any(item["id"] == selected for item in models) else models[0]["id"]
            # Preserve a working selection; the first connected key makes an
            # otherwise unconfigured agent ready without another manual action.
            await self.update(provider=provider, model=model, api_key=api_key,
                              base_url=definition.base_url, activate=not current["configured"], available_models=models)
            return await self.status(include_providers=True)

    async def _discover_custom(self, definition, key: str):
        from .model_discovery import discover_custom_models
        return await discover_custom_models(definition, key)

    def _environment_key(self, provider: str) -> str | None:
        if provider == "fireworks":
            return self.environ.get("FIREWORKS_API_KEY") or self.environ.get(
                "COLORIDE_FIREWORKS_API_KEY"
            )
        if provider == "gemini":
            # Google AI Studio documents GEMINI_API_KEY; GOOGLE_API_KEY is
            # also widely used by Google's SDKs. Keep the Coloride-prefixed
            # alias for deployments that namespace all provider credentials.
            return (
                self.environ.get("GEMINI_API_KEY")
                or self.environ.get("GOOGLE_API_KEY")
                or self.environ.get("COLORIDE_GEMINI_API_KEY")
            )
        if provider == "openai":
            return self.environ.get("OPENAI_API_KEY") or self.environ.get(
                "COLORIDE_OPENAI_API_KEY"
            )
        if provider == "xai":
            return self.environ.get("XAI_API_KEY") or self.environ.get(
                "COLORIDE_XAI_API_KEY"
            )
        if provider == "deepseek":
            return self.environ.get("DEEPSEEK_API_KEY") or self.environ.get(
                "COLORIDE_DEEPSEEK_API_KEY"
            )
        if provider == "mistral":
            return self.environ.get("MISTRAL_API_KEY") or self.environ.get(
                "COLORIDE_MISTRAL_API_KEY"
            )
        if provider == "groq":
            return self.environ.get("GROQ_API_KEY") or self.environ.get(
                "COLORIDE_GROQ_API_KEY"
            )
        return None

    def _provider_label(self, provider: str) -> str:
        return self.registry().get(provider).label

    def _read(self) -> dict[str, object]:
        if not self.path.exists():
            return {}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (OSError, ValueError, TypeError):
            return {}

    def _write(self, value: dict[str, object]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.path.parent, 0o700)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(value, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        os.chmod(temporary, 0o600)
        temporary.replace(self.path)
        os.chmod(self.path, 0o600)
