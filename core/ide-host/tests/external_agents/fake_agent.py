"""Minimal ACP v1 agent for client tests."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path


def send(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


async def main() -> None:
    session_id = "acp-session-1"
    pending_prompt: int | None = None
    authenticated = (Path.cwd() / ".fake-acp-login").exists() or "--no-auth" in sys.argv
    for line in sys.stdin:
        message = json.loads(line)
        method = message.get("method")
        request_id = message.get("id")
        params = message.get("params") or {}
        if method == "initialize":
            send(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "protocolVersion": 1,
                        "agentCapabilities": {
                            "loadSession": "--no-load" not in sys.argv,
                            "sessionCapabilities": {"delete": {}},
                        },
                        "authMethods": [{"id": "codex-login", "name": "Sign in", "type": "agent"}],
                    },
                }
            )
        elif method == "authenticate":
            authenticated = True
            (Path.cwd() / ".fake-acp-login").write_text("test login")
            send({"jsonrpc": "2.0", "id": request_id, "result": {}})
        elif method == "session/new":
            if not authenticated:
                send(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {"code": -32000, "message": "Authentication required"},
                    }
                )
                continue
            send(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "sessionId": session_id,
                        "configOptions": [
                            {
                                "id": "thought",
                                "name": "Thinking",
                                "category": "thought_level",
                                "type": "select",
                                "currentValue": "low",
                                "options": [
                                    {"value": "low", "name": "Low"},
                                    {"value": "high", "name": "High"},
                                ],
                            }
                        ],
                    },
                }
            )
        elif method == "session/load":
            send(
                {
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": session_id,
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": {"type": "text", "text": "Edited README"},
                        },
                    },
                }
            )
            send({"jsonrpc": "2.0", "id": request_id, "result": {"configOptions": []}})
        elif method == "session/set_config_option":
            send(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "configOptions": [
                            {
                                "id": params.get("configId"),
                                "name": "Thinking",
                                "category": "thought_level",
                                "type": "select",
                                "currentValue": params.get("value"),
                                "options": [
                                    {"value": "low", "name": "Low"},
                                    {"value": "high", "name": "High"},
                                ],
                            }
                        ]
                    },
                }
            )
        elif method == "session/prompt":
            if "--crash" in sys.argv:
                return
            pending_prompt = request_id
            send(
                {
                    "jsonrpc": "2.0",
                    "method": "session/request_permission",
                    "id": "perm-1",
                    "params": {
                        "sessionId": session_id,
                        "toolCall": {"toolCallId": "tool-1", "title": "Run tests"},
                        "options": [{"optionId": "allow", "name": "Allow", "kind": "allow_once"}],
                    },
                }
            )
        elif method == "session/request_permission" or (request_id == "perm-1" and "result" in message):
            if pending_prompt is None:
                continue
            outcome = (message.get("result") or {}).get("outcome") or {}
            if outcome.get("outcome") == "cancelled":
                send({"jsonrpc": "2.0", "id": pending_prompt, "result": {"stopReason": "cancelled"}})
                pending_prompt = None
                continue
            send(
                {
                    "jsonrpc": "2.0",
                    "method": "fs/write_text_file",
                    "id": "write-1",
                    "params": {
                        "sessionId": session_id,
                        "path": str(Path.cwd() / "README.md"),
                        "content": "Edited through ACP\n",
                    },
                }
            )
        elif request_id == "write-1" and "result" in message:
            send(
                {
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": session_id,
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": {"type": "text", "text": "Edited README"},
                        },
                    },
                }
            )
            send({"jsonrpc": "2.0", "id": pending_prompt, "result": {"stopReason": "end_turn"}})
            pending_prompt = None
        elif method == "session/cancel":
            if pending_prompt is not None:
                send({"jsonrpc": "2.0", "id": pending_prompt, "result": {"stopReason": "cancelled"}})
        elif method == "session/close":
            send({"jsonrpc": "2.0", "id": request_id, "result": {}})
            return
        elif method == "session/delete":
            send({"jsonrpc": "2.0", "id": request_id, "result": {}})


if __name__ == "__main__":
    asyncio.run(main())
