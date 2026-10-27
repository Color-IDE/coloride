from __future__ import annotations

import base64
from typing import cast

import asyncssh
import pytest

from coloride_desktop.files.service import (
    MAX_EDIT_BYTES,
    FileVersionRequiredError,
    PartialFileWriteBlockedError,
    RemoteFileService,
)


class FakeAttrs:
    type = 1
    size = MAX_EDIT_BYTES + 1
    mtime = 1


class FakeSFTP:
    def __init__(self, size: int = MAX_EDIT_BYTES + 1) -> None:
        self.open_called = False
        self.size = size

    async def stat(self, path: str) -> FakeAttrs:
        _ = path
        attrs = FakeAttrs()
        attrs.size = self.size
        return attrs

    def open(self, path: str, mode: str):
        _ = (path, mode)
        self.open_called = True
        raise AssertionError("Large files must be rejected before they are opened for writing")


class AuthorizationFakeSFTP:
    def __init__(self, *, leaf_type: int | None = 1) -> None:
        self.leaf_type = leaf_type
        self.realpath_calls: list[str] = []

    async def realpath(self, path: str) -> str:
        self.realpath_calls.append(path)
        if path == "/home/coloride/workspaces/app/test-files":
            return path
        if path == "/home/coloride/workspaces/app/test-files/test.js":
            return "/outside/symlink-target.js"
        return path

    async def lstat(self, path: str) -> CopyFakeAttrs:
        _ = path
        if self.leaf_type is None:
            raise asyncssh.SFTPError(2, "missing")
        return CopyFakeAttrs(ftype=self.leaf_type)


@pytest.mark.asyncio
@pytest.mark.parametrize("leaf_type", [None, 1])
async def test_authorize_uses_canonical_parent_for_normal_new_or_existing_file(
    leaf_type: int | None,
) -> None:
    sftp = AuthorizationFakeSFTP(leaf_type=leaf_type)
    authorized: list[tuple[str, bool]] = []

    async def provide_sftp() -> asyncssh.SFTPClient:
        return cast(asyncssh.SFTPClient, sftp)

    service = RemoteFileService(
        provide_sftp,
        path_policy=lambda path, mutate: authorized.append((path, mutate)),
    )
    await service._authorize("/home/coloride/workspaces/app/test-files/test.js", mutate=True)

    assert authorized == [("/home/coloride/workspaces/app/test-files/test.js", True)]
    assert sftp.realpath_calls == ["/home/coloride/workspaces/app/test-files"]


@pytest.mark.asyncio
async def test_authorize_resolves_symlink_leaf_target() -> None:
    sftp = AuthorizationFakeSFTP(leaf_type=3)
    authorized: list[tuple[str, bool]] = []

    async def provide_sftp() -> asyncssh.SFTPClient:
        return cast(asyncssh.SFTPClient, sftp)

    service = RemoteFileService(
        provide_sftp,
        path_policy=lambda path, mutate: authorized.append((path, mutate)),
    )
    await service._authorize("/home/coloride/workspaces/app/test-files/test.js", mutate=True)

    assert authorized == [("/outside/symlink-target.js", True)]
    assert sftp.realpath_calls == [
        "/home/coloride/workspaces/app/test-files",
        "/home/coloride/workspaces/app/test-files/test.js",
    ]


class EnsureDirFakeSFTP:
    def __init__(self) -> None:
        self.directories = {
            "/home",
            "/home/coloride",
            "/home/coloride/workspaces",
            "/home/coloride/workspaces/app",
        }
        self.mkdir_calls: list[str] = []

    async def realpath(self, path: str) -> str:
        return path

    async def lstat(self, path: str) -> CopyFakeAttrs:
        if path not in self.directories:
            raise asyncssh.SFTPError(2, "missing")
        return CopyFakeAttrs(ftype=2)

    async def stat(self, path: str) -> CopyFakeAttrs:
        return await self.lstat(path)

    async def mkdir(self, path: str) -> None:
        self.mkdir_calls.append(path)
        self.directories.add(path)


