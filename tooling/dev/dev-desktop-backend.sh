#!/bin/sh
set -eu

cd "$(dirname "$0")/../../core/ide-host"
PYTHONPATH=src python3 -m coloride_desktop.main "$@"
