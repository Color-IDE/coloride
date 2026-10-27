from pathlib import Path

from fastapi.testclient import TestClient

from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig


def test_close_idle_shell_preserves_health_and_other_terminal(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setenv("SHELL", "/bin/sh")
    app = create_app(LaunchConfig(host="127.0.0.1", port=0, bearer_token="test-token"))
    headers = {"Authorization": "Bearer test-token"}
    with TestClient(app, backend_options={"use_uvloop": True}) as client:
        def create():
            response = client.post("/api/term/create", headers=headers, json={
                "cols": 80, "rows": 24, "cwd": str(tmp_path), "workspaceKind": "local",
            })
            assert response.status_code == 200, response.text
            return response.json()["termId"]

        first, second = create(), create()
        try:
            with client.websocket_connect(f"/ws/term/{second}?token=test-token") as socket:
                assert client.post(f"/api/term/{first}/close", headers=headers).status_code == 200
                assert client.get("/api/health", headers=headers).status_code == 200
                socket.send_bytes(b"printf 'COLORIDE_%s_OK\\n' 'PTY'\n")
                output = b""
                while b"COLORIDE_PTY_OK" not in output:
                    output += socket.receive_bytes()
                assert client.post(f"/api/term/{second}/close", headers=headers).status_code == 200
            assert client.get("/api/health", headers=headers).status_code == 200
        finally:
            client.post(f"/api/term/{first}/close", headers=headers)
            client.post(f"/api/term/{second}/close", headers=headers)
