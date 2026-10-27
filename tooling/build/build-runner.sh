#!/usr/bin/env bash
set -euo pipefail

# Run inside the matching Linux builder image/runner.  The result is a single
# executable, so end-user VPSs need neither Python nor pip.
ARCH="${1:?usage: build-runner.sh x86_64|arm64}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/core/ide-host/resources/runner"
mkdir -p "$OUT"

cd "$ROOT/core/ide-host"
python -m PyInstaller --onefile --clean --name "coloride-runner-linux-$ARCH" \
  --paths src runner_entry.py
chmod 755 "dist/coloride-runner-linux-$ARCH"
mv "dist/coloride-runner-linux-$ARCH" "$OUT/"
