from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .config import LaunchConfig


def _frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def _repo_root() -> Path:
    """Monorepo root in dev; beside the executable when frozen (PyInstaller)."""
    if _frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[4]


def default_frontend_dist() -> Path | None:
    if _frozen():
        # Packaged Electron always passes --frontend-dist explicitly.
        return None
    return _repo_root() / "client" / "ide" / "dist"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Coloride Python sidecar for Electron.")
    default_dist = default_frontend_dist()
    parser.add_argument(
        "--frontend-dist",
        default=str(default_dist) if default_dist is not None else None,
        help="Path to the built React frontend dist directory.",
    )
    parser.add_argument(
        "--no-frontend",
        action="store_true",
        help="Do not serve built frontend assets. Useful when Electron loads Vite.",
    )
    parser.add_argument(
        "--persistent-log",
        default=None,
        help="Redirect stdout/stderr after bootstrap so the detached host survives Electron exit.",
    )
    parser.add_argument(
        "--launch-file",
        default=None,
        help="Write host/port/token JSON here so Electron can start without stdout pipes.",
    )
    return parser


def main() -> None:
    if sys.argv[1:2] == ["--pty-child"]:
        from .term.pty_child import main as child_main
        child_main(sys.argv[2:])
        return
    args = build_parser().parse_args()
    import uvicorn

    from .api.app import create_app

    frontend = None if args.no_frontend else args.frontend_dist
    config = LaunchConfig.create(frontend_dist=frontend)

    payload = json.dumps(
        {
            "host": config.host,
            "port": config.port,
            "token": config.bearer_token,
            "terminalHostVersion": 5,
            "devSourceStamp": os.environ.get("COLORIDE_DEV_SIDECAR_STAMP") or None,
            "frontendDist": config.frontend_dist,
        }
    )
    print(payload, flush=True)
    if args.launch_file:
        launch_path = Path(args.launch_file).expanduser()
        launch_path.parent.mkdir(parents=True, exist_ok=True)
        launch_path.write_text(payload + "\n", encoding="utf-8")

    if args.persistent_log:
        log_path = Path(args.persistent_log).expanduser()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_file = log_path.open("a", encoding="utf-8", buffering=1)
        os.dup2(log_file.fileno(), sys.stdout.fileno())
        os.dup2(log_file.fileno(), sys.stderr.fileno())

    try:
        uvicorn.run(create_app(config), host=config.host, port=config.port, log_level="info")
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
