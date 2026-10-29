import { useState } from "react";
import { externalAgentsApi } from "./api";
import { ExternalAgentComposer } from "./ExternalAgentComposer";
import { ExternalAgentPermission } from "./ExternalAgentPermission";
import { ExternalAgentTimeline } from "./ExternalAgentTimeline";
import { useExternalAgentSession } from "./useExternalAgentSession";

export function ExternalAgentView({
  sessionId,
  active,
  starting = false,
  workspaceKind,
}: {
  sessionId: string;
  active: boolean;
  starting?: boolean;
  workspaceKind: "local" | "ssh";
}) {
  const { session, setSession, state, setState, error, setError } =
    useExternalAgentSession(sessionId, active);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const ssh = workspaceKind === "ssh";
  const needsLogin =
    session?.phase === "needs-login" || session?.phase === "authenticating";
  const ready = session?.phase === "ready" && !ssh;
  const name = session?.title || "External agent";
  const connecting =
    starting ||
    !sessionId ||
    !session ||
    session.phase === "installed" ||
    session.phase === "starting";

  const signIn = async (methodId: string) => {
    const method = session?.authMethods.find((item) => item.id === methodId);
    if (!method) return;
    setError("");
    setAuthenticating(true);
    try {
      setSession(await externalAgentsApi.authenticate(sessionId, method.id));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Codex sign-in failed.",
      );
    } finally {
      setAuthenticating(false);
    }
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending || state.turnActive) return;
    setSending(true);
    setError("");
    try {
      await externalAgentsApi.prompt(sessionId, text);
      setDraft("");
      setState((current) => ({ ...current, turnActive: true }));
    } catch (reason) {
      setDraft(text);
      setState((current) => ({ ...current, turnActive: false }));
      setError(
        reason instanceof Error
          ? reason.message
          : "Codex did not accept the message.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      aria-label={`${name} agent`}
      className="agent-view external-agent-view flex h-full min-h-0 flex-col bg-[var(--agent-surface,#212121)]"
    >
      {connecting ? (
        <div
          className="flex min-h-0 flex-1 items-center justify-center"
          role="status"
        >
          <span className="sr-only">Starting agent</span>
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent text-[#878888]"
          />
        </div>
      ) : null}
      {connecting ? null : ssh && sessionId ? (
        <p className="px-4 py-6 text-sm" role="status">
          SSH projects are not supported for Codex yet.
        </p>
      ) : null}
      {connecting ? null : error ? (
        <p className="px-4 pt-3 text-sm text-[#e8b4b4]" role="alert">
          {error}
        </p>
      ) : null}
      {connecting ? null : session?.error ? (
        <p className="px-4 pt-3 text-sm text-[#e8b4b4]" role="status">
          {session.error}
        </p>
      ) : null}
      {connecting
        ? null
        : session && (session.phase === "failed" || session.phase === "closed") ? (
        <button
          className="m-3 self-start rounded-control border border-[var(--agent-border)] px-3 py-1.5 text-sm"
          type="button"
          onClick={() => {
            setError("");
            void externalAgentsApi
              .openSession({
                sessionId,
                agentId: session.agentId,
                workspacePath: session.workspacePath,
                executionTarget: "local",
              })
              .then(setSession)
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Could not reconnect.",
                ),
              );
          }}
        >
          Reconnect
        </button>
      ) : null}
      {connecting ? null : needsLogin ? (
        <div className="px-4 py-6">
          <p className="text-sm">
            {name} needs you to sign in before this conversation can start.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {session?.authMethods
              .filter((method) => method.type === "agent")
              .map((method) => (
                <button
                  key={method.id}
                  disabled={authenticating}
                  className="rounded-control border border-[var(--agent-border,#333)] px-3 py-1.5 text-sm"
                  onClick={() => void signIn(method.id)}
                  type="button"
                >
                  {authenticating ? "Signing in…" : method.name}
                </button>
              ))}
          </div>
        </div>
      ) : (
        <ExternalAgentTimeline
          items={state.items}
          name={name}
          ready={Boolean(ready)}
        />
      )}
      {connecting
        ? null
        : state.permissions.map((request) => (
        <ExternalAgentPermission
          key={request.requestId}
          onResolve={(optionId, outcome) => {
            void externalAgentsApi
              .resolvePermission(
                sessionId,
                request.requestId,
                optionId,
                outcome,
              )
              .then(() => {
                setState((current) => ({
                  ...current,
                  permissions: current.permissions.filter(
                    (item) => item.requestId !== request.requestId,
                  ),
                }));
              })
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Could not resolve permission.",
                ),
              );
          }}
          request={request}
        />
      ))}
      {connecting ? null : (
      <ExternalAgentComposer
        disabled={!ready || sending}
        draft={draft}
        onCancel={() =>
          void externalAgentsApi
            .cancel(sessionId)
            .catch((reason: unknown) => setError(String(reason)))
        }
        onConfigChange={(configId, value) => {
          setState((current) => ({
            ...current,
            pendingConfig: { ...current.pendingConfig, [configId]: value },
          }));
          void externalAgentsApi
            .setConfig(sessionId, configId, value)
            .then((result) => {
              setState((current) => ({
                ...current,
                config: result.options,
                pendingConfig: result.pending,
              }));
            })
            .catch((reason: unknown) => {
              setState((current) => ({ ...current, pendingConfig: {} }));
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Codex rejected that setting.",
              );
            });
        }}
        onDraftChange={setDraft}
        onSubmit={() => void submit()}
        options={
          state.config.length ? state.config : (session?.configOptions ?? [])
        }
        pending={state.pendingConfig}
        running={state.turnActive}
        name={name}
      />
      )}
    </section>
  );
}
