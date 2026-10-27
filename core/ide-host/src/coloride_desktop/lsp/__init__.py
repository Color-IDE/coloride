"""Remote language-server tunnel: stdio over SSH, bridged to the desktop WebSocket."""

from .registry import LspRegistry

__all__ = ["LspRegistry"]
