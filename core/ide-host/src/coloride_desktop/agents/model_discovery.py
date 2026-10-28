"""Account-visible models intersected with a reviewed coding/tool-use shortlist.

Never infer access from a model name or send keys to configurable URLs. Listing
models does not generate tokens or prove remaining inference quota.
"""
from __future__ import annotations

import asyncio
import httpx

from .provider_registry import RECOMMENDED_MODELS, ENDPOINTS


class ModelDiscoveryError(ValueError):
    pass


async def discover_models(provider: str, api_key: str) -> list[dict[str, str]]:
    if provider == "ollama":
        return await _discover_ollama()
    if provider not in ENDPOINTS:
        raise ModelDiscoveryError("Choose a supported provider.")
    headers = {"x-goog-api-key": api_key} if provider == "gemini" else {"Authorization": f"Bearer {api_key}"}
    params = {"pageSize": 200} if provider in {"gemini", "fireworks"} else {}
    visible: set[str] = set()
    seen_tokens: set[str] = set()
    try:
        # Bounded total duration, including pagination; never forward credentials
        # through a redirect, environment proxy or a provider-supplied next URL.
        async with asyncio.timeout(20), httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
            for _ in range(20):
                response = await client.get(ENDPOINTS[provider], headers=headers, params=params)
                if response.status_code in {401, 403}:
                    raise ModelDiscoveryError("This API key was rejected or cannot list models. Check its permissions.")
                if response.status_code == 429:
                    raise ModelDiscoveryError("The provider is rate limiting requests. Automatic retry will follow shortly.")
                if not response.is_success:
                    raise ModelDiscoveryError("The provider could not load models. Your saved key has not been changed.")
                payload = response.json()
                records = payload.get("models" if provider in {"gemini", "fireworks"} else "data")
                if not isinstance(records, list):
                    raise ModelDiscoveryError("The provider returned an invalid model list.")
                for record in records:
                    if not isinstance(record, dict):
                        continue
                    if provider == "gemini" and "generateContent" not in record.get("supportedGenerationMethods", []):
                        continue
                    if provider == "fireworks" and not record.get("supportsServerless"):
                        continue
                    name = record.get("name" if provider in {"gemini", "fireworks"} else "id", "")
                    if provider == "gemini":
                        name = str(name).removeprefix("models/")
                    if isinstance(name, str):
                        visible.add(name)
                    if provider == "xai":
                        visible.update(alias for alias in record.get("aliases", []) if isinstance(alias, str))
                token = payload.get("nextPageToken")
                if not token:
                    break
                if not isinstance(token, str) or token in seen_tokens:
                    raise ModelDiscoveryError("The provider returned invalid model pagination.")
                seen_tokens.add(token)
                params["pageToken"] = token
            else:
                raise ModelDiscoveryError("The provider model list exceeded the supported page limit.")
    except (httpx.HTTPError, TimeoutError):
        raise ModelDiscoveryError("Could not reach the provider. Your saved key has not been changed.") from None
    except (TypeError, AttributeError, ValueError) as exc:
        if isinstance(exc, ModelDiscoveryError):
            raise
        raise ModelDiscoveryError("The provider returned an invalid model list.") from None
    models = [{"id": name, "label": label} for name, label in RECOMMENDED_MODELS[provider] if name in visible]
    if not models:
        raise ModelDiscoveryError("This key has no recommended coding models available. Your saved key has not been changed.")
    return models


async def _discover_ollama() -> list[dict[str, str]]:
    """List models the local server has already downloaded.

    Ollama does not advertise tool support in this listing, so only reviewed
    families are kept. An unreachable server stays a connection error and does
    not invent a model id.
    """
    from .provider_registry import _ollama_supports_tools

    try:
        async with asyncio.timeout(8), httpx.AsyncClient(timeout=4, follow_redirects=False, trust_env=False) as client:
            response = await client.get(ENDPOINTS["ollama"])
    except (httpx.HTTPError, TimeoutError):
        raise ModelDiscoveryError("Ollama is not running. Start it and pull a model, then try again.") from None
    if not response.is_success:
        raise ModelDiscoveryError("Ollama could not list local models.")
    try:
        records = response.json().get("data")
    except ValueError:
        raise ModelDiscoveryError("Ollama returned an invalid model list.") from None
    if not isinstance(records, list):
        raise ModelDiscoveryError("Ollama returned an invalid model list.")
    models = []
    seen: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            continue
        name = record.get("id")
        if not isinstance(name, str) or not name or len(name) > 120 or name in seen:
            continue
        if not _ollama_supports_tools(name):
            continue
        seen.add(name)
        models.append({"id": name, "label": name})
    if not models:
        raise ModelDiscoveryError("No local models with tool support are installed. Pull one with Ollama, then try again.")
    return sorted(models, key=lambda item: item["id"])[:100]


