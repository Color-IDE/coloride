"""Find or install a language server on the remote host under ~/.coloride/lsp."""

from __future__ import annotations

import shlex
from collections.abc import Awaitable, Callable
from typing import Any

from .servers import LanguageServerSpec, language_server_for

RunCommand = Callable[[str], Awaitable[Any]]

_NODE_VERSION = "v22.14.0"
_cached_argv: dict[str, list[str]] = {}


def _exit_status(result: Any) -> int:
    status = getattr(result, "exit_status", None)
    if status is None:
        status = getattr(result, "returncode", None)
    return int(status) if status is not None else 1


def _stdout_text(result: Any) -> str:
    raw = getattr(result, "stdout", None)
    if raw is None:
        return ""
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return str(raw)


def clear_bootstrap_cache() -> None:
    _cached_argv.clear()


def _script(spec: LanguageServerSpec) -> str:
    path_bins = " ".join(shlex.quote(name) for name in spec.path_bins)
    extra = " ".join(shlex.quote(arg) for arg in spec.extra_args)
    npm_package = spec.npm_package or ""
    npm_bin = spec.npm_bin or ""
    npm_prefix = spec.npm_prefix or spec.id
    vtsls = "1" if spec.vtsls_layout else ""
    return rf"""
set +e
COLORIDE_HOME="${{COLORIDE_HOME:-$HOME/.coloride}}"
LSP_HOME="$COLORIDE_HOME/lsp"
TOOLS="$COLORIDE_HOME/tools"
mkdir -p "$LSP_HOME" "$TOOLS" 2>/dev/null
if [ -x "$TOOLS/node/bin/node" ]; then
  export PATH="$TOOLS/node/bin:$PATH"
fi
if [ -x /usr/libexec/path_helper ]; then
  eval "$(/usr/libexec/path_helper -s)"
fi
export PATH="$LSP_HOME/{npm_prefix}/node_modules/.bin:$LSP_HOME/vscode-langservers/node_modules/.bin:$LSP_HOME/typescript/node_modules/.bin:$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/go/bin:$HOME/.cargo/bin:/usr/local/go/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/Library/Developer/CommandLineTools/usr/bin:/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin:$PATH"
ARGS="{extra}"

ok() {{
  echo "LSP_OK $1 $ARGS"
  exit 0
}}

for name in {path_bins}; do
  FOUND="$(command -v "$name" 2>/dev/null)"
  if [ -n "$FOUND" ] && [ -x "$FOUND" ]; then
    ok "$FOUND"
  fi
done

PREFIX="$LSP_HOME/{npm_prefix}"
# @clangd/clangd ships the binary under node_modules/clangd/bin, not .bin.
if [ "{spec.id}" = "cpp" ]; then
  for candidate in \
    "$PREFIX/node_modules/clangd/bin/clangd" \
    "$PREFIX/node_modules/@clangd/clangd/bin/clangd" \
    "$PREFIX/bin/clangd"
  do
    if [ -x "$candidate" ]; then
      ok "$candidate"
    fi
  done
fi
if [ -n "{npm_bin}" ]; then
  LOCAL="$PREFIX/node_modules/.bin/{npm_bin}"
  if [ -x "$LOCAL" ] || [ -f "$LOCAL" ]; then
    LOCAL="$(cd "$(dirname "$LOCAL")" && pwd)/$(basename "$LOCAL")"
    ok "$LOCAL"
  fi
fi

if [ -n "{vtsls}" ]; then
  JS="$PREFIX/node_modules/@vtsls/language-server/bin/vtsls.js"
  if [ -f "$JS" ]; then
    JS="$(cd "$(dirname "$JS")" && pwd)/$(basename "$JS")"
    ok "$JS"
  fi
fi

if [ -z "{npm_package}" ]; then
  echo "LSP_FAIL {spec.id} not on PATH"
  exit 4
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  if [ ! -x "$TOOLS/node/bin/node" ]; then
    ARCH="$(uname -m)"
    case "$ARCH" in
      x86_64|amd64) NODE_ARCH="x64" ;;
      aarch64|arm64) NODE_ARCH="arm64" ;;
      *) echo "LSP_FAIL unsupported arch $ARCH"; exit 2 ;;
    esac
    OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
    case "$OS" in
      linux) NODE_OS="linux" ;;
      darwin) NODE_OS="darwin" ;;
      *) echo "LSP_FAIL unsupported os $OS"; exit 2 ;;
    esac
    VER="{_NODE_VERSION}"
    NAME="node-${{VER}}-${{NODE_OS}}-${{NODE_ARCH}}"
    URL="https://nodejs.org/dist/${{VER}}/${{NAME}}.tar.xz"
    TMP="$TOOLS/node-download-$$"
    mkdir -p "$TMP"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL --connect-timeout 15 --max-time 120 "$URL" -o "$TMP/node.tar.xz" || {{ echo "LSP_FAIL node download"; exit 3; }}
    elif command -v wget >/dev/null 2>&1; then
      wget -q -T 120 -O "$TMP/node.tar.xz" "$URL" || {{ echo "LSP_FAIL node download"; exit 3; }}
    else
      echo "LSP_FAIL need curl or wget"; exit 3
    fi
    tar -xJf "$TMP/node.tar.xz" -C "$TMP" || {{ echo "LSP_FAIL node extract"; exit 3; }}
    rm -rf "$TOOLS/node"
    mv "$TMP/$NAME" "$TOOLS/node"
    rm -rf "$TMP"
  fi
  export PATH="$TOOLS/node/bin:$PATH"
fi

mkdir -p "$PREFIX"
npm install --prefix "$PREFIX" --no-fund --no-audit --omit=optional --prefer-offline --progress=false {npm_package} >/dev/null 2>&1 \
  || npm install --prefix "$PREFIX" --no-fund --no-audit --omit=optional --progress=false {npm_package}
BIN="$PREFIX/node_modules/.bin/{npm_bin}"
if [ "{spec.id}" = "cpp" ]; then
  for candidate in \
    "$PREFIX/node_modules/clangd/bin/clangd" \
    "$PREFIX/node_modules/@clangd/clangd/bin/clangd" \
    "$PREFIX/bin/clangd"
  do
    if [ -x "$candidate" ]; then
      BIN="$candidate"
      break
    fi
  done
fi
if [ ! -e "$BIN" ] && [ -n "{vtsls}" ]; then
  BIN="$PREFIX/node_modules/@vtsls/language-server/bin/vtsls.js"
fi
if [ -z "$BIN" ] || [ ! -e "$BIN" ]; then
  echo "LSP_FAIL {spec.id} missing after npm install"
  exit 5
fi
chmod +x "$BIN" 2>/dev/null || true
BIN="$(cd "$(dirname "$BIN")" && pwd)/$(basename "$BIN")"
ok "$BIN"
"""


