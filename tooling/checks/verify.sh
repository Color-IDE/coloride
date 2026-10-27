#!/bin/sh
set -eu

echo "==> Python syntax"
python3 - <<'PY'
from pathlib import Path
import ast

for root in [Path("core/ide-host")]:
    for path in sorted(root.rglob("*.py")):
        ast.parse(path.read_text(), filename=str(path))
PY

if python3 -c "import pytest" >/dev/null 2>&1; then
  echo "==> Python tests"
  PYTHONPATH=core/ide-host/src \
    python3 -m pytest core/ide-host/tests
else
  echo "==> Python tests skipped: pytest is not installed"
fi

if command -v pnpm >/dev/null 2>&1 && [ -d node_modules ]; then
  echo "==> TypeScript typecheck"
  pnpm -s typecheck
else
  echo "==> TypeScript typecheck skipped: run pnpm install first"
fi

echo "==> OK"
