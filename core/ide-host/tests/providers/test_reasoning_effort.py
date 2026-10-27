import pytest

from coloride_desktop.agents.gemini_native import gemini_thinking_config
from coloride_desktop.agents.provider import (
    _fireworks_reasoning_effort,
    _provider_reasoning_effort,
)
from coloride_desktop.agents.reasoning import (
    advertised_reasoning_efforts,
    normalize_reasoning_effort,
    wire_reasoning_effort,
)


def test_catalog_matches_advertised_efforts() -> None:
    assert advertised_reasoning_efforts("grok-4.7") == ("xhigh", "high", "medium", "low")
    assert advertised_reasoning_efforts("grok-4.6") == ("xhigh", "high", "medium", "low")
    assert advertised_reasoning_efforts("grok-4.5") == ("high", "medium", "low")
    assert advertised_reasoning_efforts("grok-build-0.1") == ()
    assert advertised_reasoning_efforts("gemini-3.8-flash") == ("high", "medium", "low")
    assert advertised_reasoning_efforts("gemini-3.1-pro-preview") == ("high", "medium", "low")
    assert advertised_reasoning_efforts("accounts/fireworks/models/deepseek-v4p1-flash") == (
        "max",
        "high",
        "low",
    )
    assert advertised_reasoning_efforts("accounts/fireworks/models/kimi-k3") == (
        "max",
        "high",
        "medium",
        "low",
    )
    assert advertised_reasoning_efforts("accounts/fireworks/models/minimax-m3") == (
        "high",
        "medium",
        "low",
    )


def test_normalize_snaps_to_nearest_and_prefers_deeper_on_tie() -> None:
    grok45 = ("low", "medium", "high")
    assert normalize_reasoning_effort("xhigh", grok45) == "high"
    assert normalize_reasoning_effort("max", grok45) == "high"
    # medium is equally far from low and high; the tie keeps high.
    assert normalize_reasoning_effort("medium", ("low", "high", "max")) == "high"
    assert normalize_reasoning_effort("low", ("low", "high", "max")) == "low"
    assert normalize_reasoning_effort("none", grok45) == "medium"
    assert normalize_reasoning_effort("none", ("none", "low", "high")) == "none"
    assert normalize_reasoning_effort("extra high", ("low", "medium", "high", "xhigh")) == "xhigh"
    assert normalize_reasoning_effort("xhigh", ()) is None


def test_wire_effort_omits_off_and_maps_max() -> None:
    assert wire_reasoning_effort("grok-4.7", "xhigh") == "xhigh"
    assert wire_reasoning_effort("grok-4.7", "none") == "medium"
    assert wire_reasoning_effort("accounts/fireworks/models/kimi-k3", "none") is None
    assert wire_reasoning_effort("grok-4.5", "xhigh") == "high"
    assert wire_reasoning_effort("grok-build-0.1", "high") is None
    assert wire_reasoning_effort("accounts/fireworks/models/deepseek-v4p1-flash", "max") == "high"
    assert wire_reasoning_effort("accounts/fireworks/models/kimi-k3", "medium") == "medium"
    assert _provider_reasoning_effort("xai", "grok-4.7", "xhigh") == "xhigh"
    assert _provider_reasoning_effort("xai", "grok-build-0.1", "high") is None
    assert _fireworks_reasoning_effort("accounts/fireworks/models/kimi-k3", "max") == "high"
    assert _fireworks_reasoning_effort("accounts/fireworks/models/minimax-m3", "none") == "medium"


def test_gemini_thinking_follows_advertised_levels() -> None:
    assert gemini_thinking_config("gemini-3.8-flash", "xhigh") == {
        "thinkingLevel": "HIGH",
        "includeThoughts": True,
    }
    assert gemini_thinking_config("gemini-3.1-pro-preview", "none") == {
        "thinkingLevel": "MEDIUM",
        "includeThoughts": True,
    }
    assert gemini_thinking_config("gemini-2.5-pro", "high") == {
        "thinkingBudget": -1,
        "includeThoughts": True,
    }


@pytest.mark.parametrize(
    ("effort", "expected"),
    [("low", "LOW"), ("medium", "MEDIUM"), ("high", "HIGH"),
     ("xhigh", "HIGH"), ("max", "HIGH"), ("none", "MEDIUM")],
)
def test_argon_thinking_levels(effort: str, expected: str) -> None:
    assert gemini_thinking_config("gemini-4-argon", effort) == {
        "thinkingLevel": expected,
        "includeThoughts": True,
    }
