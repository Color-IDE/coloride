from __future__ import annotations

import asyncio
import contextlib
import json
import os
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

PROVIDER_DEFAULTS: dict[str, tuple[str, str]] = {
    "fireworks": (
        "accounts/fireworks/models/kimi-k3",
        "https://api.fireworks.ai/inference/v1",
    ),
    # Native generateContent (not the OpenAI-compat shim) so thought
    # signatures survive the tool loop.
    "gemini": (
        "gemini-3.8-flash",
        "https://generativelanguage.googleapis.com/v1beta",
    ),
    "openai": ("gpt-5.3-codex", "https://api.openai.com/v1"),
    "xai": ("grok-4.5", "https://api.x.ai/v1"),
}

# Coloride's hosted gateway holds credentials for every product provider. BYOK
# remains an explicit development/enterprise fallback, never a normal user flow.
MANAGED_LLM_PROVIDERS = frozenset({"fireworks", "gemini", "openai", "xai"})


class AgentSecretStore(Protocol):
    async def get_api_key(self, provider: str) -> str | None: ...

    async def save_api_key(self, provider: str, api_key: str) -> None: ...

    async def delete_api_key(self, provider: str) -> None: ...


class InMemoryAgentSecretStore:
    def __init__(self) -> None:
        self._keys: dict[str, str] = {}

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


class AgentConfigStore:
    """Persist non-secret provider settings and resolve credentials privately."""

    def __init__(
        self,
        path: Path | None = None,
        secrets: AgentSecretStore | None = None,
        environ: dict[str, str] | None = None,
    ) -> None:
        self.path = path or Path.home() / ".coloride" / "desktop" / "agent-config.json"
        self.secrets = secrets or KeyringAgentSecretStore()
        self.environ = environ if environ is not None else os.environ

    def public_settings(self) -> dict[str, str]:
        stored = self._read()
        provider = str(stored.get("provider") or DEFAULT_PROVIDER).strip().lower()
        if provider not in PROVIDER_DEFAULTS:
            provider = DEFAULT_PROVIDER
        default_model, default_base_url = PROVIDER_DEFAULTS[provider]
        provider_base_url_env = {
            "fireworks": "COLORIDE_FIREWORKS_BASE_URL",
            "gemini": "COLORIDE_GEMINI_BASE_URL",
            "openai": "COLORIDE_OPENAI_BASE_URL",
            "xai": "COLORIDE_XAI_BASE_URL",
        }[provider]
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

    async def status(self) -> dict[str, object]:
        # Lazy import avoids config ↔ provider circular dependency.
        from .provider import _max_context_characters, _max_context_tokens
        from .model_capabilities import supports_tools
        from .cloud_token import cloud_access_token_needs_refresh

        settings = self.public_settings()
        provider = str(settings["provider"])
        model = str(settings.get("model") or "")
        managed_llm = self._managed_llm_enabled() and provider in MANAGED_LLM_PROVIDERS
        source, _ = await self._resolve_credentials(provider)
        # When using managed LLM, public baseUrl still shows the logical provider
        # default — actual requests go to api.coloride.com/v1/llm.
        return {
            **settings,
            "configured": source != "none",
            "availability": ("missing_credentials" if source == "none" else "auth_expired" if source == "coloride" and cloud_access_token_needs_refresh() else "available"),
            "credentialSource": source,
            # True whenever product path is on (even before sign-in) so UI hides BYOK.
            "managedLlm": managed_llm,
            "capabilities": {
                "tools": supports_tools(provider, model),
                "streaming": True,
                "encryptedReasoning": provider in {"openai", "xai"},
                # Derived from real token windows (Grok 4.5 ≈ 500K) — see provider.
                "maxContextCharacters": _max_context_characters(provider, model),
                "maxContextTokens": _max_context_tokens(provider, model),
                "maxRetries": 3,
            },
        }

    async def resolve(self) -> AgentProviderSettings:
        public = self.public_settings()
        provider = str(public["provider"])
        source, api_key = await self._resolve_credentials(provider)
        if not api_key or source == "none":
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
            api_key=api_key,
            credential_source=source,
        )

    async def _resolve_credentials(self, provider: str) -> tuple[str, str | None]:
        """Return (credential_source, secret). Prefer managed Coloride LLM."""
        managed_llm = self._managed_llm_enabled() and provider in MANAGED_LLM_PROVIDERS
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
    ) -> dict[str, object]:
        provider = provider.strip().lower()
        model = model.strip()
        if provider not in PROVIDER_DEFAULTS:
            raise ValueError("Choose a supported model provider")
        if not model or len(model) > 120:
            raise ValueError("Choose a valid model name")
        current = self.public_settings()
        selected_base_url = base_url
        if selected_base_url is None:
            selected_base_url = (
                str(current["baseUrl"])
                if current["provider"] == provider
                else PROVIDER_DEFAULTS[provider][1]
            )
        normalized_base_url = selected_base_url.strip().rstrip("/")
        if not normalized_base_url.startswith("https://"):
            raise ValueError("The provider base URL must use HTTPS")

        self._write(
            {
                "provider": provider,
                "model": model,
                "baseUrl": normalized_base_url,
            }
        )
        if api_key is not None:
            normalized_key = api_key.strip()
            if not normalized_key:
                raise ValueError("The API key cannot be empty")
            await self.secrets.save_api_key(provider, normalized_key)
        return await self.status()

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
        return None

    @staticmethod
    def _provider_label(provider: str) -> str:
        if provider == "fireworks":
            return "Fireworks"
        if provider == "gemini":
            return "Gemini"
        return "xAI" if provider == "xai" else "OpenAI"

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
