from __future__ import annotations

from fastapi.testclient import TestClient

from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig


def test_connection_state_reports_current_ssh_snapshot() -> None:
    app = create_app(LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token"))

    with TestClient(app) as client:
        response = client.get(
            "/api/conn/state",
            headers={"authorization": "Bearer test-token"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "idle"
    assert body["profileId"] is None
    assert body.get("socksPort") is None