@pytest.mark.asyncio
async def test_ensure_dir_does_not_mutate_existing_restricted_ancestors() -> None:
    sftp = EnsureDirFakeSFTP()
    authorized_mutations: list[str] = []

    async def provide_sftp() -> asyncssh.SFTPClient:
        return cast(asyncssh.SFTPClient, sftp)

    def enforce_path(path: str, mutate: bool) -> None:
        if mutate and not (path == "/home/coloride" or path.startswith("/home/coloride/")):
            raise PermissionError(path)
        if mutate:
            authorized_mutations.append(path)

    service = RemoteFileService(provide_sftp, path_policy=enforce_path)
    await service.ensure_dir("/home/coloride/workspaces/app/test-files")

    assert sftp.mkdir_calls == ["/home/coloride/workspaces/app/test-files"]
    assert "/home" not in authorized_mutations


@pytest.mark.asyncio
async def test_ensure_dir_authorizes_each_missing_nested_child() -> None:
    sftp = EnsureDirFakeSFTP()
    authorized_mutations: list[str] = []

    async def provide_sftp() -> asyncssh.SFTPClient:
        return cast(asyncssh.SFTPClient, sftp)

    def enforce_path(path: str, mutate: bool) -> None:
        if mutate and not path.startswith("/home/coloride/workspaces/app/"):
            raise PermissionError(path)
        if mutate:
            authorized_mutations.append(path)

    service = RemoteFileService(provide_sftp, path_policy=enforce_path)
    await service.ensure_dir("/home/coloride/workspaces/app/src/app/api/auth/apple")

    expected = [
        "/home/coloride/workspaces/app/src",
        "/home/coloride/workspaces/app/src/app",
        "/home/coloride/workspaces/app/src/app/api",
        "/home/coloride/workspaces/app/src/app/api/auth",
        "/home/coloride/workspaces/app/src/app/api/auth/apple",
    ]
    assert sftp.mkdir_calls == expected
    assert authorized_mutations == expected


@pytest.mark.asyncio
async def test_write_blocks_overwriting_a_partially_loaded_large_file() -> None:
    sftp = FakeSFTP()

    async def provide_sftp() -> asyncssh.SFTPClient:
        return cast(asyncssh.SFTPClient, sftp)

    service = RemoteFileService(provide_sftp)

    with pytest.raises(PartialFileWriteBlockedError):
        await service.write("/large.log", base64.b64encode(b"partial").decode(), "etag")

    assert sftp.open_called is False


@pytest.mark.asyncio
async def test_write_requires_etag_before_overwriting_an_existing_file() -> None:
    sftp = FakeSFTP(size=20)

    async def provide_sftp() -> asyncssh.SFTPClient:
        return cast(asyncssh.SFTPClient, sftp)

    service = RemoteFileService(provide_sftp)

    with pytest.raises(FileVersionRequiredError):
        await service.write("/existing.txt", base64.b64encode(b"replacement").decode())

    assert sftp.open_called is False


class CopyFakeFile:
    def __init__(self, data: bytes = b"") -> None:
        self.data = bytearray(data)
        self._pos = 0

    async def read(self, n: int = -1) -> bytes:
        if n < 0:
            chunk = bytes(self.data[self._pos :])
            self._pos = len(self.data)
            return chunk
        chunk = bytes(self.data[self._pos : self._pos + n])
        self._pos += len(chunk)
        return chunk

    async def write(self, data: bytes) -> int:
        self.data.extend(data)
        return len(data)

    async def __aenter__(self) -> CopyFakeFile:
        return self

    async def __aexit__(self, *args: object) -> None:
        _ = args


class CopyFakeAttrs:
    def __init__(self, ftype: int = 1, size: int = 0) -> None:
        self.type = ftype
        self.size = size
        self.mtime = 1


