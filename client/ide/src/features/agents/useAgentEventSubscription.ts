import type {
  AgentEvent,
  AgentMode,
  AgentPlan,
  AgentSessionSummary,
} from "@coloride/contracts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { api } from "../../shared/api/client";
import type { AgentTerminalReference } from "../../shared/api/types";
import { getValidAccessToken } from "../auth/cloudAuth";
import {
  getCachedLlmCredits,
  isOutOfCreditsError,
  refreshLlmCredits,
  type LlmCreditsSnapshot,
} from "../auth/llmCredits";
import { recordTokenActivity } from "../settings/activity";
import { type AgentWorkspaceToolKind } from "./AgentWorkspacePanel";
import { logAgentConsoleEvent } from "./agentDiagnostics";
import type { AgentEditKind } from "./agentEditEvents";
import {
  appendLocalTurnEvents,
  bufferAgentEvent,
  mergeAgentEvents,
} from "./agentEvents";
import {
  type AgentFileStreamApply,
  type AgentViewProps,
} from "./agentViewTypes";
import { type ComposerReasoning } from "./composer/modelReasoning";
import { providerFailureMessage } from "./providerFailure";

interface Dependencies {
  timelineRef: RefObject<HTMLDivElement | null>;
  selectedSessionIdRef: RefObject<string | null>;
  lastAgentEventAtRef: RefObject<number>;
  setEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  applyAgentFileStreamRef: RefObject<AgentFileStreamApply | undefined>;
  toolNameFromEventData: (data: Record<string, unknown>) => string;
  workspacePathRef: RefObject<string | null>;
  writeToolPathByItemRef: RefObject<
    Map<string, { path: string; kind: AgentEditKind }>
  >;
  resolveAgentEditPath: (raw: string, workspacePath: string | null) => string;
  pathFromToolEventData: (data: Record<string, unknown>) => string;
  isPathInsideWorkspace: (
    path: string,
    root: string | null | undefined,
  ) => boolean;
  explorerWorkspacePathRef: RefObject<string | null>;
  DELETE_TOOLS: Set<string>;
  WRITE_TOOLS: Set<string>;
  isSidebar: boolean;
  setWorkspaceOpenRequest: Dispatch<
    SetStateAction<{
      kind: AgentWorkspaceToolKind;
      nonce: number;
      terminal?: AgentTerminalReference;
    } | null>
  >;
  bufferedEventsRef: RefObject<Map<string, AgentEvent[]>>;
  llmCreditsRefreshAfterTurnRef: RefObject<boolean>;
  recordLocalActivityRef: RefObject<boolean>;
  lastAcceptedPromptRef: RefObject<{ sessionId: string; text: string } | null>;
  eventsRef: RefObject<AgentEvent[]>;
  setComposerRetryDraft: Dispatch<
    SetStateAction<{ sessionId: string; text: string; key: number } | null>
  >;
  setError: Dispatch<SetStateAction<string>>;
  setOutOfCreditsPeriodEnd: Dispatch<SetStateAction<string | null>>;
  setOutOfCreditsOpen: Dispatch<SetStateAction<boolean>>;
  setLlmCredits: Dispatch<SetStateAction<LlmCreditsSnapshot | null>>;
  setSessions: Dispatch<SetStateAction<AgentSessionSummary[]>>;
  setActivePlan: Dispatch<SetStateAction<AgentPlan | null>>;
  setMode: Dispatch<SetStateAction<AgentMode>>;
  setComposerReasoning: Dispatch<SetStateAction<ComposerReasoning>>;
  watchdogFiredRef: RefObject<string | null>;
  sessionsRef: RefObject<AgentSessionSummary[]>;
  stoppingRef: RefObject<boolean>;
  selectedSessionId: string | null;
  props: AgentViewProps;
  setWorkspaceTerminalRecovery: Dispatch<
    SetStateAction<AgentTerminalReference[]>
  >;
}
export function useAgentEventSubscription({
  timelineRef,
  selectedSessionIdRef,
  lastAgentEventAtRef,
  setEvents,
  applyAgentFileStreamRef,
  toolNameFromEventData,
  workspacePathRef,
  writeToolPathByItemRef,
  resolveAgentEditPath,
  pathFromToolEventData,
  isPathInsideWorkspace,
  explorerWorkspacePathRef,
  DELETE_TOOLS,
  WRITE_TOOLS,
  isSidebar,
  setWorkspaceOpenRequest,
  bufferedEventsRef,
  llmCreditsRefreshAfterTurnRef,
  recordLocalActivityRef,
  lastAcceptedPromptRef,
  eventsRef,
  setComposerRetryDraft,
  setError,
  setOutOfCreditsPeriodEnd,
  setOutOfCreditsOpen,
  setLlmCredits,
  setSessions,
  setActivePlan,
  setMode,
  setComposerReasoning,
  watchdogFiredRef,
  sessionsRef,
  stoppingRef,
  selectedSessionId,
  props,
  setWorkspaceTerminalRecovery,
}: Dependencies) {
  // Batch WS agent events to one React update per animation frame so Thinking/tools
  // paint live instead of freezing the main thread on every SSE crumb.
  const pendingLiveEventsRef = useRef<AgentEvent[]>([]);
  const liveFlushRafRef = useRef<number | null>(null);

  useEffect(() => {
    let selectionResumeHandler: (() => void) | null = null;
    const detachSelectionResume = () => {
      if (!selectionResumeHandler) return;
      document.removeEventListener("selectionchange", selectionResumeHandler);
      selectionResumeHandler = null;
    };
    const scheduleFlushLiveEvents = () => {
      if (liveFlushRafRef.current != null) return;
      liveFlushRafRef.current = window.requestAnimationFrame(flushLiveEvents);
    };
    const flushLiveEvents = () => {
      liveFlushRafRef.current = null;
      const batch = pendingLiveEventsRef.current;
      if (!batch.length) return;
      // Don't re-render markdown under an active chat selection — it wipes the range.
      const timeline = timelineRef.current;
      const selection =
        typeof window !== "undefined" ? window.getSelection() : null;
      const selecting =
        Boolean(timeline) &&
        Boolean(selection) &&
        !selection!.isCollapsed &&
        selection!.rangeCount > 0 &&
        Boolean(selection!.toString()) &&
        Boolean(
          selection!.anchorNode && timeline!.contains(selection!.anchorNode),
        );
      if (selecting) {
        if (!selectionResumeHandler) {
          selectionResumeHandler = () => {
            const still =
              Boolean(timelineRef.current) &&
              Boolean(window.getSelection()) &&
              !window.getSelection()!.isCollapsed &&
              Boolean(window.getSelection()!.toString()) &&
              Boolean(
                window.getSelection()!.anchorNode &&
                timelineRef.current!.contains(
                  window.getSelection()!.anchorNode,
                ),
              );
            if (still) return;
            detachSelectionResume();
            scheduleFlushLiveEvents();
          };
          document.addEventListener("selectionchange", selectionResumeHandler);
        }
        return;
      }
      detachSelectionResume();
      pendingLiveEventsRef.current = [];
      const sid = selectedSessionIdRef.current;
      const forSelected = sid
        ? batch.filter((event) => event.sessionId === sid)
        : [];
      if (forSelected.length) {
        lastAgentEventAtRef.current = Date.now();
        setEvents((current) => mergeAgentEvents(current, forSelected));
        // Live Explorer editor updates (sidebar agent → open file as agent writes).
        for (const event of forSelected) {
          void applyAgentEditEvent(event);
        }
      }
    };

    const applyAgentEditEvent = async (event: AgentEvent) => {
      const apply = applyAgentFileStreamRef.current;
      if (!apply) return;
      const data = (event.data || {}) as Record<string, unknown>;
      const tool = toolNameFromEventData(data);
      const root = workspacePathRef.current;
      const itemId = typeof data.itemId === "string" ? data.itemId : "";
      const remembered = itemId
        ? writeToolPathByItemRef.current.get(itemId)
        : undefined;
      const remember = (path: string, kind: AgentEditKind) => {
        if (itemId) writeToolPathByItemRef.current.set(itemId, { path, kind });
      };
      const resolveRememberedPath = () =>
        resolveAgentEditPath(pathFromToolEventData(data), root) ||
        remembered?.path ||
        "";

      // Progressive content stream (backend file_write_delta).
      if (event.type === "file_write_delta") {
        const path = resolveAgentEditPath(pathFromToolEventData(data), root);
        if (
          !path ||
          !isPathInsideWorkspace(path, explorerWorkspacePathRef.current)
        )
          return;
        remember(path, "write");
        const content =
          typeof data.content === "string" ? data.content : undefined;
        const oldText =
          typeof data.oldText === "string" ? data.oldText : undefined;
        const newText =
          typeof data.newText === "string" ? data.newText : undefined;
        const replaceAll =
          typeof data.replaceAll === "boolean" ? data.replaceAll : undefined;
        const phase = data.phase === "final" ? "final" : "streaming";
        await apply({
          path,
          content,
          oldText,
          newText,
          replaceAll,
          phase,
          reload: phase === "final" && content == null,
        });
        return;
      }

      // On tool start: open write targets early; never open a file the agent is deleting.
      if (event.type === "tool_call") {
        if (DELETE_TOOLS.has(tool)) {
          const path = resolveAgentEditPath(pathFromToolEventData(data), root);
          if (
            path &&
            isPathInsideWorkspace(path, explorerWorkspacePathRef.current)
          ) {
            remember(path, "delete");
          }
          return;
        }
        if (!WRITE_TOOLS.has(tool)) return;
        const path = resolveAgentEditPath(pathFromToolEventData(data), root);
        if (
          !path ||
          !isPathInsideWorkspace(path, explorerWorkspacePathRef.current)
        )
          return;
        remember(path, "write");
        await apply({ path, phase: "streaming" });
        return;
      }

      if (event.type === "tool_output") {
        if (DELETE_TOOLS.has(tool) || remembered?.kind === "delete") {
          const path = resolveRememberedPath();
          if (
            path &&
            isPathInsideWorkspace(path, explorerWorkspacePathRef.current)
          ) {
            remember(path, "delete");
            await apply({ path, phase: "deleted" });
          }
          return;
        }
        if (!WRITE_TOOLS.has(tool) && remembered?.kind !== "write") return;
        const path = resolveRememberedPath();
        if (
          !path ||
          !isPathInsideWorkspace(path, explorerWorkspacePathRef.current)
        )
          return;
        remember(path, "write");
        await apply({ path, phase: "streaming" });
        return;
      }

      if (event.type === "tool_result") {
        const path = resolveRememberedPath();
        const kind = DELETE_TOOLS.has(tool) ? "delete" : remembered?.kind;
        if (itemId) writeToolPathByItemRef.current.delete(itemId);
        if (data.failed === true) {
          if (
            kind === "write" &&
            path &&
            isPathInsideWorkspace(path, explorerWorkspacePathRef.current)
          ) {
            await apply({ path, phase: "failed" });
          }
          return;
        }
        if (
          !path ||
          !isPathInsideWorkspace(path, explorerWorkspacePathRef.current)
        )
          return;
        if (kind === "delete" || DELETE_TOOLS.has(tool)) {
          await apply({ path, phase: "deleted" });
          return;
        }
        if (kind !== "write" && !WRITE_TOOLS.has(tool)) return;
        await apply({ path, phase: "final", reload: true });
      }
    };

    const revealTerminal = (terminal: AgentTerminalReference) => {
      if (terminal.agentSessionId !== selectedSessionIdRef.current) return;
      if (isSidebar) {
        window.dispatchEvent(
          new CustomEvent("coloride:agent-terminal", { detail: terminal }),
        );
      } else {
        setWorkspaceOpenRequest({
          kind: "terminal",
          nonce: Date.now(),
          terminal,
        });
      }
    };
    const socket = api.events((envelope) => {
      if (envelope.event === "term:reveal") {
        revealTerminal(envelope.payload as AgentTerminalReference);
        return;
      }
      if (envelope.event === "agent:event") {
        const event = envelope.payload as AgentEvent;
        logAgentConsoleEvent(event);
        bufferAgentEvent(bufferedEventsRef.current, event);
        if (event.sessionId === selectedSessionIdRef.current) {
          pendingLiveEventsRef.current.push(event);
          scheduleFlushLiveEvents();
        }
        // Managed LLM charges once on the cloud (POST /v1/llm/responses).
        // Never also POST /v1/usage from the desktop — that double-counted
        // (one turn logged 96,073 tokens → balance 192,146).
        if (event.type === "cloud_session_refreshing") {
          void getValidAccessToken()
            .then((token) =>
              token ? api.setCloudAgentToken(token) : undefined,
            )
            .catch(() => undefined);
        }
        if (event.type === "usage") {
          llmCreditsRefreshAfterTurnRef.current = true;
          const data = (event.data || {}) as Record<string, unknown>;
          const numberValue = (value: unknown) => {
            const parsed = typeof value === "number" ? value : Number(value);
            return Number.isFinite(parsed)
              ? Math.max(0, Math.floor(parsed))
              : 0;
          };
          const totalTokens =
            numberValue(data.totalTokens) ||
            numberValue(data.inputTokens) + numberValue(data.outputTokens);
          recordTokenActivity(
            totalTokens,
            `${event.sessionId}:${event.id}`,
            recordLocalActivityRef.current,
          );
        }
        if (
          event.type === "guard_paused" &&
          event.sessionId === selectedSessionIdRef.current &&
          (event.data as { reason?: unknown })?.reason === "provider-errors"
        ) {
          const accepted = lastAcceptedPromptRef.current;
          const timelinePrompt = [...eventsRef.current]
            .reverse()
            .find(
              (item) =>
                item.sessionId === event.sessionId &&
                item.type === "user_message" &&
                !Boolean(item.data?.hidden) &&
                typeof item.data?.text === "string",
            );
          const text =
            accepted?.sessionId === event.sessionId
              ? accepted.text
              : String(timelinePrompt?.data?.text ?? "").trim();
          if (text) {
            setComposerRetryDraft((current) => ({
              sessionId: event.sessionId,
              text,
              key: (current?.key ?? 0) + 1,
            }));
          }
          setError(providerFailureMessage(event.data?.message));
        }
        if (event.type === "done" || event.type === "error") {
          if (event.type === "error") {
            const msg = String(
              (event.data as { message?: unknown })?.message || "",
            );
            if (isOutOfCreditsError(msg, event.data)) {
              setOutOfCreditsPeriodEnd(
                getCachedLlmCredits()?.periodEnd ?? null,
              );
              setOutOfCreditsOpen(true);
              setError(""); // dedicated dialog, not generic banner spam
            }
          }
          // One credits refresh per completed/cancelled turn (deduped in module).
          if (
            llmCreditsRefreshAfterTurnRef.current ||
            event.type === "done" ||
            event.type === "error"
          ) {
            llmCreditsRefreshAfterTurnRef.current = false;
            void refreshLlmCredits({ force: true }).then((snap) => {
              setLlmCredits(snap);
            });
          }
        }
        // Agent switched workspace root — keep session list cwd in sync.
        // Explorer root is updated globally in useServerWorkspace (WS listener),
        // so the tree still changes even if this view unmounts mid-turn.
        if (event.type === "workspace_changed") {
          const cwd =
            typeof (event.data as { cwd?: unknown })?.cwd === "string"
              ? String((event.data as { cwd: string }).cwd).trim()
              : "";
          if (cwd.startsWith("/")) {
            setSessions((current) =>
              current.map((session) =>
                session.sessionId === event.sessionId
                  ? { ...session, cwd }
                  : session,
              ),
            );
            // A chat may analyse a second project. Its cwd is session state,
            // not the user's Explorer workspace, so never navigate the whole
            // app just because the agent changed directory.
          }
        } else if (
          event.type === "tool_output" &&
          (event.data as { tool?: string })?.tool === "change_workspace" &&
          !(event.data as { failed?: boolean })?.failed
        ) {
          const meta = (
            event.data as { metadata?: { cwd?: unknown; unchanged?: unknown } }
          )?.metadata;
          const cwd = typeof meta?.cwd === "string" ? meta.cwd.trim() : "";
          if (cwd.startsWith("/") && meta?.unchanged !== true) {
            setSessions((current) =>
              current.map((session) =>
                session.sessionId === event.sessionId
                  ? { ...session, cwd }
                  : session,
              ),
            );
            // Keep this change inside the agent session; Explorer stays put.
          }
        }
        if (event.type === "plan_updated") {
          const plan = (event.data as { plan?: AgentPlan }).plan;
          if (plan && plan.id) {
            setSessions((current) =>
              current.map((session) =>
                session.sessionId === event.sessionId
                  ? {
                    ...session,
                    plan:
                      plan.status === "dismissed" ||
                        plan.status === "completed"
                        ? plan.status === "completed"
                          ? plan
                          : null
                        : plan,
                  }
                  : session,
              ),
            );
            if (event.sessionId === selectedSessionIdRef.current) {
              if (plan.status === "dismissed") setActivePlan(null);
              else setActivePlan(plan);
            }
          }
        }
        if (event.type === "mode_changed") {
          const nextMode = (event.data as { mode?: AgentMode }).mode;
          if (nextMode) {
            setSessions((current) =>
              current.map((session) =>
                session.sessionId === event.sessionId
                  ? { ...session, mode: nextMode }
                  : session,
              ),
            );
            if (event.sessionId === selectedSessionIdRef.current)
              setMode(nextMode);
          }
        }
        if (event.type === "reasoning_changed") {
          const nextEffort = (
            event.data as { reasoningEffort?: ComposerReasoning }
          ).reasoningEffort;
          if (
            nextEffort === "none" ||
            nextEffort === "low" ||
            nextEffort === "medium" ||
            nextEffort === "high" ||
            nextEffort === "xhigh" ||
            nextEffort === "max"
          ) {
            setSessions((current) =>
              current.map((session) =>
                session.sessionId === event.sessionId
                  ? { ...session, reasoningEffort: nextEffort }
                  : session,
              ),
            );
            if (event.sessionId === selectedSessionIdRef.current)
              setComposerReasoning(nextEffort);
          }
        }
        return;
      }
      if (envelope.event === "agent:state") {
        const payload = envelope.payload as {
          sessionId: string;
          state: AgentSessionSummary["state"];
        };
        if (payload.sessionId === selectedSessionIdRef.current) {
          lastAgentEventAtRef.current = Date.now();
          // New turn activity clears the one-shot watchdog latch.
          if (payload.state === "starting" || payload.state === "running") {
            if (watchdogFiredRef.current === payload.sessionId) {
              watchdogFiredRef.current = null;
            }
          }
          // Approvals must never race a stall timer.
          if (payload.state === "waiting-approval") {
            lastAgentEventAtRef.current = Date.now();
          }
        }
        setSessions((current) =>
          current.map((session) =>
            session.sessionId === payload.sessionId
              ? { ...session, state: payload.state }
              : session,
          ),
        );
        // Agent state stays on this machine. Managed model calls use the Coloride
        // API on their own; they do not publish the session to the dashboard.
        // When the backend ends a turn, force-seal any stuck thinking rows even if
        // a "done"/"error" event was missed by the timeline merger.
        // Skip while a user stop is in flight — stop already injected a soft seal.
        if (
          payload.sessionId === selectedSessionIdRef.current &&
          !stoppingRef.current &&
          (payload.state === "idle" ||
            payload.state === "stopped" ||
            payload.state === "failed")
        ) {
          const now = new Date().toISOString();
          const sid = payload.sessionId;
          setEvents((current) => {
            // Avoid stacking seal dones if the timeline already has a recent stop/done.
            const hasRecentStop = [...current]
              .slice(-8)
              .some(
                (event) =>
                  event.type === "done" &&
                  (Boolean(event.data?.stopped) ||
                    Boolean(event.data?.localSeal) ||
                    Boolean(event.data?.watchdog)),
              );
            if (hasRecentStop) return current;
            return appendLocalTurnEvents(current, [
              (sequence) => ({
                id: `local-seal-${Date.now()}`,
                sessionId: sid,
                sequence,
                type: "done",
                data: { failed: payload.state === "failed", localSeal: true },
                createdAt: now,
              }),
            ]);
          });
        }
        return;
      }
      if (envelope.event === "agent:session") {
        const nextSession = envelope.payload as AgentSessionSummary;
        setSessions((current) =>
          current.some((session) => session.sessionId === nextSession.sessionId)
            ? current.map((session) =>
              session.sessionId === nextSession.sessionId
                ? nextSession
                : session,
            )
            : [nextSession, ...current],
        );
      }
    });
    return () => {
      detachSelectionResume();
      if (liveFlushRafRef.current != null) {
        window.cancelAnimationFrame(liveFlushRafRef.current);
        liveFlushRafRef.current = null;
      }
      // Final flush so we don't drop the last frame of deltas.
      if (pendingLiveEventsRef.current.length) {
        const batch = pendingLiveEventsRef.current;
        pendingLiveEventsRef.current = [];
        const sid = selectedSessionIdRef.current;
        const forSelected = sid
          ? batch.filter((event) => event.sessionId === sid)
          : [];
        if (forSelected.length) {
          setEvents((current) => mergeAgentEvents(current, forSelected));
        }
      }
      socket.close();
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    void api
      .listTerminals({
        workspaceKind: props.workspaceKind ?? "ssh",
        connectionId: props.connectionId,
      })
      .then((terminals) => {
        if (cancelled) return;
        const owned = terminals.filter(
          (terminal) =>
            terminal.agentSessionId === selectedSessionId &&
            terminal.status !== "exited" &&
            terminal.revealed !== false,
        );
        if (isSidebar) {
          for (const terminal of owned)
            window.dispatchEvent(
              new CustomEvent("coloride:agent-terminal", { detail: terminal }),
            );
        } else {
          setWorkspaceTerminalRecovery(owned);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, props.workspaceKind, props.connectionId, isSidebar]);
}
