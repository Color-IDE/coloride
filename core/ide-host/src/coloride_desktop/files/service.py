from __future__ import annotations

import base64
import fnmatch
import re
import shlex
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any, Literal

import asyncssh

from ..models import ContentSearchMatch, Entry

# Editor open/preview budget (partial reads above this stay read-only).
MAX_EDIT_BYTES = 10 * 1024 * 1024
# Full binary upload / write budget (fonts, zip, assets dropped into the tree).
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
# Default globs skipped during content search (ripgrep --glob '!…').
DEFAULT_CONTENT_SEARCH_EXCLUDES = (
    "**/.git/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/target/**",
    "**/.venv/**",
    "**/venv/**",
    "**/__pycache__/**",
    "**/.cache/**",
)


class PartialFileWriteBlockedError(RuntimeError):
    """Raised when an editor write could overwrite a partially loaded file."""


class FileVersionRequiredError(RuntimeError):
    """Raised when replacing an existing file without a version check."""


class EditorContentTooLargeError(RuntimeError):
    """Raised when editor content exceeds the supported complete-file limit."""


@dataclass(frozen=True, slots=True)
class RemotePath:
    path: str

    def __post_init__(self) -> None:
        if not self.path.startswith("/"):
            raise ValueError("Remote paths must be absolute.")
        if "\x00" in self.path:
            raise ValueError("Remote paths cannot contain null bytes.")


