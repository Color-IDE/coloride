"""Backward-compatible access to the central provider capability registry."""
from .provider_registry import ProviderRegistry


def supports_tools(provider: str, model: str) -> bool:
    try:
        return ProviderRegistry().capabilities(provider, model).tools
    except ValueError:
        return False
