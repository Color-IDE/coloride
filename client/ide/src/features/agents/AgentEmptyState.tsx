import type { AgentProvider } from "@coloride/contracts";
import { BotIcon } from "@hugeicons/core-free-icons";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import { PROVIDER_OPTIONS } from "./composer/modelCatalog";

export function AgentEmptyState({
  configured,
  connected,
  managedLlm,
  model,
  onKeyChange,
  onModelChange,
  onProviderChange,
  onSave,
  provider,
  providerKey,
  saving,
  workspacePath,
}: {
  configured: boolean;
  connected: boolean;
  managedLlm?: boolean;
  model: string;
  onKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onProviderChange: (value: AgentProvider) => void;
  onSave: () => void;
  provider: AgentProvider;
  providerKey: string;
  saving: boolean;
  workspacePath: string | null;
}) {
  if (!configured) {
    // Account access feedback lives in the composer and shared notifications.
    if (managedLlm !== false) {
      return null;
    }
    return (
      <div className="flex h-full min-h-72 items-center justify-center p-8">
        <div className="agent-provider-setup w-full max-w-sm text-center">
          <div className="agent-empty-icon mx-auto flex h-11 w-11 items-center justify-center rounded-xl">
            <Icon icon={BotIcon} size={20} />
          </div>
          <h2 className="mt-3 text-sm font-medium">Configure Coloride Agent</h2>
          <p className="agent-muted mx-auto mt-1 max-w-xs text-xs leading-5">
            Advanced BYOK mode: the API key stays in this device&apos;s system
            Keychain.
          </p>
          <div className="mt-4 text-left">
            <ProviderSetupFields
              configured={false}
              model={model}
              onKeyChange={onKeyChange}
              onModelChange={onModelChange}
              onProviderChange={onProviderChange}
              onSave={onSave}
              provider={provider}
              providerKey={providerKey}
              saving={saving}
            />
          </div>
        </div>
      </div>
    );
  }
  if (connected && workspacePath) {
    return <div className="h-full min-h-72" />;
  }
  return (
    <div className="flex h-full min-h-72 items-center justify-center p-8 text-center">
      <div>
        <div className="agent-empty-icon mx-auto flex h-11 w-11 items-center justify-center rounded-xl">
          <Icon icon={BotIcon} size={20} />
        </div>
        <h2 className="mt-3 text-sm font-medium">Agent unavailable</h2>
        <p className="agent-muted mx-auto mt-1 max-w-sm text-xs leading-5">
          {!connected
            ? "Connect to a VPS to run an agent."
            : "Choose a workspace before starting a task."}
        </p>
      </div>
    </div>
  );
}

export function ProviderSetupFields({
  configured,
  model,
  onKeyChange,
  onModelChange,
  onProviderChange,
  onSave,
  provider,
  providerKey,
  saving,
}: {
  configured: boolean;
  model: string;
  onKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onProviderChange: (value: AgentProvider) => void;
  onSave: () => void;
  provider: AgentProvider;
  providerKey: string;
  saving: boolean;
}) {
  return (
    <>
      <div className="agent-provider-select mb-2 grid grid-cols-2 rounded-lg p-0.5">
        {(Object.keys(PROVIDER_OPTIONS) as AgentProvider[]).map((candidate) => (
          <button
            aria-pressed={provider === candidate}
            className={provider === candidate ? "is-active" : ""}
            key={candidate}
            onClick={() => onProviderChange(candidate)}
            type="button"
          >
            {PROVIDER_OPTIONS[candidate].label}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        <label className="agent-config-field block rounded-lg px-3 py-2">
          <span className="agent-muted block text-[10px] font-medium uppercase">
            Model
          </span>
          <input
            className="mt-0.5 w-full bg-transparent text-xs outline-none"
            onChange={(event) => onModelChange(event.target.value)}
            value={model}
          />
        </label>
        <label className="agent-config-field block rounded-lg px-3 py-2">
          <span className="agent-muted block text-[10px] font-medium uppercase">
            {PROVIDER_OPTIONS[provider].keyLabel}
          </span>
          <input
            autoComplete="off"
            className="mt-0.5 w-full bg-transparent text-xs outline-none"
            onChange={(event) => onKeyChange(event.target.value)}
            placeholder={
              configured ? "Leave empty to keep current key" : "Paste API key"
            }
            type="password"
            value={providerKey}
          />
        </label>
      </div>
      <div className="agent-muted mt-2 text-[10px] leading-4">
        Advanced BYOK requests use{" "}
        {provider === "xai"
          ? "api.x.ai"
          : provider === "fireworks"
            ? "api.fireworks.ai"
            : provider === "gemini"
              ? "generativelanguage.googleapis.com"
              : "api.openai.com"}
        . The key remains in this device&apos;s Keychain.
      </div>
      <Button
        className="mt-3 px-4"
        loading={saving}
        variant="primary"
        disabled={(!configured && !providerKey.trim()) || !model.trim()}
        onClick={onSave}
      >
        {saving ? "Saving..." : "Save securely"}
      </Button>
    </>
  );
}
