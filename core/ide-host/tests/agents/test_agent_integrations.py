from __future__ import annotations

import json
import socket

import httpx
import pytest

from coloride_desktop.agents import integrations as integrations_module
from coloride_desktop.agents.integrations import (
    AgentIntegrationManager,
    AgentIntegrationStore,
    SafeWebReader,
    validate_public_https_url,
)


def test_integration_store_persists_only_environment_references(tmp_path) -> None:
    path = tmp_path / "agent-integrations.json"
    store = AgentIntegrationStore(path)

    servers = store.replace(
        [
            {
                "id": "docs",
                "name": "Documentation",
                "url": "https://mcp.example.com/api",
                "enabled": True,
                "headerEnv": {"Authorization": "COLORIDE_DOCS_TOKEN"},
            }
        ]
    )

    assert servers[0].header_env == {"Authorization": "COLORIDE_DOCS_TOKEN"}
    assert path.stat().st_mode & 0o777 == 0o600
    assert "COLORIDE_DOCS_TOKEN" in path.read_text(encoding="utf-8")
    with pytest.raises(ValueError, match="environment variable"):
        store.replace(
            [
                {
                    "id": "unsafe",
                    "name": "Unsafe",
                    "url": "https://mcp.example.com/api",
                    "headerEnv": {"Authorization": "Bearer literal-secret"},
                }
            ]
        )


async def test_mcp_streamable_http_discovers_and_calls_namespaced_tools(
    tmp_path,
    monkeypatch,
) -> None:
    requests: list[tuple[str, str | None]] = []

    async def allow_test_url(_value: str) -> None:
        return None

    monkeypatch.setattr(integrations_module, "validate_public_https_url", allow_test_url)

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        method = str(payload["method"])
        requests.append((method, request.headers.get("mcp-session-id")))
        assert request.headers.get("authorization") == "Bearer test-token"
        if method == "initialize":
            return httpx.Response(
                200,
                headers={"Mcp-Session-Id": "session-123"},
                json={"jsonrpc": "2.0", "id": payload["id"], "result": {}},
            )
        if method == "notifications/initialized":
            return httpx.Response(202)
        if method == "tools/list":
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": payload["id"],
                    "result": {
                        "tools": [
                            {
                                "name": "search-docs",
                                "description": "Search product documentation",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {"query": {"type": "string"}},
                                    "required": ["query"],
                                },
                            }
                        ]
                    },
                },
            )
        assert method == "tools/call"
        assert payload["params"] == {
            "name": "search-docs",
            "arguments": {"query": "SSH"},
        }
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": payload["id"],
                "result": {"content": [{"type": "text", "text": "SSH guide"}]},
            },
        )

    store = AgentIntegrationStore(tmp_path / "integrations.json")
    store.replace(
        [
            {
                "id": "docs",
                "name": "Documentation",
                "url": "https://mcp.example.com/api",
                "headerEnv": {"Authorization": "COLORIDE_DOCS_TOKEN"},
            }
        ]
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        manager = AgentIntegrationManager(
            store,
            environ={"COLORIDE_DOCS_TOKEN": "Bearer test-token"},
            client=client,
        )
        await manager.refresh(force=True)
        tool = manager.get_tool("mcp__docs__search_docs")
        assert tool is not None
        assert tool.parameters["additionalProperties"] is False
        result = await manager.call(tool.exposed_name, {"query": "SSH"})

    assert result["content"][0]["text"] == "SSH guide"
    assert requests == [
        ("initialize", None),
        ("notifications/initialized", "session-123"),
        ("tools/list", "session-123"),
        ("tools/call", "session-123"),
    ]


async def test_safe_web_reader_extracts_text_and_blocks_private_hosts(
    monkeypatch,
) -> None:
    async def allow_test_url(_value: str) -> None:
        return None

    monkeypatch.setattr(integrations_module, "validate_public_https_url", allow_test_url)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "text/html; charset=utf-8"},
            text="<h1>Coloride</h1><script>secret()</script><p>Remote workspace</p>",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await SafeWebReader(client).read("https://docs.example.com/guide")

    assert result["text"] == "Coloride\nRemote workspace"
    assert "secret" not in result["text"]

    def private_address(*_args, **_kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]

    monkeypatch.setattr(socket, "getaddrinfo", private_address)
    with pytest.raises(ValueError, match="Private, loopback"):
        await validate_public_https_url("https://localhost.example/api")
