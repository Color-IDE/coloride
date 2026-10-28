# Provider registry

`core/ide-host/src/coloride_desktop/agents/provider_registry.py` owns provider
definitions, supported API protocols and model capability resolution. The agent
loop receives the same provider interface regardless of the service's name.

The supported wire protocols are OpenAI Responses, OpenAI Chat Completions and
Gemini generateContent. A service using another protocol needs an adapter;
registering its name alone does not make it compatible. Provider-specific native
semantics, such as Gemini thought signatures, remain in their adapters. Managed
Coloride routing is restricted to its existing built-in provider set.

## Add an endpoint

Settings → LLM Providers → Add a compatible provider registers a name, API URL,
protocol and whether authentication is required. API keys then use the existing
automatic validation and credential-store flow. Endpoints without authentication
are discovered automatically. HTTPS is required except for localhost HTTP.
Credentials, query strings and fragments are rejected in base URLs; discovery
requests never follow redirects or use environment proxies.

The authenticated local API also exposes `GET /api/agents/providers` and
`POST /api/agents/providers`. A registration can declare model capabilities:

```json
{
  "id": "custom:internal-models",
  "label": "Internal Models",
  "protocol": "chat-completions",
  "baseUrl": "https://models.example.com/v1",
  "requiresKey": true,
  "models": {
    "coding-model": {
      "tools": true,
      "streaming": true,
      "images": false,
      "reasoning": false,
      "context_tokens": 32768
    }
  }
}
```

Then `POST /api/agents/providers/custom:internal-models/connect` with `apiKey`
validates the catalog before saving the key. Omit `apiKey` when refreshing saved
credentials or connecting an endpoint without authentication. Registration and
model metadata persist in the public configuration; keys stay in the OS vault.

## Capabilities and enforcement

Model features come from reviewed built-in definitions, explicit custom model
declarations or catalog metadata. Custom declarations take precedence. A model
ID resembling a known provider's model does not inherit that model's features.
An ordinary `/models` listing only establishes that an ID is listed, not that it
supports tools, vision, streaming, reasoning or a particular inference quota.
Catalog declarations are not live inference certification.

Unspecified custom features default to disabled, with a conservative 8k fallback context
budget when no limit is supplied. Declared context limits are validated and used by the agent's context
manager. The model gateway omits tools when unavailable, uses non-streaming calls
when necessary and rejects image input for models without image support. Act mode
continues to require tools; text-only models appear as Ask-only in Settings. The
composer hides reasoning controls when the discovered model declares no support.

Run `core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q` for registry,
adapter, credential and agent-loop checks. The isolated Settings Electron smoke
also covers registering a simulated local endpoint and discovering its models.
