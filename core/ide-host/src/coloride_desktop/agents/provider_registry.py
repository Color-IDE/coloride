"""Provider registration, transport selection and conservative model capabilities.

Provider metadata is declarative. Adding a provider using an existing protocol
never changes the agent loop. Unknown model abilities are disabled, not guessed.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Literal
from urllib.parse import urlparse, urlsplit

Protocol = Literal["responses", "chat-completions", "gemini"]

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
    "deepseek": ("deepseek-flash", "https://api.deepseek.com"),
    "mistral": ("mistral-large-latest", "https://api.mistral.ai/v1"),
    "groq": ("openai/gpt-oss-120b", "https://api.groq.com/openai/v1"),
    "ollama": ("qwen2.5-coder", "http://127.0.0.1:11434/v1"),
}

RECOMMENDED_MODELS = {
    "openai": [
        ("gpt-6.1-sol", "GPT-6.1 Sol"), ("gpt-6-astra", "GPT-6 Astra"),
        ("gpt-6-luna", "GPT-6 Luna"), ("gpt-5.3-codex", "GPT-5.3 Codex"),
        ("gpt-5.2-codex", "GPT-5.2 Codex"),
    ],
    "gemini": [
        ("gemini-4-argon", "Gemini 4 Argon"), ("gemini-3.8-flash", "Gemini 3.8 Flash"),
        ("gemini-3.1-pro-preview", "Gemini 3.1 Pro (Preview)"),
        ("gemini-2.5-pro", "Gemini 2.5 Pro"), ("gemini-2.5-flash", "Gemini 2.5 Flash"),
    ],
    "xai": [("grok-4.7", "Grok 4.7"), ("grok-build-0.1", "Grok Build 0.1"),
            ("grok-4.6", "Grok 4.6"), ("grok-4.5", "Grok 4.5")],
    "fireworks": [
        ("accounts/fireworks/models/kimi-k3", "Kimi K3"),
        ("accounts/fireworks/models/minimax-m3", "MiniMax M3"),
        ("accounts/fireworks/models/deepseek-v4p1-flash", "DeepSeek V4.1 Flash"),
    ],
    "deepseek": [
        ("deepseek-flash", "DeepSeek Flash"),
        ("deepseek-v4-pro", "DeepSeek V4 Pro"),
    ],
    "mistral": [
        ("mistral-large-latest", "Mistral Large"),
        ("codestral-latest", "Codestral"),
        ("mistral-medium-latest", "Mistral Medium"),
        ("mistral-small-latest", "Mistral Small"),
    ],
    "groq": [
        ("openai/gpt-oss-120b", "GPT-OSS 120B"),
        ("llama-3.3-70b-versatile", "Llama 3.3 70B"),
        ("qwen/qwen3-32b", "Qwen3 32B"),
    ],
}

ENDPOINTS = {
    "openai": "https://api.openai.com/v1/models",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/models",
    "xai": "https://api.x.ai/v1/models",
    "fireworks": "https://api.fireworks.ai/v1/accounts/fireworks/models",
    "deepseek": "https://api.deepseek.com/models",
    "mistral": "https://api.mistral.ai/v1/models",
    "groq": "https://api.groq.com/openai/v1/models",
    "ollama": "http://127.0.0.1:11434/v1/models",
}

TOOL_MODELS = {
    'openai': {'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'o3', 'o4-mini'},
    'xai': {'grok-build-0.1', 'grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4'},
    'gemini': {'gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'},
    'fireworks': {'accounts/fireworks/models/deepseek-v4p1-flash', 'accounts/fireworks/models/minimax-m3', 'accounts/fireworks/models/kimi-k3'},
    'deepseek': {'deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'},
    'mistral': {'mistral-large-latest', 'codestral-latest', 'mistral-medium-latest', 'mistral-small-latest'},
    'groq': {'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b'},
}


@dataclass(frozen=True, slots=True)
class ModelCapabilities:
    tools: bool = False
    streaming: bool = False
    images: bool = False
    reasoning: bool = False
    encrypted_reasoning: bool = False
    context_tokens: int = 8_192
    context_characters: int = 26_214
    source: str = "unknown"

    @classmethod
    def from_dict(cls, value: dict[str, object], *, source: str = "declared") -> ModelCapabilities:
        allowed = {"tools", "streaming", "images", "reasoning", "encrypted_reasoning", "context_tokens", "context_characters"}
        if set(value) - allowed:
            raise ValueError("Unknown model capability.")
        for name, item in value.items():
            if name.startswith("context_"):
                if type(item) is not int or not 1_024 <= item <= 10_000_000:
                    raise ValueError("Invalid model context limit.")
            elif type(item) is not bool:
                raise ValueError("Model capabilities must be booleans.")
        value = dict(value)
        if "context_tokens" in value and "context_characters" not in value:
            value["context_characters"] = min(10_000_000, int(value["context_tokens"] * 3.2))
        return cls(**value, source=source)


@dataclass(frozen=True, slots=True)
class ProviderDefinition:
    id: str
    label: str
    protocol: Protocol
    base_url: str
    default_model: str = ""
    requires_key: bool = True
    managed: bool = False
    models: dict[str, ModelCapabilities] = field(default_factory=dict)
    builtin: bool = False
    show_in_settings: bool = True

    def public(self) -> dict[str, object]:
        return {"id": self.id, "label": self.label, "protocol": self.protocol,
                "baseUrl": self.base_url, "requiresKey": self.requires_key,
                "builtin": self.builtin, "showInSettings": self.show_in_settings}


def validate_endpoint(value: str) -> str:
    value = value.strip().rstrip("/")
    try:
        parsed = urlsplit(value)
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError
        if any(ord(char) < 32 for char in value):
            raise ValueError
        local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
            raise ValueError
        if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
            raise ValueError
    except ValueError:
        raise ValueError("Use HTTPS, or HTTP on localhost, without URL credentials, query or fragment.") from None
    return value


def _ollama_supports_tools(model: str) -> bool:
    """A local catalog mixes chat, embedding and image models. Enable tools
    for families Ollama documents as function-calling capable, including tags
    such as qwen2.5-coder:7b."""
    name = model.strip().lower().split(":", 1)[0]
    if any(term in name for term in ("embed", "nomic", "bge-", "whisper", "llava", "moondream", "vision")):
        return False
    prefixes = (
        "qwen2.5", "qwen3", "llama3.1", "llama3.2", "llama3.3",
        "mistral", "command-r", "firefunction", "granite3", "phi4", "smollm2",
    )
    return name.startswith(prefixes)


def detect_protocol(base_url: str) -> str:
    """Infer the wire format from the endpoint. A Gemini host is unambiguous;
    everything else starts as Chat Completions, the common OpenAI-compatible form."""
    host = urlparse(base_url).hostname or ""
    if host == "generativelanguage.googleapis.com" or host.endswith(".googleapis.com"):
        return "gemini"
    return "chat-completions"


def custom_definition(value: dict[str, object]) -> ProviderDefinition:
    identifier = str(value.get("id", ""))
    label = str(value.get("label", "")).strip()
    base_url = validate_endpoint(str(value.get("baseUrl", "")))
    protocol = detect_protocol(base_url)
    if not re.fullmatch(r"custom:[a-z0-9][a-z0-9-]{0,47}", identifier):
        raise ValueError("Custom provider IDs must use custom:name with lowercase letters, digits or hyphens.")
    if not label or len(label) > 80 or protocol not in {"responses", "chat-completions", "gemini"}:
        raise ValueError("Choose a provider name and supported API protocol.")
    requires_key = value.get("requiresKey", True)
    if type(requires_key) is not bool:
        raise ValueError("requiresKey must be a boolean.")
    raw_models = value.get("models", {})
    if not isinstance(raw_models, dict) or len(raw_models) > 100:
        raise ValueError("Invalid model capability definitions.")
    models = {}
    for model, capabilities in raw_models.items():
        if not isinstance(model, str) or not model.strip() or len(model) > 120 or not isinstance(capabilities, dict):
            raise ValueError("Invalid model capability definition.")
        models[model] = ModelCapabilities.from_dict(capabilities)
        if models[model].encrypted_reasoning and protocol != "responses":
            raise ValueError("Encrypted reasoning requires the Responses protocol.")
    return ProviderDefinition(id=identifier, label=label, protocol=protocol,
        base_url=base_url, requires_key=requires_key, models=models)


class ProviderRegistry:
    def __init__(self, custom: list[dict[str, object]] | None = None, profiles: dict | None = None) -> None:
        labels = {
            "openai": "OpenAI", "xai": "xAI", "gemini": "Gemini", "fireworks": "Fireworks",
            "deepseek": "DeepSeek", "mistral": "Mistral", "groq": "Groq", "ollama": "Ollama",
        }
        protocols = {
            "openai": "responses", "xai": "responses", "gemini": "gemini",
            "fireworks": "chat-completions", "deepseek": "chat-completions",
            "mistral": "chat-completions", "groq": "chat-completions", "ollama": "chat-completions",
        }
        self._definitions = {name: ProviderDefinition(id=name, label=labels[name], protocol=protocols[name], base_url=base,
            default_model=model, requires_key=name != "ollama", managed=name in {"openai", "xai", "gemini", "fireworks"},
            builtin=True, show_in_settings=name != "fireworks")
            for name, (model, base) in PROVIDER_DEFAULTS.items()}
        self._catalog_capabilities: dict[tuple[str, str], ModelCapabilities] = {}
        for value in custom or []:
            self.register(custom_definition(value))
        for name, profile in (profiles or {}).items():
            if name not in self._definitions or self._definitions[name].builtin or not isinstance(profile, dict):
                continue
            definition = self._definitions[name]
            for item in profile.get("availableModels", []):
                if not isinstance(item, dict) or item.get("id") in definition.models:
                    continue
                caps = item.get("capabilities")
                if isinstance(caps, dict):
                    source = caps.get("source", "unknown")
                    if source == "declared":
                        continue
                    values = {key: val for key, val in caps.items() if key != "source"}
                    self._catalog_capabilities[(name, item["id"])] = ModelCapabilities.from_dict(values, source=source)


    def register(self, definition: ProviderDefinition) -> None:
        if definition.id in self._definitions:
            raise ValueError("This provider is already registered.")
        self._definitions[definition.id] = definition

    def get(self, identifier: str) -> ProviderDefinition:
        try:
            return self._definitions[identifier]
        except KeyError:
            raise ValueError("Choose a registered model provider.") from None

    def all(self) -> list[ProviderDefinition]:
        return list(self._definitions.values())

    def capabilities(self, provider: str, model: str) -> ModelCapabilities:
        definition = self.get(provider)
        if not definition.builtin:
            return definition.models.get(model) or self._catalog_capabilities.get((provider, model)) or ModelCapabilities()
        # Preserve reviewed built-in limits and wire quirks. Custom providers
        # never inherit features simply because their model ID looks familiar.
        from .provider import _max_context_tokens, _max_context_characters, _supports_reasoning
        known = model.lower() in TOOL_MODELS.get(provider, set())
        if provider == "ollama":
            known = _ollama_supports_tools(model)
        return ModelCapabilities(tools=known, streaming=True, images=known and provider not in {"deepseek", "ollama"},
            reasoning=_supports_reasoning(provider, model), encrypted_reasoning=provider in {"openai", "xai"},
            context_tokens=_max_context_tokens(provider, model), context_characters=_max_context_characters(provider, model),
            source="reviewed" if known else "unknown")


def create_provider(settings):
    """Choose wire adapter by protocol, independently of provider branding."""
    from .provider import ResponsesAPIProvider, OpenAIChatCompletionsProvider, GeminiResponsesProvider
    protocol = settings.protocol or ProviderRegistry().get(settings.provider).protocol
    adapters = {"responses": ResponsesAPIProvider, "chat-completions": OpenAIChatCompletionsProvider, "gemini": GeminiResponsesProvider}
    try:
        adapter = adapters[protocol]
    except KeyError:
        raise ValueError("Unsupported provider API protocol.") from None
    return adapter(settings)
