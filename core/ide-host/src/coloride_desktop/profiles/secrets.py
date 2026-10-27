from __future__ import annotations

import contextlib
from typing import Protocol

import keyring
from keyring.errors import PasswordDeleteError


class ProfileSecretStore(Protocol):
    async def get_password(self, profile_id: str) -> str | None: ...

    async def save_password(self, profile_id: str, password: str) -> None: ...

    async def delete_password(self, profile_id: str) -> None: ...


class InMemoryProfileSecretStore:
    def __init__(self) -> None:
        self._passwords: dict[str, str] = {}

    async def get_password(self, profile_id: str) -> str | None:
        return self._passwords.get(profile_id)

    async def save_password(self, profile_id: str, password: str) -> None:
        self._passwords[profile_id] = password

    async def delete_password(self, profile_id: str) -> None:
        self._passwords.pop(profile_id, None)


class KeyringProfileSecretStore:
    """Store reusable profile credentials in the operating system keyring."""

    SERVICE = "coloride-profiles"

    def __init__(self) -> None:
        # macOS can show an authorization dialog for every `get_password()`
        # call. A profile is consulted several times while a connection is
        # being upgraded to the restricted account, so retain both a password
        # and a known-missing value for the lifetime of the sidecar.
        self._cache: dict[str, str | None] = {}
        self._loaded: set[str] = set()

    @staticmethod
    def _account(profile_id: str) -> str:
        return f"{profile_id}:password"

    async def get_password(self, profile_id: str) -> str | None:
        if profile_id in self._loaded:
            return self._cache[profile_id]
        password = keyring.get_password(self.SERVICE, self._account(profile_id))
        self._cache[profile_id] = password
        self._loaded.add(profile_id)
        return password

    async def save_password(self, profile_id: str, password: str) -> None:
        keyring.set_password(self.SERVICE, self._account(profile_id), password)
        self._cache[profile_id] = password
        self._loaded.add(profile_id)

    async def delete_password(self, profile_id: str) -> None:
        with contextlib.suppress(PasswordDeleteError):
            keyring.delete_password(self.SERVICE, self._account(profile_id))
        self._cache.pop(profile_id, None)
        self._loaded.discard(profile_id)