class RemoteFileService:
    """Real SFTP implementation using asyncssh."""

    def __init__(
        self,
        sftp_provider: Callable[[], Awaitable[asyncssh.SFTPClient]],
        run_command: Callable[[str], Awaitable[Any]] | None = None,
        path_policy: Callable[[str, bool], None] | None = None,
    ):
        self._get_sftp = sftp_provider
        self._run_command = run_command
        self._path_policy = path_policy

    def normalize(self, path: str) -> RemotePath:
        return RemotePath(path=path)

    async def _authorize(self, path: str, *, mutate: bool) -> None:
        if self._path_policy is None:
            return
        sftp = await self._get_sftp()
        candidate = self.normalize(path).path
        if candidate == "/":
            self._path_policy(str(await sftp.realpath(candidate)), mutate)
            return

        parent = str(PurePosixPath(candidate).parent)
        parent_real = str(await sftp.realpath(parent))
        resolved = str(PurePosixPath(parent_real) / PurePosixPath(candidate).name)
        try:
            attrs = await sftp.lstat(candidate)
        except asyncssh.SFTPError as error:
            if error.code != 2:
                raise
        else:
            # Resolve the leaf itself only when it is a symlink. For regular
            # files, OpenSSH variants can return a surprising realpath while
            # the canonical parent is stable. Resolving the parent still blocks
            # escapes through symlinked directories; resolving a symlink leaf
            # blocks direct links outside the permitted roots.
            if getattr(attrs, "type", None) == 3:  # FILEXFER_TYPE_SYMLINK
                resolved = str(await sftp.realpath(candidate))
        self._path_policy(resolved, mutate)

    async def realpath(self, path: str) -> str:
        """Resolve symlinks so callers can enforce workspace boundaries."""
        sftp = await self._get_sftp()
        norm = self.normalize(path)
        await self._authorize(norm.path, mutate=False)
        try:
            resolved = await sftp.realpath(norm.path)
            return str(resolved)
        except asyncssh.SFTPError as error:
            if error.code == 2:  # FX_NO_SUCH_FILE
                raise FileNotFoundError(norm.path) from error
            raise

    async def exists(self, path: str) -> bool:
        """True only when the path is present. Prefer this over realpath for existence checks.

        OpenSSH SFTP realpath often resolves a missing leaf to the parent + name and
        succeeds, which would make rename/move falsely report "destination already exists".
        Prefer parent listdir + exact name match; fall back to stat.
        """
        sftp = await self._get_sftp()
        norm = self.normalize(path)
        await self._authorize(norm.path, mutate=False)
        remote = PurePosixPath(norm.path)
        parent = str(remote.parent)
        name = remote.name
        if name and parent:
            try:
                names = await sftp.listdir(parent)
                return name in names
            except asyncssh.SFTPError as error:
                if error.code != 2:  # FX_NO_SUCH_FILE on parent
                    # Fall through to stat for non-missing errors after trying stat.
                    pass
                else:
                    return False
        try:
            await sftp.stat(norm.path)
        except asyncssh.SFTPError as error:
            if error.code == 2:  # FX_NO_SUCH_FILE
                return False
            raise
        return True

    async def list(self, path: str, offset: int = 0, limit: int = 500) -> list[Entry]:
        sftp = await self._get_sftp()
        norm = self.normalize(path)
        await self._authorize(norm.path, mutate=False)

        try:
            entries = await sftp.listdir(norm.path)
        except asyncssh.SFTPError as e:
            if e.code == 2:  # FX_NO_SUCH_FILE
                return []
            raise

        result: list[Entry] = []
        for name in sorted(entries):
            if name in (".", ".."):
                continue
            full_path = f"{norm.path.rstrip('/')}/{name}"
            if self._path_policy is not None:
                try:
                    self._path_policy(full_path, False)
                except PermissionError:
                    continue
            try:
                stat = await sftp.stat(full_path)
                # asyncssh SFTPAttrs has .type attribute
                ftype = getattr(stat, "type", None)
                kind: Literal["file", "dir", "link"]
                if ftype == 1:  # FILEXFER_TYPE_REGULAR
                    kind = "file"
                elif ftype == 2:  # FILEXFER_TYPE_DIRECTORY
                    kind = "dir"
                elif ftype == 3:  # FILEXFER_TYPE_SYMLINK
                    kind = "link"
                else:
                    kind = "file"
                size = stat.size or 0
                mtime = datetime.fromtimestamp(stat.mtime) if stat.mtime else datetime.now(UTC)
                result.append(Entry(name=name, path=full_path, kind=kind, size=size, mtime=mtime))
            except asyncssh.SFTPError:
                # If we can't stat one entry, skip it
                continue

        # Apply pagination
        return result[offset : offset + limit]

    async def search(self, path: str, query: str, include: str = "", limit: int = 100) -> list[Entry]:
        """Find matching remote file names without executing a shell on the server."""
        sftp = await self._get_sftp()
        root = self.normalize(path).path.rstrip("/") or "/"
        await self._authorize(root, mutate=False)
        needle = query.casefold()
        pattern = include.strip() or "*"
        results: list[Entry] = []
        pending: list[tuple[str, int]] = [(root, 0)]
        visited_directories = 0
        max_directories = 250
        max_depth = 12

        while pending and len(results) < limit and visited_directories < max_directories:
            directory, depth = pending.pop()
            visited_directories += 1
            try:
                names = await sftp.listdir(directory)
            except asyncssh.SFTPError:
                continue

            for name in names:
                if name in (".", ".."):
                    continue
                full_path = f"{directory.rstrip('/')}/{name}" if directory != "/" else f"/{name}"
                try:
                    stat = await sftp.stat(full_path)
                except asyncssh.SFTPError:
                    continue

                ftype = getattr(stat, "type", None)
                if ftype == 2:
                    if depth < max_depth:
                        pending.append((full_path, depth + 1))
                    continue
                if ftype != 1 or needle not in name.casefold() or not fnmatch.fnmatch(name, pattern):
                    continue

                mtime = datetime.fromtimestamp(stat.mtime) if stat.mtime else datetime.now(UTC)
                results.append(Entry(name=name, path=full_path, kind="file", size=stat.size or 0, mtime=mtime))
                if len(results) >= limit:
                    break

        return sorted(results, key=lambda entry: entry.path.casefold())

    async def search_content(
        self,
        path: str,
        query: str,
        include: str = "",
        limit: int = 100,
        *,
        case_sensitive: bool = False,
    ) -> tuple[list[ContentSearchMatch], bool, Literal["rg", "grep", "none"]]:
        """Search file contents only (thin wrapper around unified remote search)."""
        _names, matches, _names_trunc, content_trunc, engine = await self.search_unified(
            path,
            query,
            include=include,
            name_limit=1,
            content_limit=limit,
            case_sensitive=case_sensitive,
            names=False,
            content=True,
        )
        return matches, content_trunc, engine

    async def search_unified(
        self,
        path: str,
        query: str,
        *,
        include: str = "",
        name_limit: int = 40,
        content_limit: int = 80,
        case_sensitive: bool = False,
        names: bool = True,
        content: bool = True,
    ) -> tuple[
        list[tuple[str, str]],
        list[ContentSearchMatch],
        bool,
        bool,
        Literal["rg", "grep", "none"],
    ]:
        """One SSH round-trip: filename hits + content hits (rg preferred, parallel remote jobs).

        Returns (name_hits[(name, path)], content_matches, names_truncated, content_truncated, engine).
        """
        if self._run_command is None:
            raise RuntimeError("Content search requires an SSH command runner")

        root = self.normalize(path).path
        await self._authorize(root, mutate=False)
        needle = query.strip()
        if not needle:
            return [], [], False, False, "none"
        if len(needle) > 200:
            raise ValueError("Search query is too long")
        if "\0" in needle:
            raise ValueError("Search query cannot contain null bytes")

        include_pattern = (include or "").strip() or "*"
        if "\0" in include_pattern or len(include_pattern) > 200:
            raise ValueError("Invalid include pattern")

        name_limit = max(1, min(int(name_limit), 100))
        content_limit = max(1, min(int(content_limit), 200))
        # Fetch one extra line to detect truncation without a second call.
        name_head = name_limit + 1
        content_head = content_limit + 1

        quoted_query = shlex.quote(needle)
        quoted_path = shlex.quote(root)
        quoted_include = shlex.quote(include_pattern)
        quoted_name_glob = shlex.quote(f"*{needle}*")
        case_flag_rg = "" if case_sensitive else "-i "
        case_flag_grep = "" if case_sensitive else "-i "
        name_case_rg = "" if case_sensitive else "-i "
        find_name_flag = "-name" if case_sensitive else "-iname"
        excludes = " ".join(
            f"--glob {shlex.quote(f'!{pattern}')}" for pattern in DEFAULT_CONTENT_SEARCH_EXCLUDES
        )

        # Single remote shell: detect engine once, run name+content in parallel, merge.
        # Markers keep sections separable even if a tool prints noise.
        want_names = "1" if names else "0"
        want_content = "1" if content else "0"
        command = f"""
set +e
ROOT={quoted_path}
Q={quoted_query}
INC={quoted_include}
if command -v rg >/dev/null 2>&1; then ENGINE=rg; else ENGINE=grep; fi
echo "__COLORIDE_ENGINE=$ENGINE"
if [ "{want_names}" = "1" ]; then
  (
    echo "__NAMES_BEGIN__"
    if [ "$ENGINE" = rg ]; then
      rg --files --hidden --color never {excludes} --glob "$INC" "$ROOT" 2>/dev/null \\
        | rg {name_case_rg}-F -- "$Q" 2>/dev/null \\
        | head -n {name_head}
    else
      find "$ROOT" \\
        \\( -name .git -o -name node_modules -o -name dist -o -name build -o -name .next -o -name target -o -name .venv -o -name venv -o -name __pycache__ \\) -prune -o \\
        -type f {find_name_flag} {quoted_name_glob} -print 2>/dev/null \\
        | head -n {name_head}
    fi
    echo "__NAMES_END__"
  ) &
  NAMES_PID=$!
fi
if [ "{want_content}" = "1" ]; then
  (
    echo "__CONTENT_BEGIN__"
    if [ "$ENGINE" = rg ]; then
      rg --line-number --no-heading --color never --hidden --max-columns 240 --max-columns-preview \\
        --max-count 8 {case_flag_rg}{excludes} --glob "$INC" -F -- "$Q" "$ROOT" 2>/dev/null \\
        | head -n {content_head}
    else
      grep -RInF {case_flag_grep}--exclude-dir=.git --exclude-dir=node_modules \\
        --exclude-dir=dist --exclude-dir=build --exclude-dir=.next \\
        --exclude-dir=target --exclude-dir=.venv --exclude-dir=venv \\
        --exclude-dir=__pycache__ --include="$INC" -- "$Q" "$ROOT" 2>/dev/null \\
        | head -n {content_head}
    fi
    echo "__CONTENT_END__"
  ) &
  CONTENT_PID=$!
fi
[ -n "${{NAMES_PID:-}}" ] && wait "$NAMES_PID"
[ -n "${{CONTENT_PID:-}}" ] && wait "$CONTENT_PID"
true
""".strip()

        result = await self._run_command(command)
        text = _ssh_stdout_text(result)

        engine: Literal["rg", "grep", "none"] = "none"
        name_lines: list[str] = []
        content_lines: list[str] = []
        section: str | None = None
        for raw_line in text.splitlines():
            line = raw_line.rstrip("\r")
            if line.startswith("__COLORIDE_ENGINE="):
                value = line.split("=", 1)[1].strip()
                if value in ("rg", "grep"):
                    engine = value  # type: ignore[assignment]
                continue
            if line == "__NAMES_BEGIN__":
                section = "names"
                continue
            if line == "__NAMES_END__":
                section = None
                continue
            if line == "__CONTENT_BEGIN__":
                section = "content"
                continue
            if line == "__CONTENT_END__":
                section = None
                continue
            if not line.strip():
                continue
            if section == "names":
                name_lines.append(line.strip())
            elif section == "content":
                content_lines.append(line)

        name_hits: list[tuple[str, str]] = []
        names_truncated = len(name_lines) > name_limit
        for file_path in name_lines[:name_limit]:
            path_value = file_path
            if not path_value.startswith("/"):
                path_value = f"{root.rstrip('/')}/{path_value.lstrip('./')}" if root != "/" else f"/{path_value.lstrip('./')}"
            while "//" in path_value:
                path_value = path_value.replace("//", "/")
            name_value = path_value.rsplit("/", 1)[-1] or path_value
            name_hits.append((name_value, path_value))

        matches = _parse_content_search_output(content_lines, root_path=root, limit=content_limit)
        content_truncated = len(content_lines) > content_limit
        return name_hits, matches, names_truncated, content_truncated, engine

    async def stat_path(self, path: str) -> dict[str, Any]:
        """Lightweight probe: exists/kind/size/mtime/etag without reading content."""
        sftp = await self._get_sftp()
        norm = self.normalize(path)
        await self._authorize(norm.path, mutate=False)
        try:
            stat = await sftp.stat(norm.path)
        except asyncssh.SFTPError as e:
            if e.code == 2:  # FX_NO_SUCH_FILE
                return {
                    "path": norm.path,
                    "exists": False,
                    "kind": None,
                    "size": None,
                    "mtime": None,
                    "etag": None,
                }
            raise

        ftype = getattr(stat, "type", None)
        kind: Literal["file", "dir", "link"]
        if ftype == 2:
            kind = "dir"
        elif ftype == 3:
            kind = "link"
        else:
            kind = "file"
        size = int(stat.size or 0)
        mtime = int(stat.mtime) if stat.mtime else 0
        etag = f"{size}-{mtime}" if kind != "dir" else f"dir-{mtime}-{size}"
        return {
            "path": norm.path,
            "exists": True,
            "kind": kind,
            "size": size,
            "mtime": mtime,
            "etag": etag,
        }

    async def stat_paths(self, paths: list[str]) -> list[dict[str, Any]]:
        """Batch version of stat_path (sequential over one SFTP session)."""
        # Deduplicate while preserving order.
        seen: set[str] = set()
        ordered: list[str] = []
        for path in paths:
            if not path or path in seen:
                continue
            seen.add(path)
            ordered.append(path)
        results: list[dict[str, Any]] = []
        for path in ordered:
            results.append(await self.stat_path(path))
        return results

    async def read(self, path: str) -> tuple[str, str, bool]:
        """Returns (base64_content, etag, truncated)"""
        sftp = await self._get_sftp()
        norm = self.normalize(path)
        await self._authorize(norm.path, mutate=False)

        try:
            stat = await sftp.stat(norm.path)
            ftype = getattr(stat, "type", None)
            if ftype == 2:  # FILEXFER_TYPE_DIRECTORY
                raise IsADirectoryError(norm.path)
            size = stat.size or 0
            mtime = int(stat.mtime) if stat.mtime else 0
            etag = f"{size}-{mtime}"

            async with sftp.open(norm.path, "rb") as f:
                data = await f.read(MAX_EDIT_BYTES + 1)
                truncated = len(data) > MAX_EDIT_BYTES
                content = data[:MAX_EDIT_BYTES]
                b64 = base64.b64encode(content).decode("ascii")
                return b64, etag, truncated
        except asyncssh.SFTPError as e:
            if e.code == 2:  # FX_NO_SUCH_FILE
                raise FileNotFoundError(norm.path) from e
            raise

    async def ensure_dir(self, path: str) -> None:
        """Create directory and missing parents (idempotent)."""
        sftp = await self._get_sftp()
        norm = self.normalize(path)
        parts = PurePosixPath(norm.path).parts
        built = ""
        for part in parts:
            if part == "/":
                built = "/"
                continue
            built = f"{built.rstrip('/')}/{part}"
            try:
                await sftp.stat(built)
                continue
            except asyncssh.SFTPError as error:
                if error.code != 2:  # FX_NO_SUCH_FILE
                    raise
            # Do not call mkdir on existing ancestors such as /home or /var.
            # Restricted access may browse those anchors but must never mutate
            # them; only genuinely missing descendants need authorization.
            await self.mkdir(built)

    async def write(self, path: str, content_b64: str, etag: str | None = None) -> str:
        """Writes base64 content. Returns new etag."""
        sftp = await self._get_sftp()
        norm = self.normalize(path)
        await self._authorize(norm.path, mutate=True)

        try:
            current_stat = None
            try:
                current_stat = await sftp.stat(norm.path)
            except asyncssh.SFTPError as e:
                if e.code != 2:  # FX_NO_SUCH_FILE
                    raise

            # Existing files larger than the editor read limit are only partially
            # loaded. Never let a partial buffer overwrite the full remote file.
            if current_stat is not None and (current_stat.size or 0) > MAX_EDIT_BYTES:
                raise PartialFileWriteBlockedError(norm.path)

            if current_stat is not None and etag is None:
                raise FileVersionRequiredError(norm.path)

            # Check etag if provided
            if etag is not None:
                if current_stat is None:
                    raise RuntimeError("etag_mismatch")
                current_size = current_stat.size or 0
                current_mtime = int(current_stat.mtime) if current_stat.mtime else 0
                current_etag = f"{current_size}-{current_mtime}"
                if current_etag != etag:
                    raise RuntimeError("etag_mismatch")

            data = base64.b64decode(content_b64)
            if len(data) > MAX_UPLOAD_BYTES:
                raise EditorContentTooLargeError(norm.path)

            # New files / uploads: make sure the parent folder exists (drop/paste).
            parent = str(PurePosixPath(norm.path).parent)
            if parent and parent not in (".", "/"):
                await self.ensure_dir(parent)

            async with sftp.open(norm.path, "wb") as f:
                await f.write(data)

            # Get new stat for etag
            new_stat = await sftp.stat(norm.path)
            new_size = new_stat.size or 0
            new_mtime = int(new_stat.mtime) if new_stat.mtime else 0
            return f"{new_size}-{new_mtime}"

        except asyncssh.SFTPError as e:
            if e.code in (3, 7):  # FX_PERMISSION_DENIED, FX_WRITE_PROTECT
                raise PermissionError(norm.path) from e
            # Missing parent directory, etc.
            if e.code == 2:  # FX_NO_SUCH_FILE
                raise FileNotFoundError(norm.path) from e
            raise

    async def mkdir(self, path: str) -> None:
        sftp = await self._get_sftp()
        norm = self.normalize(path)
        await self._authorize(norm.path, mutate=True)
        try:
            await sftp.mkdir(norm.path)
        except asyncssh.SFTPError as e:
            if e.code in (3, 7):  # FX_PERMISSION_DENIED, FX_WRITE_PROTECT
                raise PermissionError(norm.path) from e
            if e.code == 11:  # FX_FILE_ALREADY_EXISTS
                # idempotent-ish: if dir exists, ok
                return
            # FX_FAILURE often means the path already exists as a directory on some servers
            if e.code == 4:
                try:
                    st = await sftp.stat(norm.path)
                    if getattr(st, "type", None) == 2:
                        return
                except Exception:
                    pass
            raise

    async def delete(self, path: str, *, recursive: bool = False) -> None:
        sftp = await self._get_sftp()
        norm = self.normalize(path)
        await self._authorize(norm.path, mutate=True)
        try:
            # Never follow a symlink while deleting recursively. A workspace
            # symlink may point outside the permitted tree; lstat makes it a
            # removable link rather than a directory to traverse.
            st = await sftp.lstat(norm.path)
            is_dir = getattr(st, "type", None) == 2  # FILEXFER_TYPE_DIRECTORY
            if is_dir:
                if recursive:
                    # Delete in pages from the beginning: every removed entry
                    # shifts the next entries into the first page. Recursing
                    # through this method keeps policy checks at every level.
                    while True:
                        entries = await self.list(norm.path, limit=500)
                        if not entries:
                            break
                        for entry in entries:
                            await self.delete(entry.path, recursive=True)
                try:
                    await sftp.rmdir(norm.path)
                except asyncssh.SFTPError as e:
                    if e.code in (18, 4):  # FX_DIR_NOT_EMPTY, FX_FAILURE
                        # verify it's actually not empty
                        try:
                            names = await sftp.listdir(norm.path)
                            if any(n not in (".", "..") for n in names):
                                raise RuntimeError("directory not empty")
                        except Exception as exc:
                            raise RuntimeError("directory not empty") from exc
                    raise
            else:
                await sftp.remove(norm.path)
        except asyncssh.SFTPError as e:
            if e.code == 2:  # FX_NO_SUCH_FILE
                raise FileNotFoundError(norm.path) from e
            if e.code in (3, 7, 17):  # FX_PERMISSION_DENIED, FX_WRITE_PROTECT, FX_CANNOT_DELETE
                raise PermissionError(norm.path) from e
            if e.code in (18, 4):  # FX_DIR_NOT_EMPTY, FX_FAILURE
                raise RuntimeError("directory not empty") from e
            raise

    async def rename(self, old_path: str, new_path: str) -> None:
        sftp = await self._get_sftp()
        old_norm = self.normalize(old_path)
        new_norm = self.normalize(new_path)
        await self._authorize(old_norm.path, mutate=True)
        await self._authorize(new_norm.path, mutate=True)
        if old_norm.path == new_norm.path:
            return
        if await self.exists(new_norm.path):
            raise FileExistsError(f"The destination already exists: {new_norm.path}")
        try:
            await sftp.rename(old_norm.path, new_norm.path)
        except asyncssh.SFTPError as e:
            if e.code == 2:  # FX_NO_SUCH_FILE
                raise FileNotFoundError(old_norm.path) from e
            if e.code == 11:  # FX_FILE_ALREADY_EXISTS
                raise FileExistsError(f"The destination already exists: {new_norm.path}") from e
            if e.code in (3, 7):  # FX_PERMISSION_DENIED, FX_WRITE_PROTECT
                raise PermissionError(old_norm.path) from e
            # Some servers report collisions as FX_FAILURE with this wording.
            detail = str(e).lower()
            if "already exists" in detail or "file exists" in detail:
                raise FileExistsError(f"The destination already exists: {new_norm.path}") from e
            raise

    async def copy(self, source_path: str, dest_path: str) -> None:
        """Copy a remote file or directory tree to a new path (recursive for dirs)."""
        sftp = await self._get_sftp()
        src = self.normalize(source_path)
        dst = self.normalize(dest_path)
        await self._authorize(src.path, mutate=False)
        await self._authorize(dst.path, mutate=True)
        if src.path == dst.path:
            raise ValueError("Source and destination paths are the same.")

        # Refuse to copy a directory into itself / a descendant.
        src_prefix = src.path.rstrip("/")
        dst_prefix = dst.path.rstrip("/")
        if dst_prefix == src_prefix or dst_prefix.startswith(f"{src_prefix}/"):
            raise ValueError("Cannot copy a folder into itself or a subfolder.")

        if await self.exists(dst.path):
            raise FileExistsError(f"The destination already exists: {dst.path}")

        try:
            await self._copy_path(sftp, src.path, dst.path)
        except asyncssh.SFTPError as e:
            if e.code == 2:  # FX_NO_SUCH_FILE
                raise FileNotFoundError(src.path) from e
            if e.code == 11:  # FX_FILE_ALREADY_EXISTS
                raise FileExistsError(f"The destination already exists: {dst.path}") from e
            if e.code in (3, 7):  # FX_PERMISSION_DENIED, FX_WRITE_PROTECT
                raise PermissionError(src.path) from e
            detail = str(e).lower()
            if "already exists" in detail or "file exists" in detail:
                raise FileExistsError(f"The destination already exists: {dst.path}") from e
            raise

    async def _copy_path(self, sftp: asyncssh.SFTPClient, source: str, dest: str) -> None:
        try:
            st = await sftp.stat(source)
        except asyncssh.SFTPError as e:
            if e.code == 2:  # FX_NO_SUCH_FILE
                raise FileNotFoundError(source) from e
            raise

        is_dir = getattr(st, "type", None) == 2  # FILEXFER_TYPE_DIRECTORY
        if is_dir:
            try:
                await sftp.mkdir(dest)
            except asyncssh.SFTPError as e:
                if e.code == 11:  # FX_FILE_ALREADY_EXISTS
                    raise FileExistsError(f"The destination already exists: {dest}") from e
                if e.code in (3, 7):
                    raise PermissionError(dest) from e
                raise

            try:
                names = await sftp.listdir(source)
            except asyncssh.SFTPError as e:
                if e.code in (3, 7):
                    raise PermissionError(source) from e
                raise

            for name in names:
                if name in (".", ".."):
                    continue
                child_src = f"{source.rstrip('/')}/{name}"
                child_dst = f"{dest.rstrip('/')}/{name}"
                await self._copy_path(sftp, child_src, child_dst)
            return

        # Regular file / symlink / other: stream bytes.
        chunk_size = 64 * 1024
        try:
            async with sftp.open(source, "rb") as src_file:
                async with sftp.open(dest, "wb") as dst_file:
                    while True:
                        chunk = await src_file.read(chunk_size)
                        if not chunk:
                            break
                        await dst_file.write(chunk)
        except asyncssh.SFTPError as e:
            if e.code == 2:
                raise FileNotFoundError(source) from e
            if e.code in (3, 7):
                raise PermissionError(source) from e
            raise


