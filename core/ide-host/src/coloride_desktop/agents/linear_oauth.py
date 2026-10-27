from __future__ import annotations

import asyncio
import os
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx

from . import integration_tokens
from .integrations import AgentIntegrationManager

LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize"
LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token"
LINEAR_MCP_URL = "https://mcp.linear.app/mcp"
LINEAR_SCOPES = "read,write"
DEFAULT_REDIRECT = "http://127.0.0.1:8789/oauth/linear/callback"
DEFAULT_PORT = 8789
SERVER_ID = "linear"


class LinearOAuthError(RuntimeError):
    pass


@dataclass
class LinearOAuthStatus:
    state: str = "idle"
    error: str = ""
    authorize_url: str = ""


@dataclass
class LinearOAuthSettings:
    client_id: str
    client_secret: str
    redirect_uri: str
    listen_port: int

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> LinearOAuthSettings:
        env = environ if environ is not None else os.environ
        client_id = (env.get("COLORIDE_LINEAR_CLIENT_ID") or "").strip()
        client_secret = (env.get("COLORIDE_LINEAR_CLIENT_SECRET") or "").strip()
        if not client_id or not client_secret:
            raise LinearOAuthError(
                "Set COLORIDE_LINEAR_CLIENT_ID and COLORIDE_LINEAR_CLIENT_SECRET in the repo .env, then restart Coloride."
            )
        redirect = (env.get("COLORIDE_LINEAR_REDIRECT_URI") or DEFAULT_REDIRECT).strip()
        raw_port = (env.get("COLORIDE_LINEAR_OAUTH_PORT") or "").strip()
        if raw_port.isdigit():
            port = int(raw_port)
        else:
            parsed = urlsplit(redirect)
            port = parsed.port or DEFAULT_PORT
        return cls(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect,
            listen_port=port,
        )


def build_authorize_url(*, client_id: str, redirect_uri: str, state: str) -> str:
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": LINEAR_SCOPES,
            "state": state,
            "prompt": "consent",
        }
    )
    return f"{LINEAR_AUTHORIZE_URL}?{query}"


