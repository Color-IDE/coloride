from __future__ import annotations

import base64
import io

from PIL import Image

from coloride_desktop.agents.vision import (
    MAX_VISION_BYTES,
    is_payload_too_large_error,
    prepare_vision_image,
    strip_vision_from_history,
)


def _noisy_png_bytes(width: int, height: int) -> bytes:
    """Screenshot-like payload (not a flat color — those compress too well)."""
    image = Image.new("RGB", (width, height))
    pixels = image.load()
    assert pixels is not None
    for y in range(height):
        for x in range(width):
            pixels[x, y] = ((x * 37 + y * 17) % 256, (x * 13) % 256, (y * 29) % 256)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_prepare_vision_image_resizes_and_compresses_large_screenshot() -> None:
    raw = _noisy_png_bytes(1800, 1200)

    prepared = prepare_vision_image(raw, mime="image/png")
    assert prepared is not None
    assert prepared.mime == "image/jpeg"
    assert prepared.detail == "low"
    assert max(prepared.width, prepared.height) <= 1280
    assert prepared.encoded_bytes <= MAX_VISION_BYTES
    # Round-trip decodes as a real JPEG under the wire budget.
    decoded = base64.b64decode(prepared.base64_data)
    check = Image.open(io.BytesIO(decoded))
    check.load()
    assert check.format == "JPEG"
    assert len(prepared.base64_data) <= MAX_VISION_BYTES * 2


def test_prepare_vision_image_rejects_empty() -> None:
    assert prepare_vision_image(b"", mime="image/png") is None


def test_strip_vision_from_history_replaces_images_with_note() -> None:
    history = [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "no veo nada"},
                {
                    "type": "input_image",
                    "image_url": "data:image/jpeg;base64," + ("A" * 5000),
                    "detail": "high",
                },
            ],
        },
        {"role": "assistant", "content": "ok"},
    ]
    stripped = strip_vision_from_history(history)
    assert stripped[0]["role"] == "user"
    assert isinstance(stripped[0]["content"], str)
    assert "no veo nada" in stripped[0]["content"]
    assert "omitted" in stripped[0]["content"].lower()
    assert "input_image" not in str(stripped)
    assert stripped[1] == history[1]


def test_is_payload_too_large_error() -> None:
    assert is_payload_too_large_error(RuntimeError("xAI request failed: HTTP 413"))
    assert is_payload_too_large_error(RuntimeError("Payload Too Large"))
    assert not is_payload_too_large_error(RuntimeError("HTTP 500"))
