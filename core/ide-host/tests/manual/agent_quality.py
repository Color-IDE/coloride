#!/usr/bin/env python3
"""Paid, opt-in agent evaluations using real adapters, runtime and local tools.

Each case gets its own HOME, session store and disposable project. Only fixture
code is sent to providers. Reports contain checks and events, never credentials.
This is a quality sample, not a claim that arbitrary production tasks are safe.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import json
import os
import shlex
import signal
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

from coloride_desktop.agents.cloud_token import cloud_access_token_needs_refresh
from coloride_desktop.agents.config import PROVIDER_DEFAULTS, AgentConfigStore, AgentProviderSettings
from coloride_desktop.agents.domain import AgentMode, AgentSession
from coloride_desktop.agents.engine import ColorideAgentEngine
from coloride_desktop.agents.provider import (
    FireworksResponsesProvider,
    GeminiResponsesProvider,
    OpenAIResponsesProvider,
    XAIResponsesProvider,
)
from coloride_desktop.agents.store import AgentSessionStore
from coloride_desktop.agents.tools import RemoteWorkspaceTools
from coloride_desktop.files.local import WorkspaceFileService

ADAPTERS = {
    "openai": OpenAIResponsesProvider,
    "xai": XAIResponsesProvider,
    "gemini": GeminiResponsesProvider,
    "fireworks": FireworksResponsesProvider,
}
CASES = ("read_only", "repair", "multiple_files", "failed_check_recovery", "follow_up", "shell_edit")
TESTS = """import unittest
from calculator import add, clamp

class Contract(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)
        self.assertEqual(add(-4, 1), -3)
    def test_clamp(self):
        self.assertEqual(clamp(-2, 0, 10), 0)
        self.assertEqual(clamp(15, 0, 10), 10)
        self.assertEqual(clamp(4, 0, 10), 4)
"""
ORACLE = """from calculator import add, clamp
for a,b in [(0,0),(-100,99),(123456,789),(-5,-6)]:
    assert add(a,b) == a+b, (a,b)
