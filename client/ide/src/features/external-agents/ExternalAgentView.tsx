import { useState } from "react";
import { externalAgentsApi } from "./api";
import { ExternalAgentComposer } from "./ExternalAgentComposer";
import { ExternalAgentPermission } from "./ExternalAgentPermission";
import { ExternalAgentTimeline } from "./ExternalAgentTimeline";
import { reduceExternalAgentUpdate } from "./externalAgentReducer";
import { useExternalAgentSession } from "./useExternalAgentSession";

export function ExternalAgentView({
  sessionId,
  active,
  workspaceKind,
}: {
  sessionId: string;
  active: boolean;
  workspaceKind: "local" | "ssh";
}) {
  const { session, setSession, state, setState, error, setError } = useExternalAgentSession(sessionId, active);
  const [draft, setDraft] = useState("");
  const ssh = workspaceKind === "ssh";
  const needsLogin = session?.phase === "needs-login" || session?.phase === "authenticating";
  const ready = session?.phase === "ready" && !ssh;

  const signIn = async () => {
    const method = session?.authMethods.find((item) => item.type === "agent") ?? session?.authMethods[0];
    if (!method) return;
    setError("");
    try {
      setSession(await externalAgentsApi.authenticate(sessionId, method.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Codex sign-in failed.");
    }
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setState((current) => reduceExternalAgentUpdate(current, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text },
    }));
    try {
      await externalAgentsApi.prompt(sessionId, text);
    } catch (reason) {
      setDraft(text);
      setState((current) => ({ ...current, turnActive: false }));
      setError(reason instanceof Error ? reason.message : "Codex did not accept the message.");
    }
  };

  return (
    <section aria-label="Codex" className="flex h-full min-h-0 flex-col bg-[var(--agent-surface,#212121)]">
      {ssh ? (
        <p className="px-4 py-6 text-sm" role="status">SSH projects are not supported for Codex yet.</p>
      ) : null}
      {error ? <p className="px-4 pt-3 text-sm text-[#e8b4b4]" role="alert">{error}</p> : null}
      {needsLogin ? (
        <div className="px-4 py-6">
          <p className="text-sm">Codex needs you to sign in before this conversation can start.</p>
          <button className="mt-3 rounded-control border border-[var(--agent-border,#333)] px-3 py-1.5 text-sm" onClick={() => void signIn()} type="button">
            {session?.phase === "authenticating" ? "Signing in…" : "Sign in"}
          </button>
        </div>
      ) : (
        <ExternalAgentTimeline items={state.items} />
      )}
      {state.permissions.map((request) => (
        <ExternalAgentPermission
          key={request.requestId}
          onResolve={(optionId, outcome) => {
            void externalAgentsApi.resolvePermission(sessionId, request.requestId, optionId, outcome);
          }}
          request={request}
        />
      ))}
      <ExternalAgentComposer
        disabled={!ready}
        draft={draft}
        onCancel={() => void externalAgentsApi.cancel(sessionId)}
        onConfigChange={(configId, value) => {
          void externalAgentsApi.setConfig(sessionId, configId, value).catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : "Codex rejected that setting.");
          });
        }}
        onDraftChange={setDraft}
        onSubmit={() => void submit()}
        options={state.config}
        pending={state.pendingConfig}
        running={state.turnActive}
      />
    </section>
  );
}
