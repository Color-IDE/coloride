#!/usr/bin/env python3
"""
Manual test for the new profiles system (M0).

Usage:
  cd core/ide-host
  .venv/bin/python tests/manual/profiles_remote.py

Or with real server:
  HOST=example.test PORT=22 PASS='yourpass' .venv/bin/python tests/manual/profiles_remote.py
"""
import os
import sys
import json

# Ensure we can import the package
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

    print(f"=== Manual profile test against {host} ===")
    config = LaunchConfig.create(frontend_dist=None)
    app = create_app(config)
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {config.bearer_token}"}

    # 1. pair/start
    r = client.post("/api/pair/start", json={"host": host, "port": port, "phrase": phrase}, headers=headers)
    assert r.status_code == 200, r.text
    prof = r.json()
    profile_id = prof["profileId"]
    print("pair/start ->", profile_id)

    # 2. profiles list
    r = client.get("/api/profiles", headers=headers)
    print("profiles:", [p["id"] for p in r.json()])

    # 3. connect
    r = client.post("/api/conn/connect", json={"profileId": profile_id}, headers=headers)
    print("connect:", r.status_code, r.json())

    # 4. stats
    r = client.get("/api/conn/stats", headers=headers)
    stats = r.json()
    print("stats rttMs:", stats.get("rttMs"))

    # 5. disconnect
    r = client.post("/api/conn/disconnect", headers=headers)
    print("disconnect:", r.status_code, r.json())

    print("=== MANUAL TEST PASSED ===")


if __name__ == "__main__":
    main()
