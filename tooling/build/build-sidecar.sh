#!/usr/bin/env bash
# Build a one-file PyInstaller binary of the desktop Python sidecar for Electron packaging.
#
# Usage:
#   ./tooling/build/build-sidecar.sh
#   ./tooling/build/build-sidecar.sh --out client/desktop/resources/sidecar
#
# Output (onedir — much faster cold start than onefile extract):
#   <out>/coloride-sidecar/coloride-sidecar        (macOS/Linux)
#   <out>/coloride-sidecar.exe                    (legacy onefile, still accepted)
#   Windows — run the .ps1 there.
#
# For macOS universal Electron builds, CI builds arm64 + x64 and lipo-s them.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

OUT="${COLORIDE_SIDECAR_OUT:-client/desktop/resources/sidecar}"
NAME="coloride-sidecar"

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

DESKTOP="$ROOT/core/ide-host"
OUT_ABS="$ROOT/$OUT"
mkdir -p "$OUT_ABS"

if [ ! -d "$DESKTOP/.venv" ] && [ ! -d "$DESKTOP/venv" ]; then
  echo "==> creating venv + installing backend + pyinstaller"
  python3 -m venv "$DESKTOP/.venv"
fi

if [ -x "$DESKTOP/.venv/bin/python" ]; then
  PY="$DESKTOP/.venv/bin/python"
elif [ -x "$DESKTOP/.venv/Scripts/python.exe" ]; then
  PY="$DESKTOP/.venv/Scripts/python.exe"
else
  PY="python3"
fi

echo "==> python: $PY"
"$PY" -m pip install -q -U pip
"$PY" -m pip install -q -e "$DESKTOP" "pyinstaller>=6.3,<7"

# Clean previous build junk in desktop dir
rm -rf "$DESKTOP/build" "$DESKTOP/dist" "$DESKTOP"/*.spec 2>/dev/null || true

echo "==> pyinstaller onedir $NAME"
(
  cd "$DESKTOP"
  "$PY" -m PyInstaller \
    --noconfirm \
    --clean \
    --onedir \
    --name "$NAME" \
    --paths src \
    --hidden-import uvicorn.logging \
    --hidden-import uvicorn.loops \
    --hidden-import uvicorn.loops.auto \
    --hidden-import uvicorn.protocols \
    --hidden-import uvicorn.protocols.http \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import uvicorn.protocols.websockets \
    --hidden-import uvicorn.protocols.websockets.auto \
    --hidden-import uvicorn.lifespan \
    --hidden-import uvicorn.lifespan.on \
    --collect-all uvicorn \
    --collect-all asyncssh \
    --collect-all keyring \
    pyinstaller_entry.py
)

DIR_SRC="$DESKTOP/dist/$NAME"
if [ ! -d "$DIR_SRC" ]; then
  echo "error: expected onedir $DIR_SRC" >&2
  exit 1
fi
rm -rf "$OUT_ABS/$NAME" "$OUT_ABS/${NAME}.exe"
# Flatten onedir into extraResources/sidecar/ so Electron can spawn
# resources/sidecar/coloride-sidecar (same path as the old onefile).
# shellcheck disable=SC2086
cp -a "$DIR_SRC"/. "$OUT_ABS/"
if [ "$(uname -s)" = "Darwin" ] || [ "$(uname -s)" = "Linux" ]; then
  if [ ! -f "$OUT_ABS/$NAME" ]; then
    echo "error: expected $OUT_ABS/$NAME after flatten" >&2
    exit 1
  fi
  chmod +x "$OUT_ABS/$NAME"
  echo "==> wrote onedir $OUT_ABS/$NAME"
  file "$OUT_ABS/$NAME" || true
  ls -lah "$OUT_ABS" | head -20
else
  if [ -f "$OUT_ABS/${NAME}.exe" ]; then
    echo "==> wrote onedir $OUT_ABS/${NAME}.exe"
    ls -lah "$OUT_ABS/${NAME}.exe"
  else
    echo "error: expected $OUT_ABS/${NAME}.exe" >&2
    exit 1
  fi
fi

echo "Done. Electron extraResources should include $OUT → sidecar/"
