#!/usr/bin/env bash
# Build a Developer ID–signed + notarized Coloride.app / DMG / ZIP for distribution.
#
# Prerequisites (one-time):
#   1. Apple Developer Program membership
#   2. Certificate "Developer ID Application" in Keychain Access
#      (or a .p12 exported and pointed to by CSC_LINK)
#   3. App-specific password: https://appleid.apple.com → Sign-In → App-Specific Passwords
#   4. Optional GH_TOKEN to publish auto-updates to GitHub Releases
#
# Usage:
#   export APPLE_ID="you@domain.com"
#   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
#   export APPLE_TEAM_ID="XXXXXXXXXX"
#   # either cert already in login keychain:
#   export CSC_NAME="Developer ID Application: Your Name (XXXXXXXXXX)"
#   # or:
#   export CSC_LINK="/path/to/certs.p12"
#   export CSC_KEY_PASSWORD="..."
#   # optional publish:
#   export GH_TOKEN="ghp_..."
#   ./tooling/release/macos-sign-release.sh
#   ./tooling/release/macos-sign-release.sh --publish

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ELECTRON_DIR="$ROOT/client/desktop"
PUBLISH=never

for arg in "$@"; do
  case "$arg" in
    --publish|publish) PUBLISH=always ;;
    --help|-h)
      sed -n '2,30p' "$0"
      exit 0
      ;;
  esac
done

echo "==> Coloride macOS signed release"
echo "    root: $ROOT"
echo "    publish: $PUBLISH"
echo

# ── 1. Codesign identity ────────────────────────────────────────────────────
echo "==> Checking Developer ID certificate…"
IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null || true)"
echo "$IDENTITIES"

if ! echo "$IDENTITIES" | grep -q "Developer ID Application"; then
  if [[ -z "${CSC_LINK:-}" ]]; then
    cat <<'EOF'

ERROR: No "Developer ID Application" identity in the keychain and CSC_LINK is unset.

Create / install one:

  1. https://developer.apple.com/account/resources/certificates/list
  2. "+" → Developer ID Application
  3. CSR from Keychain Access → Certificate Assistant → Request from CA
  4. Download .cer → double-click to install in "login" keychain
  5. Verify:
       security find-identity -v -p codesigning

Or export a .p12 from another Mac and:
       export CSC_LINK="/absolute/path/certs.p12"
       export CSC_KEY_PASSWORD="..."

EOF
    exit 1
  fi
  echo "    Using CSC_LINK=$CSC_LINK"
else
  echo "    Found Developer ID Application identity."
  if [[ -z "${CSC_NAME:-}" ]]; then
    # electron-builder wants the common name WITHOUT the "Developer ID Application:" prefix.
    CSC_NAME="$(echo "$IDENTITIES" | sed -n 's/.*"Developer ID Application: \([^"]*\)".*/\1/p' | head -1)"
    export CSC_NAME
    echo "    CSC_NAME=$CSC_NAME"
  fi
fi

# ── 2. Notarization credentials ─────────────────────────────────────────────
echo
echo "==> Checking Apple notarization credentials…"
missing=0
for var in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  if [[ -z "${!var:-}" ]]; then
    echo "    MISSING: $var"
    missing=1
  else
    echo "    OK: $var"
  fi
done

if [[ "$missing" -ne 0 ]]; then
  cat <<'EOF'

ERROR: Notarization env vars required.

  export APPLE_ID="you@domain.com"
  export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com
  export APPLE_TEAM_ID="XXXXXXXXXX"                          # developer.apple.com → Membership

EOF
  exit 1
fi

# electron-builder / @electron/notarize
export APPLE_ID
export APPLE_APP_SPECIFIC_PASSWORD
export APPLE_TEAM_ID
# Some versions also read these aliases:
export APPLEID="${APPLEID:-$APPLE_ID}"
export APPLEIDPASS="${APPLEIDPASS:-$APPLE_APP_SPECIFIC_PASSWORD}"

# Do NOT skip signing
unset CSC_IDENTITY_AUTO_DISCOVERY || true
export CSC_IDENTITY_AUTO_DISCOVERY=true

if [[ "$PUBLISH" == "always" && -z "${GH_TOKEN:-}" ]]; then
  echo
  echo "WARNING: --publish set but GH_TOKEN is empty. Upload to GitHub may fail."
  echo "  export GH_TOKEN=ghp_..."
  echo
fi

# ── 3. Build web ────────────────────────────────────────────────────────────
echo
echo "==> Building web frontend…"
cd "$ROOT"
pnpm build:web

# ── 4. electron-builder (sign + notarize) ───────────────────────────────────
echo
echo "==> electron-builder (signed + notarized)…"
cd "$ELECTRON_DIR"

# Only current arch for faster local release; CI can build universal.
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  EB_ARCH=arm64
else
  EB_ARCH=x64
fi

pnpm exec electron-builder --mac dmg zip --"$EB_ARCH" --publish "$PUBLISH" -c.mac.notarize=true -c.forceCodeSigning=true

echo
echo "==> Done."
echo "    Artifacts: $ELECTRON_DIR/release/"
ls -la "$ELECTRON_DIR/release" | head -30
echo
echo "Verify Gatekeeper (should say 'accepted' after notarize stapling):"
APP_PATH="$(find "$ELECTRON_DIR/release" -name 'Coloride.app' -type d | head -1 || true)"
test -n "$APP_PATH"
if [[ -n "$APP_PATH" ]]; then
  echo "    app: $APP_PATH"
  codesign --verify --deep --strict "$APP_PATH"
  spctl --assess --type execute -v "$APP_PATH"
  xcrun stapler validate "$APP_PATH"
  codesign -dv --verbose=2 "$APP_PATH" 2>&1 | head -20 || true
fi
echo
echo "Open:"
echo "  open \"$APP_PATH\""
