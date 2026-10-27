import type {
  AgentEvent,
  AgentMode,
  AgentPlan,
  AgentProvider,
  AgentProviderConfig,
  AgentSessionSummary
} from "@coloride/contracts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { startTransition, useCallback, useEffect } from "react";
import { api } from "../../shared/api/client";
import type { AgentTerminalReference } from "../../shared/api/types";
import { type LlmCreditsSnapshot } from "../auth/llmCredits";
import { buildAgentTimeline, groupTimelineTurns } from "./AgentTimeline";
import { type AgentWorkspaceToolKind } from "./AgentWorkspacePanel";
import type { AgentEditKind } from "./agentEditEvents";
import {
  HISTORY_EVENT_LIMIT,
  HISTORY_PAGE_TURNS,
  historyPageMayHaveOlder,
  mergeAgentEvents,
  PREFETCH_SESSION_COUNT,
  TIMELINE_RENDER_TURNS
} from "./agentEvents";
import {
  ARCHIVED_TASKS_KEY,
  readPreferNewTask,
  readStoredSessionId,
  readStoredTaskIds,
  writeKeptCheckpointsBySession,
  writePreferNewTask,
} from "./agentStorage";
import {
  type AgentFileStreamApply,
  type AgentViewProps,
} from "./agentViewTypes";
import { type ComposerReasoning } from "./composer/modelReasoning";
import { useAgentEventSubscription } from "./useAgentEventSubscription";
import { useAgentSelectedHistory } from "./useAgentSelectedHistory";