for low,high in [(-20,-3),(0,1),(10,10),(-10,30)]:
    for x in [low-100,low,high,high+100,(low+high)//2]:
        assert clamp(x,low,high) == max(low,min(high,x)), (x,low,high)
"""


def fixture(root: Path, case: str) -> tuple[list[str], str]:
    (root / "KEEP.txt").write_text("User-owned sentinel: café العربية 日本語\n")
    if case == "read_only":
        (root / "settings.json").write_text('{"port": 4317, "name": "quality-fixture"}\n')
        return (
            ["Lee settings.json y responde con el nombre y el puerto. No crees ni modifiques archivos."],
            "",
        )
    if case == "multiple_files":
        return (
            [
                "Crea calculator.py con add(a,b) y clamp(value,low,high), y cli.py que importe add "
                "y escriba 5 al ejecutar python cli.py. clamp limita value al intervalo inclusivo. "
                "Crea test_contract.py con unittest para ambas funciones y ejecuta los tests. "
                "Conserva KEEP.txt y no instales dependencias."
            ],
            ORACLE,
        )
    (root / "calculator.py").write_text(
        "def add(a, b):\n    return a - b\n\ndef clamp(value, low, high):\n    return value\n"
    )
    (root / "test_contract.py").write_text(TESTS)
    prefix = (
        "Ejecuta primero los tests actuales para observar el fallo. "
        if case == "failed_check_recovery"
        else ""
    )
    prompts = [
        prefix + "Corrige calculator.py: add suma; clamp limita value al intervalo inclusivo "
        "[low,high]. Lee y conserva test_contract.py sin modificarlo. Conserva KEEP.txt. "
        "Ejecuta los tests después del último cambio; no instales dependencias."
    ]
    if case == "shell_edit":
        prompts[0] += " Realiza las ediciones usando execute_command; no uses write_file ni replace_in_file."
    oracle = ORACLE
    if case == "follow_up":
        prompts.append(
            "Ahora añade multiply(a,b) a calculator.py sin romper add ni clamp. Añade "
            "test_multiply.py con unittest, ejecuta toda la suite y conserva los archivos anteriores."
        )
        oracle += (
            "from calculator import multiply\nassert multiply(-7, 6) == -42\nassert multiply(0, 99) == 0\n"
        )
    return prompts, oracle


def snapshot(root: Path) -> dict[str, str]:
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in root.rglob("*")
        if p.is_file()
        and not any(x in {"__pycache__", ".coloride", ".git"} for x in p.relative_to(root).parts)
    }


async def command(cmd: str, cwd: Path, timeout: float = 30) -> SimpleNamespace:
    process = await asyncio.create_subprocess_exec(
        "/bin/bash",
        "-c",
        cmd,
        cwd=cwd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
    except (TimeoutError, asyncio.CancelledError):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        await process.communicate()
        raise
    return SimpleNamespace(
        exit_status=process.returncode,
        stdout=stdout.decode(errors="replace"),
        stderr=stderr.decode(errors="replace"),
    )


async def run_case(settings: AgentProviderSettings, case: str, output: Path, timeout: float) -> dict:
    output.mkdir(parents=True)
    project = output / "project with spaces"
    project.mkdir()
    prompts, oracle = fixture(project, case)
    original = snapshot(project)
    store = AgentSessionStore(output / "sessions")
    files = WorkspaceFileService(object())
    session = AgentSession.create(
        agent="coloride",
        cwd=str(project),
        mode=AgentMode.ACT,
        workspace_kind="local",
        access_level="full",
        reasoning_effort=settings.reasoning_effort,
    )
    files.authorize_local_session(session.session_id, str(project))
    store.save_session(session)
    events: list[dict] = []

    async def emit(kind, data):
        # Disk logs can contain only the synthetic fixture, never API keys.
        events.append({"type": kind, "data": data})
        store.append_event(session.session_id, kind, data)

    async def approve(_call, _details):
        return "approve"

    async def run_command(cmd):
        return await command(cmd, project, timeout=min(timeout, 60))

    tools = RemoteWorkspaceTools(files=files, run_command=run_command, store=store)
    provider = ADAPTERS[settings.provider](settings)
    engine = ColorideAgentEngine(
        provider=provider,
        tools=tools,
        store=store,
        emit=emit,
        request_approval=approve,
        save_session=store.save_session,
    )
    started = time.monotonic()
    error = None
    turns = []
    try:
        with files.session_scope(session.session_id):
            for prompt in prompts:
                before = len(events)
                guidance = (
                    ""
                    if case == "read_only"
                    else (
                        f"\nPython disponible: {sys.executable}. "
                        f"Para verificar usa {shlex.quote(sys.executable)} -m unittest discover -v."
                    )
                )
                await asyncio.wait_for(
                    engine.run_turn(
                        session=session,
                        message=prompt + guidance,
                        cancel_event=asyncio.Event(),
                    ),
                    timeout,
                )
                turn_events = events[before:]
                task = engine._sdk_task
                turns.append(
                    {
                        "accepted": bool(task.completion.get("accepted")),
                        "outcome": task.completion.get("outcome"),
                        "done": any(
                            e["type"] == "task_outcome" and e["data"].get("outcome") == "completed"
                            for e in turn_events
                        ),
                        "modelCalls": task.budget_usage.model_calls,
                    }
                )
    except Exception as exc:
        error = (
            f"Turn timed out after {timeout:g} seconds"
            if isinstance(exc, TimeoutError)
            else f"{type(exc).__name__}: {exc}"
        ).replace(settings.api_key, "[REDACTED]")
    checks = {
        "turns_completed": len(turns) == len(prompts)
        and all(t["done"] and t["accepted"] and t["outcome"] == "completed" for t in turns),
        "sentinel_unchanged": snapshot(project).get("KEEP.txt") == original["KEEP.txt"],
    }
    if case == "read_only":
        text = " ".join(str(e["data"].get("text", "")) for e in events if e["type"] in {"text", "text_delta"})
        checks.update(
            no_file_changes=snapshot(project) == original,
            answer_matches_fixture="4317" in text and "quality-fixture" in text,
        )
    else:
        if "test_contract.py" in original:
            checks["original_tests_unchanged"] = (
                snapshot(project).get("test_contract.py") == original["test_contract.py"]
            )
        # Hidden assertions run independently after the agent finishes. The
        # oracle lives outside the workspace and does not trust edited tests.
        oracle_path = output / "oracle.py"
        oracle_path.write_text("import sys\nsys.path.insert(0, " + repr(str(project)) + ")\n" + oracle)
        result = await command(f"{shlex.quote(sys.executable)} {shlex.quote(str(oracle_path))}", project)
        checks["independent_behavior"] = result.exit_status == 0
        if case == "multiple_files":
            cli = await command(f"{shlex.quote(sys.executable)} cli.py", project)
            checks["cli_result"] = cli.exit_status == 0 and cli.stdout.strip() == "5"
            checks["tests_created"] = (project / "test_contract.py").is_file()
        if case == "follow_up":
            checks["follow_up_tests_created"] = (project / "test_multiply.py").is_file()
        if case == "shell_edit":
            checks["shell_used_for_edit"] = any(
                e["type"] == "tool_call" and e["data"].get("tool") == "execute_command" for e in events
            ) and not any(
                e["type"] == "tool_call" and e["data"].get("tool") in {"write_file", "replace_in_file"}
                for e in events
            )
        if case == "failed_check_recovery":
            # A tool can execute successfully while its child test exits nonzero.
            # Use the completion ledger's exit-code evidence, not transport failure.
            evidence = engine._sdk_task.completion.get("evidence", []) if turns else []
            checks["failure_observed"] = any(not item["passed"] for item in evidence)
    # Never persist a provider secret even if a provider repeats it in an error.
    payload = json.dumps(events, ensure_ascii=False, default=str).replace(settings.api_key, "[REDACTED]")
    (output / "events.json").write_text(payload)
    provider_guards = [
        e["data"]
        for e in events
        if e["type"] == "guard_paused" and e["data"].get("reason") == "provider-errors"
    ]
    status = "passed" if all(checks.values()) and error is None else "failed"
    if provider_guards and not any(e["type"] == "tool_call" for e in events):
        status = "blocked"
        error = provider_guards[-1].get("message")
    return {
        "case": case,
        "status": status,
        "checks": checks,
        "turns": turns,
        "error": error,
        "seconds": round(time.monotonic() - started, 2),
        "reasoningEffort": settings.reasoning_effort,
    }


async def main(args) -> int:
    config = AgentConfigStore()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    results = []
    # Resolve without changing the user's provider configuration or keychain.
    for selection in args.model:
        provider, model = selection.split(":", 1)
        source, key = await config._resolve_credentials(provider)
        if not key or (source == "coloride" and cloud_access_token_needs_refresh(key)):
            results.append(
                {"model": selection, "status": "blocked", "reason": "missing_or_expired_credentials"}
            )
            print(f"BLOCKED {selection}: missing or expired credentials", flush=True)
            continue
        settings = AgentProviderSettings(
            provider=provider,
            model=model,
            base_url=config._managed_llm_base_url()
            if source == "coloride"
            else PROVIDER_DEFAULTS[provider][1],
            api_key=key,
            credential_source=source,
            reasoning_effort=args.reasoning_effort,
        )
        for repeat in range(args.repeat):
            for case in args.case or CASES:
                case_output = output / f"{len(results):03d}-{provider}-{case}-{repeat}"
                with tempfile.TemporaryDirectory(prefix="coloride-quality-home-") as isolated_home:
                    previous_home = os.environ.get("HOME")
                    os.environ["HOME"] = isolated_home
                    try:
                        result = await run_case(settings, case, case_output, args.timeout)
                    finally:
                        if previous_home is None:
                            os.environ.pop("HOME", None)
                        else:
                            os.environ["HOME"] = previous_home
                result["model"] = selection
                results.append(result)
                print(f"{result['status'].upper()} {selection} {case}: {result['checks']}", flush=True)
                (output / "report.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    (output / "report.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    return 0 if results and all(r["status"] == "passed" for r in results) else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", action="append", required=True, metavar="PROVIDER:MODEL")
    parser.add_argument("--case", action="append", choices=CASES)
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--reasoning-effort", choices=("low", "medium", "high"), default="medium")
    parser.add_argument("--timeout", type=float, default=240)
    parser.add_argument(
        "--output", type=Path, required=True, help="New report directory, e.g. artifacts/agent-quality/run-1"
    )
    arguments = parser.parse_args()
    for selection in arguments.model:
        if ":" not in selection or selection.split(":", 1)[0] not in ADAPTERS:
            parser.error("--model must be a supported PROVIDER:MODEL")
    if arguments.repeat < 1 or arguments.timeout <= 0:
        parser.error("--repeat and --timeout must be positive")
    raise SystemExit(asyncio.run(main(arguments)))
