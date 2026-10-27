"""Regression checks for the repository's non-destructive Python source audit."""
from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace


def load_audit():
    root = Path(__file__).resolve().parents[4]
    spec = importlib.util.spec_from_file_location(
        "coloride_source_audit", root / "tooling/checks/audit-python.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_private_helper_review_respects_registration_and_dynamic_dispatch(tmp_path, monkeypatch):
    audit = load_audit()
    module = tmp_path / "core/ide-host/src/sample.py"
    module.parent.mkdir(parents=True)
    module.write_text(
        "def _orphan(): pass\n"
        "def _called(): pass\n"
        "_called()\n"
        "@register\n"
        "def _route(): pass\n"
        "def _execute_read_file(): pass\n"
        "def _registered(): pass\n"
        "registry = {'handler': '_registered'}\n"
    )
    monkeypatch.setattr(audit, "ROOT", tmp_path)
    assert audit.private_helper_candidates() == ["core/ide-host/src/sample.py:1: _orphan"]


def test_python_audit_propagates_required_check_failures(monkeypatch):
    audit = load_audit()
    monkeypatch.setattr(audit.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(returncode=1))
    monkeypatch.setattr(audit, "private_helper_candidates", lambda: [])
    assert audit.main() == 1
