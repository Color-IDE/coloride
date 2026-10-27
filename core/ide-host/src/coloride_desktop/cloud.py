"""Cloud configuration shared by the proxy and managed model providers."""

from collections.abc import Mapping
from urllib.parse import urlsplit


def cloud_enabled(environ: Mapping[str, str]) -> bool:
    """Account and managed-agent calls. Files, terminals and the editor do not use this."""
    return environ.get("COLORIDE_CLOUD_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}


def cloud_api_base(environ: Mapping[str, str]) -> str:
    value = (
        environ.get("COLORIDE_CLOUD_AUTH_BASE")
        or environ.get("COLORIDE_CLOUD_API_BASE")
        or ""
    ).rstrip("/")
    if not value:
        return ""
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Cloud API must be an HTTPS URL without credentials, query or fragment.")
    return value
