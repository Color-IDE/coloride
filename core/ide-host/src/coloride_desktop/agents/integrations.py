from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import re
import socket
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

MAX_WEB_BYTES = 15_000_000
MAX_MCP_SERVERS = 20
MAX_MCP_TOOLS = 100
_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_-]{0,47}$")
_ENVIRONMENT_NAME = re.compile(r"^[A-Z_][A-Z0-9_]{0,127}$")


@dataclass(frozen=True, slots=True)
class MCPServerConfig:
    server_id: str
    name: str
    url: str
    enabled: bool
    header_env: dict[str, str]

    def public_dict(self, *, status: str = "configured", error: str = "") -> dict[str, Any]:
        return {
            "id": self.server_id,
            "name": self.name,
            "url": self.url,
            "enabled": self.enabled,
            "headerEnv": dict(self.header_env),
            "status": status,
            "error": error,
        }


@dataclass(frozen=True, slots=True)
class MCPTool:
    exposed_name: str
    server_id: str
    remote_name: str
    title: str
    description: str
    parameters: dict[str, Any]


class AgentIntegrationStore:
    """Persist public integration metadata without storing credentials."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or Path.home() / ".coloride" / "desktop" / "agent-integrations.json"

    def list(self) -> list[MCPServerConfig]:
        value = self._read()
        raw_servers = value.get("mcpServers")
        if not isinstance(raw_servers, list):
            return []
        servers: list[MCPServerConfig] = []
        for raw in raw_servers[:MAX_MCP_SERVERS]:
            if not isinstance(raw, dict):
                continue
            try:
                servers.append(_parse_server(raw))
            except ValueError:
                continue
        return servers

    def replace(self, raw_servers: list[dict[str, Any]]) -> list[MCPServerConfig]:
        if len(raw_servers) > MAX_MCP_SERVERS:
            raise ValueError(f"Coloride supports at most {MAX_MCP_SERVERS} MCP servers")
        servers = [_parse_server(value) for value in raw_servers]
        ids = [server.server_id for server in servers]
        if len(ids) != len(set(ids)):
            raise ValueError("Each MCP server must have a unique id")
        self._write({"mcpServers": [_stored_server(server) for server in servers]})
        return servers

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return {}
        return value if isinstance(value, dict) else {}

    def _write(self, value: dict[str, Any]) -> None:
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


class AgentIntegrationManager:
    """Discover namespaced MCP tools and execute them through Streamable HTTP."""

    def __init__(
        self,
        store: AgentIntegrationStore | None = None,
        *,
        environ: dict[str, str] | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.store = store or AgentIntegrationStore()
        self.environ = environ if environ is not None else os.environ
        self.client = client
        self._tools: dict[str, MCPTool] = {}
        self._status: dict[str, tuple[str, str]] = {}
        self._sessions: dict[str, str] = {}
        self._access_tokens: dict[str, str] = {}
        self._request_id = 0
        self._last_refresh = 0.0

    def set_access_token(self, server_id: str, token: str) -> None:
        cleaned = token.strip()
        if cleaned:
            self._access_tokens[server_id] = cleaned

    def ensure_server(self, raw: dict[str, Any]) -> None:
        current = [server.public_dict() for server in self.store.list()]
        server_id = str(raw.get("id") or "").strip().lower()
        next_servers = [server for server in current if str(server.get("id") or "") != server_id]
        next_servers.append(raw)
        self.replace(next_servers)

    def _request_headers(self, server: MCPServerConfig) -> dict[str, str]:
        headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": "2025-03-26",
        }
        session_id = self._sessions.get(server.server_id)
        if session_id:
            headers["Mcp-Session-Id"] = session_id
        token = self._access_tokens.get(server.server_id, "")
        if token:
            headers["Authorization"] = token if token.lower().startswith("bearer ") else f"Bearer {token}"
        for header, environment_name in server.header_env.items():
            value = self.environ.get(environment_name)
            if value:
                headers[header] = value
        return headers

    async def refresh(self, *, force: bool = False) -> None:
        if not force and time.monotonic() - self._last_refresh < 30:
            return
        from . import integration_tokens

        for server in self.store.list():
            if server.server_id in self._access_tokens:
                continue
            stored = await integration_tokens.get_access_token(server.server_id)
            if stored:
                self._access_tokens[server.server_id] = stored
        discovered: dict[str, MCPTool] = {}
        status: dict[str, tuple[str, str]] = {}
        for server in self.store.list():
            if not server.enabled:
                status[server.server_id] = ("disabled", "")
                continue
            try:
                values = await self._list_server_tools(server)
                for tool in values:
                    if len(discovered) >= MAX_MCP_TOOLS:
                        break
                    discovered[tool.exposed_name] = tool
                status[server.server_id] = ("ready", "")
            except Exception as exc:
                status[server.server_id] = ("error", str(exc)[:300])
        self._tools = discovered
        self._status = status
        self._last_refresh = time.monotonic()

    def tools(self) -> list[MCPTool]:
        return list(self._tools.values())

    def get_tool(self, name: str) -> MCPTool | None:
        return self._tools.get(name)

    def public_status(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for server in self.store.list():
            state, error = self._status.get(server.server_id, ("configured", ""))
            result.append(server.public_dict(status=state, error=error))
        return result

    def replace(self, servers: list[dict[str, Any]]) -> list[dict[str, Any]]:
        values = self.store.replace(servers)
        self._tools.clear()
        self._status.clear()
        self._sessions.clear()
        self._last_refresh = 0.0
        return [value.public_dict() for value in values]

    async def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        tool = self._tools.get(name)
        if tool is None:
            raise ValueError(f"MCP tool is unavailable: {name}")
        server = next(
            (value for value in self.store.list() if value.server_id == tool.server_id),
            None,
        )
        if server is None or not server.enabled:
            raise RuntimeError("The MCP server is no longer enabled")
        return await self._rpc(
            server,
            "tools/call",
            {"name": tool.remote_name, "arguments": arguments},
        )

    async def _list_server_tools(self, server: MCPServerConfig) -> list[MCPTool]:
        await self._rpc(
            server,
            "initialize",
            {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "Coloride", "version": "0.1.0"},
            },
        )
        await self._notify(server, "notifications/initialized", {})
        result = await self._rpc(server, "tools/list", {})
        raw_tools = result.get("tools")
        if not isinstance(raw_tools, list):
            return []
        tools: list[MCPTool] = []
        for raw in raw_tools[:MAX_MCP_TOOLS]:
            if not isinstance(raw, dict):
                continue
            remote_name = str(raw.get("name") or "").strip()
            if not remote_name:
                continue
            exposed = f"mcp__{_slug(server.server_id)}__{_slug(remote_name)}"
            schema = raw.get("inputSchema")
            parameters = schema if isinstance(schema, dict) else {"type": "object"}
            parameters = _strict_object_schema(parameters)
            tools.append(
                MCPTool(
                    exposed_name=exposed,
                    server_id=server.server_id,
                    remote_name=remote_name,
                    title=str(raw.get("title") or remote_name),
                    description=str(raw.get("description") or f"MCP tool from {server.name}"),
                    parameters=parameters,
                )
            )
        return tools

    async def _rpc(
        self,
        server: MCPServerConfig,
        method: str,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        await validate_public_https_url(server.url)
        headers = self._request_headers(server)
        self._request_id += 1
        payload = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        }
        response = await self._post(server.url, headers, payload)
        response.raise_for_status()
        next_session_id = response.headers.get("mcp-session-id")
        if next_session_id:
            self._sessions[server.server_id] = next_session_id
        value = _decode_json_or_sse(response)
        error = value.get("error")
        if isinstance(error, dict):
            raise RuntimeError(str(error.get("message") or "MCP request failed"))
        result = value.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("The MCP server returned an invalid result")
        return result

    async def _notify(
        self,
        server: MCPServerConfig,
        method: str,
        params: dict[str, Any],
    ) -> None:
        await validate_public_https_url(server.url)
        headers = self._request_headers(server)
        response = await self._post(
            server.url,
            headers,
            {"jsonrpc": "2.0", "method": method, "params": params},
        )
        response.raise_for_status()

    async def _post(
        self,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> httpx.Response:
        if self.client is not None:
            return await self.client.post(url, headers=headers, json=payload)
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            return await client.post(url, headers=headers, json=payload)


class SafeWebReader:
    """Fetch small public HTTPS documents without exposing the local network."""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self.client = client

    async def read(self, url: str) -> dict[str, Any]:
        current = url
        for _redirect in range(4):
            await validate_public_https_url(current)
            response = await self._get(current)
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    raise RuntimeError("The web response redirected without a location")
                current = urljoin(current, location)
                continue
            response.raise_for_status()
            data = response.content
            if len(data) > MAX_WEB_BYTES:
                raise ValueError("Web documents are limited to 15 MB")
            content_type = response.headers.get("content-type", "").lower()
            if not any(value in content_type for value in ("text/", "json", "xml")):
                raise ValueError("Only text, HTML, JSON and XML documents can be read")
            charset = response.encoding or "utf-8"
            text = data.decode(charset, errors="replace")
            if "html" in content_type:
                parser = _ReadableHTMLParser()
                parser.feed(text)
                text = parser.text()
            return {
                "url": str(response.url),
                "contentType": content_type.split(";", 1)[0],
                "text": text[:MAX_WEB_BYTES],
            }
        raise RuntimeError("Too many web redirects")

    async def _get(self, url: str) -> httpx.Response:
        headers = {
            "User-Agent": "Coloride-Agent/0.1",
            "Accept": "text/html, text/plain, application/json, application/xml",
        }
        if self.client is not None:
            return await self.client.get(url, headers=headers, follow_redirects=False)
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            return await client.get(url, headers=headers)


async def validate_public_https_url(value: str) -> None:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Integration URLs must be public HTTPS URLs without embedded credentials")
    if parsed.fragment:
        raise ValueError("Integration URLs cannot contain fragments")
    try:
        addresses = await asyncio.to_thread(
            socket.getaddrinfo,
            parsed.hostname,
            parsed.port or 443,
            type=socket.SOCK_STREAM,
        )
    except OSError as exc:
        raise ValueError(f"Unable to resolve integration host: {parsed.hostname}") from exc
    if not addresses:
        raise ValueError("The integration host did not resolve")
    for address in addresses:
        host = address[4][0]
        if not isinstance(host, str):
            raise ValueError("The integration host did not resolve to an IP address")
        ip = ipaddress.ip_address(host.split("%", 1)[0])
        if not ip.is_global:
            raise ValueError("Private, loopback and link-local integration hosts are blocked")


def _parse_server(value: dict[str, Any]) -> MCPServerConfig:
    server_id = str(value.get("id") or "").strip().lower()
    name = str(value.get("name") or "").strip()
    url = str(value.get("url") or "").strip()
    if not _IDENTIFIER.fullmatch(server_id):
        raise ValueError("MCP server ids must use lowercase letters, numbers, - or _")
    if not name or len(name) > 80:
        raise ValueError("Choose a valid MCP server name")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("MCP server URLs must use public HTTPS without embedded credentials")
    raw_headers = value.get("headerEnv") or {}
    if not isinstance(raw_headers, dict) or len(raw_headers) > 12:
        raise ValueError("headerEnv must be an object with at most 12 entries")
    headers: dict[str, str] = {}
    for raw_header, raw_environment in raw_headers.items():
        header = str(raw_header).strip()
        environment = str(raw_environment).strip()
        if not header or "\n" in header or "\r" in header:
            raise ValueError("Invalid MCP header name")
        if not _ENVIRONMENT_NAME.fullmatch(environment):
            raise ValueError("MCP credentials must reference an environment variable name")
        headers[header] = environment
    return MCPServerConfig(
        server_id=server_id,
        name=name,
        url=url.rstrip("/"),
        enabled=bool(value.get("enabled", True)),
        header_env=headers,
    )


def _stored_server(server: MCPServerConfig) -> dict[str, Any]:
    return {
        "id": server.server_id,
        "name": server.name,
        "url": server.url,
        "enabled": server.enabled,
        "headerEnv": server.header_env,
    }


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_]", "_", value).strip("_").lower()
    return normalized[:48] or "tool"


def _strict_object_schema(value: dict[str, Any]) -> dict[str, Any]:
    result = dict(value)
    result["type"] = "object"
    properties = result.get("properties")
    if not isinstance(properties, dict):
        properties = {}
    result["properties"] = properties
    result["required"] = [str(name) for name in result.get("required", []) if str(name) in properties]
    result["additionalProperties"] = False
    return result


def _decode_json_or_sse(response: httpx.Response) -> dict[str, Any]:
    content_type = response.headers.get("content-type", "").lower()
    if "text/event-stream" not in content_type:
        value = response.json()
        if not isinstance(value, dict):
            raise RuntimeError("The MCP server returned invalid JSON")
        return value
    last: dict[str, Any] | None = None
    for line in response.text.splitlines():
        if not line.startswith("data:"):
            continue
        raw = line[5:].strip()
        if not raw or raw == "[DONE]":
            continue
        value = json.loads(raw)
        if isinstance(value, dict):
            last = value
    if last is None:
        raise RuntimeError("The MCP server returned an empty event stream")
    return last


class _ReadableHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self.hidden_depth += 1
        elif not self.hidden_depth and tag in {"p", "br", "li", "h1", "h2", "h3", "h4", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self.hidden_depth:
            self.hidden_depth -= 1
        elif not self.hidden_depth and tag in {"p", "li", "h1", "h2", "h3", "h4", "tr"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden_depth:
            self.parts.append(data)

    def text(self) -> str:
        lines = [" ".join(line.split()) for line in "".join(self.parts).splitlines()]
        return "\n".join(line for line in lines if line)
