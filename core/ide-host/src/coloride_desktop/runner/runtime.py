"""Entrypoint for the self-contained Linux Coloride Runner artifact.

This module intentionally only uses the standard library plus :mod:`store` so
PyInstaller can package it as one Linux executable.  The runner binds no public
port: the desktop controls it over SSH by executing this CLI in its VPS home.
"""

from __future__ import annotations

import argparse
import json
import signal
import time
from pathlib import Path

from .store import RunnerStore


def _root(value: str) -> Path:
    return Path(value).expanduser().resolve()


def _print(value: object) -> None:
    print(json.dumps(value, ensure_ascii=True, separators=(",", ":")), flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="coloride-runner")
    parser.add_argument("--root", default="~/.coloride/runner")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("health")
    submit = sub.add_parser("submit")
    submit.add_argument("--job", required=True, help="JSON job payload")
    events = sub.add_parser("events")
    events.add_argument("--job-id", required=True)
    events.add_argument("--after", type=int, default=0)
    stop = sub.add_parser("stop")
    stop.add_argument("--job-id", required=True)
    detach = sub.add_parser("detach")
    detach.add_argument("--job-id", required=True)
    sub.add_parser("serve")
    args = parser.parse_args(argv)

    store = RunnerStore(_root(args.root))
    try:
        if args.command == "health":
            _print({"ok": True, "version": "0.1.0", "root": str(store.root)})
            return 0
        if args.command == "submit":
            value = json.loads(args.job)
            job = store.create_job(
                job_id=str(value["jobId"]),
                session_id=str(value["sessionId"]),
                workspace=str(value["workspace"]),
                model=str(value["model"]),
                payload=dict(value.get("payload") or {}),
            )
            _print({"jobId": job.job_id, "state": job.state})
            return 0
        if args.command == "events":
            _print(store.events(args.job_id, args.after))
            return 0
        if args.command == "stop":
            job = store.transition(args.job_id, "stopped", reason="Stopped explicitly by the user.")
            _print({"jobId": job.job_id, "state": job.state})
            return 0
        if args.command == "detach":
            job = store.transition(args.job_id, "detached")
            _print({"jobId": job.job_id, "state": job.state})
            return 0
        # The daemon intentionally has no public listener.  It owns durable
        # background jobs and is kept alive by tmux; a future control-plane
        # worker is started from here with the scoped job token only.
        stopping = False
        def _stop(_signum: int, _frame: object) -> None:
            nonlocal stopping
            stopping = True
        signal.signal(signal.SIGTERM, _stop)
        signal.signal(signal.SIGINT, _stop)
        while not stopping:
            time.sleep(1)
        return 0
    finally:
        store.close()


if __name__ == "__main__":
    raise SystemExit(main())
