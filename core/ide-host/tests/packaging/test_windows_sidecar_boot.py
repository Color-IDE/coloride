from __future__ import annotations

import builtins
import importlib
import sys


def test_create_app_imports_when_unix_pty_modules_are_missing(monkeypatch) -> None:
    """Windows PyInstaller has no termios/pty. Importing the sidecar must not crash."""
    real_import = builtins.__import__
    blocked = {"pty", "tty", "termios", "fcntl"}
    saved_unix = {name: sys.modules.pop(name) for name in list(blocked) if name in sys.modules}
    saved_app = {
        name: sys.modules.pop(name)
        for name in list(sys.modules)
        if name == "coloride_desktop" or name.startswith("coloride_desktop.")
    }

    def guarded(name, globals=None, locals=None, fromlist=(), level=0):
        root = name.split(".", 1)[0]
        if root in blocked:
            raise ModuleNotFoundError(f"No module named '{root}'")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", guarded)

    try:
        from coloride_desktop.api.app import create_app
        from coloride_desktop.config import LaunchConfig

        app = create_app(LaunchConfig(host="127.0.0.1", port=8788, bearer_token="test-token"))
        assert app is not None
    finally:
        monkeypatch.undo()
        for name in list(sys.modules):
            if name == "coloride_desktop" or name.startswith("coloride_desktop."):
                sys.modules.pop(name)
        sys.modules.update(saved_unix)
        sys.modules.update(saved_app)
        importlib.invalidate_caches()