def _ssh_stdout_text(result: Any) -> str:
    stdout = getattr(result, "stdout", None)
    if stdout is None:
        stdout = result if isinstance(result, str) else ""
    if isinstance(stdout, bytes):
        return stdout.decode("utf-8", errors="replace")
    return str(stdout or "")


_CONTENT_MATCH_RE = re.compile(r"^(?P<path>.+?):(?P<line>\d+):(?P<text>.*)$")


def _parse_content_search_output(
    lines: list[str],
    *,
    root_path: str,
    limit: int,
) -> list[ContentSearchMatch]:
    """Parse `path:line:text` lines from rg/grep. Handles Windows-drive-less POSIX paths."""
    matches: list[ContentSearchMatch] = []
    root = root_path.rstrip("/") or "/"

    for line in lines:
        if len(matches) >= limit:
            break
        # rg/grep format: /abs/path:12:content  (path may contain colons rarely — take last :digits: split carefully)
        match = _CONTENT_MATCH_RE.match(line)
        if not match:
            # Fallback: split from the right for line number.
            parts = line.rsplit(":", 2)
            if len(parts) < 3 or not parts[1].isdigit():
                continue
            file_path, line_s, text = parts[0], parts[1], parts[2]
        else:
            file_path = match.group("path")
            line_s = match.group("line")
            text = match.group("text")

        try:
            line_no = int(line_s)
        except ValueError:
            continue
        if line_no < 1:
            continue

        # Normalize to absolute path under root when rg prints relative paths.
        path = file_path.strip()
        if not path.startswith("/"):
            path = f"{root}/{path.lstrip('./')}" if root != "/" else f"/{path.lstrip('./')}"

        # Collapse accidental double slashes.
        while "//" in path:
            path = path.replace("//", "/")

        cleaned = text.replace("\t", " ").rstrip()
        if len(cleaned) > 300:
            cleaned = f"{cleaned[:297]}..."

        matches.append(
            ContentSearchMatch(
                path=path,
                line=line_no,
                text=cleaned,
            )
        )

    return matches
