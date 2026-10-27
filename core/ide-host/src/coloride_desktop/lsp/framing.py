"""LSP Content-Length framing (stdio transport)."""

from __future__ import annotations

import json
from typing import Any


class LspFrameDecoder:
    """Incremental decoder for LSP Content-Length framed messages."""

    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, chunk: bytes) -> list[dict[str, Any]]:
        if not chunk:
            return []
        self._buffer.extend(chunk)
        messages: list[dict[str, Any]] = []
        while True:
            message = self._try_pop()
            if message is None:
                break
            messages.append(message)
        return messages

    def _try_pop(self) -> dict[str, Any] | None:
        sep = b"\r\n\r\n"
        index = self._buffer.find(sep)
        header_term_len = 4
        if index < 0:
            sep = b"\n\n"
            index = self._buffer.find(sep)
            header_term_len = 2
            if index < 0:
                return None

        header_bytes = bytes(self._buffer[:index])
        try:
            header_text = header_bytes.decode("ascii", errors="strict")
        except UnicodeDecodeError as error:
            raise ValueError("Invalid LSP header encoding") from error

        content_length: int | None = None
        for line in header_text.replace("\r\n", "\n").split("\n"):
            if not line.strip():
                continue
            key, _, value = line.partition(":")
            if key.strip().lower() == "content-length":
                content_length = int(value.strip())
                break
        if content_length is None or content_length < 0:
            raise ValueError("LSP frame missing Content-Length")

        total = index + header_term_len + content_length
        if len(self._buffer) < total:
            return None

        body = bytes(self._buffer[index + header_term_len : total])
        del self._buffer[:total]
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Invalid LSP JSON body") from error
        if not isinstance(payload, dict):
            raise ValueError("LSP message must be a JSON object")
        return payload


def encode_lsp_message(message: dict[str, Any]) -> bytes:
    body = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
    return header + body
