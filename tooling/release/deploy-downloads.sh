#!/usr/bin/env bash
# Deploy desktop installers + electron-updater feeds to the VPS static folder.
#
# One command for admins after a build:
#   pnpm desktop:deploy-downloads
#   ./tooling/release/deploy-downloads.sh
#   ./tooling/release/deploy-downloads.sh --dry-run
#   ./tooling/release/deploy-downloads.sh --dir /path/to/artifacts
#
# Configuration:
#   COLORIDE_DEPLOY_HOST   required
#   COLORIDE_DEPLOY_PATH   required
#   COLORIDE_RELEASE_DIR   default: client/desktop/release
#   COLORIDE_DOWNLOADS_URL required public HTTPS base URL
#
# Needs: rsync + SSH key to the host (BatchMode).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DRY_RUN=0
RELEASE_DIR="${COLORIDE_RELEASE_DIR:-client/desktop/release}"
HOST="${COLORIDE_DEPLOY_HOST:-}"
REMOTE_PATH="${COLORIDE_DEPLOY_PATH:-}"
PUBLIC_URL="${COLORIDE_DOWNLOADS_URL:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) RELEASE_DIR="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --path) REMOTE_PATH="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$HOST" ] || [ -z "$REMOTE_PATH" ]; then
  echo "Set COLORIDE_DEPLOY_HOST and COLORIDE_DEPLOY_PATH before publishing downloads." >&2
  exit 1
fi

if [ -z "$PUBLIC_URL" ]; then
  echo "Set COLORIDE_DOWNLOADS_URL before publishing downloads." >&2
  exit 1
fi

VERSION="$(node -p "require('./client/desktop/package.json').version")"
case "$RELEASE_DIR" in
  /*) SRC="$RELEASE_DIR" ;;
  *) SRC="$ROOT/$RELEASE_DIR" ;;
esac

if [ ! -d "$SRC" ]; then
  echo "error: release dir not found: $SRC" >&2
  echo "Build first (CI artifacts or local electron-builder output)." >&2
  exit 1
fi

# Collect files (bash 3 compatible)
FILES=""
add_glob() {
  # $1 = glob relative to SRC
  local g
  for g in $SRC/$1; do
    if [ -f "$g" ]; then
      FILES="$FILES
$g"
    fi
  done
}

add_glob "Coloride-${VERSION}-arm64.dmg"
add_glob "Coloride-${VERSION}-arm64.zip"
add_glob "Coloride-${VERSION}-arm64.*.blockmap"
add_glob "Coloride-${VERSION}-universal.dmg"
add_glob "Coloride-${VERSION}-universal.zip"
add_glob "Coloride-${VERSION}-universal.*.blockmap"
add_glob "Coloride-${VERSION}-win-x64-setup.exe"
add_glob "Coloride-${VERSION}-win-*.blockmap"
add_glob "latest-mac.yml"
add_glob "latest.yml"
# fallbacks
add_glob "Coloride-${VERSION}*.dmg"
add_glob "Coloride-${VERSION}*.zip"
add_glob "Coloride-${VERSION}*setup.exe"

# unique lines
FILES="$(printf '%s\n' "$FILES" | sed '/^$/d' | sort -u)"

if [ -z "$FILES" ]; then
  echo "error: no Coloride-${VERSION} artifacts in $SRC" >&2
  ls -lah "$SRC" | head -40 >&2
  exit 1
fi

echo "==> version  $VERSION"
echo "==> source   $SRC"
echo "==> target   ${HOST}:${REMOTE_PATH}"
echo "==> files:"
printf '%s\n' "$FILES" | while IFS= read -r f; do
  [ -z "$f" ] && continue
  printf '    %s  (%s)\n' "$(basename "$f")" "$(du -h "$f" | awk '{print $1}')"
done

# Prefer arm64 (current CI); fall back to universal legacy names.
MAC_DMG="Coloride-${VERSION}-arm64.dmg"
if ! printf '%s\n' "$FILES" | grep -q "Coloride-${VERSION}-arm64.dmg"; then
  MAC_DMG="Coloride-${VERSION}-universal.dmg"
fi
WIN_EXE="Coloride-${VERSION}-win-x64-setup.exe"
TMP_JSON="$(mktemp -t coloride-latest.XXXXXX.json)"
cat >"$TMP_JSON" <<EOF
{
  "version": "${VERSION}",
  "channel": "stable",
  "publishedAt": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")",
  "notes": "Coloride ${VERSION}",
  "downloadUrl": "${PUBLIC_URL}/${MAC_DMG}",
  "platforms": {
    "darwin": {
      "url": "${PUBLIC_URL}/${MAC_DMG}",
      "filename": "${MAC_DMG}"
    },
    "win32": {
      "url": "${PUBLIC_URL}/${WIN_EXE}",
      "filename": "${WIN_EXE}"
    }
  }
}
EOF

RSYNC_FLAGS="-avz --chmod=Fu=rw,Fg=r,Fo=r,Du=rwx,Dg=rx,Do=rx"
if [ "$DRY_RUN" -eq 1 ]; then
  RSYNC_FLAGS="$RSYNC_FLAGS --dry-run"
  echo "==> DRY RUN (no changes on server)"
fi

if [ "$DRY_RUN" -eq 0 ]; then
  ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$HOST" "mkdir -p $(printf %q "$REMOTE_PATH")"
fi

# shellcheck disable=SC2086
rsync $RSYNC_FLAGS $FILES "$TMP_JSON" "${HOST}:${REMOTE_PATH}/"

# Ensure marketing manifest has the stable name latest.json
if [ "$DRY_RUN" -eq 0 ]; then
  # shellcheck disable=SC2086
  rsync $RSYNC_FLAGS "$TMP_JSON" "${HOST}:${REMOTE_PATH}/latest.json"
fi

rm -f "$TMP_JSON"

if [ "$DRY_RUN" -eq 0 ]; then
  echo "==> verify public URLs"
  for path in latest-mac.yml latest.yml latest.json "$MAC_DMG" "$WIN_EXE"; do
    code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 30 "${PUBLIC_URL}/${path}" || echo "err")
    echo "    ${code}  ${PUBLIC_URL}/${path}"
  done
fi

echo ""
echo "Done. Public base: ${PUBLIC_URL}/"
echo "If the landing hardcodes DESKTOP_VERSION, bump it to ${VERSION} and rebuild www."