class LinearOAuthCoordinator:
    """One-shot loopback OAuth for the Linear complement."""

    def __init__(
        self,
        integrations: AgentIntegrationManager,
        *,
        environ: dict[str, str] | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.integrations = integrations
        self.environ = environ if environ is not None else os.environ
        self.http_client = http_client
        self._status = LinearOAuthStatus()
        self._expected_state = ""
        self._server: asyncio.AbstractServer | None = None
        self._timeout_handle: asyncio.TimerHandle | None = None

    def status(self) -> dict[str, Any]:
        return {
            "status": self._status.state,
            "error": self._status.error,
            "authorizeUrl": self._status.authorize_url,
        }

    async def start(self) -> dict[str, Any]:
        settings = LinearOAuthSettings.from_env(self.environ)
        await self.cancel()
        state = secrets.token_urlsafe(24)
        authorize_url = build_authorize_url(
            client_id=settings.client_id,
            redirect_uri=settings.redirect_uri,
            state=state,
        )
        self._expected_state = state
        self._status = LinearOAuthStatus(state="waiting", authorize_url=authorize_url)
        try:
            self._server = await asyncio.start_server(
                lambda reader, writer: self._handle(reader, writer, settings),
                "127.0.0.1",
                settings.listen_port,
            )
        except OSError as exc:
            self._status = LinearOAuthStatus(state="error", error=f"Could not listen on 127.0.0.1:{settings.listen_port}")
            raise LinearOAuthError(self._status.error) from exc
        loop = asyncio.get_running_loop()
        self._timeout_handle = loop.call_later(180, lambda: asyncio.create_task(self._expire()))
        return self.status()

    async def cancel(self) -> None:
        if self._timeout_handle is not None:
            self._timeout_handle.cancel()
            self._timeout_handle = None
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        if self._status.state == "waiting":
            self._status = LinearOAuthStatus(state="idle")
        self._expected_state = ""

    async def _expire(self) -> None:
        if self._status.state != "waiting":
            return
        self._status = LinearOAuthStatus(state="error", error="Linear sign-in timed out. Try again.")
        await self._stop_listener()

    async def _stop_listener(self) -> None:
        if self._timeout_handle is not None:
            self._timeout_handle.cancel()
            self._timeout_handle = None
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    async def _handle(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        settings: LinearOAuthSettings,
    ) -> None:
        try:
            raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
        except (asyncio.IncompleteReadError, asyncio.TimeoutError, asyncio.LimitOverrunError):
            writer.close()
            return
        request_line = raw.split(b"\r\n", 1)[0].decode("ascii", "replace")
        parts = request_line.split(" ")
        path = parts[1] if len(parts) >= 2 else "/"
        parsed = urlsplit(path)
        query = parse_qs(parsed.query)
        code = (query.get("code") or [""])[0]
        state = (query.get("state") or [""])[0]
        error = (query.get("error_description") or query.get("error") or [""])[0]
        ok = bool(code and state and state == self._expected_state and not error)
        body = _callback_page(success=ok)
        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: text/html; charset=utf-8\r\n"
            b"Connection: close\r\n"
            + f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
            + body
        )
        try:
            await writer.drain()
        finally:
            writer.close()
        if not ok:
            self._status = LinearOAuthStatus(
                state="error",
                error=error or "Linear did not return an authorization code.",
            )
            await self._stop_listener()
            return
        try:
            token = await self._exchange(settings, code)
            await integration_tokens.save_access_token(SERVER_ID, token)
            self.integrations.set_access_token(SERVER_ID, token)
            self.integrations.ensure_server(
                {
                    "id": SERVER_ID,
                    "name": "Linear",
                    "url": LINEAR_MCP_URL,
                    "enabled": True,
                    "headerEnv": {},
                }
            )
            await self.integrations.refresh(force=True)
            self._status = LinearOAuthStatus(state="ready")
        except Exception as exc:
            self._status = LinearOAuthStatus(state="error", error=str(exc)[:300])
        await self._stop_listener()

    async def _exchange(self, settings: LinearOAuthSettings, code: str) -> str:
        payload = {
            "grant_type": "authorization_code",
            "client_id": settings.client_id,
            "client_secret": settings.client_secret,
            "redirect_uri": settings.redirect_uri,
            "code": code,
        }
        if self.http_client is not None:
            response = await self.http_client.post(LINEAR_TOKEN_URL, data=payload)
        else:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(LINEAR_TOKEN_URL, data=payload)
        return _token_from_response(response)


def _token_from_response(response: httpx.Response) -> str:
    if response.status_code >= 400:
        detail = response.text[:200] or response.reason_phrase
        raise LinearOAuthError(f"Linear token exchange failed ({response.status_code}): {detail}")
    value = response.json()
    if not isinstance(value, dict):
        raise LinearOAuthError("Linear returned an invalid token response")
    token = str(value.get("access_token") or "").strip()
    if not token:
        raise LinearOAuthError("Linear did not return an access token")
    return token


def _callback_page(*, success: bool) -> bytes:
    title = "Connected to Linear" if success else "Could not connect Linear"
    detail = (
        "You can close this tab and return to Coloride."
        if success
        else "Return to Coloride and try Continue again."
    )
    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{title}</title></head>
<body style="font-family:system-ui,sans-serif;background:#171717;color:#f0f4f8;display:grid;place-items:center;min-height:100vh;margin:0">
  <main style="max-width:28rem;text-align:center;padding:2rem">
    <h1 style="font-size:1.25rem;font-weight:600">{title}</h1>
    <p style="color:#a1a1aa">{detail}</p>
  </main>
</body></html>"""
    return html.encode("utf-8")
