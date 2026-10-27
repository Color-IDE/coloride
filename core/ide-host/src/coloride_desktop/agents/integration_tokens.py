from __future__ import annotations

import asyncio

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

SERVICE = "coloride-integrations"


def _account(server_id: str) -> str:
    return f"{server_id}:access-token"


async def get_access_token(server_id: str) -> str | None:
    try:
        value = await asyncio.to_thread(keyring.get_password, SERVICE, _account(server_id))
    except KeyringError:
        return None
    return value or None


async def save_access_token(server_id: str, token: str) -> None:
    await asyncio.to_thread(keyring.set_password, SERVICE, _account(server_id), token)


async def delete_access_token(server_id: str) -> None:
    try:
        await asyncio.to_thread(keyring.delete_password, SERVICE, _account(server_id))
    except (KeyringError, PasswordDeleteError):
        return