class CopyFakeSFTP:
    def __init__(self) -> None:
        # path -> ("file", bytes) | ("dir", None)
        self.nodes: dict[str, tuple[str, bytes | None]] = {
            "/src": ("dir", None),
            "/src/a.txt": ("file", b"hello"),
            "/src/nested": ("dir", None),
            "/src/nested/b.txt": ("file", b"world"),
            "/dst": ("dir", None),
        }

    async def stat(self, path: str) -> CopyFakeAttrs:
        node = self.nodes.get(path)
        if node is None:
            error = asyncssh.SFTPError("missing")
            error.code = 2
            raise error
        kind, data = node
        if kind == "dir":
            return CopyFakeAttrs(ftype=2, size=0)
        return CopyFakeAttrs(ftype=1, size=len(data or b""))

    async def listdir(self, path: str) -> list[str]:
        prefix = path.rstrip("/") + "/"
        names: list[str] = []
        for candidate in self.nodes:
            if candidate.startswith(prefix):
                rest = candidate[len(prefix) :]
                if rest and "/" not in rest:
                    names.append(rest)
        return names

    async def mkdir(self, path: str) -> None:
        if path in self.nodes:
            error = asyncssh.SFTPError("exists")
            error.code = 11
            raise error
        self.nodes[path] = ("dir", None)

    def open(self, path: str, mode: str) -> CopyFakeFile:
        if "r" in mode:
            node = self.nodes.get(path)
            if node is None or node[0] != "file":
                error = asyncssh.SFTPError("missing")
                error.code = 2
                raise error
            return CopyFakeFile(node[1] or b"")

        # write: keep a live buffer and flush into the tree on every write + close.
        handle = CopyFakeFile()

        async def write_and_store(data: bytes) -> int:
            written = await CopyFakeFile.write(handle, data)
            self.nodes[path] = ("file", bytes(handle.data))
            return written

        handle.write = write_and_store  # type: ignore[method-assign]
        return handle


@pytest.mark.asyncio
async def test_copy_duplicates_files_and_directories() -> None:
    sftp = CopyFakeSFTP()

    async def provide_sftp() -> asyncssh.SFTPClient:
        return cast(asyncssh.SFTPClient, sftp)

    service = RemoteFileService(provide_sftp)
    await service.copy("/src", "/dst/src-copy")

    assert sftp.nodes["/dst/src-copy"][0] == "dir"
    assert sftp.nodes["/dst/src-copy/a.txt"] == ("file", b"hello")
    assert sftp.nodes["/dst/src-copy/nested"][0] == "dir"
    assert sftp.nodes["/dst/src-copy/nested/b.txt"] == ("file", b"world")


@pytest.mark.asyncio
async def test_copy_rejects_destination_inside_source() -> None:
    sftp = CopyFakeSFTP()

    async def provide_sftp() -> asyncssh.SFTPClient:
        return cast(asyncssh.SFTPClient, sftp)

    service = RemoteFileService(provide_sftp)
    with pytest.raises(ValueError, match="itself"):
        await service.copy("/src", "/src/nested/oops")


def test_parse_content_search_output_handles_rg_lines() -> None:
    from coloride_desktop.files.service import _parse_content_search_output

    matches = _parse_content_search_output(
        [
            "/ws/src/a.ts:10:export const x = 1;",
            "src/b.ts:2:hello",
            "not-a-match",
        ],
        root_path="/ws",
        limit=10,
    )
    assert len(matches) == 2
    assert matches[0].path == "/ws/src/a.ts"
    assert matches[0].line == 10
    assert matches[1].path == "/ws/src/b.ts"


class StatFakeAttrs:
    def __init__(self, ftype: int = 1, size: int = 10, mtime: int = 42) -> None:
        self.type = ftype
        self.size = size
        self.mtime = mtime


class StatFakeSFTP:
    def __init__(self) -> None:
        self.nodes: dict[str, StatFakeAttrs] = {
            "/ws/a.txt": StatFakeAttrs(1, 10, 42),
            "/ws/dir": StatFakeAttrs(2, 0, 99),
        }

    async def stat(self, path: str) -> StatFakeAttrs:
        node = self.nodes.get(path)
        if node is None:
            raise asyncssh.SFTPError(2, "missing")
        return node


@pytest.mark.asyncio
async def test_stat_path_returns_etag_without_opening() -> None:
    sftp = StatFakeSFTP()

    async def provide_sftp() -> asyncssh.SFTPClient:
        return cast(asyncssh.SFTPClient, sftp)

    service = RemoteFileService(provide_sftp)
    file_stat = await service.stat_path("/ws/a.txt")
    assert file_stat["exists"] is True
    assert file_stat["kind"] == "file"
    assert file_stat["etag"] == "10-42"

    missing = await service.stat_path("/ws/missing.txt")
    assert missing["exists"] is False
    assert missing["etag"] is None

    batch = await service.stat_paths(["/ws/a.txt", "/ws/dir", "/ws/a.txt", "/nope"])
    assert len(batch) == 3  # deduped
    assert batch[1]["kind"] == "dir"
    assert batch[1]["etag"] == "dir-99-0"
