# Provider registry

## External agents through ACP

Settings → External Agents → ACP Registry installs optional agents into the
application's user-data directory. The catalog supports search and installed
filters. Installs use the registry version, retain the program across restarts
and provision a private Node/npm or uv runtime when needed. Installing executes
the selected agent's published package; it does not change Coloride's dependencies.

Installed agents appear in the agent panel's `+` menu. They own their tools,
authentication and model connection. Coloride is an ACP client: it presents
messages, permissions and the model/mode/thinking options announced by each
session. These agents do not run through Coloride's provider registry or tool loop.
The initial implementation supports local projects and protocol-driven login.
Interactive terminal authentication is not advertised yet. Conversation recovery
depends on the agent's `loadSession` capability; unsupported histories remain
read-only. Closing a tab or quitting stops its execution and keeps its history.

After a backend update, a persistent development host can still be serving the
old API. Settings identifies that case and offers **Restart host and close
terminals**. Save work first: that explicit action closes terminal processes.
If the desktop preload itself is old, close terminal tabs and restart `pnpm dev`.

`node tests/electron/smoke/external-agents.mjs` uses an isolated HOME/profile,
downloads the real catalog and Codex package, then checks the conversation with
a deterministic ACP process. It never signs into an account or sends paid prompts.

## Built-in agent providers

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
