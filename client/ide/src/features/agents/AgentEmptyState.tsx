import { Button } from "../../shared/ui/Button";

export function AgentEmptyState({
  configured,
  connected,
  managedLlm,
  workspacePath,
}: {
  configured: boolean;
  connected: boolean;
  managedLlm?: boolean;
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
          <h2 className="text-sm font-medium">Configure Coloride Agent</h2>
          <p className="agent-muted mx-auto mt-1 max-w-xs text-xs leading-5">
            Choose your model provider and add an API key in Settings.
          </p>
          <Button className="mt-4" onClick={() => window.dispatchEvent(new CustomEvent("coloride:open-settings", { detail: { section: "providers" } }))}>
            Open LLM provider settings
          </Button>
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
        <h2 className="text-sm font-medium">Agent unavailable</h2>
        <p className="agent-muted mx-auto mt-1 max-w-sm text-xs leading-5">
          {!connected
            ? "Connect to a VPS to run an agent."
            : "Choose a workspace before starting a task."}
        </p>
      </div>
    </div>
  );
}
