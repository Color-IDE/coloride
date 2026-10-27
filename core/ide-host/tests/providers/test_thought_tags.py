import asyncio

import pytest

from coloride_desktop.agents.provider import GeminiResponsesProvider, ModelResponse
from coloride_desktop.agents.thought_tags import ThoughtTagParser, split_thought_tags


@pytest.mark.parametrize("split", range(61))
def test_thought_tags_across_chunk_boundaries(split: int) -> None:
    raw = " <thought>Inspect files</thought><thought>Check</thought>Done"
    parser = ThoughtTagParser()
    chunks = parser.feed(raw[:split]) + parser.feed(raw[split:])
    chunks += parser.feed("", final=True)
    assert "".join(v for k, v in chunks if k == "text") == "Done"
    assert "".join(v for k, v in chunks if k == "reasoning") == "Inspect filesCheck"


@pytest.mark.parametrize("raw", [
    "Normal answer", "Use <thought> literally", "```xml\n<thought>x</thought>\n```",
    "<thing>", "<thou", "   ",
])
def test_literal_text_is_preserved(raw: str) -> None:
    assert split_thought_tags(raw) == (raw, "")


def test_unclosed_thought_stays_out_of_answer() -> None:
    assert split_thought_tags("<thought>Still working") == ("", "Still working")


def test_gemini_stream_routes_thoughts_and_normalizes_history(monkeypatch) -> None:
    raw = "<thought>Inspect files</thought>Updated architecture"
    response = ModelResponse(
        response_id="test", text=raw, tool_calls=(),
        output_items=({"type": "message", "role": "assistant", "content": [
            {"type": "output_text", "text": raw},
        ]},), streamed=True,
    )

    async def fake_stream(self, *, on_text_delta, on_reasoning_delta, **kwargs):
        await on_reasoning_delta("Native reasoning. ")
        for char in raw:
            await on_text_delta(char)
        return response

    monkeypatch.setattr(GeminiResponsesProvider, "_complete_stream_raw", fake_stream)
    provider = object.__new__(GeminiResponsesProvider)
    visible, reasoning = [], []

    async def collect_text(value):
        visible.append(value)

    async def collect_reasoning(value):
        reasoning.append(value)

    result = asyncio.run(provider.complete_stream(
        on_text_delta=collect_text, on_reasoning_delta=collect_reasoning,
    ))
    assert "".join(visible) == result.text == "Updated architecture"
    assert "".join(reasoning) == "Native reasoning. Inspect files"
    assert result.output_items[0]["content"][0]["text"] == result.text
    assert result.output_items[0]["reasoning_content"] == "Inspect files"
    assert response.text == raw


def test_gemini_title_excludes_thoughts(monkeypatch) -> None:
    async def fake_complete(self, **kwargs):
        return ModelResponse(
            response_id="title", text="<thought>Naming</thought>Update Agent Architecture",
            tool_calls=(), output_items=(),
        )

    monkeypatch.setattr(GeminiResponsesProvider, "_complete_raw", fake_complete)
    provider = object.__new__(GeminiResponsesProvider)
    assert asyncio.run(provider.generate_title("Update docs")) == "Update Agent Architecture"