interface Dependencies {
  selectedSessionIdRef: RefObject<string | null>;
  sessionsRef: RefObject<AgentSessionSummary[]>;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setSessions: Dispatch<SetStateAction<AgentSessionSummary[]>>;
  setEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  setHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  configSeqRef: RefObject<number>;
  props: AgentViewProps;
  filesystemScope: "workspace" | "server";
  setProviderConfig: Dispatch<SetStateAction<AgentProviderConfig | null>>;
  setProvider: Dispatch<SetStateAction<AgentProvider>>;
  setProviderModel: Dispatch<SetStateAction<string>>;
  setArchivedTaskIds: Dispatch<SetStateAction<string[]>>;
  sessionPane: "sidebar" | "agent";
  setTimelineRenderLimit: Dispatch<SetStateAction<number>>;
  setActiveTimelineTurn: Dispatch<SetStateAction<number>>;
  setHistoryHasOlder: Dispatch<SetStateAction<boolean>>;
  historyHasOlderRef: RefObject<Map<string, boolean>>;
  bufferedEventsRef: RefObject<Map<string, AgentEvent[]>>;
  historyHydratedRef: RefObject<Set<string>>;
  setPinnedTaskIds: Dispatch<SetStateAction<string[]>>;
  setHiddenTaskIds: Dispatch<SetStateAction<string[]>>;
  setKeptCheckpointsBySession: Dispatch<
    SetStateAction<Record<string, string[]>>
  >;
  setError: Dispatch<SetStateAction<string>>;
  rememberSessionEvents: (
    sessionId: string,
    nextEvents: AgentEvent[],
  ) => AgentEvent[];
  messageFromError: (error: unknown) => string;
  selectedSessionId: string | null;
  selectedSession: AgentSessionSummary | null;
  historyFetchGenRef: RefObject<number>;
  historyOlderRequestRef: RefObject<boolean>;
  historyHasOlder: boolean;
  eventsRef: RefObject<AgentEvent[]>;
  setHistoryLoadingOlder: Dispatch<SetStateAction<boolean>>;
  timelineRef: RefObject<HTMLDivElement | null>;
  lastAgentEventAtRef: RefObject<number>;
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
  llmCreditsRefreshAfterTurnRef: RefObject<boolean>;
  recordLocalActivityRef: RefObject<boolean>;
  lastAcceptedPromptRef: RefObject<{ sessionId: string; text: string } | null>;
  setComposerRetryDraft: Dispatch<
    SetStateAction<{ sessionId: string; text: string; key: number } | null>
  >;
  setOutOfCreditsPeriodEnd: Dispatch<SetStateAction<string | null>>;
  setOutOfCreditsOpen: Dispatch<SetStateAction<boolean>>;
  setLlmCredits: Dispatch<SetStateAction<LlmCreditsSnapshot | null>>;
  setActivePlan: Dispatch<SetStateAction<AgentPlan | null>>;
  setMode: Dispatch<SetStateAction<AgentMode>>;
  setComposerReasoning: Dispatch<SetStateAction<ComposerReasoning>>;
  watchdogFiredRef: RefObject<string | null>;
  stoppingRef: RefObject<boolean>;
  setWorkspaceTerminalRecovery: Dispatch<
    SetStateAction<AgentTerminalReference[]>
  >;
}
export function useAgentSessions({
  selectedSessionIdRef,
  sessionsRef,
  setSelectedSessionId,
  setSessions,
  setEvents,
  setHistoryLoading,
  setLoading,
  configSeqRef,
  props,
  filesystemScope,
  setProviderConfig,
  setProvider,
  setProviderModel,
  setArchivedTaskIds,
  sessionPane,
  setTimelineRenderLimit,
  setActiveTimelineTurn,
  setHistoryHasOlder,
  historyHasOlderRef,
  bufferedEventsRef,
  historyHydratedRef,
  setPinnedTaskIds,
  setHiddenTaskIds,
  setKeptCheckpointsBySession,
  setError,
  rememberSessionEvents,
  messageFromError,
  selectedSessionId,
  selectedSession,
  historyFetchGenRef,
  historyOlderRequestRef,
  historyHasOlder,
  eventsRef,
  setHistoryLoadingOlder,
  timelineRef,
  lastAgentEventAtRef,
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
  llmCreditsRefreshAfterTurnRef,
  recordLocalActivityRef,
  lastAcceptedPromptRef,
  setComposerRetryDraft,
  setOutOfCreditsPeriodEnd,
  setOutOfCreditsOpen,
  setLlmCredits,
  setActivePlan,
  setMode,
  setComposerReasoning,
  watchdogFiredRef,
  stoppingRef,
  setWorkspaceTerminalRecovery,
}: Dependencies) {
  useEffect(() => {
    let cancelled = false;
    // A selected session belongs to a concrete workspace. Clear it before the
    // next fetch so a VPS conversation never flashes in a local folder.
    selectedSessionIdRef.current = null;
    sessionsRef.current = [];
    setSelectedSessionId(null);
    setSessions([]);
    setEvents([]);
    setHistoryLoading(false);
    const load = async () => {
      setLoading(true);
      try {
        // Local history must not wait for cloud authentication. Provider state
        // syncs the token and refreshes availability independently in the background.
        const seq = ++configSeqRef.current;
        const [nextSessions, nextConfig] = await Promise.all([
          api.agentSessions({
            workspaceKind: props.workspaceKind ?? "ssh",
            // Local chats are separated by their own cwd grants, not by a
            // server profile. This also keeps chats created by older builds.
            connectionId:
              props.workspaceKind === "local" ? undefined : props.connectionId,
            filesystemScope,
          }),
          api.agentConfig(),
        ]);
        if (cancelled) return;
        setSessions(nextSessions);
        if (seq >= configSeqRef.current) {
          setProviderConfig(nextConfig);
          setProvider(nextConfig.provider);
          setProviderModel(nextConfig.model);
        }
        const known = new Set(nextSessions.map((session) => session.sessionId));
        const backendArchived = nextSessions
          .filter((session) => Boolean(session.archived))
          .map((session) => session.sessionId);
        // One-time migrate: local-only archives → durable backend flag on disk.
        const legacyLocal = readStoredTaskIds(ARCHIVED_TASKS_KEY).filter((id) =>
          known.has(id),
        );
        const toMigrate = legacyLocal.filter(
          (id) => !backendArchived.includes(id),
        );
        if (toMigrate.length) {
          void Promise.all(
            toMigrate.map((id) =>
              api.archiveAgentSession(id, true).catch(() => null),
            ),
          ).then((results) => {
            const migrated = results.filter(
              (item): item is AgentSessionSummary => Boolean(item),
            );
            if (!migrated.length) return;
            setSessions((current) =>
              current.map((session) => {
                const hit = migrated.find(
                  (item) => item.sessionId === session.sessionId,
                );
                return hit ? { ...session, ...hit, archived: true } : session;
              }),
            );
          });
        }
        setArchivedTaskIds([...new Set([...backendArchived, ...legacyLocal])]);
        const current = selectedSessionIdRef.current;
        const stored = readStoredSessionId(sessionPane);
        const visibleSessions = nextSessions.filter(
          (session) =>
            !session.archived && !legacyLocal.includes(session.sessionId),
        );
        const stillExists =
          Boolean(current) &&
          visibleSessions.some((session) => session.sessionId === current);
        // New task must survive presentation changes between Explorer and Agents.
        const preferNewTask =
          readPreferNewTask(sessionPane) ||
          (current === null && sessionsRef.current.length > 0);
        const next = stillExists
          ? current
          : preferNewTask
            ? null
            : stored &&
              visibleSessions.some((session) => session.sessionId === stored)
              ? stored
              : (visibleSessions[0]?.sessionId ?? null);
        if (next) writePreferNewTask(sessionPane, false);
        selectedSessionIdRef.current = next;
        setSelectedSessionId(next);
        setTimelineRenderLimit(TIMELINE_RENDER_TURNS);
        setActiveTimelineTurn(0);
        setHistoryHasOlder(
          next ? (historyHasOlderRef.current.get(next) ?? false) : false,
        );
        // Seed timeline from cache immediately so restore doesn't flash empty → full.
        const cached = next ? (bufferedEventsRef.current.get(next) ?? []) : [];
        setEvents(cached);
        setHistoryLoading(
          Boolean(next) &&
          !historyHydratedRef.current.has(next!) &&
          cached.length === 0,
        );
        // Drop pin/hidden ids that no longer exist. Never wipe against empty loads.
        if (known.size > 0) {
          setPinnedTaskIds((currentIds) =>
            currentIds.filter((id) => known.has(id)),
          );
          setHiddenTaskIds((currentIds) =>
            currentIds.filter((id) => known.has(id)),
          );
        }
        // Drop kept-checkpoint entries for deleted sessions (defer disk write).
        setKeptCheckpointsBySession((currentMap) => {
          let changed = false;
          const nextMap: Record<string, string[]> = {};
          for (const [sessionId, ids] of Object.entries(currentMap)) {
            if (!known.has(sessionId)) {
              changed = true;
              continue;
            }
            nextMap[sessionId] = ids;
          }
          if (!changed) return currentMap;
          queueMicrotask(() => writeKeptCheckpointsBySession(nextMap));
          return nextMap;
        });
        setError("");

        // Prefetch a few nearby histories sequentially (idle) — never stampede 20k×N fetches.
        const prefetchIds = nextSessions
          .map((session) => session.sessionId)
          .filter((id) => id !== next && !historyHydratedRef.current.has(id))
          .slice(0, PREFETCH_SESSION_COUNT);
        const runPrefetch = async () => {
          for (const sessionId of prefetchIds) {
            if (cancelled) return;
            try {
              const nextEvents = await api.agentEventsPage(sessionId, {
                turns: HISTORY_PAGE_TURNS,
                limit: HISTORY_EVENT_LIMIT,
              });
              if (cancelled) return;
              const merged = mergeAgentEvents(
                nextEvents,
                bufferedEventsRef.current.get(sessionId) ?? [],
              );
              rememberSessionEvents(sessionId, merged);
              historyHydratedRef.current.add(sessionId);
              historyHasOlderRef.current.set(
                sessionId,
                historyPageMayHaveOlder(nextEvents),
              );
            } catch {
              // Prefetch is best-effort.
            }
          }
        };
        const w = typeof window !== "undefined" ? window : null;
        if (w && "requestIdleCallback" in w) {
          (
            w as Window & { requestIdleCallback: (cb: () => void) => number }
          ).requestIdleCallback(() => {
            void runPrefetch();
          });
        } else {
          globalThis.setTimeout(() => void runPrefetch(), 400);
        }
      } catch (reason) {
        if (!cancelled) setError(messageFromError(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    filesystemScope,
    props.connected,
    props.connectionId,
    props.workspaceKind,
    rememberSessionEvents,
    sessionPane,
  ]);
  useAgentSelectedHistory({
    selectedSessionId,
    selectedSession,
    setHistoryLoading,
    selectedSessionIdRef,
    historyFetchGenRef,
    bufferedEventsRef,
    historyHydratedRef,
    setHistoryHasOlder,
    historyHasOlderRef,
    rememberSessionEvents,
    setEvents,
    setError,
    messageFromError,
  });

  const loadOlderHistory = useCallback(async () => {
    const sessionId = selectedSessionIdRef.current;
    if (!sessionId || historyOlderRequestRef.current) return;
    if (!(historyHasOlderRef.current.get(sessionId) ?? historyHasOlder)) return;
    const currentEvents = eventsRef.current;
    if (!currentEvents.length) return;
    const beforeSequence = Math.min(
      ...currentEvents.map((event) => event.sequence),
    );

    historyOlderRequestRef.current = true;
    setHistoryLoadingOlder(true);
    try {
      const page = await api.agentEventsPage(sessionId, {
        beforeSequence,
        turns: HISTORY_PAGE_TURNS,
        limit: HISTORY_EVENT_LIMIT,
      });
      if (selectedSessionIdRef.current !== sessionId) return;
      const hasOlder = historyPageMayHaveOlder(page);
      historyHasOlderRef.current.set(sessionId, hasOlder);
      setHistoryHasOlder(hasOlder);
      if (!page.length) return;

      const pageTurnCount = groupTimelineTurns(
        buildAgentTimeline(page, { sealIncomplete: true }),
      ).length;
      const merged = mergeAgentEvents(page, eventsRef.current);
      rememberSessionEvents(sessionId, merged);
      startTransition(() => {
        setTimelineRenderLimit((current) => current + pageTurnCount);
        setActiveTimelineTurn((current) => current + pageTurnCount);
        setEvents(merged);
      });
    } catch (reason) {
      if (selectedSessionIdRef.current === sessionId)
        setError(messageFromError(reason));
    } finally {
      historyOlderRequestRef.current = false;
      if (selectedSessionIdRef.current === sessionId)
        setHistoryLoadingOlder(false);
    }
  }, [historyHasOlder, rememberSessionEvents]);

  useAgentEventSubscription({
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
  });
  /** Selecting chat text — don't fight the drag with scroll jumps or DOM churn. */

  return { loadOlderHistory };
}
