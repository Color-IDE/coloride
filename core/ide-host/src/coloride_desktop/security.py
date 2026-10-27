from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Header, HTTPException, status


def bearer_auth(expected_token: str) -> Callable[[str | None], Awaitable[None]]:
    async def verify(authorization: Annotated[str | None, Header()] = None) -> None:
        if authorization != f"Bearer {expected_token}":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "auth.invalid_token",
                    "message": "Missing or invalid bearer token.",
                    "retryable": False,
                },
            )

    return verify
