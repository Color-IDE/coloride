from __future__ import annotations

import json
import stat

from fastapi.testclient import TestClient

from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig
from coloride_desktop.reports.store import BugReportStore, redact_report_text


def test_bug_report_store_writes_private_local_report(tmp_path) -> None:
    report_directory = tmp_path / "reports"
    store = BugReportStore(report_directory)

    report = store.save(
        categories=["terminal", "connection"],
        description="Codex stopped after opening the terminal",
        include_diagnostics=True,
        connection_state="connected",
    )

    destination = report_directory / f"{report['id']}.json"
    stored = json.loads(destination.read_text(encoding="utf-8"))
    assert stored["categories"] == ["terminal", "connection"]
    assert stored["diagnostics"]["connectionState"] == "connected"
    assert "host" not in stored["diagnostics"]
    assert stat.S_IMODE(report_directory.stat().st_mode) == 0o700
    assert stat.S_IMODE(destination.stat().st_mode) == 0o600


def test_bug_report_redacts_common_secrets() -> None:
    value = "password=hunter2 token: abc123\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"

    redacted = redact_report_text(value)

    assert "hunter2" not in redacted
    assert "abc123" not in redacted
    assert "BEGIN PRIVATE KEY" not in redacted
    assert redacted.count("[REDACTED]") == 2


def test_bug_report_endpoint_returns_local_reference(tmp_path) -> None:
    config = LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token")
    app = create_app(config)
    app.state.bug_reports = BugReportStore(tmp_path / "reports")

    with TestClient(app) as client:
        response = client.post(
            "/api/reports",
            headers={"authorization": "Bearer test-token"},
            json={
                "categories": ["editor", "files"],
                "description": "The editor stopped responding after save",
                "includeDiagnostics": False,
            },
        )
    assert "default-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["x-content-type-options"] == "nosniff"

    assert response.status_code == 200
    payload = response.json()
    assert payload["reportId"].startswith("bug_")
    assert payload["storedLocally"] is True
    stored = json.loads((tmp_path / "reports" / f"{payload['reportId']}.json").read_text())
    assert stored["categories"] == ["editor", "files"]
    assert stored["diagnostics"] is None
