from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig
from coloride_desktop.lsp.session import LspSession


def test_lsp_socket_accepts_existing_session_without_ssh(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    app = create_app(LaunchConfig(host="127.0.0.1", port=0, bearer_token="test-token"))
    session = LspSession("test-lsp", str(tmp_path), "unused", status="ready")
    monkeypatch.setattr(app.state.lsp, "get", lambda session_id: session)
    assert app.state.ssh.connection is None
    with TestClient(app) as client:
        with client.websocket_connect("/ws/lsp/test-lsp?token=test-token") as socket:
            assert socket.receive_json()["type"] == "status"
            socket.send_json({"type": "ping"})
            assert socket.receive_json() == {"type": "pong"}
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws/lsp/test-lsp?token=wrong"):
                pass


def test_lsp_socket_rejects_unknown_session(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    app = create_app(LaunchConfig(host="127.0.0.1", port=0, bearer_token="test-token"))
    monkeypatch.setattr(app.state.lsp, "get", lambda session_id: None)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as error:
            with client.websocket_connect("/ws/lsp/missing?token=test-token"):
                pass
        assert error.value.code == 1008
