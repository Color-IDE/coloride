from __future__ import annotations

import asyncio
import base64
import contextlib
import difflib
import hashlib
import json
import re
import shlex
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Any, cast

from ..browser import BrowserService
from ..files.local import WorkspaceFileService
from ..files.search import ProjectSearchService, SearchConnectionError
from ..files.service import RemoteFileService
from ..ssh.restricted import (
    DEFAULT_ALLOWED_ROOTS,
    DEFAULT_BROWSE_ROOTS,
    is_path_under_roots,
)
from .checkpoints import MAX_CHECKPOINT_FILES, AgentCheckpoint, AgentCheckpointManager
from .domain import (
    AgentMode,
    AgentPlan,
    AgentPlanStatus,
    AgentPlanStep,
    AgentPlanStepStatus,
    AgentSession,
    normalize_filesystem_scope,
    utc_now,
)
from .integrations import AgentIntegrationManager, SafeWebReader
from .processes import AgentProcessRegistry
from .project_memory import FileAwareness, ProjectMemoryRegistry
from .provider import ModelToolCall
from .rules import WorkspacePolicy, WorkspacePolicyLoader

RunCommand = Callable[[str], Awaitable[object]]
AgentFileService = WorkspaceFileService | RemoteFileService
StatPath = Callable[[str], Awaitable[dict[str, Any]]]
_COMMAND_TIMEOUT_SECONDS = 180.0

_DYNAMIC_CORE_TOOLS = frozenset(
    {
        "list_files",
        "read_file",
        "search_files",
        "search_chat_history",
        "read_tool_output",
        "get_diagnostics",
        "git_status",
        "git_diff",
        "list_terminals",
        "read_terminal",
    }
)
_DYNAMIC_EDIT_TOOLS = frozenset(
    {"write_file", "replace_in_file", "create_directory", "execute_command", "update_plan_step"}
)
_DYNAMIC_PATH_TOOLS = frozenset({"rename_path", "move_path", "delete_path"})
_DYNAMIC_PROCESS_TOOLS = frozenset({"start_process", "read_process", "stop_process"})
_DYNAMIC_BROWSER_TOOLS = frozenset(
    {
        "browser_open",
        "browser_snapshot",
        "browser_screenshot",
        "browser_click",
        "browser_type",
        "browser_press",
        "browser_close",
    }
)

MAX_TOOL_OUTPUT = 60_000
MAX_DIFF_OUTPUT = 40_000
MAX_WRITE_BYTES = 2 * 1024 * 1024
MAX_LIST_ENTRIES = 400
_ACTIVE_TOOL_SESSION: ContextVar[AgentSession | None] = ContextVar(
    "coloride_active_tool_session",
    default=None,
)
_RELAX_PATH_POLICY: ContextVar[bool] = ContextVar(
    "coloride_relax_path_policy",
    default=False,
)


def relax_path_policy() -> bool:
    """True while the Agents-tab chat is using the Linux account as the only limit."""
    return bool(_RELAX_PATH_POLICY.get())


def path_in_active_agent_workspace(path: str) -> bool:
    """True when an agent tool is writing inside the folder the user already opened."""
    session = _ACTIVE_TOOL_SESSION.get()
    if session is None:
        return False
    root = (getattr(session, "cwd", "") or "").rstrip("/") or "/"
    candidate = (path or "").rstrip("/") or "/"
    return candidate == root or candidate.startswith(f"{root}/")


def _is_server_scope(session: AgentSession | None) -> bool:
    return (
        session is not None
        and getattr(session, "workspace_kind", "ssh") == "ssh"
        and normalize_filesystem_scope(session.filesystem_scope) == "server"
    )


class ToolRisk(StrEnum):
    READ = "read"
    WRITE = "write"
    EXECUTE = "execute"
    PRODUCTION = "production"


@dataclass(frozen=True, slots=True)
class ToolDefinition:
    name: str
    title: str
    description: str
    risk: ToolRisk
    modes: frozenset[AgentMode]
    parameters: dict[str, Any]

    def provider_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
            "strict": True,
        }


@dataclass(frozen=True, slots=True)
class ToolExecutionResult:
    output: str
    diff: str | None = None
    metadata: dict[str, Any] | None = None


class RecoverableToolInputError(ValueError):
    """A malformed model tool call that the model can safely correct and retry."""


@dataclass(frozen=True, slots=True)
class MutationPreview:
    details: dict[str, Any]
    resolved_paths: tuple[str, ...]
    payload: dict[str, Any]


# Inspect the workspace without mutating it or running shell.
# Ask + Plan: read/search only. Write/execute stay out.
READ_MODES = frozenset({AgentMode.ASK, AgentMode.PLAN, AgentMode.DEBUG, AgentMode.ACT})
# Run diagnostics and process inspection without writing files.
DEBUG_READ_MODES = frozenset({AgentMode.DEBUG, AgentMode.ACT})
# Shell / process control. Debug requires approval via Act-style policy.
EXECUTE_MODES = frozenset({AgentMode.DEBUG, AgentMode.ACT})
# File mutations stay out of Ask / Plan / Debug.
WRITE_MODES = frozenset({AgentMode.ACT})
# Structured plan tools (no file mutation).
PLAN_SUBMIT_MODES = frozenset({AgentMode.PLAN})
# Progress while following a plan: Plan (read-only investigation) + Act (build).
PLAN_UPDATE_MODES = frozenset({AgentMode.PLAN, AgentMode.ACT})
MAX_PLAN_STEPS = 20

_PLESK_SHELL_BANNER_RE = re.compile(
    r"\A\s*This server is powered by Plesk\.\s*\n"
    r"\s*Run the 'plesk login' command and log in by browsing either of the links "
    r"received in the output\.\s*\n"
    r"\s*Use the 'plesk' command to manage the server\. Run 'plesk help' for more info\."
    r"(?:\s*\n|\s*\Z)",
)


