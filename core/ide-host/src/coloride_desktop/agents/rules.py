from __future__ import annotations

import base64
import fnmatch
from dataclasses import dataclass
from pathlib import PurePosixPath

from ..files.service import RemoteFileService

RULE_FILES = (".coloriderules", ".coloride/rules.md")
IGNORE_FILES = (".colorideignore", ".gitignore")
DEFAULT_IGNORE_PATTERNS = (
    ".git/",
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "id_rsa",
    "id_ed25519",
    "**/.ssh/",
)
MAX_RULE_CHARACTERS = 24_000
MAX_IGNORE_CHARACTERS = 64_000


@dataclass(frozen=True, slots=True)
class IgnoreRule:
    pattern: str
    negated: bool = False


@dataclass(frozen=True, slots=True)
class WorkspacePolicy:
    root: str
    instructions: str
    ignore_rules: tuple[IgnoreRule, ...]

    def is_ignored(self, path: str) -> bool:
        relative = _relative(path, self.root)
        ignored = False
        for rule in self.ignore_rules:
            if _matches(relative, rule.pattern):
                ignored = not rule.negated
        return ignored

    def require_allowed(self, path: str) -> None:
        if self.is_ignored(path):
            raise PermissionError(
                f"The path {_relative(path, self.root)!r} is blocked by Coloride ignore rules"
            )

    def search_excludes(self) -> tuple[str, ...]:
        """Return positive ignore rules as ripgrep-compatible exclusion globs."""
        values: list[str] = []
        for rule in self.ignore_rules:
            if rule.negated:
                continue
            pattern = rule.pattern.strip().replace("\\", "/").lstrip("/")
            if not pattern:
                continue
            if pattern.endswith("/"):
                pattern = f"{pattern}**"
            values.append(pattern)
        return tuple(dict.fromkeys(values))


class WorkspacePolicyLoader:
    def __init__(self, files: RemoteFileService) -> None:
        self.files = files

    async def load(self, workspace: str) -> WorkspacePolicy:
        rule_sections: list[str] = []
        for relative in RULE_FILES:
            content = await self._read_optional(workspace, relative, MAX_RULE_CHARACTERS)
            if content:
                rule_sections.append(f"Rules from {relative}:\n{content}")

        ignore_rules = [IgnoreRule(pattern) for pattern in DEFAULT_IGNORE_PATTERNS]
        for relative in IGNORE_FILES:
            content = await self._read_optional(workspace, relative, MAX_IGNORE_CHARACTERS)
            if content:
                ignore_rules.extend(_parse_ignore_rules(content))

        return WorkspacePolicy(
            root=workspace.rstrip("/") or "/",
            instructions="\n\n".join(rule_sections),
            ignore_rules=tuple(ignore_rules),
        )

    async def _read_optional(self, workspace: str, relative: str, limit: int) -> str:
        path = f"{workspace.rstrip('/')}/{relative}"
        try:
            encoded, _etag, truncated = await self.files.read(path)
        except (FileNotFoundError, IsADirectoryError, PermissionError):
            return ""
        if truncated:
            return ""
        data = base64.b64decode(encoded)
        if b"\0" in data:
            return ""
        return data.decode("utf-8", errors="replace")[:limit].strip()


def _parse_ignore_rules(content: str) -> list[IgnoreRule]:
    rules: list[IgnoreRule] = []
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        negated = line.startswith("!")
        if negated:
            line = line[1:].strip()
        if line:
            rules.append(IgnoreRule(pattern=line, negated=negated))
    return rules


def _matches(path: str, pattern: str) -> bool:
    normalized = pattern.strip().replace("\\", "/")
    if not normalized:
        return False
    anchored = normalized.startswith("/")
    normalized = normalized.lstrip("/")
    directory = normalized.endswith("/")
    normalized = normalized.rstrip("/")
    if not normalized:
        return False

    candidates = [path]
    if not anchored and "/" not in normalized:
        candidates.extend(PurePosixPath(path).parts)
    if directory:
        return any(
            candidate == normalized
            or candidate.startswith(f"{normalized}/")
            or f"/{normalized}/" in f"/{candidate}/"
            for candidate in candidates
        )
    return any(
        fnmatch.fnmatchcase(candidate, normalized)
        or fnmatch.fnmatchcase(candidate, f"**/{normalized}")
        for candidate in candidates
    )


def _relative(path: str, root: str) -> str:
    normalized_root = root.rstrip("/") or "/"
    if path == normalized_root:
        return "."
    prefix = f"{normalized_root.rstrip('/')}/"
    value = path[len(prefix) :] if path.startswith(prefix) else path.lstrip("/")
    return value.replace("\\", "/")
