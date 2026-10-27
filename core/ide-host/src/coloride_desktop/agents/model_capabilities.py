"""Declarative model support; adding a model never changes the agent loop."""
TOOL_MODELS = {
    'openai': {'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'o3', 'o4-mini'},
    'xai': {'grok-build-0.1', 'grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4'},
    'gemini': {'gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'},
    'fireworks': {'accounts/fireworks/models/deepseek-v4p1-flash', 'accounts/fireworks/models/minimax-m3', 'accounts/fireworks/models/kimi-k3'},
}


def supports_tools(provider: str, model: str) -> bool:
    return model.lower() in TOOL_MODELS.get(provider, set())