TOOL_DEFINITIONS: tuple[ToolDefinition, ...] = (
    ToolDefinition(
        name="list_files",
        title="List files",
        description=(
            "List files and directories. Relative paths start at the current working directory. "
            "Absolute paths are allowed."
        ),
        risk=ToolRisk.READ,
        modes=READ_MODES,
        parameters={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path from the current working directory, or an absolute path.",
                },
                "recursive": {"type": "boolean"},
                "max_depth": {"type": "integer", "minimum": 1, "maximum": 5},
            },
            "required": ["path", "recursive", "max_depth"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="read_file",
        title="Read file",
        description=(
            "Read a UTF-8 text file, optionally limited to an inclusive line range. "
            "Relative paths start at the current working directory; absolute paths are allowed. "
            "start_line and end_line are absolute 1-based line numbers, not an offset/count pair; "
            "end_line must be greater than or equal to start_line."
        ),
        risk=ToolRisk.READ,
        modes=READ_MODES,
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "start_line": {
                    "type": ["integer", "null"],
                    "minimum": 1,
                    "description": "First absolute line to read (1-based), or null for line 1.",
                },
                "end_line": {
                    "type": ["integer", "null"],
                    "minimum": 1,
                    "description": (
                        "Last absolute line to read, inclusive, or null for EOF. "
                        "This is never a line count."
                    ),
                },
            },
            "required": ["path", "start_line", "end_line"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="search_files",
        title="Search files",
        description=(
            "Search workspace file contents. Use auto for discovery: one call searches exact text, "
            "then related terms, identifier words and spelling variants when exact hits are scarce. "
            "A persistent background index accelerates discovery; cached local embeddings are used "
            "when configured. Results distinguish exact from related matches and include paths, lines "
            "and context. Do not manually cycle through synonyms already expanded by this tool. "
            "Use literal when tracing an exact identifier or error. Relative paths start at cwd."
        ),
        risk=ToolRisk.READ,
        modes=READ_MODES,
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1},
                "path": {"type": "string"},
                "include": {"type": "string", "description": "File glob such as *.ts or *"},
                "mode": {
                    "type": ["string", "null"], "enum": ["auto", "literal", None],
                    "description": "auto (default) expands discovery internally; literal requires exact text.",
                },
                "case_sensitive": {
                    "type": ["boolean", "null"], "description": "Default false in local and SSH.",
                },
                "max_results": {
                    "type": ["integer", "null"], "minimum": 1, "maximum": 200,
                    "description": "Maximum returned hits; default 40.",
                },
                "context_lines": {
                    "type": ["integer", "null"], "minimum": 0, "maximum": 5,
                    "description": "Lines before/after each match; default 2.",
                },
            },
            "required": [
                "query", "path", "include", "mode", "case_sensitive", "max_results", "context_lines",
            ],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="search_chat_history",
        title="Search chat history",
        description=(
            "Search this chat's durable history (not just the compacted prompt). "
            "Use only after CONVERSATION MEMORY and recent spans are not enough. "
            "Put every missing topic in queries[] (one call, several topics). "
            "Budget: 1 search this turn, maximum 2 if genuinely new facts appear. "
            "Repeating a query already retrieved this turn returns "
            "'Already available in current working context.'"
        ),
        risk=ToolRisk.READ,
        modes=READ_MODES,
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": ["string", "null"],
                    "description": "One literal substring. Prefer queries[] for several topics.",
                },
                "queries": {
                    "type": ["array", "null"],
                    "items": {"type": "string", "minLength": 1},
                    "maxItems": 8,
                    "description": "Several topics in one call. Deduplicated.",
                },
                "limit": {
                    "type": ["integer", "null"],
                    "minimum": 1,
                    "maximum": 50,
                    "description": "Maximum unique hits. Defaults to 20.",
                },
            },
            "required": ["query", "queries", "limit"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="read_tool_output",
        title="Read tool output",
        description=(
            "Read a spilled tool log by id (the function_call call_id). Large command "
            "and file outputs are stored as files so the prompt only keeps a preview. "
            "Use offset/limit to page through the log."
        ),
        risk=ToolRisk.READ,
        modes=READ_MODES,
        parameters={
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Tool output id / call_id from a spilled result.",
                },
                "offset": {
                    "type": ["integer", "null"],
                    "minimum": 0,
                    "description": "0-based line offset. Defaults to 0.",
                },
                "limit": {
                    "type": ["integer", "null"],
                    "minimum": 1,
                    "maximum": 400,
                    "description": "Number of lines to return. Defaults to 80.",
                },
            },
            "required": ["id", "offset", "limit"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="write_file",
        title="Write file",
        description=(
            "Create a NEW file or fully rewrite a file only when most of the content must change. "
            "For editing an existing file (README, config, source), ALWAYS prefer replace_in_file "
            "with a small exact old_text/new_text block. Whole-file write_file on large files is "
            "slow and more likely to fail mid-stream."
        ),
        risk=ToolRisk.WRITE,
        modes=WRITE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="replace_in_file",
        title="Edit file",
        description=(
            "Preferred way to edit existing files. Replace an exact text block (old_text -> new_text). "
            "old_text must be non-empty and match the file exactly; NEVER send an empty old_text. "
            "Read a narrow file range first if the exact block is not known. Use this for README "
            "sections, small fixes, and almost all edits instead of write_file."
        ),
        risk=ToolRisk.WRITE,
        modes=WRITE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old_text": {"type": "string", "minLength": 1},
                "new_text": {"type": "string"},
                "replace_all": {"type": "boolean"},
            },
            "required": ["path", "old_text", "new_text", "replace_all"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="create_directory",
        title="Create directory",
        description="Create a directory inside the selected workspace.",
        risk=ToolRisk.WRITE,
        modes=WRITE_MODES,
        parameters={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="rename_path",
        title="Rename path",
        description=(
            "REQUIRED for renaming. Change only the basename of a file or directory while "
            "keeping it in the same parent folder. Example: path='foo/test.txt', "
            "new_name='test2.txt'. Do NOT use move_path for renames. new_name must be a "
            "basename only (no slashes)."
        ),
        risk=ToolRisk.WRITE,
        modes=WRITE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Current file or directory path relative to the workspace.",
                },
                "new_name": {
                    "type": "string",
                    "description": "New basename only, e.g. 'test2.txt'. No path separators.",
                },
            },
            "required": ["path", "new_name"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="move_path",
        title="Move path",
        description=(
            "Move a file or directory into a DIFFERENT parent folder. "
            "old_path and new_path must not share the same parent. "
            "For same-folder renames (e.g. foo/a.txt → foo/b.txt) you MUST call rename_path "
            "instead — move_path will reject same-folder destinations."
        ),
        risk=ToolRisk.WRITE,
        modes=WRITE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "old_path": {
                    "type": "string",
                    "description": "Current path of the file or directory to move.",
                },
                "new_path": {
                    "type": "string",
                    "description": "Full destination path in a different parent folder.",
                },
            },
            "required": ["old_path", "new_path"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="delete_path",
        title="Delete path",
        description=(
            "Delete a workspace file or directory. Non-empty directories require recursive=true. "
            "Coloride creates a restorable checkpoint first."
        ),
        risk=ToolRisk.WRITE,
        modes=WRITE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "recursive": {"type": "boolean"},
            },
            "required": ["path", "recursive"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="execute_command",
        title="Run command",
        description=(
            "Run a short shell command from the given directory and wait for it to finish. "
            "Use for builds, tests, project tooling, and process managers the current Linux "
            "user can already run (pm2, systemctl, nginx). "
            "Do not start long-running servers here (npm run dev, next dev, vite, "
            "python -m http.server). Use start_process so output and status remain in chat "
            "and the user can open that same process in the IDE terminal. Backgrounding with & "
            "still blocks this tool. "
            "Commands run as the Linux user selected when the SSH connection was created; "
            "Coloride never changes Linux users. Never claim success without checking output. "
            "Use structured file tools instead of touch, printf, mkdir, mv or rm for file operations."
        ),
        risk=ToolRisk.EXECUTE,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "command": {"type": "string", "minLength": 1},
                "cwd": {"type": "string", "description": "Working directory. Relative or absolute."},
            },
            "required": ["command", "cwd"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="list_terminals",
        title="List IDE terminals",
        description=(
            "List existing IDE terminals in the selected workspace and connection. "
            "User terminals can be read without taking them over."
        ),
        risk=ToolRisk.READ,
        modes=READ_MODES,
        parameters={"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    ),
    ToolDefinition(
        name="create_terminal",
        title="Create IDE terminal",
        description="Create a visible terminal tab when the user explicitly asks to open or use the IDE terminal.",
        risk=ToolRisk.EXECUTE,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {"cwd": {"type": "string"}, "title": {"type": "string"}},
            "required": ["cwd", "title"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="read_terminal",
        title="Read IDE terminal",
        description=(
            "Read recent output from an existing IDE terminal without consuming or clearing user scrollback. "
            "Output is a snapshot, not an exit-code check."
        ),
        risk=ToolRisk.READ,
        modes=READ_MODES,
        parameters={
            "type": "object",
            "properties": {
                "terminal_id": {"type": "string"},
                "lines": {"type": "integer", "minimum": 1, "maximum": 2000},
            },
            "required": ["terminal_id", "lines"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="run_terminal_command",
        title="Run in IDE terminal",
        description=(
            "Send a shell command to an idle terminal created by this chat. It is visible to the user. "
            "Use this when the user explicitly asks to run something in an open terminal. For long-running "
            "commands that should remain in chat, use start_process. Returns after submission, not completion. "
            "Use execute_command for verification requiring an exit code. Never send commands to "
            "user-owned terminals or interactive prompts."
        ),
        risk=ToolRisk.EXECUTE,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "terminal_id": {"type": "string"},
                "command": {"type": "string", "minLength": 1},
            },
            "required": ["terminal_id", "command"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="start_process",
        title="Start process",
        description=(
            "Start a long-running command such as npm run dev, Vite, Next, a watcher, or server, "
            "and return a process_id. Its output and status stay in chat, with a button that lets "
            "the user open the same live process in the IDE terminal. "
            "Pass the project's real command only (for example npm run dev). Do not wrap "
            "it in tmux, nohup, setsid, or a /tmp log. Coloride detaches it: tmux on a VPS, "
            "a native logged process on a local Mac folder. Missing tmux is expected locally. "
            "Use read_process later to inspect output."
        ),
        risk=ToolRisk.EXECUTE,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "command": {"type": "string", "minLength": 1},
                "cwd": {"type": "string"},
            },
            "required": ["command", "cwd"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="read_process",
        title="Read background process",
        description="Read recent output and status from a process started by Coloride Agent.",
        risk=ToolRisk.READ,
        modes=DEBUG_READ_MODES,
        parameters={
            "type": "object",
            "properties": {
                "process_id": {"type": "string"},
                "lines": {"type": "integer", "minimum": 10, "maximum": 2000},
            },
            "required": ["process_id", "lines"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="stop_process",
        title="Stop background process",
        description="Stop a background process previously started by this agent session.",
        risk=ToolRisk.EXECUTE,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {"process_id": {"type": "string"}},
            "required": ["process_id"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="get_diagnostics",
        title="Workspace diagnostics",
        description=(
            "Run safe repository diagnostics (Git whitespace/conflict checks and project "
            "metadata detection) without modifying files."
        ),
        risk=ToolRisk.READ,
        modes=READ_MODES,
        parameters={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="fetch_url",
        title="Read web page",
        description=(
            "Read a public HTTPS document for documentation or research (up to 15 MB). "
            "Private and local network addresses are blocked. For localhost apps, SPAs, "
            "and interactive UI on the VPS, use browser_open instead."
        ),
        risk=ToolRisk.READ,
        modes=READ_MODES,
        parameters={
            "type": "object",
            "properties": {"url": {"type": "string", "minLength": 1}},
            "required": ["url"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="browser_open",
        title="Analyze browser",
        description=(
            "Open or navigate a real Chromium browser that runs on the VPS (not on the user's "
            "laptop). Use for localhost apps, SPAs, and UI flows. Returns browser_id, title, url, "
            "and an accessibility snapshot with refs (e1, e2, …) for click/type. "
            "First use may install Playwright/Chromium on the VPS."
        ),
        risk=ToolRisk.EXECUTE,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "minLength": 1,
                    "description": "http(s) URL, including http://127.0.0.1 on the VPS",
                },
            },
            "required": ["url"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="browser_snapshot",
        title="Browser snapshot",
        description=(
            "Capture an accessibility-style snapshot of the open VPS browser page with stable "
            "element refs (e1, e2, …). Always snapshot before click/type."
        ),
        risk=ToolRisk.READ,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {"browser_id": {"type": "string", "minLength": 1}},
            "required": ["browser_id"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="browser_screenshot",
        title="Browser screenshot",
        description="Capture a screenshot of the open VPS browser viewport.",
        risk=ToolRisk.READ,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {"browser_id": {"type": "string", "minLength": 1}},
            "required": ["browser_id"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="browser_click",
        title="Browser click",
        description=(
            "Click an element in the VPS browser by ref from the latest browser_snapshot "
            "or browser_open (for example e4)."
        ),
        risk=ToolRisk.EXECUTE,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "browser_id": {"type": "string", "minLength": 1},
                "ref": {"type": "string", "minLength": 1, "description": "Element ref like e1"},
            },
            "required": ["browser_id", "ref"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="browser_type",
        title="Browser type",
        description=(
            "Type text into an element in the VPS browser by snapshot ref. "
            "Set submit=true to press Enter afterward."
        ),
        risk=ToolRisk.EXECUTE,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "browser_id": {"type": "string", "minLength": 1},
                "ref": {"type": "string", "minLength": 1},
                "text": {"type": "string"},
                "submit": {"type": "boolean"},
            },
            "required": ["browser_id", "ref", "text", "submit"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="browser_press",
        title="Browser key press",
        description=(
            "Press a keyboard key in the VPS browser (Enter, Tab, Escape, End, ArrowDown, …). "
            "Omit ref (or pass \"\") for a page-level key on the focused document. "
            "If the browser was closed after a pause, call browser_open again first."
        ),
        risk=ToolRisk.EXECUTE,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "browser_id": {"type": "string", "minLength": 1},
                "key": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Playwright key name, e.g. Enter, Tab, Escape, End, ArrowDown",
                },
                "ref": {
                    "type": "string",
                    "description": (
                        "Optional element ref from the latest snapshot. "
                        "Omit or use empty string for page-level key press."
                    ),
                },
            },
            "required": ["browser_id", "key"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="browser_close",
        title="Close browser",
        description="Close the VPS browser session and free Chromium resources.",
        risk=ToolRisk.EXECUTE,
        modes=EXECUTE_MODES,
        parameters={
            "type": "object",
            "properties": {"browser_id": {"type": "string", "minLength": 1}},
            "required": ["browser_id"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="git_status",
        title="Git status",
        description="Show the current Git branch and changed files in the workspace.",
        risk=ToolRisk.READ,
        modes=READ_MODES,
        parameters={
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="git_diff",
        title="Git diff",
        description="Inspect staged or unstaged Git changes, optionally for one workspace path.",
        risk=ToolRisk.READ,
        modes=READ_MODES,
        parameters={
            "type": "object",
            "properties": {
                "staged": {"type": "boolean"},
                "path": {"type": ["string", "null"]},
            },
            "required": ["staged", "path"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="submit_plan",
        title="Submit plan",
        description=(
            "Submit the work checklist EARLY in Plan mode — before a long free-form tour. "
            "Match steps to the user goal (not only analysis):\n"
            "• Analyze/review/explain: research steps only (map layout, read X, summarize).\n"
            "• Build/fix/change code: full implementation sequence (recon → edits → tests), "
            "with concrete file paths when known.\n"
            "• Other tasks: ordered actions that achieve that ask.\n"
            "After submit_plan: follow what Plan mode allows (reads) in this same turn; "
            "for write/edit steps, leave them pending until the user presses Implement (Act). "
            "3–10 steps preferred, max 20."
        ),
        risk=ToolRisk.READ,
        modes=PLAN_SUBMIT_MODES,
        parameters={
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Short plan title",
                },
                "summary": {
                    "type": ["string", "null"],
                    "description": "Optional one-paragraph overview",
                },
                "steps": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_PLAN_STEPS,
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {
                                "type": "string",
                                "minLength": 1,
                                "description": "Actionable step title",
                            },
                            "detail": {
                                "type": ["string", "null"],
                                "description": "Optional detail (paths, approach)",
                            },
                        },
                        "required": ["title", "detail"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["title", "summary", "steps"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="update_plan_step",
        title="Update plan step",
        description=(
            "Mark progress on the active plan while you follow it in this same chat. "
            "Call when starting a step (in_progress), finishing (done), or skipping (skipped + note). "
            "Only one step in_progress at a time. Prefer order. Works in Plan (read-only) and Act."
        ),
        risk=ToolRisk.READ,
        modes=PLAN_UPDATE_MODES,
        parameters={
            "type": "object",
            "properties": {
                "step_id": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Step id from the approved plan (e.g. step_1)",
                },
                "status": {
                    "type": "string",
                    "enum": ["pending", "in_progress", "done", "skipped"],
                },
                "note": {
                    "type": ["string", "null"],
                    "description": "Optional note (required when skipping)",
                },
            },
            "required": ["step_id", "status", "note"],
            "additionalProperties": False,
        },
    ),
)

DEFINITIONS_BY_NAME = {definition.name: definition for definition in TOOL_DEFINITIONS}
SERVER_ONLY_TOOL_NAMES: frozenset[str] = frozenset()
_MUTATING_FILE_TOOLS = frozenset(
    {
        "write_file",
        "replace_in_file",
        "create_directory",
        "rename_path",
        "move_path",
        "delete_path",
    }
)


class RemoteWorkspaceTools:
    """Coloride-owned tool executor scoped to one selected remote workspace."""

    def __init__(
        self,
        *,
        files: AgentFileService,
        run_command: RunCommand,
        browsers: BrowserService | None = None,
        store: Any | None = None,
        on_plan_updated: Callable[[AgentPlan], Awaitable[None]] | None = None,
    ) -> None:
        self.terminals: Any | None = None
        self.files = files
        self.run_command = run_command
        remote_files = cast(RemoteFileService, files)
        self.policy_loader = WorkspacePolicyLoader(remote_files)
        self.checkpoints = AgentCheckpointManager(remote_files)
        self.processes = AgentProcessRegistry(run_command)
        # App-wide browser service (shared with UI / terminal links).
        self.browsers = browsers or BrowserService(run_command=run_command, files=remote_files)
        self.integrations = AgentIntegrationManager()
        self._session_plugins: dict[str, tuple[str, ...]] = {}
        self.web_reader = SafeWebReader()
        self._store = store
        self._on_plan_updated = on_plan_updated
        self._policies: dict[str, WorkspacePolicy] = {}
        self._previews: dict[tuple[str, str], MutationPreview] = {}
        self._production_resolver: Callable[[AgentSession], Awaitable[dict[str, Any] | None]] | None = None
        self._production_controller: Any | None = None
        self._filesystem_resolver: Callable[[AgentSession], Awaitable[dict[str, Any] | None]] | None = None
        self._turn_retrieval: dict[str, Any] = {}
        self._memory_cache_hits: dict[str, int] = {}
        self._project_memory: ProjectMemoryRegistry | None = None
        self.search_service: ProjectSearchService | None = None
        self._symbol_provider: Callable[
            [AgentSession, str], Awaitable[list[dict[str, Any]]]
        ] | None = None

    def bind_project_memory(self, registry: ProjectMemoryRegistry | None) -> None:
        self._project_memory = registry

    async def warm_search(self, session: AgentSession) -> None:
        if self.search_service is not None:
            with contextlib.suppress(OSError, RuntimeError, ValueError):
                await self.search_service.warm(
                    session.cwd, kind=session.workspace_kind, connection_id=session.connection_id,
                )

    def bind_symbol_provider(
        self,
        provider: Callable[[AgentSession, str], Awaitable[list[dict[str, Any]]]] | None,
    ) -> None:
        self._symbol_provider = provider

    def bind_production(
        self,
        *,
        resolver: Callable[[AgentSession], Awaitable[dict[str, Any] | None]] | None,
        controller: Any | None,
    ) -> None:
        self._production_resolver = resolver
        self._production_controller = controller

    def bind_filesystem_roots(
        self,
        resolver: Callable[[AgentSession], Awaitable[dict[str, Any] | None]] | None,
    ) -> None:
        self._filesystem_resolver = resolver

    def begin_turn_retrieval(self, session_id: str, state: Any) -> None:
        """Latch retrieval for this user turn so duplicate searches stay cheap."""
        if session_id:
            self._turn_retrieval[session_id] = state
            self._memory_cache_hits[session_id] = 0

    def memory_cache_hits(self, session_id: str) -> int:
        return max(0, int(self._memory_cache_hits.get(session_id, 0)))

    def set_session_plugins(self, session_id: str, plugin_ids: list[str] | None) -> None:
        cleaned = tuple(item.strip().lower() for item in plugin_ids or [] if item.strip())
        if cleaned:
            self._session_plugins[session_id] = cleaned
        else:
            self._session_plugins.pop(session_id, None)

    async def prepare(self, session: AgentSession) -> str:
        """Refresh integrations and return only repository-controlled guidance."""
        _ACTIVE_TOOL_SESSION.set(session)
        _RELAX_PATH_POLICY.set(_is_server_scope(session))
        policy = await self.policy_loader.load(session.cwd)
        self._policies[session.cwd.rstrip("/") or "/"] = policy
        await self.warm_search(session)
        await self.integrations.refresh()
        return policy.instructions

    def runtime_instructions(self, session: AgentSession) -> str:
        """Return Coloride-owned guidance for capabilities connected to this chat."""
        return self._plugin_instructions(session)

    def _plugin_instructions(self, session: AgentSession) -> str:
        allowed = self._allowed_plugin_ids(session)
        if not allowed:
            return ""
        names = ", ".join(allowed)
        tools = self._mcp_tools_for(session)
        if not tools:
            return (
                f"The user added these complements to this chat: {names}. "
                "Their MCP tools are not connected. Tell them to connect the complement "
                "in Complements. Do not search or explain this repository's source to "
                "stand in for the plugin."
            )
        exposed = ", ".join(tool.exposed_name for tool in tools[:32])
        return (
            f"The user added these complements to this chat: {names}. "
            f"Use only these MCP tools to demonstrate them: {exposed}. "
            "If they ask how a plugin works, call those tools (issues, teams, PRs, etc.) "
            "and show a real result. Do not search, read, or summarize this repository's "
            "Linear/GitHub/OAuth/integration code unless they explicitly ask about this codebase."
        )

    def schemas_for(
        self,
        mode: AgentMode,
        session: AgentSession | None = None,
        *,
        task: Any | None = None,
        intent: str = "",
    ) -> list[dict[str, Any]]:
        server_scope = _is_server_scope(session)
        selected_names = self._selected_tool_names(mode, task=task, intent=intent)
        schemas = [
            definition.provider_schema()
            for definition in TOOL_DEFINITIONS
            if mode in definition.modes
            and (self.terminals is not None or definition.name not in {"list_terminals", "create_terminal", "read_terminal", "run_terminal_command"})
            and not (not server_scope and definition.name in SERVER_ONLY_TOOL_NAMES)
            and (selected_names is None or definition.name in selected_names)
        ]
        if mode in WRITE_MODES:
            schemas.extend(
                {
                    "type": "function",
                    "name": tool.exposed_name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                    "strict": True,
                }
                for tool in self._mcp_tools_for(session)
            )
        return schemas

    def _selected_tool_names(
        self,
        mode: AgentMode,
        *,
        task: Any | None,
        intent: str,
    ) -> set[str] | None:
        """Keep the model's tool surface relevant without changing permissions.

        Calls without task/intent retain the full historical schema for API and
        test compatibility. Runtime turns pass both and receive a smaller,
        deterministic set. PolicyEngine remains the execution authority.
        """
        if task is None and not intent.strip():
            return None
        if mode not in {AgentMode.ACT, AgentMode.DEBUG}:
            return None

        task_text = " ".join(
            str(getattr(task, field, "") or "")
            for field in ("goal", "current_objective", "next_action", "last_error")
        )
        text = f"{intent} {task_text}".lower()
        selected = set(_DYNAMIC_CORE_TOOLS)

        if mode == AgentMode.ACT:
            selected.update(_DYNAMIC_EDIT_TOOLS)
            # File operations are a compact, coherent capability group. Keep
            # them together so a task that discovers a required rename/delete
            # mid-turn does not fall back to unsafe shell workarounds.
            selected.update(_DYNAMIC_PATH_TOOLS)
        else:
            selected.add("execute_command")

        if mode != AgentMode.ACT and any(
            hint in text
            for hint in (
                "rename",
                "renombr",
                "move ",
                "mover",
                "delete",
                "remove",
                "borrar",
                "eliminar",
                "carpeta",
                "folder",
            )
        ):
            selected.update(_DYNAMIC_PATH_TOOLS)

        process_requested = any(
            hint in text
            for hint in (
                "server",
                "process",
                "terminal",
                "start",
                "run ",
                "dev server",
                "watch",
                "logs",
                "port",
                "localhost",
                "vite",
                "next",
                "npm",
                "pnpm",
                "pytest",
                "test",
                "build",
            )
        )
        long_running_command_requested = any(
            hint in text
            for hint in (
                "npm run dev",
                "pnpm dev",
                "yarn dev",
                "bun run dev",
                "next dev",
                "vite --host",
                "vite dev",
                "dev server",
                "development server",
                "servidor de desarrollo",
                "run the server",
                "start the server",
                "arranca el servidor",
                "inicia el servidor",
                "watch mode",
                "modo watch",
            )
        )
        background_requested = any(
            hint in text
            for hint in (
                "background",
                "detached",
                "headless",
                "hidden process",
                "without showing",
                "segundo plano",
                "en background",
                "sin mostrar",
                "oculto",
                "desatendido",
                "arrière-plan",
                "sans afficher",
            )
        )
        existing_process_requested = any(
            hint in text
            for hint in (
                "proc_",
                "process_id",
                "read process",
                "stop process",
                "process output",
                "lee el proceso",
                "leer el proceso",
                "para el proceso",
                "detén el proceso",
                "detener el proceso",
            )
        )
        explicit_terminal_requested = any(
            hint in text
            for hint in (
                "in the terminal",
                "open the terminal",
                "show the terminal",
                "visible terminal",
                "en la terminal",
                "abre la terminal",
                "abre una terminal",
                "muestra la terminal",
                "terminal visible",
            )
        )
        if long_running_command_requested or background_requested or existing_process_requested:
            selected.update(_DYNAMIC_PROCESS_TOOLS)
        if explicit_terminal_requested and self.terminals is not None:
            selected.update(
                {"list_terminals", "read_terminal", "create_terminal", "run_terminal_command"}
            )
            if long_running_command_requested and not background_requested:
                selected.difference_update(_DYNAMIC_PROCESS_TOOLS)
        elif process_requested and not long_running_command_requested and self.terminals is not None:
            selected.update({"list_terminals", "read_terminal"})
        if long_running_command_requested:
            # A short command runner can tempt the model to inspect ports and
            # incorrectly treat another service as the requested dev server.
            # Keep launch requests on the visible/background lifecycle chosen above.
            selected.discard("execute_command")

        if any(
            hint in text
            for hint in (
                "browser",
                "navegador",
                "screenshot",
                "captura",
                "click",
                "visual",
                "ui",
                "website",
                "web ",
                "página",
                "pagina",
                "localhost",
            )
        ):
            selected.update(_DYNAMIC_BROWSER_TOOLS)

        if any(hint in text for hint in ("http://", "https://", "url", "docs", "documentación")):
            selected.add("fetch_url")
        return selected

    def _allowed_plugin_ids(self, session: AgentSession | None) -> tuple[str, ...] | None:
        if session is None:
            return None
        return self._session_plugins.get(session.session_id)

    def _mcp_tools_for(self, session: AgentSession | None):
        allowed = self._allowed_plugin_ids(session)
        if not allowed:
            return []
        allowed_set = set(allowed)
        return [
            tool
            for tool in self.integrations.tools()
            if tool.server_id.lower() in allowed_set
        ]

    def definition(self, name: str) -> ToolDefinition:
        definition = DEFINITIONS_BY_NAME.get(name)
        if definition is None:
            mcp_tool = self.integrations.get_tool(name)
            if mcp_tool is not None:
                return ToolDefinition(
                    name=mcp_tool.exposed_name,
                    title=mcp_tool.title,
                    description=mcp_tool.description,
                    risk=ToolRisk.EXECUTE,
                    modes=WRITE_MODES,
                    parameters=mcp_tool.parameters,
                )
        if definition is None:
            raise ValueError(f"Unknown Coloride tool: {name}")
        return definition

    async def approval_details(
        self,
        call: ModelToolCall,
        session: AgentSession,
    ) -> dict[str, Any]:
        _ACTIVE_TOOL_SESSION.set(session)
        _RELAX_PATH_POLICY.set(_is_server_scope(session))
        definition = self.definition(call.name)
        details: dict[str, Any] = {
            "tool": call.name,
            "risk": definition.risk.value,
            "cwd": session.cwd,
        }
        if call.name in _MUTATING_FILE_TOOLS:
            preview = await self._prepare_mutation(call, session)
            self._previews[(session.session_id, call.call_id)] = preview
            details.update(preview.details)
        elif call.name in {"execute_command", "start_process"}:
            details["command"] = _required_string(call.arguments, "command", limit=12_000)
            details["cwd"] = str(call.arguments.get("cwd") or ".")
        elif call.name == "run_terminal_command":
            terminal = await self.terminals.get(_required_string(call.arguments, "terminal_id", limit=80), session)
            details["command"] = _required_string(call.arguments, "command", limit=12_000)
            details["cwd"] = terminal.cwd
        elif call.name == "stop_process":
            details["processId"] = _required_string(call.arguments, "process_id", limit=80)
        elif call.name == "browser_open":
            details["url"] = _required_string(call.arguments, "url", limit=2_000)
            details["title"] = "Allow remote browser?"
        elif call.name in {"browser_click", "browser_type", "browser_press", "browser_close"}:
            details["browserId"] = _required_string(call.arguments, "browser_id", limit=80)
            if call.name == "browser_click":
                details["ref"] = _required_string(call.arguments, "ref", limit=32)
            if call.name == "browser_type":
                details["ref"] = _required_string(call.arguments, "ref", limit=32)
                details["text"] = _required_string(call.arguments, "text", limit=2_000)
            if call.name == "browser_press":
                details["key"] = _required_string(call.arguments, "key", limit=40)
        elif call.name.startswith("mcp__"):
            mcp_tool = self.integrations.get_tool(call.name)
            plugin_id = (
                mcp_tool.server_id
                if mcp_tool is not None
                else call.name.split("__")[1] if call.name.count("__") >= 2 else "plugin"
            )
            remote = (
                mcp_tool.remote_name
                if mcp_tool is not None
                else call.name.split("__")[-1]
            ).replace("_", " ")
            label = plugin_id.replace("-", " ").replace("_", " ").title()
            details["server"] = plugin_id
            details["plugin"] = plugin_id
            details["remoteTool"] = remote
            details["title"] = f"Use {label}?"
            details["command"] = remote
        else:
            path = call.arguments.get("path")
            if isinstance(path, str):
                details["path"] = path
        return details

    async def create_checkpoint(
        self,
        call: ModelToolCall,
        session: AgentSession,
    ) -> AgentCheckpoint | None:
        _ACTIVE_TOOL_SESSION.set(session)
        _RELAX_PATH_POLICY.set(_is_server_scope(session))
        if call.name not in _MUTATING_FILE_TOOLS:
            return None
        key = (session.session_id, call.call_id)
        preview = self._previews.get(key) or await self._prepare_mutation(call, session)
        self._previews[key] = preview
        return await self.checkpoints.capture(call, session, list(preview.resolved_paths))

    def discard_preview(self, session_id: str, call_id: str) -> None:
        self._previews.pop((session_id, call_id), None)

    def list_checkpoints(self, session_id: str) -> list[dict[str, Any]]:
        return [value.to_dict() for value in self.checkpoints.list(session_id)]

    async def restore_checkpoint(
        self,
        session: AgentSession,
        checkpoint_id: str,
    ) -> dict[str, Any]:
        _ACTIVE_TOOL_SESSION.set(session)
        _RELAX_PATH_POLICY.set(_is_server_scope(session))
        target = self.checkpoints.get(checkpoint_id, session.session_id)
        rollback = await self.checkpoints.capture(
            ModelToolCall(
                call_id=f"restore_{checkpoint_id}",
                name="restore_checkpoint",
                arguments={"checkpoint_id": checkpoint_id},
            ),
            session,
            [snapshot.path for snapshot in target.snapshots],
        )
        checkpoint = await self.checkpoints.restore(checkpoint_id, session.session_id)
        return {
            "checkpoint": checkpoint.to_dict(),
            "rollbackCheckpoint": rollback.to_dict() if rollback is not None else None,
        }

    async def execute(
        self,
        call: ModelToolCall,
        session: AgentSession,
    ) -> ToolExecutionResult:
        call = self.normalize_call(call)
        _ACTIVE_TOOL_SESSION.set(session)
        _RELAX_PATH_POLICY.set(_is_server_scope(session))
        definition = self.definition(call.name)
        if session.mode not in definition.modes:
            raise PermissionError(f"{call.name} is unavailable in {session.mode.value} mode")
        if call.name in _MUTATING_FILE_TOOLS:
            key = (session.session_id, call.call_id)
            preview = self._previews.pop(key, None) or await self._prepare_mutation(call, session)
            result = await self._execute_mutation(call, session, preview)
        elif call.name in {"list_terminals", "create_terminal", "read_terminal", "run_terminal_command"}:
            if self.terminals is None:
                raise RuntimeError("IDE terminals are unavailable in this host")
            arguments = dict(call.arguments)
            if call.name == "create_terminal":
                arguments["cwd"] = await self._safe_path(session.cwd, str(arguments.get("cwd") or "."), mutate=False)
                _require_within(await self.files.realpath(session.cwd), arguments["cwd"])
            if call.name == "run_terminal_command":
                arguments["command"] = _required_string(arguments, "command", limit=12_000)
            payload = await self.terminals.execute(call.name, arguments, session)
            result = ToolExecutionResult(output=json.dumps(payload, ensure_ascii=False), metadata=payload)
        elif call.name.startswith("mcp__"):
            mcp_tool = self.integrations.get_tool(call.name)
            allowed = self._allowed_plugin_ids(session)
            if (
                mcp_tool is None
                or not allowed
                or mcp_tool.server_id.lower() not in allowed
            ):
                raise PermissionError(
                    "This plugin is not added to this chat. Use /add-plugin first."
                )
            value = await self.integrations.call(call.name, call.arguments)
            result = ToolExecutionResult(
                output=_truncate(json.dumps(value, ensure_ascii=False, indent=2)),
                metadata={"integration": "mcp", "tool": call.name},
            )
        else:
            handler = getattr(self, f"_execute_{call.name}", None)
            if handler is None:
                raise ValueError(f"Coloride tool has no executor: {call.name}")
            result = await handler(call.arguments, session)
        return self._persist_large_tool_output(call, session, result)

    def normalize_call(self, call: ModelToolCall) -> ModelToolCall:
        """Repair only unambiguous, read-only argument slips before UI/policy execution.

        Models occasionally emit ``start_line=540, end_line=80`` when they mean
        "read 80 lines starting at 540".  Mutating calls are deliberately never
        inferred here: an ambiguous edit must go back to the model for a retry.
        """
        if call.name != "read_file":
            return call
        start = _optional_integer(call.arguments.get("start_line"))
        end = _optional_integer(call.arguments.get("end_line"))
        if start is None or end is None or end >= start:
            return call
        # read_tool_output already exposes a bounded line-count API (max 400),
        # which is the shape the model commonly transfers to read_file. Treat a
        # small trailing value as that count. This changes no data and cannot
        # escape the path boundary.
        if 1 <= end <= 400:
            arguments = dict(call.arguments)
            arguments["end_line"] = start + end - 1
            return ModelToolCall(call_id=call.call_id, name=call.name, arguments=arguments)
        return call

    async def refresh_integrations(self) -> list[dict[str, Any]]:
        await self.integrations.refresh(force=False)
        return self.integrations.public_status()

    def replace_integrations(self, servers: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self.integrations.replace(servers)

    def catalog(self) -> list[dict[str, object]]:
        values = tool_catalog()
        values.extend(
            {
                "id": tool.exposed_name,
                "name": tool.title,
                "description": tool.description,
                "risk": ToolRisk.EXECUTE.value,
                "modes": [AgentMode.ACT.value],
            }
            for tool in self.integrations.tools()
        )
        return values

    async def _execute_submit_plan(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        if session.mode != AgentMode.PLAN:
            raise PermissionError("submit_plan is only available in Plan mode")
        title = _required_string(arguments, "title", limit=200).strip()
        summary_raw = arguments.get("summary")
        summary = (
            summary_raw.strip()
            if isinstance(summary_raw, str) and summary_raw.strip()
            else None
        )
        raw_steps = arguments.get("steps")
        if not isinstance(raw_steps, list) or not raw_steps:
            raise ValueError("steps must be a non-empty list")
        if len(raw_steps) > MAX_PLAN_STEPS:
            raise ValueError(f"plans are limited to {MAX_PLAN_STEPS} steps")
        steps: list[AgentPlanStep] = []
        for index, item in enumerate(raw_steps, start=1):
            if not isinstance(item, dict):
                raise ValueError("each step must be an object")
            step_title = str(item.get("title") or "").strip()
            if not step_title:
                raise ValueError(f"step {index} needs a non-empty title")
            detail_raw = item.get("detail")
            detail = (
                detail_raw.strip()
                if isinstance(detail_raw, str) and detail_raw.strip()
                else None
            )
            steps.append(
                AgentPlanStep(
                    id=f"step_{index}",
                    title=step_title[:300],
                    detail=detail[:2_000] if detail else None,
                    status=AgentPlanStepStatus.PENDING,
                )
            )
        plan = AgentPlan.create(
            session_id=session.session_id,
            title=title[:200],
            summary=summary[:2_000] if summary else None,
            steps=steps,
            status=AgentPlanStatus.READY,
        )
        session.active_plan_id = plan.plan_id
        if self._store is not None:
            self._store.save_plan(plan)
            self._store.save_session(session)
        if self._on_plan_updated is not None:
            await self._on_plan_updated(plan)
        lines = [
            f"Plan submitted: {plan.title} ({len(steps)} steps).",
            "Continue in THIS same turn:",
            "- If the user asked to analyze/review/explain: follow all research steps now "
            "(read tools + update_plan_step) and answer.",
            "- If the user asked to build/fix/change code: do recon/read steps only; leave "
            "edit steps pending; then stop for the user to press Implement (you cannot edit in Plan).",
            "- Never edit files in Plan mode.",
        ]
        for step in steps:
            lines.append(f"- [{step.id}] {step.title}")
        return ToolExecutionResult(
            output="\n".join(lines),
            metadata={"planId": plan.plan_id, "stepCount": len(steps), "status": plan.status.value},
        )

    async def _execute_update_plan_step(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        if session.mode not in PLAN_UPDATE_MODES:
            raise PermissionError("update_plan_step is only available while implementing")
        if self._store is None:
            raise RuntimeError("Plan store is unavailable")
        plan = self._store.get_session_plan(session.session_id)
        if plan is None or plan.status not in {
            AgentPlanStatus.IMPLEMENTING,
            AgentPlanStatus.READY,
        }:
            raise ValueError("No active plan for this session")
        if plan.status == AgentPlanStatus.READY:
            # Start following the checklist in the same thread.
            plan.status = AgentPlanStatus.IMPLEMENTING
        step_id = _required_string(arguments, "step_id", limit=80)
        status_raw = _required_string(arguments, "status", limit=40)
        try:
            status = AgentPlanStepStatus(status_raw)
        except ValueError as exc:
            raise ValueError(f"Invalid step status: {status_raw}") from exc
        note_raw = arguments.get("note")
        note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None
        target = next((step for step in plan.steps if step.id == step_id), None)
        if target is None:
            known = ", ".join(step.id for step in plan.steps) or "(none)"
            raise ValueError(f"Unknown step_id {step_id!r}. Known: {known}")
        if status == AgentPlanStepStatus.IN_PROGRESS:
            for step in plan.steps:
                if step.id != step_id and step.status == AgentPlanStepStatus.IN_PROGRESS:
                    step.status = AgentPlanStepStatus.PENDING
        target.status = status
        if note is not None:
            target.note = note[:1_000]
        plan.refresh_completion()
        plan.updated_at = utc_now()
        self._store.save_plan(plan)
        if self._on_plan_updated is not None:
            await self._on_plan_updated(plan)
        done = sum(
            1
            for step in plan.steps
            if step.status in {AgentPlanStepStatus.DONE, AgentPlanStepStatus.SKIPPED}
        )
        return ToolExecutionResult(
            output=(
                f"Updated {step_id} → {status.value}"
                + (f" ({note})" if note else "")
                + f". Progress {done}/{len(plan.steps)} · plan {plan.status.value}."
            ),
            metadata={
                "planId": plan.plan_id,
                "stepId": step_id,
                "status": status.value,
                "planStatus": plan.status.value,
            },
        )

    async def _execute_list_files(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        root = await self._safe_path(
            session.cwd,
            str(arguments.get("path") or "."),
            mutate=False,
        )
        recursive = bool(arguments.get("recursive"))
        max_depth = max(1, min(_integer(arguments.get("max_depth"), 2), 5))
        if getattr(self.files, "mode", "ssh") == "local":
            lines: list[str] = []
            pending: list[tuple[str, int]] = [(root, 0)]
            while pending and len(lines) < MAX_LIST_ENTRIES:
                directory, depth = pending.pop(0)
                entries = await self.files.list(directory, limit=MAX_LIST_ENTRIES)
                for entry in entries:
                    relative = _relative_to(entry.path, session.cwd)
                    suffix = "/" if entry.kind == "dir" else ""
                    lines.append(f"{entry.kind:<4} {entry.size:>10} {relative}{suffix}")
                    if recursive and entry.kind == "dir" and depth + 1 < max_depth:
                        pending.append((entry.path, depth + 1))
                    if len(lines) >= MAX_LIST_ENTRIES:
                        break
            if not lines:
                return ToolExecutionResult(output="No files found.")
            if pending:
                lines.append(f"... truncated after {MAX_LIST_ENTRIES} entries")
            return ToolExecutionResult(
                output="\n".join(lines),
                metadata={"path": root, "recursive": recursive, "exitCode": 0},
            )
        quoted_root = shlex.quote(root)
        # Match Cursor-style long listings (permissions, links, owner, group, size, date, name).
        if recursive:
            command = (
                "find {root} -maxdepth {depth} -mindepth 1 "
                "\\( -type f -o -type d -o -type l \\) -print0 2>/dev/null "
                "| sort -z "
                "| xargs -0 ls -ld 2>/dev/null "
                "| head -n {limit}"
            ).format(root=quoted_root, depth=max_depth, limit=MAX_LIST_ENTRIES)
        else:
            command = f"ls -lA {quoted_root} 2>/dev/null | head -n {MAX_LIST_ENTRIES + 2}"
        output, exit_status = await self._run(command)
        cleaned = _format_ls_output(output)
        if not cleaned:
            if exit_status not in {0, 1}:
                raise ValueError(output or "Failed to list files")
            return ToolExecutionResult(output="No files found.")
        if cleaned.count("\n") + 1 >= MAX_LIST_ENTRIES:
            cleaned = f"{cleaned}\n... truncated after {MAX_LIST_ENTRIES} entries"
        return ToolExecutionResult(
            output=cleaned,
            metadata={"path": root, "recursive": recursive, "exitCode": exit_status},
        )

    async def _execute_read_file(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        path = await self._safe_path(
            session.cwd,
            _required_string(arguments, "path"),
            mutate=False,
        )
        start = _optional_integer(arguments.get("start_line")) or 1
        requested_end = _optional_integer(arguments.get("end_line"))
        project = self._project_memory.for_session(session) if self._project_memory else None
        current_etag = ""
        stat_path = getattr(self.files, "stat_path", None)
        if project is not None and callable(stat_path):
            stat = await cast(StatPath, stat_path)(path)
            current_etag = str((stat or {}).get("etag") or "")
            cached = project.get_file_awareness(path)
            if cached is not None and current_etag and cached.etag == current_etag:
                cached_range = _cached_file_range(cached, start, requested_end)
                if cached_range is not None:
                    self._memory_cache_hits[session.session_id] = (
                        self._memory_cache_hits.get(session.session_id, 0) + 1
                    )
                    return ToolExecutionResult(
                        output=str(cached_range.get("text") or "(empty file)"),
                        metadata={
                            "path": path,
                            "etag": current_etag,
                            "startLine": int(cached_range.get("startLine") or start),
                            "endLine": int(cached_range.get("endLine") or start),
                            "cached": True,
                            "symbols": cached.symbols[:100],
                        },
                    )
            elif cached is not None and cached.etag != current_etag:
                project.invalidate_file(path)

        encoded, etag, truncated = await self.files.read(path)
        if truncated:
            raise ValueError("File is larger than Coloride's 10 MB safe editing limit")
        data = base64.b64decode(encoded)
        if b"\0" in data or _looks_like_image_path(path):
            lower = path.lower()
            if any(lower.endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico")):
                raise ValueError(
                    "This is an image file — read_file cannot open binaries as text. "
                    "User-attached screenshots are already sent as vision input when pasted. "
                    "For live UI, use browser_screenshot / browser_snapshot instead."
                )
            raise ValueError(
                "Binary files cannot be read as agent text. "
                "Use the workspace path for tools that accept files, or a specialized tool."
            )
        text = data.decode("utf-8", errors="replace")
        lines = text.splitlines()
        end = requested_end or len(lines)
        if start < 1 or end < start:
            raise RecoverableToolInputError(
                "read_file needs absolute inclusive line numbers with end_line >= start_line. "
                f"Received start_line={start}, end_line={end}. Read a smaller valid range and retry."
            )
        selected = lines[start - 1 : end]
        numbered = "\n".join(
            f"{line_number:>6} | {line}"
            for line_number, line in enumerate(selected, start=start)
        )
        output = _truncate(numbered or "(empty file)")
        symbols = _extract_symbols(path, text)
        if self._symbol_provider is not None:
            with contextlib.suppress(Exception):
                lsp_symbols = await self._symbol_provider(session, path)
                if lsp_symbols:
                    symbols = lsp_symbols[:500]
        if project is not None:
            existing = project.get_file_awareness(path)
            ranges = list(existing.ranges) if existing is not None and existing.etag == etag else []
            ranges.append(
                {
                    "startLine": start,
                    "endLine": min(end, len(lines)),
                    "text": output,
                    "full": requested_end is None,
                }
            )
            project.upsert_file_awareness(
                FileAwareness(
                    path=path,
                    etag=etag,
                    content_hash=hashlib.sha256(data).hexdigest(),
                    summary=_file_summary(path, lines, symbols),
                    ranges=ranges,
                    symbols=symbols,
                )
            )
        return ToolExecutionResult(
            output=output,
            metadata={
                "path": path,
                "etag": etag,
                "startLine": start,
                "endLine": min(end, len(lines)),
                "totalLines": len(lines),
                "cached": False,
                "symbols": symbols[:100],
            },
        )

    def _persist_large_tool_output(
        self,
        call: ModelToolCall,
        session: AgentSession,
        result: ToolExecutionResult,
    ) -> ToolExecutionResult:
        """Write bulky tool bodies to disk so later prompts can spill them."""
        if self._store is None:
            return result
        output = result.output or ""
        line_count = output.count("\n") + (1 if output else 0)
        if len(output) <= 2_000 and line_count <= 80:
            return result
        try:
            output_id = self._store.write_tool_output(
                session.session_id,
                call.call_id,
                output,
                metadata={
                    "tool": call.name,
                    "exit_code": (result.metadata or {}).get("exitCode")
                    or (result.metadata or {}).get("exit_code"),
                    "duration_ms": (result.metadata or {}).get("durationMs")
                    or (result.metadata or {}).get("duration_ms"),
                },
            )
        except (OSError, ValueError, TypeError):
            return result
        metadata = dict(result.metadata or {})
        metadata["spilled"] = True
        metadata["outputId"] = output_id
        metadata["bytes"] = len(output)
        metadata["lines"] = line_count
        return ToolExecutionResult(
            output=output,
            diff=result.diff,
            metadata=metadata,
        )

    async def _execute_search_chat_history(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        if self._store is None:
            raise RuntimeError("Chat history is unavailable in this session")
        from .retrieval import format_search_report, search_conversation

        state = self._turn_retrieval.get(session.session_id)
        result = search_conversation(
            self._store,
            session.session_id,
            arguments.get("queries"),
            query=arguments.get("query"),
            limit=_optional_integer(arguments.get("limit")) or 20,
            state=state,
        )
        if state is not None:
            result["retrievedRanges"] = list(state.retrieved_ranges)
        report = format_search_report(result)
        topics = result.get("topics") or []
        return ToolExecutionResult(
            output=report,
            metadata={
                "hits": len(result.get("hits") or []),
                "scanned": result.get("scanned") or 0,
                "queries": result.get("queries") or [],
                "topics": [str(topic.get("topic") or "") for topic in topics if isinstance(topic, dict)],
                "topicCount": len(topics),
                "already": bool(result.get("already")),
                "budgetExhausted": bool(result.get("budget_exhausted")),
                "sessionRecovery": True,
            },
        )

    async def _execute_read_tool_output(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        if self._store is None:
            raise RuntimeError("Tool output store is unavailable in this session")
        output_id = _required_string(arguments, "id", limit=128)
        offset = _optional_integer(arguments.get("offset")) or 0
        limit = _optional_integer(arguments.get("limit")) or 80
        try:
            payload = self._store.read_tool_output(
                session.session_id,
                output_id,
                offset=offset,
                limit=limit,
            )
        except FileNotFoundError as exc:
            raise ValueError(str(exc)) from exc
        header = (
            f"Tool output {payload['id']}: {payload['lines']} lines, "
            f"{payload['bytes']} bytes, offset={payload['offset']}, "
            f"limit={payload['limit']}"
            + (" (truncated)" if payload.get("truncated") else "")
        )
        body = str(payload.get("text") or "")
        return ToolExecutionResult(
            output=f"{header}\n{body}".rstrip(),
            metadata={
                "id": payload["id"],
                "lines": payload["lines"],
                "bytes": payload["bytes"],
                "truncated": bool(payload.get("truncated")),
            },
        )

    async def _execute_search_files(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        query = _required_string(arguments, "query", limit=1_000)
        path = await self._safe_path(
            session.cwd,
            str(arguments.get("path") or "."),
            mutate=False,
        )
        include = str(arguments.get("include") or "*").strip() or "*"
        if "\0" in include or len(include) > 200:
            raise ValueError("Invalid search include pattern")
        mode = str(arguments.get("mode") or "auto")
        if mode not in {"auto", "literal"}:
            raise ValueError("Search mode must be auto or literal")
        limit = max(1, min(200, _optional_integer(arguments.get("max_results")) or 40))
        context = _optional_integer(arguments.get("context_lines"))
        context = 2 if context is None else max(0, min(5, context))
        case_sensitive = bool(arguments.get("case_sensitive", False))
        index_error = None
        # External searches use their requested directory as the index root.
        root = session.cwd
        if not is_path_under_roots(path, [root]):
            stat = (await self.files.stat_paths([path]))[0]
            root = path if stat.get("kind") == "dir" else str(PurePosixPath(path).parent)
        if self.search_service is not None:
            try:
                payload = await self.search_service.search(
                    root, query, kind=session.workspace_kind, connection_id=session.connection_id,
                    path=path, include=include, mode=mode, max_results=limit,
                    context_lines=context, case_sensitive=case_sensitive,
                )
                return _search_result(payload)
            except SearchConnectionError as exc:
                raise PermissionError("Search stopped because this chat's SSH connection changed") from exc
            except (OSError, RuntimeError, TimeoutError) as exc:
                # Indexing is an optimization: a missing remote Python/runtime
                # must not remove the existing literal search capability.
                index_error = f"Indexed expansion unavailable ({str(exc)[:180]}); literal fallback.\n"
        if session.workspace_kind == "local":
            from ..files.search_worker import live_search
            payload = await asyncio.to_thread(
                live_search, root, query, path=path, include=include,
                max_results=limit, case_sensitive=case_sensitive,
                mode=mode, context_lines=context,
            )
            if index_error:
                payload["index_error"] = index_error.strip()
            for match in payload.get("matches", []):
                match["path"] = str(PurePosixPath(root) / match["path"])
            return _search_result(payload)
        # No remote Python: keep a bounded literal ripgrep fallback. ripgrep
        # does not follow directory symlinks; grep -R did and bypassed ignores.
        policy = self._policy(session.cwd) or await self.policy_loader.load(session.cwd)
        excludes = " ".join(
            f"--glob {shlex.quote(f'!{pattern}')}" for pattern in policy.search_excludes()
        )
        case_flag = "" if case_sensitive else "-i "
        command = (
            "command -v rg >/dev/null 2>&1 || { "
            "printf 'Search requires python3 or ripgrep on this server.' >&2; exit 127; }; "
            "coloride_search_status=$(mktemp) || exit 2; "
            "trap 'rm -f \"$coloride_search_status\"' EXIT; "
            f"(rg {case_flag}--json --color never --hidden --max-columns 2000 "
            f"--max-count {limit + 1} --glob {shlex.quote(include)} {excludes} "
            f"-F -- {shlex.quote(query)} {shlex.quote(path)}; "
            "printf '%s' \"$?\" > \"$coloride_search_status\") | head -c 40000; "
            "printf '\n__COLORIDE_SEARCH_STATUS__'; cat \"$coloride_search_status\""
        )
        output, exit_status = await self._run(command, timeout=10)
        marker = re.search(r"__COLORIDE_SEARCH_STATUS__(\d+)", output)
        search_status = int(marker.group(1)) if marker else exit_status
        if not marker or search_status not in {0, 1, 141}:
            raise RuntimeError(f"Literal search failed (status {search_status}): {output[-500:]}")
        matches = []
        for raw in output[:marker.start()].splitlines():
            try:
                item = json.loads(raw)
            except ValueError:
                continue
            if item.get("type") != "match":
                continue
            data = item["data"]
            match_path = data.get("path", {}).get("text")
            if not match_path:
                continue
            try:
                match_path = await self._safe_path(session.cwd, match_path, mutate=False)
                policy.require_allowed(match_path)
            except (PermissionError, FileNotFoundError):
                continue
            matches.append({
                "path": match_path, "line": data["line_number"],
                "text": data.get("lines", {}).get("text", "").rstrip(), "match_type": "exact",
            })
            if len(matches) > limit:
                break
        return _search_result({
            "matches": matches[:limit], "stage": "literal_fallback",
            "truncated": len(matches) > limit or search_status == 141 or len(output) >= 40000,
            "pending": False, "index_error": index_error,
        })

    async def _prepare_mutation(
        self,
        call: ModelToolCall,
        session: AgentSession,
    ) -> MutationPreview:
        if call.name == "write_file":
            path = await self._safe_path(
                session.cwd,
                _required_string(call.arguments, "path"),
                allow_missing=True,
            )
            content = str(call.arguments.get("content") or "")
            content_bytes = content.encode("utf-8")
            if len(content_bytes) > MAX_WRITE_BYTES:
                raise ValueError("Agent writes are limited to 2 MB per tool call")
            before, etag = await self._read_text_optional(path)
            diff = _unified_diff(_relative_to(path, session.cwd), before, content)
            return MutationPreview(
                details={
                    "path": _relative_to(path, session.cwd),
                    "bytes": len(content_bytes),
                    "diff": diff,
                },
                resolved_paths=(path,),
                payload={"path": path, "content": content, "etag": etag, "diff": diff},
            )

        if call.name == "replace_in_file":
            path = await self._safe_path(
                session.cwd,
                _required_string(call.arguments, "path"),
            )
            old_text = _exact_replacement_anchor(call.arguments)
            new_text = str(call.arguments.get("new_text") or "")
            replace_all = bool(call.arguments.get("replace_all"))
            original, etag = await self._read_text(path)
            matches = original.count(old_text)
            if matches == 0:
                raise RecoverableToolInputError(
                    "The exact old_text block was not found. Read a narrow current range from the "
                    "file, then retry with a non-empty unique block copied exactly from that output."
                )
            if matches > 1 and not replace_all:
                raise RecoverableToolInputError(
                    f"old_text matched {matches} places. Read a narrow current range and retry "
                    "with a larger unique exact block, or set replace_all only when every match "
                    "must change."
                )
            updated = original.replace(old_text, new_text, -1 if replace_all else 1)
            if len(updated.encode("utf-8")) > MAX_WRITE_BYTES:
                raise ValueError("Edited file exceeds the 2 MB agent write limit")
            count = matches if replace_all else 1
            diff = _unified_diff(_relative_to(path, session.cwd), original, updated)
            return MutationPreview(
                details={
                    "path": _relative_to(path, session.cwd),
                    "replacements": count,
                    "diff": diff,
                },
                resolved_paths=(path,),
                payload={
                    "path": path,
                    "content": updated,
                    "etag": etag,
                    "diff": diff,
                    "replacements": count,
                },
            )

        if call.name == "create_directory":
            path = await self._safe_path(
                session.cwd,
                _required_string(call.arguments, "path"),
                allow_missing=True,
            )
            if path == session.cwd.rstrip("/"):
                raise ValueError("The workspace root already exists")
            relative = _relative_to(path, session.cwd)
            return MutationPreview(
                details={"path": relative, "diff": f"Create directory: {relative}/"},
                resolved_paths=(path,),
                payload={"path": path},
            )

        if call.name == "rename_path":
            old_path = await self._safe_path(
                session.cwd,
                _required_string(call.arguments, "path"),
            )
            new_name = _required_string(call.arguments, "new_name", limit=512).strip()
            if not new_name or new_name in {".", ".."}:
                raise ValueError("new_name must be a non-empty basename")
            if "/" in new_name or "\\" in new_name:
                raise ValueError("new_name must be a basename only — use move_path to change folders")
            parent = str(PurePosixPath(old_path).parent)
            new_path = await self._safe_path(
                session.cwd,
                str(PurePosixPath(parent) / new_name),
                allow_missing=True,
            )
            if old_path == session.cwd.rstrip("/"):
                raise PermissionError("The selected workspace root cannot be renamed")
            if old_path == new_path:
                raise ValueError("The source and destination names are identical")
            old_relative = _relative_to(old_path, session.cwd)
            new_relative = _relative_to(new_path, session.cwd)
            if await self._path_exists(new_path):
                raise FileExistsError(
                    f"Cannot rename to {new_relative}: that path already exists. "
                    "Choose a different new_name or delete/move the existing file first."
                )
            return MutationPreview(
                details={
                    "oldPath": old_relative,
                    "newPath": new_relative,
                    "diff": f"Rename: {old_relative} -> {new_relative}",
                },
                resolved_paths=(old_path, new_path),
                payload={"oldPath": old_path, "newPath": new_path, "action": "rename"},
            )

        if call.name == "move_path":
            old_path = await self._safe_path(
                session.cwd,
                _required_string(call.arguments, "old_path"),
            )
            new_path = await self._safe_path(
                session.cwd,
                _required_string(call.arguments, "new_path"),
                allow_missing=True,
            )
            if old_path == session.cwd.rstrip("/"):
                raise PermissionError("The selected workspace root cannot be moved")
            if old_path == new_path:
                raise ValueError("The source and destination paths are identical")
            if PurePosixPath(old_path).parent == PurePosixPath(new_path).parent:
                raise ValueError(
                    "Source and destination are in the same folder — use rename_path "
                    "to change only the basename"
                )
            old_relative = _relative_to(old_path, session.cwd)
            new_relative = _relative_to(new_path, session.cwd)
            if await self._path_exists(new_path):
                raise FileExistsError(
                    f"Cannot move to {new_relative}: that path already exists. "
                    "Choose a different destination or delete/move the existing path first."
                )
            return MutationPreview(
                details={
                    "oldPath": old_relative,
                    "newPath": new_relative,
                    "diff": f"Move: {old_relative} -> {new_relative}",
                },
                resolved_paths=(old_path, new_path),
                payload={"oldPath": old_path, "newPath": new_path, "action": "move"},
            )

        if call.name == "delete_path":
            path = await self._safe_path(
                session.cwd,
                _required_string(call.arguments, "path"),
            )
            if path == session.cwd.rstrip("/"):
                raise PermissionError("The selected workspace root cannot be deleted")
            recursive = bool(call.arguments.get("recursive"))
            relative = _relative_to(path, session.cwd)
            kind = "file"
            diff: str
            try:
                original, _etag = await self._read_text(path)
                diff = _unified_diff(relative, original, "")
            except ValueError as error:
                # Deleting a binary does not edit it as text. The preview still
                # has to succeed so the delete can be confirmed and executed.
                if "cannot be edited as agent text" not in str(error):
                    raise
                kind = "file"
                diff = f"Delete binary file: {relative}"
            except IsADirectoryError:
                kind = "dir"
                entries = await self.files.list(path, limit=MAX_CHECKPOINT_FILES + 1)
                if entries and not recursive:
                    raise ValueError(
                        "The directory is not empty; set recursive=true to delete it"
                    ) from None
                if len(entries) > MAX_CHECKPOINT_FILES:
                    raise ValueError(
                        "Directory is too large for a safe agent deletion"
                    ) from None
                diff = f"Delete directory: {relative}/ ({len(entries)} immediate entries)"
            return MutationPreview(
                details={"path": relative, "kind": kind, "recursive": recursive, "diff": diff},
                resolved_paths=(path,),
                payload={"path": path, "kind": kind, "recursive": recursive, "diff": diff},
            )

        raise ValueError(f"No mutation preview is available for {call.name}")

    async def _execute_mutation(
        self,
        call: ModelToolCall,
        session: AgentSession,
        preview: MutationPreview,
    ) -> ToolExecutionResult:
        payload = preview.payload
        if call.name in {"write_file", "replace_in_file"}:
            path = str(payload["path"])
            content = str(payload["content"])
            encoded = content.encode("utf-8")
            await self.files.write(
                path,
                base64.b64encode(encoded).decode("ascii"),
                payload.get("etag") if isinstance(payload.get("etag"), str) else None,
            )
            await self._remember_written_file(session, path, content)
            if call.name == "replace_in_file":
                count = int(payload["replacements"])
                output = (
                    f"Updated {count} exact block{'s' if count != 1 else ''} in "
                    f"{_relative_to(path, session.cwd)}."
                )
                metadata = {"path": path, "replacements": count}
            else:
                output = f"Wrote {len(encoded)} bytes to {_relative_to(path, session.cwd)}."
                metadata = {"path": path, "bytes": len(encoded)}
            return ToolExecutionResult(
                output=output,
                diff=str(payload["diff"]),
                metadata=metadata,
            )

        if call.name == "create_directory":
            path = str(payload["path"])
            # A model commonly asks for a nested route such as
            # `src/app/api/auth/apple`. mkdir() only creates one level on SSH,
            # which used to look like a workspace permission failure when an
            # intermediate directory did not exist. ensure_dir() stays within
            # the resolved workspace policy and creates only missing children.
            await self.files.ensure_dir(path)
            return ToolExecutionResult(
                output=f"Created directory {_relative_to(path, session.cwd)}/.",
                diff=str(preview.details["diff"]),
                metadata={"path": path},
            )

        if call.name in {"rename_path", "move_path"}:
            old_path = str(payload["oldPath"])
            new_path = str(payload["newPath"])
            action = str(payload.get("action") or ("rename" if call.name == "rename_path" else "move"))
            await self.files.rename(old_path, new_path)
            if self._project_memory is not None:
                project = self._project_memory.for_session(session)
                project.invalidate_file(old_path, deleted=True)
                project.invalidate_file(new_path)
            old_relative = _relative_to(old_path, session.cwd)
            new_relative = _relative_to(new_path, session.cwd)
            if action == "rename":
                output = f"Renamed {old_relative} to {new_relative}."
            else:
                output = f"Moved {old_relative} to {new_relative}."
            return ToolExecutionResult(
                output=output,
                diff=str(preview.details["diff"]),
                metadata={"oldPath": old_path, "newPath": new_path, "action": action},
            )

        if call.name == "delete_path":
            path = str(payload["path"])
            if payload["kind"] == "dir" and bool(payload["recursive"]):
                await self._delete_recursive(path, session.cwd)
            else:
                await self.files.delete(path)
            if self._project_memory is not None:
                self._project_memory.for_session(session).invalidate_file(path, deleted=True)
            return ToolExecutionResult(
                output=f"Deleted {_relative_to(path, session.cwd)}.",
                diff=str(payload["diff"]),
                metadata={"path": path},
            )

        raise ValueError(f"No mutation executor is available for {call.name}")

    async def _execute_write_file(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        path = await self._safe_path(
            session.cwd,
            _required_string(arguments, "path"),
            allow_missing=True,
        )
        content = str(arguments.get("content") or "")
        encoded = content.encode("utf-8")
        if len(encoded) > MAX_WRITE_BYTES:
            raise ValueError("Agent writes are limited to 2 MB per tool call")
        old_text = ""
        etag: str | None = None
        try:
            old_encoded, etag, truncated = await self.files.read(path)
            if truncated:
                raise ValueError("Refusing to replace a partially loaded file")
            old_text = base64.b64decode(old_encoded).decode("utf-8", errors="replace")
        except FileNotFoundError:
            pass
        await self.files.write(path, base64.b64encode(encoded).decode("ascii"), etag)
        await self._remember_written_file(session, path, content)
        diff = _unified_diff(path, old_text, content)
        return ToolExecutionResult(
            output=f"Wrote {len(encoded)} bytes to {_relative_to(path, session.cwd)}.",
            diff=diff,
            metadata={"path": path, "bytes": len(encoded)},
        )

    async def _execute_replace_in_file(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        path = await self._safe_path(session.cwd, _required_string(arguments, "path"))
        old_text = _exact_replacement_anchor(arguments)
        new_text = str(arguments.get("new_text") or "")
        replace_all = bool(arguments.get("replace_all"))
        encoded, etag, truncated = await self.files.read(path)
        if truncated:
            raise ValueError("Refusing to edit a partially loaded file")
        original = base64.b64decode(encoded).decode("utf-8", errors="strict")
        matches = original.count(old_text)
        if matches == 0:
            raise RecoverableToolInputError(
                "The exact old_text block was not found. Read a narrow current range from the file, "
                "then retry with a non-empty unique block copied exactly from that output."
            )
        if matches > 1 and not replace_all:
            raise RecoverableToolInputError(
                f"old_text matched {matches} places. Read a narrow current range and retry with "
                "a larger unique exact block, or set replace_all only when every match must change."
            )
        updated = original.replace(old_text, new_text, -1 if replace_all else 1)
        updated_bytes = updated.encode("utf-8")
        if len(updated_bytes) > MAX_WRITE_BYTES:
            raise ValueError("Edited file exceeds the 2 MB agent write limit")
        await self.files.write(
            path,
            base64.b64encode(updated_bytes).decode("ascii"),
            etag,
        )
        await self._remember_written_file(session, path, updated)
        diff = _unified_diff(path, original, updated)
        count = matches if replace_all else 1
        return ToolExecutionResult(
            output=(
                f"Updated {count} exact block{'s' if count != 1 else ''} in "
                f"{_relative_to(path, session.cwd)}."
            ),
            diff=diff,
            metadata={"path": path, "replacements": count},
        )

    async def _execute_execute_command(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        command = _required_string(arguments, "command", limit=12_000)
        if "\0" in command:
            raise ValueError("Commands cannot contain null bytes")
        cwd = await self._safe_path(
            session.cwd,
            str(arguments.get("cwd") or "."),
            mutate=False,
        )
        command_to_run = await self._sandbox_command(command, cwd, session.cwd, session=session)
        output, exit_status = await self._run(command_to_run)
        note = ""
        if exit_status != 0 and _looks_like_access_denied(output):
            note = (
                "\n\n[Coloride] Linux denied this command for the SSH user selected at connection time. "
                "Coloride will not change Linux users automatically. Report the exact failed operation."
            )
        return ToolExecutionResult(
            output=f"Exit code: {exit_status}\n{output}{note}".rstrip(),
            metadata={"exitCode": exit_status, "cwd": cwd},
        )

    async def _execute_change_workspace(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        raw = _required_string(arguments, "path", limit=1_000).strip()
        if not raw or "\0" in raw:
            raise ValueError("A non-empty workspace path is required")
        path = PurePosixPath(raw)
        active = session or _ACTIVE_TOOL_SESSION.get()
        if ".." in path.parts and not (active is not None and active.workspace_kind == "local"):
            raise PermissionError("Parent-directory traversal is not allowed")

        # Absolute path = new root anywhere on the VPS; relative = under current workspace.
        if path.is_absolute():
            candidate = str(path)
        else:
            candidate = str(PurePosixPath(session.cwd) / path)

        try:
            resolved = await self.files.realpath(candidate)
        except FileNotFoundError as error:
            raise ValueError(f"Workspace path not found: {raw}") from error

        if not await self.files.exists(resolved):
            raise ValueError(f"Workspace path not found: {raw}")

        # Must be a directory (not a file). Use the file service instead of a
        # shell probe so this also works in a local workspace, where commands
        # intentionally stay unavailable.
        metadata = await self.files.stat_path(resolved)
        if metadata.get("kind") != "dir":
            raise ValueError(f"Workspace path must be an existing directory: {resolved}")

        previous = session.cwd.rstrip("/") or "/"
        next_cwd = resolved.rstrip("/") or "/"
        if previous == next_cwd:
            return ToolExecutionResult(
                output=f"Workspace is already {next_cwd}.",
                metadata={"cwd": next_cwd, "previousCwd": previous, "unchanged": True},
            )

        session.cwd = next_cwd
        # Refresh project rules for the new root (keys match prepare / _policy).
        policy = await self.policy_loader.load(session.cwd)
        self._policies[next_cwd] = policy
        self._policies.pop(previous, None)

        return ToolExecutionResult(
            output=(
                f"Workspace changed from {previous} to {next_cwd}. "
                "Subsequent tools use this root with the same connected Linux user."
            ),
            metadata={"cwd": next_cwd, "previousCwd": previous, "unchanged": False},
        )

    async def _execute_git_status(
        self,
        _arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        workspace = await self._safe_path(session.cwd, ".", mutate=False)
        output, exit_status = await self._run(
            f"git -C {shlex.quote(workspace)} status --short --branch"
        )
        return ToolExecutionResult(
            output=f"Exit code: {exit_status}\n{output}".rstrip()
        )

    async def _execute_git_diff(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        workspace = await self._safe_path(session.cwd, ".", mutate=False)
        command = f"git -C {shlex.quote(workspace)} diff --no-ext-diff --no-color"
        if bool(arguments.get("staged")):
            command += " --cached"
        path_value = arguments.get("path")
        if isinstance(path_value, str) and path_value.strip():
            path = await self._safe_path(session.cwd, path_value)
            command += f" -- {shlex.quote(path)}"
        output, exit_status = await self._run(command)
        return ToolExecutionResult(
            output=f"Exit code: {exit_status}\n{output or '(no changes)'}".rstrip()
        )

    async def _execute_start_process(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        command = _required_string(arguments, "command", limit=12_000)
        if "\0" in command:
            raise ValueError("Commands cannot contain null bytes")
        cwd = await self._safe_path(
            session.cwd,
            str(arguments.get("cwd") or "."),
            mutate=False,
        )
        command_to_run = await self._sandbox_command(command, cwd, session.cwd, session=session)
        terminal: dict[str, Any] | None = None
        if self.terminals is not None:
            terminal = await self.terminals.execute(
                "create_terminal",
                {"cwd": cwd, "title": command[:80], "_reveal": False},
                session,
            )
            await self.terminals.execute(
                "run_terminal_command",
                {
                    "terminal_id": terminal["termId"],
                    "command": command_to_run,
                    "_reveal": False,
                },
                session,
            )
            process = self.processes.register_terminal(session.session_id, command, cwd, terminal)
        else:
            process = await self.processes.start(
                session.session_id,
                command_to_run,
                cwd,
                display_command=command,
                local=(
                    getattr(session, "workspace_kind", "ssh") == "local"
                    or getattr(self.files, "mode", "ssh") == "local"
                ),
            )
        return ToolExecutionResult(
            output=(
                f"Started process {process.process_id}. Use read_process to inspect it. "
                "The user can open the same live process from its chat row."
            ),
            metadata={**process.to_dict(), "terminal": terminal} if terminal else process.to_dict(),
        )

    async def _execute_read_process(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        process_id = _required_string(arguments, "process_id", limit=80)
        lines = max(10, min(_integer(arguments.get("lines"), 200), 2_000))
        process = self.processes.require(session.session_id, process_id)
        terminal: dict[str, Any] | None = None
        if process.backend == "terminal" and process.terminal_id and self.terminals is not None:
            terminal, output, alive = await self.terminals.process_snapshot(
                process.terminal_id, session, lines
            )
        else:
            process, output, alive = await self.processes.read(
                session.session_id,
                process_id,
                lines,
            )
        return ToolExecutionResult(
            output=f"Status: {'running' if alive else 'exited'}\n{_truncate(output)}".rstrip(),
            metadata={**process.to_dict(), "alive": alive, "terminal": terminal},
        )

    async def _execute_stop_process(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        process_id = _required_string(arguments, "process_id", limit=80)
        process = self.processes.require(session.session_id, process_id)
        terminal: dict[str, Any] | None = None
        if process.backend == "terminal" and process.terminal_id and self.terminals is not None:
            terminal = await self.terminals.interrupt(process.terminal_id, session)
        else:
            process = await self.processes.stop(session.session_id, process_id)
        return ToolExecutionResult(
            output=f"Stopped process {process.process_id}.",
            metadata={**process.to_dict(), "terminal": terminal},
        )

    async def _execute_get_diagnostics(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        path = await self._safe_path(
            session.cwd,
            str(arguments.get("path") or "."),
            mutate=False,
        )
        command = (
            f"cd -- {shlex.quote(path)} && "
            "printf '%s\\n' '== Git checks ==' && "
            "if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then "
            "git diff --check; git status --short --branch; "
            "else printf '%s\\n' 'Not a Git worktree'; fi; "
            "printf '%s\\n' '== Project files ==' && "
            "for name in package.json pyproject.toml requirements.txt Cargo.toml go.mod "
            "composer.json Makefile; do test ! -e \"$name\" || printf '%s\\n' \"$name\"; done"
        )
        output, exit_status = await self._run(command)
        return ToolExecutionResult(
            output=f"Exit code: {exit_status}\n{output}".rstrip(),
            metadata={"cwd": path, "exitCode": exit_status},
        )

    async def _execute_fetch_url(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        _ = session
        url = _required_string(arguments, "url", limit=2_000)
        value = await self.web_reader.read(url)
        return ToolExecutionResult(
            output=_truncate(str(value["text"])),
            metadata={"url": value["url"], "contentType": value["contentType"]},
        )

    def _agent_browser_owner(self, session: AgentSession) -> str:
        return f"agent:{session.session_id}"

    async def _execute_browser_open(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        url = _required_string(arguments, "url", limit=2_000)
        value = await self.browsers.open(
            url,
            owner=self._agent_browser_owner(session),
            reuse_owner=True,
        )
        snapshot = str(value.get("snapshot") or "")
        title = str(value.get("title") or "")
        final_url = str(value.get("url") or url)
        browser_id = str(value.get("browserId") or "")
        output = (
            f"Opened browser {browser_id}\n"
            f"Title: {title or '(untitled)'}\n"
            f"URL: {final_url}\n\n"
            f"{snapshot}"
        ).rstrip()
        return ToolExecutionResult(
            output=_truncate(output),
            metadata={
                "browserId": browser_id,
                "url": final_url,
                "title": title,
                "refCount": value.get("refCount"),
                "owner": value.get("owner"),
            },
        )

    async def _execute_browser_snapshot(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        _ = session
        browser_id = _required_string(arguments, "browser_id", limit=80)
        try:
            value = await self.browsers.snapshot(browser_id)
        except Exception as exc:
            raise _browser_tool_error("browser_snapshot", browser_id, exc) from exc
        snapshot = str(value.get("snapshot") or "")
        return ToolExecutionResult(
            output=_truncate(snapshot),
            metadata={
                "browserId": browser_id,
                "url": value.get("url"),
                "title": value.get("title"),
                "refCount": value.get("refCount"),
            },
        )

    async def _execute_browser_screenshot(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        _ = session
        browser_id = _required_string(arguments, "browser_id", limit=80)
        try:
            value = await self.browsers.screenshot(browser_id)
        except Exception as exc:
            raise _browser_tool_error("browser_screenshot", browser_id, exc) from exc
        title = str(value.get("title") or "")
        url = str(value.get("url") or "")
        output = f"Screenshot captured\nTitle: {title or '(untitled)'}\nURL: {url}".rstrip()
        return ToolExecutionResult(
            output=output,
            metadata={
                "browserId": browser_id,
                "url": url,
                "title": title,
                "mimeType": value.get("mimeType") or "image/png",
                "imageBase64": value.get("imageBase64") or "",
                "byteLength": value.get("byteLength"),
            },
        )

    async def _execute_browser_click(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        _ = session
        browser_id = _required_string(arguments, "browser_id", limit=80)
        ref = _required_string(arguments, "ref", limit=32)
        try:
            value = await self.browsers.click(browser_id, ref)
        except Exception as exc:
            raise _browser_tool_error("browser_click", browser_id, exc, ref=ref) from exc
        snapshot = str(value.get("snapshot") or "")
        output = (
            f"Clicked {ref}\n"
            f"URL: {value.get('url') or ''}\n\n"
            f"{snapshot}"
        ).rstrip()
        return ToolExecutionResult(
            output=_truncate(output),
            metadata={
                "browserId": browser_id,
                "ref": ref,
                "url": value.get("url"),
                "title": value.get("title"),
            },
        )

    async def _execute_browser_type(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        _ = session
        browser_id = _required_string(arguments, "browser_id", limit=80)
        ref = _required_string(arguments, "ref", limit=32)
        text = _required_string(arguments, "text", limit=20_000)
        submit = bool(arguments.get("submit"))
        try:
            value = await self.browsers.type_text(
                browser_id,
                ref,
                text,
                submit=submit,
            )
        except Exception as exc:
            raise _browser_tool_error("browser_type", browser_id, exc, ref=ref) from exc
        snapshot = str(value.get("snapshot") or "")
        output = (
            f"Typed into {ref}"
            f"{' + Enter' if submit else ''}\n"
            f"URL: {value.get('url') or ''}\n\n"
            f"{snapshot}"
        ).rstrip()
        return ToolExecutionResult(
            output=_truncate(output),
            metadata={
                "browserId": browser_id,
                "ref": ref,
                "submit": submit,
                "url": value.get("url"),
                "title": value.get("title"),
            },
        )

    async def _execute_browser_press(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        _ = session
        browser_id = _required_string(arguments, "browser_id", limit=80)
        key = _required_string(arguments, "key", limit=40)
        ref_raw = arguments.get("ref")
        # ref is optional — empty / missing means page-level keyboard.press
        ref = str(ref_raw).strip() if isinstance(ref_raw, str) and str(ref_raw).strip() else None
        try:
            value = await self.browsers.press(browser_id, key, ref)
        except Exception as exc:
            raise _browser_tool_error(
                "browser_press",
                browser_id,
                exc,
                ref=ref,
                key=key,
            ) from exc
        snapshot = str(value.get("snapshot") or "")
        output = (
            f"Pressed {key}"
            f"{f' on {ref}' if ref else ' (page-level)'}\n"
            f"URL: {value.get('url') or ''}\n\n"
            f"{snapshot}"
        ).rstrip()
        return ToolExecutionResult(
            output=_truncate(output),
            metadata={
                "browserId": browser_id,
                "key": key,
                "ref": ref or "",
                "url": value.get("url"),
                "title": value.get("title"),
            },
        )

    async def _execute_browser_close(
        self,
        arguments: dict[str, Any],
        session: AgentSession,
    ) -> ToolExecutionResult:
        _ = session
        browser_id = _required_string(arguments, "browser_id", limit=80)
        value = await self.browsers.close(browser_id)
        return ToolExecutionResult(
            output=f"Closed browser {browser_id}.",
            metadata={"browserId": browser_id, "closed": True, **{k: v for k, v in value.items() if k != "ok"}},
        )

    async def _remember_written_file(
        self,
        session: AgentSession,
        path: str,
        content: str,
    ) -> None:
        if self._project_memory is None:
            return
        project = self._project_memory.for_session(session)
        stat_path = getattr(self.files, "stat_path", None)
        etag = ""
        if callable(stat_path):
            with contextlib.suppress(Exception):
                stat = await cast(StatPath, stat_path)(path)
                etag = str((stat or {}).get("etag") or "")
        lines = content.splitlines()
        symbols = _extract_symbols(path, content)
        project.upsert_file_awareness(
            FileAwareness(
                path=path,
                etag=etag,
                content_hash=hashlib.sha256(content.encode("utf-8")).hexdigest(),
                summary=_file_summary(path, lines, symbols),
                ranges=[],
                symbols=symbols,
            )
        )

    async def _read_text(self, path: str) -> tuple[str, str]:
        encoded, etag, truncated = await self.files.read(path)
        if truncated:
            raise ValueError("Refusing to edit a partially loaded file")
        data = base64.b64decode(encoded)
        if b"\0" in data:
            raise ValueError("Binary files cannot be edited as agent text")
        return data.decode("utf-8", errors="strict"), etag

    async def _read_text_optional(self, path: str) -> tuple[str, str | None]:
        try:
            text, etag = await self._read_text(path)
            return text, etag
        except FileNotFoundError:
            return "", None

    async def _path_exists(self, path: str) -> bool:
        # Must use stat-based exists — SFTP realpath often succeeds for missing leaves.
        return await self.files.exists(path)

    async def _delete_recursive(self, path: str, workspace: str) -> None:
        policy = self._policy(workspace)
        entries = await self.files.list(path, limit=MAX_CHECKPOINT_FILES + 1)
        if len(entries) > MAX_CHECKPOINT_FILES:
            raise ValueError("Directory is too large for a safe agent deletion")
        for entry in entries:
            if policy is not None:
                policy.require_allowed(entry.path)
            if entry.kind == "dir":
                await self._delete_recursive(entry.path, workspace)
            else:
                await self.files.delete(entry.path)
        await self.files.delete(path)

    def _policy(self, workspace: str) -> WorkspacePolicy | None:
        return self._policies.get(workspace.rstrip("/") or "/")

    async def _filesystem_bounds(self, session: AgentSession | None = None) -> dict[str, Any]:
        active = session or _ACTIVE_TOOL_SESSION.get()
        if active is not None and active.workspace_kind == "local":
            return {"scope": "local", "writable": ["/"], "readable": ["/"]}
        if (
            active is None
            or getattr(active, "workspace_kind", "ssh") != "ssh"
            or normalize_filesystem_scope(active.filesystem_scope) != "server"
        ):
            root = (active.cwd if active is not None else "").rstrip("/") or "/"
            return {"scope": "workspace", "writable": [root], "readable": [root]}
        writable = list(DEFAULT_ALLOWED_ROOTS)
        readable = list(DEFAULT_BROWSE_ROOTS)
        if self._filesystem_resolver is not None:
            context = None
            with contextlib.suppress(Exception):
                context = await self._filesystem_resolver(active)
            if isinstance(context, dict):
                writable = [
                    str(item)
                    for item in (context.get("writableRoots") or writable)
                    if str(item).strip()
                ] or writable
                readable = [
                    str(item)
                    for item in (context.get("readableRoots") or readable)
                    if str(item).strip()
                ] or readable
        return {"scope": "server", "writable": writable, "readable": readable}

    async def _safe_path(
        self,
        workspace: str,
        value: str,
        *,
        allow_missing: bool = False,
        mutate: bool = True,
        session: AgentSession | None = None,
    ) -> str:
        if not value or "\0" in value:
            raise ValueError("A non-empty workspace path is required")
        path = PurePosixPath(value)
        active = session or _ACTIVE_TOOL_SESSION.get()
        if ".." in path.parts and not (active is not None and active.workspace_kind == "local"):
            raise PermissionError("Parent-directory traversal is not allowed")
        candidate = path if path.is_absolute() else PurePosixPath(workspace) / path
        workspace_real = await self.files.realpath(workspace)
        try:
            candidate_real = await self.files.realpath(str(candidate))
        except FileNotFoundError:
            if not allow_missing:
                raise
            # Resolve the closest existing parent. A creation such as
            # `src/app/api/auth/apple` may have several missing levels; using
            # only candidate.parent made nested folders fail before the file
            # service could create them safely.
            missing: list[str] = []
            cursor = candidate
            while True:
                name = cursor.name
                if name:
                    missing.append(name)
                parent = cursor.parent
                try:
                    parent_real = await self.files.realpath(str(parent))
                    candidate_real = str(PurePosixPath(parent_real).joinpath(*reversed(missing)))
                    break
                except FileNotFoundError:
                    if parent == cursor:
                        raise
                    cursor = parent
        bounds = await self._filesystem_bounds(session or _ACTIVE_TOOL_SESSION.get())
        if bounds["scope"] == "workspace":
            _require_within(workspace_real, candidate_real)
        policy = self._policy(workspace)
        if policy is not None and is_path_under_roots(candidate_real, [policy.root]):
            policy.require_allowed(candidate_real)
        return candidate_real

    async def _run(
        self,
        command: str,
        *,
        timeout: float = _COMMAND_TIMEOUT_SECONDS,
    ) -> tuple[str, int]:
        isolated = _isolate_command_stdio(command)
        try:
            result = await asyncio.wait_for(self.run_command(isolated), timeout=timeout)
        except TimeoutError:
            seconds = int(timeout or 0)
            return (
                f"Command timed out after {seconds}s without finishing. "
                "For long-running servers or watchers use start_process instead of "
                "execute_command (do not background them with &).",
                124,
            )
        stdout = _strip_known_shell_startup_noise(
            str(getattr(result, "stdout", "") or "")
        )
        stderr = _strip_known_shell_startup_noise(
            str(getattr(result, "stderr", "") or "")
        )
        output = stdout
        if stderr:
            output = f"{output}\n{stderr}" if output else stderr
        status = getattr(result, "exit_status", 0)
        return _truncate(output.strip()), int(status) if isinstance(status, int) else 0

    async def _sandbox_command(
        self,
        command: str,
        cwd: str,
        workspace: str,
        session: AgentSession | None = None,
    ) -> str:
        """Run in the requested cwd as the single connected Linux identity."""
        _ = workspace, session
        return f"cd {shlex.quote(cwd)} && {command}"


def tool_catalog() -> list[dict[str, object]]:
    return [
        {
            "id": definition.name,
            "name": definition.title,
            "description": definition.description,
            "risk": definition.risk.value,
            "modes": [mode.value for mode in AgentMode if mode in definition.modes],
        }
        for definition in TOOL_DEFINITIONS
    ]


def _search_result(payload: dict[str, Any]) -> ToolExecutionResult:
    """Bound prompt output while preserving exact/related provenance."""
    matches = payload.get("matches") or []
    header = f"Search: {payload.get('stage', 'unknown')}; {len(matches)} matches."
    if payload.get("pending"):
        header += " Index updating; results may be partial."
    if payload.get("index_error"):
        header += " " + str(payload["index_error"])[:250]
    if payload.get("expanded_terms"):
        header += " Expanded terms: " + ", ".join(payload["expanded_terms"][:24]) + "."
    lines = [header]
    size = len(header)
    clipped = bool(payload.get("truncated"))
    for match in matches:
        block = f"\n[{match.get('match_type', 'exact')}] {match['path']}:{match['line']}\n"
        context = match.get("context")
        if isinstance(context, str):
            block += context
        else:
            block += str(match.get("text", ""))
        if size + len(block) > 24_000:
            clipped = True
            break
        lines.append(block)
        size += len(block)
    if not matches:
        lines.append("No matches found in the searched files.")
    if clipped:
        lines.append("Results truncated; narrow the path or query for more specific results.")
    metadata = {key: value for key, value in payload.items() if key != "matches"}
    metadata["truncated"] = clipped
    metadata["match_count"] = len(matches)
    return ToolExecutionResult(output="\n".join(lines), metadata=metadata)


def _require_within(workspace: str, candidate: str) -> None:
    root = workspace.rstrip("/") or "/"
    if candidate != root and not candidate.startswith(f"{root.rstrip('/')}/"):
        raise PermissionError("The requested path escapes the selected workspace")


def _cached_file_range(
    awareness: FileAwareness,
    start_line: int,
    end_line: int | None,
) -> dict[str, Any] | None:
    for item in reversed(awareness.ranges):
        start = int(item.get("startLine") or 1)
        end = int(item.get("endLine") or start)
        if end_line is None:
            if start == start_line and bool(item.get("full")):
                return item
        elif start == start_line and end == end_line:
            return item
    return None


def _extract_symbols(path: str, content: str) -> list[dict[str, Any]]:
    suffix = PurePosixPath(path).suffix.casefold()
    patterns: list[tuple[str, re.Pattern[str]]] = []
    if suffix == ".py":
        patterns = [
            ("class", re.compile(r"^\s*class\s+([A-Za-z_]\w*)", re.MULTILINE)),
            ("function", re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)", re.MULTILINE)),
        ]
    elif suffix in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}:
        patterns = [
            ("class", re.compile(r"^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)", re.MULTILINE)),
            ("interface", re.compile(r"^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)", re.MULTILINE)),
            ("type", re.compile(r"^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)", re.MULTILINE)),
            (
                "function",
                re.compile(
                    r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+"
                    r"([A-Za-z_$][\w$]*)",
                    re.MULTILINE,
                ),
            ),
            ("variable", re.compile(r"^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=", re.MULTILINE)),
        ]
    elif suffix == ".go":
        patterns = [
            ("function", re.compile(r"^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)", re.MULTILINE)),
            ("type", re.compile(r"^type\s+([A-Za-z_]\w*)", re.MULTILINE)),
        ]
    elif suffix == ".rs":
        patterns = [
            ("function", re.compile(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)", re.MULTILINE)),
            ("type", re.compile(r"^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)", re.MULTILINE)),
        ]
    symbols: list[dict[str, Any]] = []
    for kind, pattern in patterns:
        for match in pattern.finditer(content):
            line = content.count("\n", 0, match.start()) + 1
            symbols.append(
                {"name": match.group(1), "kind": kind, "startLine": line, "endLine": line}
            )
            if len(symbols) >= 500:
                return symbols
    return symbols


def _file_summary(
    path: str,
    lines: list[str],
    symbols: list[dict[str, Any]],
) -> str:
    names = ", ".join(str(item.get("name") or "") for item in symbols[:20])
    summary = f"{PurePosixPath(path).name}: {len(lines)} lines"
    if names:
        summary += f"; symbols: {names}"
    return summary


def _relative_to(path: str, workspace: str) -> str:
    root = workspace.rstrip("/") or "/"
    if path == root:
        return "."
    prefix = f"{root.rstrip('/')}/"
    return path[len(prefix) :] if path.startswith(prefix) else path


def _isolate_command_stdio(command: str) -> str:
    """Keep leftover background jobs from holding the SSH or local pipe open.

    Non-interactive bash waits for every child unless job control is on, and
    `npm run dev &` still inherits the tool's stdout. Redirect the command to a
    temp file, enable job control so `&` does not pin the shell, then cat and exit.
    """
    quoted = shlex.quote(f"set -m; {command}")
    return (
        "tmp=$(mktemp /tmp/coloride-cmd.XXXXXX 2>/dev/null || mktemp -t coloride-cmd) || exit 1; "
        f"/bin/bash -lc {quoted} >\"$tmp\" 2>&1 </dev/null; "
        "coloride_command_exit_code=$?; "
        "disown -a >/dev/null 2>&1 || true; "
        "cat \"$tmp\"; "
        "rm -f \"$tmp\"; "
        "exit $coloride_command_exit_code"
    )


def _required_string(arguments: dict[str, Any], key: str, *, limit: int = 200_000) -> str:
    value = arguments.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} must be a non-empty string")
    if len(value) > limit:
        raise ValueError(f"{key} is too large")
    return value


def _exact_replacement_anchor(arguments: dict[str, Any]) -> str:
    value = arguments.get("old_text")
    if not isinstance(value, str) or not value:
        raise RecoverableToolInputError(
            "replace_in_file requires a non-empty old_text copied exactly from the current file. "
            "Read a narrow relevant range and retry. If most of the file must be replaced, use "
            "write_file instead; never use an empty replacement anchor."
        )
    if len(value) > MAX_WRITE_BYTES:
        raise RecoverableToolInputError("old_text is too large; use a smaller unique exact block")
    return value


def _looks_like_access_denied(output: str) -> bool:
    text = (output or "").lower()
    needles = (
        "permission denied",
        "operation not permitted",
        "access denied",
        "eacces",
        "eperm",
        "not permitted",
        "read-only file system",
        "cannot create",
        "sudo: a password is required",
        "sudo: a terminal is required",
        "are not in the sudoers",
        "authentication is required",
        "not allowed to",
        "outside the workspace",
        "path not allowed",
    )
    return any(n in text for n in needles)


def _looks_like_image_path(path: str) -> bool:
    lower = path.lower()
    return any(
        lower.endswith(ext)
        for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tif", ".tiff", ".heic")
    )


def _browser_tool_error(
    tool: str,
    browser_id: str,
    exc: BaseException,
    *,
    ref: str | None = None,
    key: str | None = None,
) -> RuntimeError:
    """Turn opaque browser/driver failures into actionable tool errors for the model."""
    detail = str(exc).strip() or exc.__class__.__name__
    lower = detail.lower()
    closed = isinstance(exc, LookupError | KeyError) or (
        "is not open" in lower
        or "unknown browser" in lower
        or ("no such" in lower and "browser" in lower)
    )
    if closed:
        return RuntimeError(
            f"{tool} failed: browser {browser_id!r} is not open ({detail}). "
            "Agent-owned browsers are closed when a turn is paused — "
            "call browser_open again and use the new browser_id."
        )
    bits = [f"{tool} failed"]
    if key:
        bits.append(f"key={key!r}")
    if ref:
        bits.append(f"ref={ref!r}")
    bits.append(detail)
    message = " — ".join(bits)
    if tool == "browser_press":
        message += (
            " Use Playwright key names (Enter, Tab, Escape, End, ArrowDown). "
            "Omit ref for page-level keys; pass a snapshot ref only when targeting a field."
        )
    elif ref:
        message += " Take a fresh browser_snapshot and retry with a current ref."
    return RuntimeError(message)


def _integer(value: object, default: int) -> int:
    return int(value) if isinstance(value, int | float) else default


def _optional_integer(value: object) -> int | None:
    return int(value) if isinstance(value, int | float) else None


def _strip_known_shell_startup_noise(value: str) -> str:
    """Remove provider login notices only when they prefix command output.

    Plesk writes this fixed informational block from the remote login profile.
    Anchoring the complete block at the beginning avoids deleting legitimate
    command output which merely happens to mention Plesk later.
    """
    return _PLESK_SHELL_BANNER_RE.sub("", value, count=1)


def _truncate(value: str, limit: int = MAX_TOOL_OUTPUT) -> str:
    if len(value) <= limit:
        return value
    head = limit * 2 // 3
    tail = limit - head
    return f"{value[:head]}\n... output truncated ...\n{value[-tail:]}"


def _format_ls_output(raw: str) -> str:
    """Normalize ``ls -l`` / ``ls -ld`` listings for the agent UI.

    Drops blank lines and the ``total N`` summary header that ``ls -l`` emits
    before entries, while keeping every path line intact.
    """
    if not raw:
        return ""
    lines: list[str] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        # ``ls -l`` / ``ls -la`` prefix: "total 1234"
        lower = stripped.lower()
        if lower.startswith("total "):
            rest = stripped[6:].strip().replace(",", "")
            if rest.isdigit():
                continue
        lines.append(line.rstrip())
    return "\n".join(lines)


def _unified_diff(path: str, before: str, after: str) -> str:
    diff = "".join(
        difflib.unified_diff(
            before.splitlines(keepends=True),
            after.splitlines(keepends=True),
            fromfile=f"a/{PurePosixPath(path).name}",
            tofile=f"b/{PurePosixPath(path).name}",
        )
    )
    return _truncate(diff or "(content unchanged)", MAX_DIFF_OUTPUT)


def tool_result_payload(call: ModelToolCall, result: ToolExecutionResult) -> str:
    metadata = dict(result.metadata or {})
    if metadata.get("spilled"):
        output = result.output or ""
        lines = output.splitlines()
        tail = "\n".join(lines[-80:])
        value: dict[str, Any] = {
            "ok": True,
            "id": metadata.get("outputId") or call.call_id,
            "lines": metadata.get("lines") or len(lines),
            "bytes": metadata.get("bytes") or len(output),
            "summary": f"{call.name} spilled ({len(lines)} lines)",
            "tail": tail,
            "spilled": True,
            "output": tail,
            "metadata": metadata,
        }
        return json.dumps(value, ensure_ascii=True, separators=(",", ":"))
    value = {"ok": True, "output": result.output}
    if metadata:
        value["metadata"] = metadata
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def tool_error_payload(error: Exception) -> str:
    return json.dumps(
        {"ok": False, "error": str(error)},
        ensure_ascii=True,
        separators=(",", ":"),
    )