async def discover_custom_models(definition, api_key: str) -> list[dict[str, object]]:
    """Discover an explicitly registered endpoint, never following redirects.

    A generic /models listing is not proof of tool/image/reasoning support.
    Only explicit capability declarations or provider metadata enable features.
    """
    from .provider_registry import ModelCapabilities
    from dataclasses import asdict
    headers = ({"x-goog-api-key": api_key} if definition.protocol == "gemini" else {"Authorization": f"Bearer {api_key}"}) if api_key else {}
    models = []
    params = {"pageSize": 200} if definition.protocol == "gemini" else {}
    seen_tokens = set()
    try:
        async with asyncio.timeout(20), httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
            for _ in range(20):
                response = await client.get(definition.base_url + "/models", headers=headers, params=params)
                if response.status_code in {401, 403}:
                    raise ModelDiscoveryError("This API key was rejected or cannot list models. Check its permissions.")
                if not response.is_success:
                    raise ModelDiscoveryError("The provider could not load models. Your saved key has not been changed.")
                payload = response.json()
                records = payload.get("models" if definition.protocol == "gemini" else "data")
                if not isinstance(records, list):
                    raise ModelDiscoveryError("The provider returned an invalid model list.")
                for record in records:
                    if not isinstance(record, dict):
                        continue
                    model = record.get("name" if definition.protocol == "gemini" else "id")
                    if not isinstance(model, str) or not model or len(model) > 120:
                        continue
                    if definition.protocol == "gemini":
                        model = model.removeprefix("models/")
                        if "generateContent" not in record.get("supportedGenerationMethods", []):
                            continue
                    # Exclude advertised non-text models and dedicated media /
                    # embedding IDs, rather than present them as coding models.
                    outputs = (record.get("architecture") or {}).get("output_modalities", [])
                    if outputs and "text" not in outputs:
                        continue
                    if any(term in model.lower() for term in ("embedding", "embed-", "whisper", "tts", "transcribe", "image-", "imagine", "rerank", "moderation", "video-")):
                        continue
                    caps = definition.models.get(model)
                    if caps is None:
                        params_supported = record.get("supported_parameters", [])
                        metadata = record.get("capabilities", {})
                        metadata = metadata if isinstance(metadata, dict) else {}
                        explicit = isinstance(params_supported, list) and bool(params_supported)
                        inputs = (record.get("architecture") or {}).get("input_modalities", [])
                        context = record.get("context_length")
                        context = context if type(context) is int and 1024 <= context <= 10_000_000 else 8_192
                        caps = ModelCapabilities(tools="tools" in params_supported or metadata.get("tools") is True,
                            images="image" in inputs or metadata.get("images") is True,
                            reasoning="reasoning" in params_supported or metadata.get("reasoning") is True,
                            streaming=metadata.get("streaming") is True,
                            context_tokens=context, context_characters=min(10_000_000, int(context * 3.2)),
                            source="catalog" if explicit or metadata or inputs or record.get("context_length") else "unknown")
                    models.append({"id": model, "label": str(record.get("displayName") or record.get("name") or model)[:120],
                                   "capabilities": asdict(caps)})
                token = payload.get("nextPageToken")
                if not token:
                    break
                if not isinstance(token, str) or token in seen_tokens:
                    raise ModelDiscoveryError("Invalid model pagination.")
                seen_tokens.add(token)
                params["pageToken"] = token
            else:
                raise ModelDiscoveryError("The provider model list exceeded the supported page limit.")
    except (httpx.HTTPError, TimeoutError):
        raise ModelDiscoveryError("Could not reach the provider. Your saved key has not been changed.") from None
    except (TypeError, AttributeError, ValueError) as exc:
        if isinstance(exc, ModelDiscoveryError):
            raise
        raise ModelDiscoveryError("The provider returned an invalid model list.") from None
    if not models:
        raise ModelDiscoveryError("This endpoint has no compatible text models available.")
    unique = {model["id"]: model for model in models}
    return sorted(unique.values(), key=lambda item: (not item["capabilities"]["tools"], item["id"]))[:100]
