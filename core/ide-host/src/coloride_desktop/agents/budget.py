from __future__ import annotations

# Compatibility/fallback budget. Memory V1 derives its normal request ceiling
# from the provider's declared capacity and uses 40k only when it is unknown.
# A turn that only needs 12k still sends 12k; no block is padded.
TARGET_CONTEXT_TOKENS = 25_000
HARD_LIMIT_TOKENS = 40_000
OUTPUT_RESERVE_TOKENS = 8_000
# Soft trigger leaves the output reserve intact. 40k is the ceiling, not the goal.
SOFT_LIMIT_TOKENS = HARD_LIMIT_TOKENS - OUTPUT_RESERVE_TOKENS
# Matches provider._CHARS_PER_TOKEN for UI / estimated-token metering.
CHARS_PER_TOKEN = 3.2

# Floor so a tiny chat still has room for system + tools + the latest ask.
MIN_CONTEXT_TOKENS = 7_500
MIN_CONTEXT_CHARACTERS = 24_000

# After a gateway 413 the working set must drop well below the published window.
RECOVERY_CONTEXT_RATIO = 0.28

# Compacted prefix: keep recent logical spans, not a literal last-N messages.
RECENT_SPAN_TARGET_TOKENS = 8_000
RECENT_SPAN_MIN_TOKENS = 2_000
SUMMARY_MAX_TOKENS = 1_250
SUMMARY_RATIO = 0.16

# Keep the newest tool evidence verbatim. Older large outputs are spilled.
RECENT_TOOL_OUTPUTS_TO_KEEP = 2
MAX_HISTORICAL_TOOL_OUTPUT_CHARACTERS = 2_000
MAX_SPILLED_TOOL_PREVIEW_LINES = 80
MAX_SPILLED_TOOL_PREVIEW_CHARACTERS = 2_000

MAX_MESSAGE_CHARACTERS = 16_000
MAX_FUNCTION_ARGUMENT_CHARACTERS = 8_000
MAX_RECOVERY_MESSAGE_CHARACTERS = 4_000
MAX_RECOVERY_TOOL_OUTPUT_CHARACTERS = 600

# Compat aliases — older tests / callers still import these names.
WORKING_SET_MAX_TOKENS = HARD_LIMIT_TOKENS
WORKING_SET_MAX_CHARACTERS = int(HARD_LIMIT_TOKENS * CHARS_PER_TOKEN)  # 128_000


def estimate_tokens(characters: int) -> int:
    """Token estimate from character accounting (same ratio as the provider meter)."""
    return max(0, int(round(max(0, characters) / CHARS_PER_TOKEN)))


def tokens_to_characters(tokens: int) -> int:
    return max(0, int(round(max(0, tokens) * CHARS_PER_TOKEN)))


def working_set_history_limit(max_context_characters: int | None = None) -> int:
    """Input budget from the provider window, with an 8k output reserve."""
    if max_context_characters is None or max_context_characters <= 0:
        return WORKING_SET_MAX_CHARACTERS
    return max(
        MIN_CONTEXT_CHARACTERS,
        max_context_characters - tokens_to_characters(OUTPUT_RESERVE_TOKENS),
    )


def working_set_token_limit(max_context_tokens: int | None = None) -> int:
    """Token equivalent of the provider-derived input budget."""
    if max_context_tokens is None or max_context_tokens <= 0:
        return HARD_LIMIT_TOKENS
    return max(MIN_CONTEXT_TOKENS, max_context_tokens - OUTPUT_RESERVE_TOKENS)


def recovery_history_limit(max_context_characters: int) -> int:
    """Tight prompt budget after the model gateway rejects the request as too large."""
    return max(
        MIN_CONTEXT_CHARACTERS,
        min(
            WORKING_SET_MAX_CHARACTERS,
            int(working_set_history_limit(max_context_characters) * RECOVERY_CONTEXT_RATIO),
        ),
    )


def prompt_character_budget(max_tokens: int | None = None) -> int:
    """Characters ContextEngine may send for a declared or fallback model window."""
    tokens = working_set_token_limit(max_tokens)
    return tokens_to_characters(tokens)
