"""Check Python unused locals/imports and report private-helper candidates for review."""
from __future__ import annotations

import ast
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = (
    "core/ide-host/src",
    "client/desktop/src/dictation",
    "tooling",
)


def private_helper_candidates() -> list[str]:
    references: Counter[str] = Counter()
    definitions: list[tuple[Path, ast.FunctionDef | ast.AsyncFunctionDef]] = []
    roots = (*SOURCES, "core/ide-host/tests", "tests")
    for root in roots:
        for path in (ROOT / root).rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Name):
                    references[node.id] += 1
                elif isinstance(node, ast.Attribute):
                    references[node.attr] += 1
                elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                    # getattr(obj, "name") and explicit registries are references too.
                    if node.value.isidentifier():
                        references[node.value] += 1
                elif (
                    isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                    and node.name.startswith("_")
                    and not node.name.startswith(("__", "_execute_"))
                    and not node.decorator_list
                    and "/src/" in path.as_posix()
                ):
                    # Tool handlers use getattr(self, f"_execute_{call.name}").
                    # Decorated handlers and protocol methods are not dead-code evidence.
                    definitions.append((path, node))
    return sorted(
        f"{path.relative_to(ROOT)}:{node.lineno}: {node.name}"
        for path, node in definitions
        if references[node.name] == 0
    )


def main() -> int:
    result = subprocess.run(
        [sys.executable, "-m", "ruff", "check", *SOURCES, "--select", "F401,F811,F841"],
        cwd=ROOT,
        check=False,
    )
    candidates = private_helper_candidates()
    print(f"Python private-helper review candidates: {len(candidates)}", flush=True)
    for candidate in candidates:
        print(f"  REVIEW (not an automatic deletion): {candidate}")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
