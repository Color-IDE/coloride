import type {
  AgentEvent,
  AgentMode,
  AgentProvider,
  AgentProviderAvailability,
  AgentProviderConfig,
  AgentSessionSummary,
} from "@coloride/contracts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect } from "react";
import { api } from "../../shared/api/client";
import { getValidAccessToken } from "../auth/cloudAuth";
import {
  getCachedLlmCredits,
  isOutOfCreditsError,
  refreshLlmCredits,
  type LlmCreditsSnapshot,
} from "../auth/llmCredits";
import { type AgentAccessLevel } from "../settings/agentAccess";
import {
  appendLocalTurnEvents,
  HISTORY_EVENT_LIMIT,
  HISTORY_PAGE_TURNS,
  mergeAgentEvents,
  stripLocalTurnSealEvents,
} from "./agentEvents";
import type { AgentViewProps } from "./agentViewTypes";
import type { BuiltAgentPrompt } from "./composer/attachmentPrompt";
import { PROVIDER_OPTIONS } from "./composer/modelCatalog";
import { type ComposerReasoning } from "./composer/modelReasoning";
import { adoptNewTaskPlugins, readSessionPluginIds } from "./sessionPlugins";

interface Dependencies {
  submitting: boolean;
  turnActive: boolean;
  selectedSession: AgentSessionSummary | null;
  setError: Dispatch<SetStateAction<string>>;
  setQueuedFollowUps: Dispatch<SetStateAction<string[]>>;
  props: AgentViewProps;
  agentWorkspacePath: string | null;
  creditsExhausted: boolean;
  setOutOfCreditsPeriodEnd: Dispatch<SetStateAction<string | null>>;
  llmCredits: LlmCreditsSnapshot | null;
  setOutOfCreditsOpen: Dispatch<SetStateAction<boolean>>;
  providerReady: boolean;
  provider: AgentProvider;
  providerConfig: AgentProviderConfig | null;
  providerModel: string;
  providerAvailability: AgentProviderAvailability;
  setSubmitting: Dispatch<SetStateAction<boolean>>;
  setComposerRetryDraft: Dispatch<
    SetStateAction<{ sessionId: string; text: string; key: number } | null>
  >;
  selectedSessionId: string | null;
  setCheckpointReviewOpen: Dispatch<SetStateAction<boolean>>;
  setOpenCheckpointTurnId: Dispatch<SetStateAction<string | null>>;
  watchdogFiredRef: RefObject<string | null>;
  lastAgentEventAtRef: RefObject<number>;
  setSessions: Dispatch<SetStateAction<AgentSessionSummary[]>>;
  setEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  composerReasoning: ComposerReasoning;
  lastAcceptedPromptRef: RefObject<{ sessionId: string; text: string } | null>;
  modeRef: RefObject<AgentMode>;
  accessLevelRef: RefObject<AgentAccessLevel>;
  bufferedEventsRef: RefObject<Map<string, AgentEvent[]>>;
  rememberSessionEvents: (
    sessionId: string,
    nextEvents: AgentEvent[],
  ) => AgentEvent[];
  historyHydratedRef: RefObject<Set<string>>;
  historyHasOlderRef: RefObject<Map<string, boolean>>;
  setOpenChatTabs: Dispatch<SetStateAction<(string | null)[]>>;
  selectSession: (
    sessionId: string | null,
    options?: { preferNewTask?: boolean },
  ) => void;
  setHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setLlmCredits: Dispatch<SetStateAction<LlmCreditsSnapshot | null>>;
  messageFromError: (error: unknown) => string;
  isTurnStillSettlingError: (message: string) => boolean;
  mode: AgentMode;
  newTaskAccessLevel: AgentAccessLevel;
  filesystemScope: "workspace" | "server";
  stopping: boolean;
  stoppingRef: RefObject<boolean>;
  restoringCheckpoint: string | null;
  queuedFollowUpsRef: RefObject<string[]>;
  dispatchingQueueRef: RefObject<boolean>;
  queuedFollowUps: string[];
  setStopping: Dispatch<SetStateAction<boolean>>;
  sessionsRef: RefObject<AgentSessionSummary[]>;
  eventsRef: RefObject<AgentEvent[]>;
}
export function useAgentTurnActions({
  submitting,
  turnActive,
  selectedSession,
  setError,
  setQueuedFollowUps,
  props,
  agentWorkspacePath,
  creditsExhausted,
  setOutOfCreditsPeriodEnd,
  llmCredits,
  setOutOfCreditsOpen,
  providerReady,
  provider,
  providerConfig,
  providerModel,
  providerAvailability,
  setSubmitting,
  setComposerRetryDraft,
  selectedSessionId,
  setCheckpointReviewOpen,
  setOpenCheckpointTurnId,
  watchdogFiredRef,
  lastAgentEventAtRef,
  setSessions,
  setEvents,
  composerReasoning,
  lastAcceptedPromptRef,
  modeRef,
  accessLevelRef,
  bufferedEventsRef,
  rememberSessionEvents,
  historyHydratedRef,
  historyHasOlderRef,
  setOpenChatTabs,
  selectSession,
  setHistoryLoading,
  setLlmCredits,
  messageFromError,
  isTurnStillSettlingError,
  mode,
  newTaskAccessLevel,
  filesystemScope,
  stopping,
  stoppingRef,
  restoringCheckpoint,
  queuedFollowUpsRef,
  dispatchingQueueRef,
  queuedFollowUps,
  setStopping,
  sessionsRef,
  eventsRef,
}: Dependencies) {
  const submit = useCallback(
    async (payload: string | BuiltAgentPrompt): Promise<boolean> => {
      const built: BuiltAgentPrompt =
        typeof payload === "string"
          ? { text: payload.trim(), attachments: [] }
          : {
            text: payload.text.trim(),
            attachments: payload.attachments ?? [],
            pluginIds: payload.pluginIds,
          };
      const prompt = built.text;
      if ((!prompt && !built.attachments.length) || submitting) return false;
      // While a turn is running, queue the next message instead of blocking typing.
      // Attachments can't be queued as structured payloads yet — require idle send.
      if (turnActive) {
        if (!selectedSession) {
          setError(
            "Wait for the active turn to finish or stop it before sending another message.",
          );
          return false;
        }
        if (built.attachments.length) {
          setError(
            "Wait for the current turn to finish before sending attachments.",
          );
          return false;
        }
        setQueuedFollowUps((current) => [...current, prompt]);
        setError("");
        return true;
      }
      if (!props.connected || !agentWorkspacePath) {
        setError("Choose a workspace before starting an agent.");
        return false;
      }
      if (creditsExhausted) {
        setOutOfCreditsPeriodEnd(llmCredits?.periodEnd ?? null);
        setOutOfCreditsOpen(true);
        return false;
      }
      if (!providerReady) {
        const providerLabel = PROVIDER_OPTIONS[provider]?.label ?? provider;
        const modelName = providerConfig?.model ?? providerModel;
        switch (providerAvailability) {
          case "loading":
            setError("Checking model availability. Please wait a moment...");
            break;
          case "auth_expired":
            setError(
              "Your Coloride session has expired. Sign in again to refresh your credentials.",
            );
            break;
          case "missing_credentials":
            setError(
              providerConfig?.managedLlm ||
                providerConfig?.credentialSource === "coloride"
                ? "Sign in to your Coloride account to use the agent. Model access is included with your plan."
                : `Configure a ${providerLabel} API key for Coloride Agent before starting a task.`,
            );
            break;
          case "incompatible":
            setError(
              `${modelName} does not support tools for autonomous implementation. Switch to Ask/Plan or select a compatible model.`,
            );
            break;
          case "connection_error":
            setError(
              `Could not connect to ${providerLabel}. Check your internet connection and credentials.`,
            );
            break;
          default:
            setError(
              "The selected model is currently unavailable. Please verify your configuration.",
            );
            break;
        }
        return false;
      }
      // A managed model cannot safely start with a missing or stale JWT. Fail
      // here instead of launching a turn that then surfaces a misleading 401.
      const managedLlm = Boolean(
        providerConfig?.managedLlm ||
        providerConfig?.credentialSource === "coloride",
      );
      if (managedLlm) {
        try {
          const token = await getValidAccessToken();
          if (!token) {
            setError(
              "Could not refresh your Coloride session. Check your connection or sign in again.",
            );
            return false;
          }
          await api.setCloudAgentToken(token);
        } catch (error) {
          const detail = error instanceof Error ? error.message.trim() : "";
          setError(
            detail
              ? `Could not prepare your Coloride session. ${detail}`
              : "Could not prepare your Coloride session. Check your connection and try again.",
          );
          return false;
        }
      }

      setSubmitting(true);
      setError("");
      setComposerRetryDraft((current) =>
        current?.sessionId === selectedSessionId ? null : current,
      );
      setCheckpointReviewOpen(false);
      setOpenCheckpointTurnId(null);
      // Fresh turn — allow stall watchdog again after a prior stop/auto-stop.
      watchdogFiredRef.current = null;
      lastAgentEventAtRef.current = Date.now();
      // Clear sticky stall banner / local seals so "continue" does not keep
      // "Thought failed" + red error under the new user bubble (those used to
      // pin at MAX sequence and re-fail the next thinking row).
      if (selectedSession) {
        const sid = selectedSession.sessionId;
        setSessions((current) =>
          current.map((session) =>
            session.sessionId === sid
              ? { ...session, lastError: null, guardPause: null }
              : session,
          ),
        );
        setEvents((current) => stripLocalTurnSealEvents(current));
      }
      try {
        const pluginIds =
          built.pluginIds ?? readSessionPluginIds(selectedSessionId);
        const sendBody = {
          reasoningEffort: composerReasoning,
          pluginIds,
          ...(built.attachments.length
            ? { attachments: built.attachments }
            : {}),
        };
        if (selectedSession) {
          await api.sendAgentMessage(
            selectedSession.sessionId,
            prompt || "See attached file(s).",
            sendBody,
          );
          lastAcceptedPromptRef.current = {
            sessionId: selectedSession.sessionId,
            text: prompt || "See attached file(s).",
          };
        } else {
          const response = await api.startAgentSession({
            agent: "coloride",
            cwd: agentWorkspacePath,
            workspaceKind: props.workspaceKind ?? "ssh",
            connectionId: props.connectionId ?? undefined,
            filesystemScope,
            mode: modeRef.current,
            accessLevel: accessLevelRef.current,
            task: prompt || "See attached file(s).",
            reasoningEffort: composerReasoning,
            pluginIds,
            ...(built.attachments.length
              ? { attachments: built.attachments }
              : {}),
          });
          lastAcceptedPromptRef.current = {
            sessionId: response.sessionId,
            text: prompt || "See attached file(s).",
          };
          adoptNewTaskPlugins(response.sessionId);
          const [session, nextEvents] = await Promise.all([
            api.agentSession(response.sessionId),
            api.agentEventsPage(response.sessionId, {
              turns: HISTORY_PAGE_TURNS,
              limit: HISTORY_EVENT_LIMIT,
            }),
          ]);
          const merged = mergeAgentEvents(
            nextEvents,
            bufferedEventsRef.current.get(response.sessionId) ?? [],
          );
          rememberSessionEvents(response.sessionId, merged);
          historyHydratedRef.current.add(response.sessionId);
          historyHasOlderRef.current.set(response.sessionId, false);
          setSessions((current) => [
            session,
            ...current.filter((item) => item.sessionId !== session.sessionId),
          ]);
          setOpenChatTabs((tabs) =>
            Array.from(
              new Set(
                tabs.map((id) => (id === null ? response.sessionId : id)),
              ),
            ),
          );
          selectSession(response.sessionId);
          setEvents(merged);
          setHistoryLoading(false);
          // Session stays local. Credits refresh below is the Coloride account call.
        }
        void refreshLlmCredits({ force: true }).then((snap) => {
          setLlmCredits(snap);
        });
        return true;
      } catch (reason) {
        const msg = messageFromError(reason);
        if (isTurnStillSettlingError(msg) && selectedSession) {
          // The backend remains authoritative. If an IDLE event and the final
          // task cleanup cross in flight, keep the message queued and restore the
          // running state instead of exposing a technical 409/JSON banner.
          setQueuedFollowUps((current) => [...current, prompt]);
          setSessions((current) =>
            current.map((session) =>
              session.sessionId === selectedSession.sessionId
                ? { ...session, state: "running", lastError: null }
                : session,
            ),
          );
          setError("");
          return true;
        }
        if (isOutOfCreditsError(msg)) {
          setOutOfCreditsPeriodEnd(getCachedLlmCredits()?.periodEnd ?? null);
          setOutOfCreditsOpen(true);
          setError("");
          void refreshLlmCredits({ force: true }).then((snap) => {
            setLlmCredits(snap);
            if (snap) {
              if (snap.periodEnd) setOutOfCreditsPeriodEnd(snap.periodEnd);
            }
          });
        } else {
          setError(msg);
        }
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [
      composerReasoning,
      creditsExhausted,
      llmCredits?.periodEnd,
      mode,
      newTaskAccessLevel,
      filesystemScope,
      props.connected,
      props.connectionId,
      props.workspacePath,
      props.workspaceKind,
      agentWorkspacePath,
      provider,
      providerConfig?.configured,
      providerConfig?.credentialSource,
      providerConfig?.managedLlm,
      providerReady,
      rememberSessionEvents,
      selectSession,
      selectedSession,
      selectedSessionId,
      submitting,
      turnActive,
    ],
  );

  // Auto-send the next queued follow-up once the active turn finishes.
  useEffect(() => {
    if (
      turnActive ||
      submitting ||
      stopping ||
      stoppingRef.current ||
      restoringCheckpoint
    )
      return;
    const pending = queuedFollowUpsRef.current[0]?.trim();
    if (!pending || !selectedSession || dispatchingQueueRef.current) return;
    if (!props.connected || !agentWorkspacePath || !providerReady) return;

    const sid = selectedSession.sessionId;
    dispatchingQueueRef.current = true;
    setQueuedFollowUps((current) => current.slice(1));
    void (async () => {
      try {
        // Direct API send — avoid re-entering submit()'s queue branch.
        setSubmitting(true);
        setError("");
        setCheckpointReviewOpen(false);
        setOpenCheckpointTurnId(null);
        watchdogFiredRef.current = null;
        lastAgentEventAtRef.current = Date.now();
        setSessions((current) =>
          current.map((session) =>
            session.sessionId === sid
              ? { ...session, lastError: null }
              : session,
          ),
        );
        setEvents((current) => stripLocalTurnSealEvents(current));
        await api.sendAgentMessage(sid, pending, {
          reasoningEffort: composerReasoning,
          pluginIds: readSessionPluginIds(sid),
        });
      } catch (reason) {
        const msg = messageFromError(reason);
        if (isTurnStillSettlingError(msg)) {
          setSessions((current) =>
            current.map((session) =>
              session.sessionId === sid
                ? { ...session, state: "running", lastError: null }
                : session,
            ),
          );
          setError("");
        } else if (isOutOfCreditsError(msg)) {
          setOutOfCreditsPeriodEnd(getCachedLlmCredits()?.periodEnd ?? null);
          setOutOfCreditsOpen(true);
          setError("");
        } else {
          setError(msg);
        }
        setQueuedFollowUps((current) => [pending, ...current]);
        void refreshLlmCredits({ force: true }).then((snap) => {
          setLlmCredits(snap);
        });
      } finally {
        setSubmitting(false);
        dispatchingQueueRef.current = false;
      }
    })();
  }, [
    composerReasoning,
    props.connected,
    agentWorkspacePath,
    providerReady,
    restoringCheckpoint,
    selectedSession,
    stopping,
    submitting,
    turnActive,
    queuedFollowUps,
  ]);

  const stopGeneration = useCallback(async () => {
    if (!selectedSession || stopping || stoppingRef.current || !turnActive)
      return;
    stoppingRef.current = true;
    setStopping(true);
    setError("");
    // Don't auto-fire queued follow-ups after an explicit stop.
    queuedFollowUpsRef.current = [];
    setQueuedFollowUps([]);
    const sid = selectedSession.sessionId;
    const now = new Date().toISOString();
    lastAgentEventAtRef.current = Date.now();
    watchdogFiredRef.current = sid;
    // Optimistic UI: go idle + soft-seal Thinking (completed, not "Thought failed").
    // Backend also emits a single done{stopped}; no local "Stopped." error spam.
    setSessions((current) =>
      current.map((session) =>
        session.sessionId === sid
          ? { ...session, state: "idle", lastError: null }
          : session,
      ),
    );
    setEvents((current) =>
      appendLocalTurnEvents(current, [
        (sequence) => ({
          id: `local-stop-done-${Date.now()}`,
          sessionId: sid,
          sequence,
          type: "done",
          data: { failed: false, stopped: true },
          createdAt: now,
        }),
      ]),
    );
    try {
      await api.stopAgentSession(sid);
    } catch (reason) {
      setError(messageFromError(reason));
    } finally {
      stoppingRef.current = false;
      setStopping(false);
      void refreshLlmCredits({ force: true }).then((snap) => {
        setLlmCredits(snap);
      });
    }
  }, [selectedSession, stopping, turnActive]);

  // Watchdog: unstick "Thinking" only when the model is actually silent.
  // Never auto-stop while waiting for approval, or while a tool is still running
  // (backend emits tool_progress heartbeats every ~12s during long VPS tools).
  useEffect(() => {
    if (!turnActive || !selectedSessionId) return;
    if (selectedSession?.state === "waiting-approval") {
      // User is deciding — freeze the stall clock so authorize never times out.
      lastAgentEventAtRef.current = Date.now();
      return;
    }
    const STALL_MS = 70_000;
    // Last resort only: sidecar claims running but no events/heartbeats at all.
    // High reasoning can stay quiet for several minutes after a stream stall.
    const HARD_STUCK_MS = 16 * 60_000;
    const timer = window.setInterval(() => {
      if (stoppingRef.current) return;
      // Re-check: approval wait must never trip the stall timer.
      const live = sessionsRef.current.find(
        (s) => s.sessionId === selectedSessionId,
      );
      if (live?.state === "waiting-approval") {
        lastAgentEventAtRef.current = Date.now();
        return;
      }
      // If the latest tool_call has no tool_result yet, a tool is in flight —
      // do not force-stop (heartbeats may have been delayed by a busy sidecar).
      const recent = eventsRef.current.slice(-40);
      let openTool = false;
      for (let i = recent.length - 1; i >= 0; i -= 1) {
        const event = recent[i]!;
        if (
          event.type === "tool_result" ||
          event.type === "done" ||
          event.type === "error"
        )
          break;
        if (event.type === "tool_call" || event.type === "tool_progress") {
          openTool = true;
          break;
        }
      }
      if (openTool) {
        lastAgentEventAtRef.current = Date.now();
        return;
      }
      const idleFor = Date.now() - lastAgentEventAtRef.current;
      if (idleFor < STALL_MS) return;
      const sid = selectedSessionId;
      void (async () => {
        if (stoppingRef.current || watchdogFiredRef.current === sid) return;
        try {
          const remote = await api.agentSession(sid);
          if (!remote) return;
          if (remote.state === "waiting-approval") {
            lastAgentEventAtRef.current = Date.now();
            return;
          }
          const remoteActive = ["starting", "running"].includes(remote.state);
          if (!remoteActive) {
            setSessions((current) =>
              current.map((session) =>
                session.sessionId === sid
                  ? {
                    ...session,
                    state: remote.state,
                    lastError: remote.lastError ?? session.lastError,
                  }
                  : session,
              ),
            );
            const now = new Date().toISOString();
            setEvents((current) =>
              appendLocalTurnEvents(current, [
                (sequence) => ({
                  id: `local-watchdog-done-${Date.now()}`,
                  sessionId: sid,
                  sequence,
                  type: "done",
                  data: { failed: remote.state === "failed", watchdog: true },
                  createdAt: now,
                }),
              ]),
            );
            lastAgentEventAtRef.current = Date.now();
            return;
          }
          // Sidecar is still working (JSON fallback / long model call). Do not
          // force-stop a live turn just because the UI went quiet.
          if (idleFor < HARD_STUCK_MS) return;
          if (stoppingRef.current || watchdogFiredRef.current === sid) return;
          watchdogFiredRef.current = sid;
          stoppingRef.current = true;
          console.warn("[agent-watchdog] forcing stop after silent stall", {
            sid,
            idleFor,
          });
          try {
            await api.stopAgentSession(sid);
          } catch {
            // ignore
          } finally {
            stoppingRef.current = false;
          }
          setSessions((current) =>
            current.map((session) =>
              session.sessionId === sid
                ? { ...session, state: "idle", lastError: null }
                : session,
            ),
          );
          const now = new Date().toISOString();
          const stamp = Date.now();
          setEvents((current) =>
            appendLocalTurnEvents(current, [
              (sequence) => ({
                id: `local-watchdog-error-${stamp}`,
                sessionId: sid,
                sequence,
                type: "error",
                data: {
                  message:
                    "Turn stalled with no model activity. Stopped automatically — send continue to retry.",
                  failed: true,
                  watchdog: true,
                },
                createdAt: now,
              }),
              (sequence) => ({
                id: `local-watchdog-done-${stamp}`,
                sessionId: sid,
                sequence,
                type: "done",
                data: { failed: true, watchdog: true },
                createdAt: now,
              }),
            ]),
          );
          lastAgentEventAtRef.current = Date.now();
        } catch {
          // sidecar busy — try again next tick
        }
      })();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [selectedSessionId, selectedSession?.state, turnActive]);

  return { submit, stopGeneration };
}
