from __future__ import annotations

import argparse

import uvicorn

from .api.app import create_app
from .config import LaunchConfig


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Coloride desktop backend.")
    parser.add_argument("--frontend-dist", default=None, help="Path to bundled frontend assets.")
    parser.add_argument("--print-launch-json", action="store_true", help="Print port/token and exit.")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    config = LaunchConfig.create(frontend_dist=args.frontend_dist)
    if args.print_launch_json:
        print(f'{{"host":"{config.host}","port":{config.port},"token":"{config.bearer_token}"}}')
        return
    uvicorn.run(create_app(config), host=config.host, port=config.port, log_level="info")


if __name__ == "__main__":
    main()
