import type { FormEvent } from "react";
import { useState } from "react";
import { api } from "../../shared/api/client";
import { Switch } from "../../shared/ui/Switch";
import { Button } from "../../shared/ui/Button";
import { SettingsRow } from "./SettingsControls";

function detectProtocol(baseUrl: string): "gemini" | "chat-completions" {
  try {
    const host = new URL(baseUrl).hostname;
    if (host === "generativelanguage.googleapis.com" || host.endsWith(".googleapis.com")) return "gemini";
  } catch { /* The host validates the URL. */ }
  return "chat-completions";
}

export function AddLlmProvider({ onBack, onAdded }: { onBack: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [requiresKey, setRequiresKey] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const id = "custom:" + name.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
      await api.registerAgentProvider({ id, label: name.trim(), baseUrl: url.trim(), protocol: detectProtocol(url.trim()), requiresKey });
      setName(""); setUrl(""); onAdded();
    } catch {
      setError("Could not add this provider. Check its name, endpoint and whether it is already registered. Use HTTPS, or HTTP on localhost, without credentials or query parameters in the URL.");
    } finally { setBusy(false); }
  };
  return <form className="llm-custom-page" aria-label="Add compatible provider" onSubmit={event => void submit(event)}>
      <div className="llm-custom-toolbar">
        <button type="button" className="llm-custom-back" onClick={onBack}>
          <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
            <path d="m4 9 8 8 8-8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" transform="rotate(90 12 12)" />
          </svg>
          LLM Providers
          <span aria-hidden="true">/</span>
          Custom provider
        </button>
        <Button type="submit" size="sm" loading={busy} disabled={busy || !name.trim() || !url.trim()}>Add provider</Button>
      </div>
      <header className="llm-custom-heading">
        <h2>Custom provider</h2>
        <p>Use this for an endpoint Coloride does not list: a local server, or another host that speaks the OpenAI API.</p>
        <ul>
          <li>The URL needs the version prefix, such as <code>/v1</code>. A local server can use HTTP on localhost.</li>
          <li>Coloride reads the model list from that endpoint. Leave the key on unless the server accepts requests without one.</li>
          <li>The built-in providers stay as they are. This one is added next to them.</li>
        </ul>
      </header>
      <SettingsRow label="Name" description="A name for this endpoint. Existing providers stay configured.">
        <input className="settings-provider-input" aria-label="Provider name" value={name} maxLength={80} required disabled={busy} placeholder="Local model" onChange={event => setName(event.target.value)} />
      </SettingsRow>
      <SettingsRow label="API endpoint" description="Include the API version prefix, such as /v1. Local servers can use HTTP on localhost.">
        <input className="settings-provider-input" aria-label="Provider API endpoint" value={url} maxLength={500} type="url" required disabled={busy} placeholder="https://your-provider.example/v1" onChange={event => setUrl(event.target.value)} />
      </SettingsRow>
      <SettingsRow label="API key required" description="Turn off only for an endpoint that accepts requests without authentication.">
        <Switch label="API key required" checked={requiresKey} disabled={busy} onChange={setRequiresKey} />
      </SettingsRow>
      {error && <p className="settings-provider-feedback" role="alert">{error}</p>}
    </form>;
}
