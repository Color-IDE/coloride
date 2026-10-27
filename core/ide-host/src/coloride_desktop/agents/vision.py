"""Vision payload guards — keep screenshots from blowing past provider/proxy limits.

xAI / nginx reject oversized request bodies (HTTP 413). Full-resolution browser
screenshots as ``detail: high`` base64 routinely exceed ~20 MB once history and
tool schemas are included. This module:

1. Resizes and re-encodes images (JPEG) before they hit the wire.
2. Caps how many images ride on a single model call (newest first).
3. Strips vision parts for 413 retries.
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass
from typing import Any

# Hard caps chosen to stay well under nginx ``client_max_body_size 20m`` and
# xAI request limits even with a long transcript + tools + reasoning.
MAX_VISION_EDGE_PX = 1280
MAX_VISION_BYTES = 450_000  # binary after compress (~600KB base64)
MAX_VISION_IMAGES_PER_REQUEST = 2
MAX_TOTAL_VISION_B64_CHARS = 1_200_000  # ~900KB total base64 across all images
DEFAULT_VISION_DETAIL = "low"  # high multiplies tokens; low is enough for UI OCR


@dataclass(frozen=True, slots=True)
class PreparedVisionImage:
    mime: str
    base64_data: str
    detail: str
    width: int
    height: int
    original_bytes: int
    encoded_bytes: int


def prepare_vision_image(
    raw: bytes,
    *,
    mime: str | None = None,
    max_edge: int = MAX_VISION_EDGE_PX,
    max_bytes: int = MAX_VISION_BYTES,
    detail: str = DEFAULT_VISION_DETAIL,
) -> PreparedVisionImage | None:
    """Decode → resize → JPEG-compress. Returns None if unusable."""
    if not raw:
        return None
    original_len = len(raw)
    mime_norm = (mime or "image/png").split(";")[0].strip().lower()
    if mime_norm == "image/jpg":
        mime_norm = "image/jpeg"

    try:
        from PIL import Image, ImageOps
    except ImportError:
        # No Pillow: only pass through small originals.
        if original_len > max_bytes:
            return None
        if mime_norm not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
            mime_norm = "image/png"
        encoded = base64.b64encode(raw).decode("ascii")
        if len(encoded) > max_bytes * 2:
            return None
        return PreparedVisionImage(
            mime=mime_norm,
            base64_data=encoded,
            detail=detail if detail in {"low", "high", "auto"} else "low",
            width=0,
            height=0,
            original_bytes=original_len,
            encoded_bytes=len(raw),
        )

    try:
        image = Image.open(io.BytesIO(raw))
        image = ImageOps.exif_transpose(image)
        image.load()
    except Exception:  # noqa: BLE001 — corrupt / unsupported
        return None

    # Flatten alpha onto white so JPEG works for screenshots with transparency.
    if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")

    width, height = image.size
    longest = max(width, height)
    if longest > max_edge > 0:
        scale = max_edge / float(longest)
        image = image.resize(
            (max(1, int(width * scale)), max(1, int(height * scale))),
            Image.Resampling.LANCZOS,
        )
        width, height = image.size

    # Progressive quality until under budget.
    payload: bytes | None = None
    for quality in (72, 60, 48, 36):
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=quality, optimize=True, progressive=True)
        candidate = buffer.getvalue()
        if len(candidate) <= max_bytes:
            payload = candidate
            break
        payload = candidate

    if payload is None:
        return None

    # Still too big after aggressive JPEG — downscale harder once.
    if len(payload) > max_bytes and max(width, height) > 640:
        scale = 640 / float(max(width, height))
        small = image.resize(
            (max(1, int(width * scale)), max(1, int(height * scale))),
            Image.Resampling.LANCZOS,
        )
        buffer = io.BytesIO()
        small.save(buffer, format="JPEG", quality=40, optimize=True)
        payload = buffer.getvalue()
        width, height = small.size

    if len(payload) > max_bytes * 1.15:
        return None

    encoded = base64.b64encode(payload).decode("ascii")
    return PreparedVisionImage(
        mime="image/jpeg",
        base64_data=encoded,
        detail=detail if detail in {"low", "high", "auto"} else "low",
        width=width,
        height=height,
        original_bytes=original_len,
        encoded_bytes=len(payload),
    )


def vision_part_from_prepared(prepared: PreparedVisionImage) -> dict[str, Any]:
    return {
        "type": "input_image",
        "image_url": f"data:{prepared.mime};base64,{prepared.base64_data}",
        "detail": prepared.detail,
    }


def count_vision_parts(items: list[dict[str, Any]]) -> int:
    total = 0
    for item in items:
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, dict) and str(part.get("type") or "") == "input_image":
                total += 1
    return total


def strip_vision_from_history(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replace vision parts with a short text note (413 / size fallback)."""
    out: list[dict[str, Any]] = []
    for item in items:
        content = item.get("content")
        if not isinstance(content, list):
            out.append(item)
            continue
        text_bits: list[str] = []
        had_image = False
        for part in content:
            if not isinstance(part, dict):
                continue
            ptype = str(part.get("type") or "")
            if ptype == "input_image":
                had_image = True
                continue
            if ptype in {"input_text", "output_text", "text"} and isinstance(part.get("text"), str):
                text_bits.append(str(part["text"]))
            elif isinstance(part.get("text"), str):
                text_bits.append(str(part["text"]))
        if not had_image:
            out.append(item)
            continue
        text = "\n".join(text_bits).strip()
        note = (
            "[Attached image omitted to fit the model request size limit. "
            "Describe what you need from it, or attach a smaller crop.]"
        )
        body = f"{text}\n\n{note}".strip() if text else note
        clean = {
            key: value
            for key, value in item.items()
            if key not in {"colorideImages", "coloride_images"}
        }
        clean["content"] = body
        out.append(clean)
    return out


def is_payload_too_large_error(exc: BaseException) -> bool:
    text = str(exc or "").lower()
    if "413" in text:
        return True
    return any(
        needle in text
        for needle in (
            "payload too large",
            "request entity too large",
            "content too large",
            "body too large",
            "request too large",
        )
    )
