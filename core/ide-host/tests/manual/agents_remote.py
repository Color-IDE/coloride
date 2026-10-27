#!/usr/bin/env python3
"""
Quick verification that Agents now actually execute on the remote via SSH.
"""

import base64
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from fastapi.testclient import TestClient

from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig


def main():
    host = os.getenv("HOST", "")
    if not host:
        raise SystemExit("Set HOST to the server you want to test.")
    port = int(os.getenv("PORT", "22"))
    phrase = os.getenv("PASS", "PUT_YOUR_PASSWORD_HERE")

    print(f"=== Agents real execution test against {host} ===")

    config = LaunchConfig.create(frontend_dist=None)
    app = create_app(config)
    client = TestClient(app)
    bearer = config.bearer_token
    headers = {"Authorization": f"Bearer {bearer}"}

    # Pair + connect
    r = client.post("/api/pair/start", json={"host": host, "port": port, "phrase": phrase}, headers=headers)
    assert r.status_code == 200
    profile_id = r.json()["profileId"]
    print("profile:", profile_id)

    r = client.post("/api/conn/connect", json={"profileId": profile_id}, headers=headers)
    assert r.status_code == 200
    print("connected")

    # Start an agent session
    r = client.post(
        "/api/agents/session/start",
        json={"agent": "claude-code", "task": "Test real execution", "cwd": "/tmp"},
        headers=headers,
    )
    assert r.status_code == 200
    session_id = r.json()["sessionId"]
    print("session started:", session_id)

    # List sessions
    r = client.get("/api/agents/sessions", headers=headers)
    print("sessions:", r.json())

    log_path = f"/tmp/.coloride_agent_{session_id}.log"

    # Verify log created
    r = client.post("/api/files/read", json={"path": log_path}, headers=headers)
    content = ""
    if r.status_code == 200:
        content = base64.b64decode(r.json()["content"]).decode("utf-8", errors="replace")
        print("=== INITIAL LOG ===")
        print(content[:1500])
        assert "Coloride Agent Started" in content
    else:
        print("read1:", r.status_code, r.text)

    # Send a message (appends to remote log)
    r = client.post(
        "/api/agents/session/send",
        json={"sessionId": session_id, "message": "hello from test"},
        headers=headers,
    )
    print("send:", r.json())

    # Stop
    r = client.post("/api/agents/session/stop", json={"sessionId": session_id}, headers=headers)
    print("stop:", r.json())

    # Read log again
    r = client.post("/api/files/read", json={"path": log_path}, headers=headers)
    if r.status_code == 200:
        content = base64.b64decode(r.json()["content"]).decode("utf-8", errors="replace")
        print("=== FINAL LOG ===")
        print(content[-800:])
        assert "msg: hello from test" in content
        assert "stopped:" in content

    # Sessions should show stopped
    r = client.get("/api/agents/sessions", headers=headers)
    print("sessions after stop:", r.json())

    client.post("/api/conn/disconnect", headers=headers)
    print("=== DONE ===")


if __name__ == "__main__":
    main()
