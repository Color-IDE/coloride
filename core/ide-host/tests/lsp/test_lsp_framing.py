from coloride_desktop.lsp.framing import LspFrameDecoder, encode_lsp_message


def test_encode_roundtrip_single_message() -> None:
    message = {"jsonrpc": "2.0", "id": 1, "method": "initialize"}
    frame = encode_lsp_message(message)
    decoder = LspFrameDecoder()
    assert decoder.feed(frame) == [message]


def test_decoder_handles_split_chunks() -> None:
    message = {"jsonrpc": "2.0", "method": "initialized", "params": {}}
    frame = encode_lsp_message(message)
    decoder = LspFrameDecoder()
    assert decoder.feed(frame[:8]) == []
    assert decoder.feed(frame[8:]) == [message]


def test_decoder_handles_multiple_frames() -> None:
    a = {"jsonrpc": "2.0", "id": 1, "result": {}}
    b = {"jsonrpc": "2.0", "method": "window/logMessage", "params": {"type": 3, "message": "ok"}}
    blob = encode_lsp_message(a) + encode_lsp_message(b)
    decoder = LspFrameDecoder()
    assert decoder.feed(blob) == [a, b]


def test_decoder_rejects_missing_content_length() -> None:
    decoder = LspFrameDecoder()
    try:
        decoder.feed(b"\r\n\r\n{}")
    except ValueError as error:
        assert "Content-Length" in str(error)
    else:
        raise AssertionError("expected ValueError")


def test_body_is_valid_json_object() -> None:
    decoder = LspFrameDecoder()
    body = b"[1]"
    frame = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body
    try:
        decoder.feed(frame)
    except ValueError as error:
        assert "JSON object" in str(error)
    else:
        raise AssertionError("expected ValueError")
