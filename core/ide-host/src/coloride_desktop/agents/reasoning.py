"""Reasoning effort: advertised levels, nearest snap, wire value.

The composer stores the user's choice. Each model advertises the levels it
accepts. A choice the model does not advertise snaps to the nearest advertised
level; a tie keeps the deeper one. ``none`` turns extended thinking off.
``max`` is a UI level that the wire formats Coloride speaks do not accept, so
it leaves as the deepest effort that format does accept.
"""

from __future__ import annotations

REASONING_LEVELS = ("none", "low", "medium", "high", "xhigh", "max")
ACTIVE_REASONING_LEVELS = ("low", "medium", "high", "xhigh", "max")

REASONING_LEVEL_LABELS = {
    "none": ("Off", "No extended thinking"),
    "low": ("Low", "Minimal reasoning"),
    "medium": ("Medium", "Balanced reasoning"),
    "high": ("High", "Deep reasoning"),
    "xhigh": ("Extra High", "Maximum reasoning"),
    "max": ("Maximum", "Maximum reasoning"),
}

# A missing model falls back to low/medium/high so an unknown id still has a
# usable selector and never sends an unadvertised extra-high.
# (needle, efforts, can turn thinking off). Off is a reasoning toggle, or
# "none" in the advertised effort list.
_MODEL_EFFORTS: tuple[tuple[str, tuple[str, ...], bool], ...] = (
    ("gpt-6", ACTIVE_REASONING_LEVELS, False),
    ("grok-build-0.1", (), False),
    ("grok-4.7", ("low", "medium", "high", "xhigh"), False),
    ("grok-4.6", ("low", "medium", "high", "xhigh"), False),
    ("grok-4.5", ("low", "medium", "high"), False),
    ("grok-4", ("low", "medium", "high"), False),
    ("gemini-4-argon", ("low", "medium", "high"), False),
    ("gemini-3.8-flash", ("low", "medium", "high"), False),
    ("gemini-3.1-pro", ("low", "medium", "high"), False),
    ("gemini-3", ("low", "medium", "high"), False),
    ("gemini-2.5", ("low", "medium", "high"), False),
    ("deepseek-v4p1-flash", ("low", "high", "max"), True),
    ("deepseek-v4", ("low", "high", "max"), True),
    ("minimax-m3", ("low", "medium", "high"), False),
    ("kimi-k3", ("low", "medium", "high", "max"), True),
    ("mistral-large", ("low", "medium", "high"), False),
    ("mistral-medium", ("low", "medium", "high"), False),
)

_DEFAULT_EFFORTS = ("low", "medium", "high")


def _model_entry(model: str) -> tuple[tuple[str, ...], bool] | None:
    normalized = (model or "").strip().lower()
    for needle, efforts, supports_off in _MODEL_EFFORTS:
        if needle in normalized:
            return efforts, supports_off
    return None


def advertised_reasoning_efforts(model: str) -> tuple[str, ...]:
    """Effort values the model advertises, deepest first."""
    entry = _model_entry(model)
    efforts = entry[0] if entry is not None else _DEFAULT_EFFORTS
    return tuple(reversed(efforts))


def model_supports_reasoning_off(model: str) -> bool:
    entry = _model_entry(model)
    return entry[1] if entry is not None else False


def model_supports_reasoning_control(model: str) -> bool:
    entry = _model_entry(model)
    if entry is None:
        return True
    return bool(entry[0])


def normalize_reasoning_effort(
    effort: object,
    supported: tuple[str, ...] | list[str] | None = None,
) -> str | None:
    """Snap ``effort`` onto ``supported``.

    An exact match wins; otherwise the nearest level wins, and a tie keeps the
    deeper level. ``none`` stays
    ``none`` when the caller asks to turn thinking off. An empty advertised
    list means the model has no effort control.
    """
    if supported is not None and len(supported) == 0:
        return None
    raw = str(effort or "").strip().lower().replace("_", " ").replace("-", " ")
    aliases = {
        "off": "none",
        "extra high": "xhigh",
        "extra high reasoning": "xhigh",
        "maximum": "max",
        "minimal": "low",
    }
    value = aliases.get(raw, raw.replace(" ", ""))
    if value == "extrahigh":
        value = "xhigh"
    if value not in REASONING_LEVELS:
        value = "medium"
    if supported is None:
        return value
    advertised = [level for level in supported if level in ACTIVE_REASONING_LEVELS]
    if not advertised:
        return None
    if value == "none" and "none" in supported:
        return "none"
    # Off on a model that cannot disable thinking uses the same nearest snap.
    if value == "none":
        value = "medium"
    if value in advertised:
        return value
    requested = ACTIVE_REASONING_LEVELS.index(value) if value in ACTIVE_REASONING_LEVELS else 1
    nearest = advertised[0]
    nearest_distance = abs(ACTIVE_REASONING_LEVELS.index(nearest) - requested)
    for candidate in advertised[1:]:
        distance = abs(ACTIVE_REASONING_LEVELS.index(candidate) - requested)
        # On a tie, preserve more capability (later level is deeper).
        if distance <= nearest_distance:
            nearest = candidate
            nearest_distance = distance
    return nearest


def wire_reasoning_effort(model: str, effort: object) -> str | None:
    """Value to put on the provider request, or None to omit the parameter.

    Off is ``none`` only when the model can disable thinking. Otherwise it
    snaps to medium, the same fallback used for an unsupported effort.
    ``max`` is not a Responses / thinkingLevel value, so it becomes the deepest
    effort that wire format accepts.
    """
    supported = tuple(reversed(advertised_reasoning_efforts(model)))
    if model_supports_reasoning_off(model):
        supported = ("none", *supported)
    snapped = normalize_reasoning_effort(effort, supported)
    if snapped is None or snapped == "none":
        return None
    if snapped == "max":
        for candidate in ("xhigh", "high", "medium", "low"):
            if candidate in supported:
                return candidate
        return "high"
    return snapped