def _parse_ok(out: str) -> list[str] | None:
    for line in reversed([ln.strip() for ln in out.splitlines() if ln.strip()]):
        if not line.startswith("LSP_OK "):
            continue
        parts = line[len("LSP_OK ") :].strip().split()
        if not parts:
            return None
        binary = parts[0]
        if not binary.startswith("/"):
            return None
        return [binary, *parts[1:]]
    return None


async def resolve_language_server(
    run_command: RunCommand,
    spec: LanguageServerSpec,
) -> tuple[list[str] | None, str | None]:
    cached = _cached_argv.get(spec.id)
    if cached is not None:
        return cached, None

    result = await run_command(f"bash -lc {shlex.quote(_script(spec))}")
    code = _exit_status(result)
    out = _stdout_text(result)
    argv = _parse_ok(out)
    if argv:
        _cached_argv[spec.id] = argv
        return argv, None

    fail = ""
    for line in reversed(out.splitlines()):
        if "LSP_FAIL" in line:
            fail = line.strip()
            break
    return None, fail or f"{spec.id} resolve failed (exit {code})"


async def resolve_vtsls(run_command: RunCommand) -> tuple[list[str] | None, str | None]:
    spec = language_server_for("typescript")
    if spec is None:
        return None, "typescript language server is not configured"
    return resolve_language_server(run_command, spec)
