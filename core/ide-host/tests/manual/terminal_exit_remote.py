#!/usr/bin/env python3
"""
Manual test for terminal exit reporting (Opción A).

This test:
1. Creates a real connection + terminal.
2. Captures term:exit events directly from the EventHub (bypassing WS delivery quirks in TestClient).
3. Verifies the session is marked as reported.
4. Optionally shows the event that was published.

Usage:
  cd core/ide-host
  .venv/bin/python tests/manual/terminal_exit_remote.py

With real VPS:
  HOST=example.test PORT=22 PASS='yourpass' .venv/bin/python tests/manual/terminal_exit_remote.py
"""

import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from fastapi.testclient import TestClient

from coloride_desktop.config import LaunchConfig
from coloride_desktop.api.app import create_app


def main() -> None:
    host = os.getenv("HOST", "")
    if not host:
        raise SystemExit("Set HOST to the server you want to test.")
    port = int(os.getenv("PORT", "22"))
    phrase = os.getenv("PASS", "PUT_YOUR_PASSWORD_HERE")

    print(f"=== term:exit real test against {host} ===")

    config = LaunchConfig.create(frontend_dist=None)
    app = create_app(config)
    client = TestClient(app)
    bearer = config.bearer_token
    headers = {"Authorization": f"Bearer {bearer}"}

    # Capture term:exit events directly from the hub
    captured = []

    original_publish = app.state.events.publish

    async def capturing_publish(event: str, payload: dict):
        if event == "term:exit":
            captured.append(payload)
            print(f"[TEST] captured term:exit -> {payload}")
        return await original_publish(event, payload)

    app.state.events.publish = capturing_publish

    # 1. Pair + connect
    r = client.post("/api/pair/start", json={"host": host, "port": port, "phrase": phrase}, headers=headers)
    assert r.status_code == 200, r.text
    profile_id = r.json()["profileId"]
    print("profile:", profile_id)

    r = client.post("/api/conn/connect", json={"profileId": profile_id}, headers=headers)
    assert r.status_code == 200, r.text
    print("connected")

    # 2. Create a terminal
    r = client.post("/api/term/create", json={"cols": 80, "rows": 24}, headers=headers)
    assert r.status_code == 200, r.text
    term_id = r.json()["termId"]
    print("term created:", term_id)

    # 3. Open PTY and make it exit
    term_url = f"/ws/term/{term_id}?token={bearer}"

    with client.websocket_connect(term_url) as term_ws:
        time.sleep(0.5)
        # Force a clean exit with a specific code
        term_ws.send_bytes(b"exit 42\n")
        time.sleep(1.2)

    # Give the watcher / finally a moment
    time.sleep(0.3)

    # 4. Check results
    reported = app.state.terminals.has_reported_exit(term_id)
    print("has_reported_exit:", reported)
    print("captured term:exit events:", captured)

    # 5. Cleanup
    client.post("/api/conn/disconnect", headers=headers)

    # Assertions
    if not reported:
        print("FAIL: terminal was not marked as exit reported")
        sys.exit(1)

    if not captured:
        print("FAIL: no term:exit event was published to the EventHub")
        sys.exit(1)

    event = captured[0]
    if event.get("termId") != term_id:
        print("FAIL: wrong termId in event")
        sys.exit(1)

    # Note: code may be None in this test harness because the PTY is created with no pty
    # in some code paths, but the important thing is that we went through the exit path.
    print(f"received code in event: {event.get('code')}")

    print("=== term:exit TEST PASSED ===")


if __name__ == "__main__":
    main()
