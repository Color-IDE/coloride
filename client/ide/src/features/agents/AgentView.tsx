import type {
  AgentCheckpoint,
  AgentMode,
  AgentPlan,
  AgentPlanStep,
  AgentProviderAvailability,
  AgentSessionSummary
} from "@coloride/contracts";
import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { api } from "../../shared/api/client";
import { AgentMark } from "../external-agents";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../../shared/ui/Menu";
import { useContextMenuPosition } from "../../shared/ui/useContextMenuPosition";
import {
  clearIdeReviewsForPaths,
  normalizeAgentPath,
  registerAgentCheckpointSync,
} from "../editor/agentEditBridge";
import {
  getDefaultAgentAccessLevel,
  setDefaultAgentAccessLevel,
  useDefaultAgentAccessLevel,
  type AgentAccessLevel,
} from "../settings/agentAccess";
import { useAppPreferences } from "../settings/preferences";
import { formatShortcut, useShortcutBindings } from "../settings/shortcuts";
import { XTerminal } from "../terminal/XTerminal";
import { AgentChatHeader } from "./AgentChatHeader";
import { AgentComposerDock } from "./AgentComposerDock";
import { AgentContextMenu } from "./AgentContextMenu";
import { AgentConversationTurn } from "./AgentConversationTurn";
import { OutOfCreditsDialog } from "./AgentCreditsMeter";
import { AgentEmptyState } from "./AgentEmptyState";
import { AgentSessionSidebar } from "./AgentSessionSidebar";
import {
  checkpointsFromEntries,
  collectTurnFileStats,
  groupTimelineTurns
} from "./AgentTimeline";
import { AgentTimelineScrubber } from "./AgentTimelineScrubber";
import {
  AgentWorkspacePanel,
  type AgentWorkspaceToolKind,
} from "./AgentWorkspacePanel";
import { ChatHistoryDialog, chatTitle } from "./ChatHistoryDialog";
import { ComplementsView } from "./ComplementsView";
import {
  DELETE_TOOLS,
  pathFromToolEventData,
  resolveAgentEditPath,
  toolNameFromEventData,
  WRITE_TOOLS,
  type AgentEditKind,
} from "./agentEditEvents";
import {
  HISTORY_EVENT_LIMIT,
  HISTORY_PAGE_TURNS,
  mergeAgentEvents
} from "./agentEvents";
import {
  defaultMode,
  hasModelCredits,
  isTurnStillSettlingError,
  messageFromError,
} from "./agentProviderState";
import {
  keptIdsForSession,
  mergeKeptCheckpointIds,
  pruneKeptCheckpointIds,
  readKeptCheckpointsBySession,
  readNewTaskNoRepo,
  readStoredComposerReasoning,
  toggleStoredId,
  writeKeptCheckpointsBySession,
  writeNewTaskNoRepo,
  writePreferNewTask,
  writeStoredComposerReasoning,
} from "./agentStorage";
import { type AgentViewProps } from "./agentViewTypes";
import {
  isHomeWorkspacePath,
  isPathInsideWorkspace,
  normalizeWorkspaceCwd,
  pathTailLabel,
  uniqueWorkspaceLabels,
} from "./agentWorkspacePaths";
import {
  checkpointPathsWithLaterEdits,
  resolveCheckpointPaths,
  restoreCheckpointBatch,
} from "./checkpointReview";
import { modelContextWindow } from "./composer/modelCatalog";
import { type ComposerReasoning } from "./composer/modelReasoning";
import { clearComposerDraft } from "./composerDrafts";
import { providerFailureMessage } from "./providerFailure";
import { clearSessionPlugins, copySessionPlugins } from "./sessionPlugins";
import {
  findAgentPlugin,
  SUMMARIZE_PROMPT,
  type SlashCommandInvocation,
  type SlashCommandResult,
} from "./slashCommands";
import { useAgentHeaderState } from "./useAgentHeaderState";
import { useAgentHistoryState } from "./useAgentHistoryState";
import { useAgentPlanActions } from "./useAgentPlanActions";
import { useAgentProviderActions } from "./useAgentProviderActions";
import { useAgentProviderState } from "./useAgentProviderState";
import { useAgentErrorNotification } from "./useAgentErrorNotification";
import { useAgentSessionNavigation } from "./useAgentSessionNavigation";
import { useAgentSessionState } from "./useAgentSessionState";
import { useAgentSessions } from "./useAgentSessions";
import { useAgentTimelineModel } from "./useAgentTimelineModel";
import { useAgentTimelineViewport } from "./useAgentTimelineViewport";
import { useAgentTurnActions } from "./useAgentTurnActions";
import { useAgentWorkspaceLayout } from "./useAgentWorkspaceLayout";
import { useAgentWorkspaceNavigation } from "./useAgentWorkspaceNavigation";

export type { AgentFileStreamApply } from "./agentViewTypes";

const MotionMenu = motion.create(Menu);

export type { AgentAccessLevel } from "../settings/agentAccess";

// The Explorer chat should never paint a browser over Monaco. This stable id
// lets links reuse one independent Coloride Browser window instead.
const SIDEBAR_BROWSER_TAB_ID = "coloride-agent-sidebar-browser";

export function AgentView(props: AgentViewProps) {
  const isSidebar = props.presentation === "sidebar";
  // Sidebar is only a compact presentation. It shares the complete Agents
  // session, scope, history and command behavior instead of acting as a second
  // workspace-bound agent.
  const sessionPane = props.sessionPane ?? "agent";
  const chatTabsKey = `coloride.agent.open-tabs.v1.${JSON.stringify([sessionPane, props.workspaceKind, props.connectionId, normalizeWorkspaceCwd(props.workspacePath)])}`;
  const filesystemScope = props.filesystemScope ?? "server";
  const preferences = useAppPreferences();
  const shortcutBindings = useShortcutBindings();
  const newTaskShortcut = formatShortcut(shortcutBindings["agents.new-task"]);
  const recordLocalActivityRef = useRef(preferences.recordLocalActivity);
  recordLocalActivityRef.current = preferences.recordLocalActivity;
  const {
    openChatTabs,
    sessions,
    setOpenChatTabs,
    selectedSessionId,
    setSessions,
    events,
    bufferedEventsRef,
    setComplementsOpen,
    selectedSessionIdRef,
    stickToBottomRef,
    setHistoryLoadingOlder,
    setHistoryHasOlder,
    historyHasOlderRef,
    historyFetchGenRef,
    setHistoryLoading,
    setEvents,
    setSelectedSessionId,
    historyHydratedRef,
    configSeqRef,
    sessionsRef,
    historyOlderRequestRef,
    historyHasOlder,
    eventsRef,
    timelineRef,
    watchdogFiredRef,
    historyLoading,
    complementsOpen,
    historyLoadingOlder,
  } = useAgentSessionState({ sessionPane, chatTabsKey });
  const [newTaskWorkspacePath, setNewTaskWorkspacePath] = useState<
    string | null
  >(props.workspacePath);
  /** New Task "No repo" — start without a selected folder; a repo can be given later in chat. */
  const [newTaskNoRepo, setNewTaskNoRepoState] = useState(() =>
    readNewTaskNoRepo(sessionPane),
  );
  const setNewTaskNoRepo = useCallback(
    (value: boolean) => {
      writeNewTaskNoRepo(sessionPane, value);
      setNewTaskNoRepoState(value);
    },
    [sessionPane],
  );
  const {
    activeHeaderTerminal,
    setActiveHeaderTerminal,
    agentContextRootRef,
    headerTabMenu,
    setHeaderTabMenu,
    headerTabMenuPlacement,
    chatTabsScrollRef,
    chatTabScroll,
    updateChatTabScroll,
  } = useAgentHeaderState({ openChatTabs, sessions, isSidebar, setOpenChatTabs, selectedSessionId, chatTabsKey, props });
  const {
    chatHistoryOpen,
    setChatHistoryOpen,
    chatHistoryDetails,
    handleHistoryDetails,
    chatTitles,
    setChatTitles,
    archivedTaskIds,
    setArchivedTaskIds,
    hiddenTaskIds,
    setHiddenTaskIds,
    pinnedTaskIds,
    setPinnedTaskIds,
    projects,
    setProjects,
  } = useAgentHistoryState({ sessionPane, selectedSessionId });

  useEffect(() => {
    if (isSidebar || selectedSessionId === null) {
      setNewTaskWorkspacePath(props.workspacePath);
    }
  }, [
    isSidebar,
    props.workspacePath,
    props.workspaceKind,
    props.connectionId,
    selectedSessionId,
  ]);

  const [taskMenu, setTaskMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);
  const taskMenuPlacement = useContextMenuPosition(taskMenu);
  /** Bumps to clear the composer draft without lifting keystrokes into AgentView. */
  const [composerDraftKey, setComposerDraftKey] = useState(0);
  /** A provider outage returns the exact sent text to the composer for retry. */
  const [composerRetryDraft, setComposerRetryDraft] = useState<{
    sessionId: string;
    text: string;
    key: number;
  } | null>(null);
  /** Follow-ups typed while a turn is still running — sent FIFO when idle. */
  const [queuedFollowUps, setQueuedFollowUps] = useState<string[]>([]);
  const queuedFollowUpsRef = useRef<string[]>([]);
  const dispatchingQueueRef = useRef(false);
  queuedFollowUpsRef.current = queuedFollowUps;
  const [mode, setMode] = useState<AgentMode>(() => defaultMode());
  const modeRef = useRef<AgentMode>(defaultMode());
  /** Tool approval level — separate from Ask/Plan/Debug submodes. */
  const defaultAccessLevel = useDefaultAgentAccessLevel();
  const [newTaskAccessLevel, setNewTaskAccessLevel] =
    useState<AgentAccessLevel>(() => getDefaultAgentAccessLevel());
  useEffect(() => {
    setNewTaskAccessLevel(defaultAccessLevel);
  }, [defaultAccessLevel]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [changingMode, setChangingMode] = useState(false);
  const [autoModel, setAutoModel] = useState(false);
  const [composerReasoning, setComposerReasoning] = useState<ComposerReasoning>(
    () => readStoredComposerReasoning(sessionPane),
  );
  const [resolvingApproval, setResolvingApproval] = useState<string | null>(
    null,
  );
  const [resolvingGuard, setResolvingGuard] = useState<string | null>(null);
  const [restoringCheckpoint, setRestoringCheckpoint] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!chatHistoryOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setChatHistoryOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [chatHistoryOpen]);
  const {
    llmCredits,
    setLlmCredits,
    outOfCreditsOpen,
    setOutOfCreditsOpen,
    outOfCreditsPeriodEnd,
    setOutOfCreditsPeriodEnd,
    llmCreditsRefreshAfterTurnRef,
    providerConfig,
    provider,
    providerModel,
    savingProvider,
    setProviderConfig,
    setProvider,
    setProviderModel,
    setSavingProvider,
  } = useAgentProviderState({ configSeqRef, viewActive: props.active !== false });
  const [error, setError] = useAgentErrorNotification({ suppressed: outOfCreditsOpen });
  const workspacePathRef = useRef(props.workspacePath);
  const explorerWorkspacePathRef = useRef(props.workspacePath);
  explorerWorkspacePathRef.current = props.workspacePath;
  const applyAgentFileStreamRef = useRef(props.onApplyAgentFileStream);
  applyAgentFileStreamRef.current = props.onApplyAgentFileStream;
  /** itemId → absolute path + kind for in-flight file tools (tool_result may omit path). */
  const writeToolPathByItemRef = useRef(
    new Map<string, { path: string; kind: AgentEditKind }>(),
  );
  /** Last agent event time for the selected session (stuck-turn watchdog). */
  const lastAgentEventAtRef = useRef<number>(Date.now());
  /** Prevents double stop (UI + watchdog) and blocks stall while user is approving. */
  const stoppingRef = useRef(false);
  const lastAcceptedPromptRef = useRef<{
    sessionId: string;
    text: string;
  } | null>(null);
  const {
    workspaceTerminalRecovery,
    workspaceOpenRequest,
    setWorkspaceOpenRequest,
    workspaceFileRequest,
    setWorkspaceFileRequest,
    workspaceBrowserRequest,
    handledBrowserOpenKeys,
    viewActive,
    workspaceCardOpen,
    browserExpanded,
    setBrowserExpanded,
    handleWorkspaceTabsChange,
    workspacePaneWidth,
    startWorkspaceResize,
    setWorkspaceTerminalRecovery,
    setWorkspaceBrowserRequest,
  } = useAgentWorkspaceLayout({ props });

  const selectedSessionRecord =
    sessions.find((session) => session.sessionId === selectedSessionId) ?? null;
  const selectedSession: AgentSessionSummary | null = selectedSessionRecord;
  const activeSessionId = selectedSession?.sessionId ?? null;
  const agentWorkspacePath =
    (isSidebar
      ? props.workspacePath || selectedSession?.cwd || newTaskWorkspacePath
      : selectedSession?.cwd || newTaskWorkspacePath || props.workspacePath) ??
    null;
  workspacePathRef.current = agentWorkspacePath;
  const activeMode = selectedSession?.mode ?? mode;
  modeRef.current = activeMode;
  // Existing chats own their access policy. localStorage is only the default
  // for a future New Chat and must never overwrite/mislabel a restored session.
  const effectiveAccessLevel: AgentAccessLevel = selectedSession
    ? (selectedSession.accessLevel ?? "request")
    : newTaskAccessLevel;
  const accessLevelRef = useRef(effectiveAccessLevel);
  accessLevelRef.current = effectiveAccessLevel;
  const providerAvailability = useMemo<AgentProviderAvailability>(() => {
    if (!props.connected) return "connection_error";
    if (loading || !providerConfig) return "loading";
    if (providerConfig.provider !== provider) return "loading";
    if (activeMode === "act" && providerConfig.capabilities?.tools === false) {
      return "incompatible";
    }
    if (providerConfig.availability) {
      return providerConfig.availability;
    }
    if (!providerConfig.configured) {
      return providerConfig.credentialSource === "coloride"
        ? "auth_expired"
        : "missing_credentials";
    }
    return "available";
  }, [props.connected, loading, providerConfig, provider, activeMode]);

  const providerReady = providerAvailability === "available";
  const turnActive = Boolean(
    selectedSession &&
    ["starting", "running", "waiting-approval"].includes(selectedSession.state),
  );

  useEffect(() => {
    if (!isSidebar || turnActive || !selectedSessionId || !props.workspacePath)
      return;
    const next = normalizeWorkspaceCwd(props.workspacePath);
    const current = normalizeWorkspaceCwd(selectedSession?.cwd);
    if (!next || next === current) return;
    let cancelled = false;
    void api
      .updateAgentWorkspace(selectedSessionId, {
        cwd: next,
        workspaceKind: props.workspaceKind ?? "ssh",
        connectionId: props.connectionId ?? undefined,
      })
      .then((summary) => {
        if (cancelled) return;
        setSessions((sessions) =>
          sessions.map((session) =>
            session.sessionId === summary.sessionId ? summary : session,
          ),
        );
      })
      .catch(() => {
        // Turn-active or unauthorized: keep the open file as the local workspace anyway.
      });
    return () => {
      cancelled = true;
    };
  }, [
    isSidebar,
    props.connectionId,
    props.workspaceKind,
    props.workspacePath,
    selectedSession?.cwd,
    selectedSessionId,
    turnActive,
  ]);
  const { visibleTimelineEvents, timeline, timelineTurns, pendingApproval, turnCheckpoints } = useAgentTimelineModel({ events, turnActive, selectedSessionId });
  const loadOlderHistoryRef = useRef<() => Promise<void>>(async () => { });
  const loadOlderHistoryCallback = useCallback(() => loadOlderHistoryRef.current(), []);
  const {
    handleTimelineScroll,
    scrollTimelineToBottom,
    jumpToTimelineTurn,
    showEarlierTimeline,
    timelineRenderLimit,
    activeTimelineTurn,
    timelineFadeEdges,
    setTimelineRenderLimit,
    setActiveTimelineTurn,
    setTimelineFadeEdges,
  } = useAgentTimelineViewport({
    timelineRef,
    stickToBottomRef,
    timelineTurns,
    loadOlderHistory: loadOlderHistoryCallback,
    viewActive,
    selectedSessionId,
  });

  const [keptCheckpointsBySession, setKeptCheckpointsBySession] = useState<
    Record<string, string[]>
  >(() => readKeptCheckpointsBySession());
  const [checkpointReviewOpen, setCheckpointReviewOpen] = useState(false);
  const [openCheckpointTurnId, setOpenCheckpointTurnId] = useState<
    string | null
  >(null);
  const [activePlan, setActivePlan] = useState<AgentPlan | null>(null);
  const [planDraftTitle, setPlanDraftTitle] = useState("");
  const [planDraftSteps, setPlanDraftSteps] = useState<AgentPlanStep[]>([]);
  const [planBusy, setPlanBusy] = useState(false);

  const dismissedCheckpointIds = useMemo(
    () => keptIdsForSession(keptCheckpointsBySession, selectedSessionId),
    [keptCheckpointsBySession, selectedSessionId],
  );

  // Only unkept checkpoints — after Keep all, new agent edits get new ids and the dock returns.
  const pendingCheckpoints = useMemo(
    () =>
      turnCheckpoints.filter(
        (checkpoint) => !dismissedCheckpointIds.includes(checkpoint.id),
      ),
    [dismissedCheckpointIds, turnCheckpoints],
  );
  const pendingCheckpointFileStats = useMemo(
    () => collectTurnFileStats(timeline),
    [timeline],
  );
  const pendingCheckpointsRef = useRef(pendingCheckpoints);
  pendingCheckpointsRef.current = pendingCheckpoints;
  /** Resolved IDE paths per checkpoint; later edits have independent identities. */
  const ideResolvedPathsRef = useRef<Map<string, Set<string>>>(new Map());

  // Allow command replaces Keep all — collapse any open review so it doesn't flash back open.
  useEffect(() => {
    if (pendingApproval) {
      setCheckpointReviewOpen(false);
      setOpenCheckpointTurnId(null);
    }
  }, [pendingApproval]);

  // New chat → fresh IDE↔dock resolution set.
  useEffect(() => {
    ideResolvedPathsRef.current = new Map();
  }, [selectedSessionId]);

  const markCheckpointsKept = useCallback(
    (sessionId: string, ids: string[]) => {
      if (!ids.length) return;
      // Update React state first so the dock hides on this frame; persist after paint.
      setKeptCheckpointsBySession((current) => {
        const next = mergeKeptCheckpointIds(current, sessionId, ids);
        if (next !== current) {
          queueMicrotask(() => writeKeptCheckpointsBySession(next));
        }
        return next;
      });
    },
    [],
  );

  const checkpointActionRef = useRef(false);

  const pathsFromCheckpoints = useCallback(
    (checkpoints: AgentCheckpoint[]): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const checkpoint of checkpoints) {
        for (const item of checkpoint.paths) {
          const p = typeof item.path === "string" ? item.path.trim() : "";
          if (!p) continue;
          const key = normalizeAgentPath(
            resolveAgentEditPath(p, checkpoint.cwd),
          );
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(key);
        }
      }
      return out;
    },
    [],
  );

  const laterCheckpointPaths = useCallback(
    (checkpoints: AgentCheckpoint[]) => {
      const restoredIds = new Set(
        visibleTimelineEvents
          .filter((event) => event.type === "checkpoint_restored")
          .map((event) => event.data.checkpointId),
      );
      return checkpointPathsWithLaterEdits(
        checkpointsFromEntries(timeline)
          .filter((checkpoint) => !restoredIds.has(checkpoint.id))
          .map((checkpoint) => ({
            id: checkpoint.id,
            paths: pathsFromCheckpoints([checkpoint]),
          })),
        new Set(checkpoints.map((checkpoint) => checkpoint.id)),
      );
    },
    [pathsFromCheckpoints, timeline, visibleTimelineEvents],
  );

  const keepCheckpoints = useCallback(
    (checkpoints: AgentCheckpoint[]) => {
      if (!selectedSessionId || turnActive || checkpointActionRef.current)
        return;
      const laterPaths = laterCheckpointPaths(checkpoints);
      const paths = pathsFromCheckpoints(checkpoints).filter(
        (path) => !laterPaths.has(path),
      );
      setCheckpointReviewOpen(false);
      setOpenCheckpointTurnId(null);
      markCheckpointsKept(
        selectedSessionId,
        checkpoints.map((checkpoint) => checkpoint.id),
      );
      clearIdeReviewsForPaths(paths);
    },
    [
      laterCheckpointPaths,
      markCheckpointsKept,
      pathsFromCheckpoints,
      selectedSessionId,
      turnActive,
    ],
  );

  // Resolve against all visible turns. Recording per checkpoint prevents an
  // earlier Accept on a path from silently accepting a later edit of that file.
  const keepCheckpointsFullyResolvedInIde = useCallback(
    (paths: string[]) => {
      if (!selectedSessionId) return;
      const checkpoints = checkpointsFromEntries(timeline)
        .filter((checkpoint) => !dismissedCheckpointIds.includes(checkpoint.id))
        .map((checkpoint) => ({
          id: checkpoint.id,
          paths: pathsFromCheckpoints([checkpoint]),
        }));
      const ids = resolveCheckpointPaths(
        checkpoints,
        paths.map(normalizeAgentPath),
        ideResolvedPathsRef.current,
      );
      if (ids.length) markCheckpointsKept(selectedSessionId, ids);
    },
    [
      dismissedCheckpointIds,
      markCheckpointsKept,
      pathsFromCheckpoints,
      selectedSessionId,
      timeline,
    ],
  );

  useEffect(
    () =>
      registerAgentCheckpointSync({
        onIdeAcceptPaths: keepCheckpointsFullyResolvedInIde,
        onIdeRejectPaths: keepCheckpointsFullyResolvedInIde,
      }),
    [keepCheckpointsFullyResolvedInIde],
  );

  const { rememberSessionEvents, selectSession } = useAgentSessionNavigation({
    bufferedEventsRef,
    setComplementsOpen,
    setActiveHeaderTerminal,
    selectedSessionIdRef,
    stickToBottomRef,
    setTimelineRenderLimit,
    setActiveTimelineTurn,
    setHistoryLoadingOlder,
    setHistoryHasOlder,
    historyHasOlderRef,
    historyFetchGenRef,
    setCheckpointReviewOpen,
    setQueuedFollowUps,
    setError,
    sessionPane,
    setHistoryLoading,
    setEvents,
    setSelectedSessionId,
    historyHydratedRef,
  });
  // Latest structured plan from timeline events (or session summary).
  const timelinePlan = useMemo(() => {
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const entry = timeline[index];
      if (entry?.kind === "plan" && entry.plan) return entry.plan;
    }
    return null;
  }, [timeline]);

  const dockPlan = useMemo(() => {
    const candidate =
      activePlan ?? timelinePlan ?? selectedSession?.plan ?? null;
    if (!candidate) return null;
    if (candidate.status === "ready" || candidate.status === "implementing")
      return candidate;
    return null;
  }, [activePlan, selectedSession?.plan, timelinePlan]);

  useEffect(() => {
    if (!dockPlan) {
      setPlanDraftTitle("");
      setPlanDraftSteps([]);
      return;
    }
    setActivePlan(dockPlan);
    setPlanDraftTitle(dockPlan.title);
    setPlanDraftSteps(dockPlan.steps.map((step) => ({ ...step })));
  }, [dockPlan?.id, dockPlan?.updatedAt, dockPlan?.status]);

  useEffect(() => {
    // Reset plan UI when switching chats.
    setActivePlan(selectedSession?.plan ?? null);
    setPlanBusy(false);
    setCheckpointReviewOpen(false);
    const effort = selectedSession?.reasoningEffort;
    if (
      effort === "none" ||
      effort === "low" ||
      effort === "medium" ||
      effort === "high" ||
      effort === "xhigh" ||
      effort === "max"
    ) {
      setComposerReasoning(effort);
    }
  }, [selectedSessionId, selectedSession?.reasoningEffort]);

  useEffect(() => {
    writeStoredComposerReasoning(sessionPane, composerReasoning);
  }, [composerReasoning, sessionPane]);

  useEffect(() => {
    if (!selectedSessionId || !props.connected) return;
    if ((props.workspaceKind ?? "ssh") === "local") return;
    let cancelled = false;
    void api
      .agentSession(selectedSessionId)
      .then((session) => {
        if (cancelled) return;
        setSessions((current) =>
          current.map((item) =>
            item.sessionId === session.sessionId
              ? { ...item, ...session }
              : item,
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [props.connected, props.workspaceKind, selectedSessionId]);

  useEffect(() => {
    // Drop kept ids that no longer exist in this turn (e.g. after a new turn).
    // Skip when the turn has no checkpoints so a brief empty reload doesn't wipe storage.
    if (!turnCheckpoints.length) {
      setCheckpointReviewOpen(false);
      return;
    }
    if (!selectedSessionId) return;
    const ids = new Set(turnCheckpoints.map((checkpoint) => checkpoint.id));
    setKeptCheckpointsBySession((current) => {
      const next = pruneKeptCheckpointIds(current, selectedSessionId, ids);
      if (next === current) return current;
      queueMicrotask(() => writeKeptCheckpointsBySession(next));
      return next;
    });
  }, [selectedSessionId, turnCheckpoints]);
  const filteredSessions = useMemo(() => {
    // Backend `archived` is source of truth; local ids cover optimistic UI + legacy.
    const excluded = new Set([...archivedTaskIds, ...hiddenTaskIds]);
    const pinned = new Set(pinnedTaskIds);
    let visible = sessions.filter(
      (session) => !session.archived && !excluded.has(session.sessionId),
    );
    // Pinned first (stable pin order), then remaining by backend updated_at order.
    const pinnedSessions = pinnedTaskIds
      .map((id) => visible.find((session) => session.sessionId === id))
      .filter((session): session is AgentSessionSummary => Boolean(session));
    const unpinnedSessions = visible.filter(
      (session) => !pinned.has(session.sessionId),
    );
    return [...pinnedSessions, ...unpinnedSessions];
  }, [archivedTaskIds, hiddenTaskIds, pinnedTaskIds, sessions]);

  useEffect(() => {
    if (!taskMenu) return;
    const close = () => setTaskMenu(null);
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [taskMenu]);

  const hideTask = (sessionId: string, destination: "archive" | "sidebar") => {
    if (destination === "archive") {
      // Optimistic hide immediately; backend write makes it survive restarts.
      setArchivedTaskIds((current) =>
        current.includes(sessionId) ? current : [...current, sessionId],
      );
      setPinnedTaskIds((current) => current.filter((id) => id !== sessionId));
      setSessions((current) =>
        current.map((session) =>
          session.sessionId === sessionId
            ? { ...session, archived: true }
            : session,
        ),
      );
      void api.archiveAgentSession(sessionId, true).then(
        (updated) => {
          setSessions((current) =>
            current.map((session) =>
              session.sessionId === updated.sessionId
                ? { ...session, ...updated, archived: true }
                : session,
            ),
          );
        },
        (reason) => {
          // Roll back optimistic hide if the sidecar write failed.
          setArchivedTaskIds((current) =>
            current.filter((id) => id !== sessionId),
          );
          setSessions((current) =>
            current.map((session) =>
              session.sessionId === sessionId
                ? { ...session, archived: false }
                : session,
            ),
          );
          setError(messageFromError(reason));
        },
      );
    } else {
      setHiddenTaskIds((current) =>
        current.includes(sessionId) ? current : [...current, sessionId],
      );
      setPinnedTaskIds((current) => current.filter((id) => id !== sessionId));
    }
    if (selectedSessionIdRef.current === sessionId) {
      selectSession(null);
    }
    setTaskMenu(null);
  };

  const togglePinTask = (sessionId: string) => {
    setPinnedTaskIds((current) => toggleStoredId(current, sessionId));
    setTaskMenu(null);
  };

  const archiveTask = (sessionId: string) => {
    hideTask(sessionId, "archive");
  };

  const moveSessionToProject = useCallback(
    (sessionId: string, projectId: string | null) => {
      setProjects((list) =>
        list.map((p) => {
          const without = p.sessionIds.filter((id) => id !== sessionId);
          if (projectId && p.id === projectId) {
            if (without.includes(sessionId))
              return { ...p, sessionIds: without };
            return { ...p, sessionIds: [...without, sessionId] };
          }
          return { ...p, sessionIds: without };
        }),
      );
      setTaskMenu(null);
    },
    [],
  );

  /** Sidebar groups: chats under each workspace folder (cwd), like the explorer tree. */
  const workspaceGroups = useMemo(() => {
    const map = new Map<string, AgentSessionSummary[]>();
    for (const session of filteredSessions) {
      const key = normalizeWorkspaceCwd(session.cwd);
      const list = map.get(key);
      if (list) list.push(session);
      else map.set(key, [session]);
    }
    const current = normalizeWorkspaceCwd(props.workspacePath);
    const keys = [...map.keys()];
    const labels = uniqueWorkspaceLabels(keys);
    keys.sort((a, b) => {
      if (a && a === current) return -1;
      if (b && b === current) return 1;
      if (!a && b) return 1;
      if (a && !b) return -1;
      const la = labels.get(a) || "Other";
      const lb = labels.get(b) || "Other";
      const byLabel = la.localeCompare(lb, undefined, { sensitivity: "base" });
      if (byLabel !== 0) return byLabel;
      return a.localeCompare(b);
    });
    return keys.map((key) => ({
      key,
      label: labels.get(key) || (key ? pathTailLabel(key) : "Other") || "Other",
      path: key,
      sessions: map.get(key) ?? [],
    }));
  }, [filteredSessions, props.workspacePath]);

  const [workspaceSectionOpen, setWorkspaceSectionOpen] = useState(true);
  const [newTaskWorkspaceMenuOpen, setNewTaskWorkspaceMenuOpen] =
    useState(false);
  const [newTaskWorkspaceQuery, setNewTaskWorkspaceQuery] = useState("");
  const newTaskWorkspaceMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuScrollRef = useRef<HTMLDivElement>(null);
  const newTaskWorkspaceSearchRef = useRef<HTMLInputElement>(null);
  const [workspaceGroupOpen, setWorkspaceGroupOpen] = useState<
    Record<string, boolean>
  >({});
  const isWorkspaceGroupOpen = useCallback(
    (key: string) => workspaceGroupOpen[key] !== false,
    [workspaceGroupOpen],
  );
  const toggleWorkspaceGroup = useCallback((key: string) => {
    setWorkspaceGroupOpen((current) => ({
      ...current,
      [key]: current[key] === false,
    }));
  }, []);

  /** Recent / known workspace roots for the new-task folder picker. */
  const selectableWorkspaces = useMemo(() => {
    const paths = new Map<string, string>();
    const current = normalizeWorkspaceCwd(props.workspacePath);
    if (current && !isHomeWorkspacePath(current)) {
      paths.set(current, pathTailLabel(current) || current);
    }
    for (const session of sessions) {
      const key = normalizeWorkspaceCwd(session.cwd);
      if (!key || paths.has(key) || isHomeWorkspacePath(key)) continue;
      paths.set(key, pathTailLabel(key) || key);
    }
    const labels = uniqueWorkspaceLabels([...paths.keys()]);
    return [...paths.keys()]
      .map((path) => ({
        path,
        label: labels.get(path) || paths.get(path) || path,
      }))
      .sort((a, b) => {
        if (a.path === current) return -1;
        if (b.path === current) return 1;
        return a.label.localeCompare(b.label, undefined, {
          sensitivity: "base",
        });
      });
  }, [props.workspacePath, sessions]);

  const isLocalWorkspace = (props.workspaceKind ?? "ssh") === "local";
  const noRepoWorkspacePath =
    normalizeWorkspaceCwd(props.workspacePath) ||
    (isLocalWorkspace ? "" : "/home/coloride");
  const hostWorkspaceLabel = isLocalWorkspace
    ? "On this Computer"
    : "On this VPS";

  useEffect(() => {
    if (!newTaskWorkspaceMenuOpen) {
      setNewTaskWorkspaceQuery("");
      return;
    }
    const focusSearch = window.requestAnimationFrame(() => {
      newTaskWorkspaceSearchRef.current?.focus({ preventScroll: true });
    });
    const onPointerDown = (event: PointerEvent) => {
      if (!newTaskWorkspaceMenuRef.current?.contains(event.target as Node)) {
        setNewTaskWorkspaceMenuOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setNewTaskWorkspaceMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusSearch);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [newTaskWorkspaceMenuOpen]);

  const { loadOlderHistory } = useAgentSessions({
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
  });
  loadOlderHistoryRef.current = loadOlderHistory;

  const createNewTask = useCallback(() => {
    setChatHistoryOpen(false);
    setHeaderTabMenu(null);
    setComplementsOpen(false);
    // Keep other chats' drafts; only reset the empty "new task" box.
    clearComposerDraft(null);
    clearSessionPlugins(null);
    writePreferNewTask(sessionPane, true);
    selectSession(null);
    setQueuedFollowUps([]);
    setComposerDraftKey((key) => key + 1);
    modeRef.current = defaultMode();
    setMode(defaultMode());
    setNewTaskWorkspacePath(props.workspacePath);
    setNewTaskNoRepo(
      !normalizeWorkspaceCwd(props.workspacePath) ||
      isHomeWorkspacePath(props.workspacePath),
    );
  }, [props.workspacePath, selectSession, sessionPane]);

  useEffect(() => {
    const onNewTaskShortcut = () => {
      createNewTask();
    };
    window.addEventListener("coloride:new-agent-task", onNewTaskShortcut);
    return () =>
      window.removeEventListener("coloride:new-agent-task", onNewTaskShortcut);
  }, [createNewTask]);

  const prepareNewTaskWorkspace = useCallback(
    async (requestedPath: string): Promise<string | null> => {
      const path = requestedPath.trim();
      if (!path) return null;
      setError("");
      try {
        const preparedPath = props.onPrepareWorkspace
          ? await props.onPrepareWorkspace(path)
          : path;
        const normalized = preparedPath.trim();
        if (!normalized)
          throw new Error("Coloride could not prepare this workspace.");
        return normalized;
      } catch (reason) {
        setError(messageFromError(reason));
        return null;
      }
    },
    [props.onPrepareWorkspace],
  );

  const selectNewTaskWorkspace = useCallback(
    async (requestedPath: string) => {
      const preparedPath = await prepareNewTaskWorkspace(requestedPath);
      if (!preparedPath) return false;
      setNewTaskNoRepo(false);
      setNewTaskWorkspacePath(preparedPath);
      return true;
    },
    [prepareNewTaskWorkspace],
  );

  // Must be above submit() — used in its dependency array (TDZ crash = blank app).
  const creditsExhausted = Boolean(
    llmCredits &&
    !llmCredits.unmetered &&
    llmCredits.enabled &&
    llmCredits.creditsLimit > 0 &&
    llmCredits.creditsRemaining <= 0,
  );

  /** Returns false when the draft should be restored in the composer. */
  const { submit, stopGeneration } = useAgentTurnActions({
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
  });
  const {
    selectComposerModel,
    changeMode,
    changeAccess,
  } = useAgentProviderActions({
    providerConfig,
    setError,
    configSeqRef,
    setSavingProvider,
    setProviderConfig,
    setProvider,
    setProviderModel,
    messageFromError,
    savingProvider,
    hasModelCredits,
    llmCredits,
    composerReasoning,
    setComposerReasoning,
    sessionPane,
    activeMode,
    changingMode,
    selectedSession,
    modeRef,
    setMode,
    setChangingMode,
    setSessions,
    accessLevelRef,
    effectiveAccessLevel,
    setNewTaskAccessLevel,
  });
  const handleSlashCommand = async (
    invocation: SlashCommandInvocation,
  ): Promise<SlashCommandResult> => {
    const { id, args } = invocation;
    const applyMode = async (next: AgentMode): Promise<SlashCommandResult> => {
      await changeMode(next);
      return { submitRemainder: args || undefined };
    };

    switch (id) {
      case "ask":
        return applyMode("ask");
      case "plan":
        return applyMode("plan");
      case "debug":
        return applyMode("debug");
      case "run-everything":
        await changeMode("act");
        setDefaultAgentAccessLevel("full");
        await changeAccess("full");
        return {};
      case "fork": {
        if (!selectedSession) return { notice: "Open a chat before forking." };
        if (turnActive)
          return {
            clearInput: false,
            notice: "Stop the active turn before forking.",
          };
        const response = await api.forkAgentSession(selectedSession.sessionId);
        const [session, nextEvents] = await Promise.all([
          api.agentSession(response.sessionId),
          api.agentEventsPage(response.sessionId, {
            turns: HISTORY_PAGE_TURNS,
            limit: HISTORY_EVENT_LIMIT,
          }),
        ]);
        const merged = rememberSessionEvents(response.sessionId, nextEvents);
        historyHydratedRef.current.add(response.sessionId);
        historyHasOlderRef.current.set(response.sessionId, false);
        setSessions((current) => [
          session,
          ...current.filter((item) => item.sessionId !== session.sessionId),
        ]);
        copySessionPlugins(selectedSession.sessionId, response.sessionId);
        selectSession(response.sessionId);
        setEvents(merged);
        setHistoryLoading(false);
        return {};
      }
      case "summarize":
        return {
          submitRemainder: args
            ? `${SUMMARIZE_PROMPT}\n\nFocus on: ${args}`
            : SUMMARIZE_PROMPT,
        };
      case "shell":
        openWorkspaceKind("terminal");
        return {};
      case "canvas":
        setComplementsOpen(true);
        return {};
      case "log": {
        if (!selectedSession)
          return {
            clearInput: false,
            notice: "Open a chat before dumping logs.",
          };
        try {
          const dump = await api.agentDebugDump(selectedSession.sessionId);
          props.onOpenAgentLogDump?.(dump.fileName, dump.content);
          setWorkspaceFileRequest({
            path: dump.fileName,
            content: dump.content,
            nonce: Date.now(),
          });
          return {
            notice: `Opened ${dump.fileName} (${dump.eventCount} raw events).`,
          };
        } catch (reason) {
          return { clearInput: false, notice: messageFromError(reason) };
        }
      }
      case "add-plugin": {
        const plugin = findAgentPlugin(args);
        return plugin
          ? { attachPlugin: plugin.id, clearInput: false }
          : { pickPlugin: "add", clearInput: false };
      }
      case "remove-plugin": {
        const plugin = findAgentPlugin(args);
        return plugin
          ? { detachPlugin: plugin.id, clearInput: false }
          : { pickPlugin: "remove", clearInput: false };
      }
      default:
        return { clearInput: false, notice: "Unknown command." };
    }
  };

  useEffect(() => {
    const onMode = (event: Event) => {
      const mode = (event as CustomEvent<string>).detail;
      if (mode === "ask" || mode === "plan" || mode === "debug")
        void changeMode(mode);
    };
    const onAccess = (event: Event) => {
      const level = (event as CustomEvent<string>).detail;
      if (level === "request" || level === "agent" || level === "full")
        void changeAccess(level);
    };
    const onStop = () => {
      void stopGeneration();
    };
    const onSelectModel = () => {
      window.dispatchEvent(new CustomEvent("coloride:composer-open-model"));
    };
    const onPalette = () => {
      window.dispatchEvent(new CustomEvent("coloride:composer-insert-slash"));
    };
    window.addEventListener("coloride:agent-mode", onMode);
    window.addEventListener("coloride:agent-access", onAccess);
    window.addEventListener("coloride:agent-stop", onStop);
    window.addEventListener("coloride:agent-select-model", onSelectModel);
    window.addEventListener("coloride:command-palette", onPalette);
    return () => {
      window.removeEventListener("coloride:agent-mode", onMode);
      window.removeEventListener("coloride:agent-access", onAccess);
      window.removeEventListener("coloride:agent-stop", onStop);
      window.removeEventListener("coloride:agent-select-model", onSelectModel);
      window.removeEventListener("coloride:command-palette", onPalette);
    };
  }, [changeAccess, changeMode, stopGeneration]);

  const changeReasoning = async (level: ComposerReasoning) => {
    if (level === composerReasoning) return;
    setComposerReasoning(level);
    writeStoredComposerReasoning(sessionPane, level);
    if (!selectedSession) return;
    try {
      const updated = await api.setAgentReasoning(
        selectedSession.sessionId,
        level,
      );
      setSessions((current) =>
        current.map((session) =>
          session.sessionId === updated.sessionId ? updated : session,
        ),
      );
    } catch {
      // Next send still includes the composer value.
    }
  };

  const { dismissPlan, implementPlan, resolveApproval, resolveGuard } =
    useAgentPlanActions({
      selectedSession,
      planBusy,
      setPlanBusy,
      setError,
      setActivePlan,
      setSessions,
      messageFromError,
      planDraftSteps,
      turnActive,
      planDraftTitle,
      setMode,
      setResolvingApproval,
      lastAgentEventAtRef,
      setEvents,
      setResolvingGuard,
    });
  const undoCheckpoints = useCallback(
    async (checkpoints: AgentCheckpoint[]) => {
      if (
        !selectedSession ||
        turnActive ||
        checkpointActionRef.current ||
        !checkpoints.length
      )
        return;
      const conflicts = laterCheckpointPaths(checkpoints);
      if (conflicts.size) {
        setError(
          `Cannot undo this older change without overwriting newer agent changes: ${[...conflicts].join(", ")}`,
        );
        return;
      }
      checkpointActionRef.current = true;
      const sessionId = selectedSession.sessionId;
      const originalEvents = eventsRef.current;
      const restored: AgentCheckpoint[] = [];
      setRestoringCheckpoint(
        checkpoints.length === 1 ? checkpoints[0]!.id : "all",
      );
      setError("");
      try {
        await restoreCheckpointBatch(
          checkpoints,
          async (checkpoint) => {
            await api.restoreAgentCheckpoint(sessionId, checkpoint.id);
          },
          (checkpoint) => {
            // Settle each successful restore even if a later one or history reload fails.
            restored.push(checkpoint);
            markCheckpointsKept(sessionId, [checkpoint.id]);
          },
        );
      } catch (reason) {
        if (selectedSessionIdRef.current === sessionId)
          setError(messageFromError(reason));
      } finally {
        try {
          if (restored.length) {
            const paths = pathsFromCheckpoints(restored);
            clearIdeReviewsForPaths(paths);
            if (selectedSessionIdRef.current === sessionId) {
              setCheckpointReviewOpen(false);
              setOpenCheckpointTurnId(null);
              ideResolvedPathsRef.current = new Map();
              const apply = props.onApplyAgentFileStream;
              if (apply) {
                for (const path of paths) {
                  if (isPathInsideWorkspace(path, props.workspacePath)) {
                    await apply({
                      path,
                      phase: "final",
                      reload: true,
                      restored: true,
                    });
                  }
                }
              }
            }
            const nextEvents = await api.agentEventsPage(sessionId, {
              turns: HISTORY_PAGE_TURNS,
              limit: HISTORY_EVENT_LIMIT,
            });
            const currentEvents =
              selectedSessionIdRef.current === sessionId
                ? eventsRef.current
                : originalEvents;
            const merged = rememberSessionEvents(
              sessionId,
              mergeAgentEvents(currentEvents, nextEvents),
            );
            historyHydratedRef.current.add(sessionId);
            if (selectedSessionIdRef.current === sessionId) setEvents(merged);
          }
        } catch (reason) {
          if (selectedSessionIdRef.current === sessionId)
            setError(messageFromError(reason));
        } finally {
          checkpointActionRef.current = false;
          setRestoringCheckpoint(null);
        }
      }
    },
    [
      laterCheckpointPaths,
      markCheckpointsKept,
      pathsFromCheckpoints,
      props.onApplyAgentFileStream,
      props.workspacePath,
      rememberSessionEvents,
      selectedSession,
      turnActive,
    ],
  );

  const undoAllCheckpoints = useCallback(() => {
    void undoCheckpoints(pendingCheckpointsRef.current);
  }, [undoCheckpoints]);

  // Context meter — fill of the published model window (Grok 4.5 = 500k), not the 40k working set.
  const contextUsage = useMemo(() => {
    const windowTokens = providerConfig?.model === providerModel
      ? providerConfig.capabilities.maxContextTokens || modelContextWindow(providerModel)
      : modelContextWindow(providerModel);

    const asNum = (value: unknown): number | null => {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const meterFor = (tokens: number, modelHint?: string | null) => {
      const maxTok = !modelHint || modelHint === providerModel ? windowTokens : modelContextWindow(modelHint) || windowTokens;
      const clamped = Math.min(Math.max(0, Math.floor(tokens)), maxTok);
      return {
        tokens: clamped,
        maxTokens: maxTok,
        pct: Math.min(100, Math.round((clamped / maxTok) * 100)),
      };
    };

    type Sample = {
      tokens: number;
      maxTokens: number;
      pct: number;
      sequence: number;
      kind: "usage" | "estimate";
      compacted: boolean;
    };

    let latestUsage: Sample | null = null;
    let latestEstimate: Sample | null = null;

    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (latestUsage && latestEstimate) break;
      const event = events[index]!;
      const sequence =
        typeof event.sequence === "number" ? event.sequence : index;

      if (!latestUsage && event.type === "usage") {
        const tokens = asNum(event.data?.inputTokens);
        if (tokens == null || tokens <= 0) continue;
        const modelHint =
          typeof event.data?.model === "string"
            ? event.data.model
            : providerModel;
        const meter = meterFor(tokens, modelHint);
        latestUsage = {
          ...meter,
          sequence,
          kind: "usage",
          compacted: false,
        };
        continue;
      }

      if (
        !latestEstimate &&
        (event.type === "context_snapshot" ||
          event.type === "context_compacted")
      ) {
        const curChars = asNum(
          event.type === "context_compacted"
            ? event.data?.afterCharacters
            : event.data?.currentCharacters,
        );
        let tokens = asNum(
          event.type === "context_compacted"
            ? event.data?.afterTokens
            : event.data?.estimatedTokens,
        );
        if ((tokens == null || tokens < 0) && curChars != null) {
          tokens = Math.round(curChars / 3.2);
        }
        if (tokens == null || tokens < 0) continue;
        const meter = meterFor(tokens, providerModel);
        latestEstimate = {
          ...meter,
          sequence,
          kind: "estimate",
          compacted:
            Boolean(event.data?.compacted) ||
            event.type === "context_compacted",
        };
      }
    }

    // Prefer real API usage. A pre-call snapshot on send used to replace it and
    // spike to ~100% from over-counted chars — only trust estimates when there is
    // no usage yet, after a compact (drop), or when the estimate is not a huge jump.
    let best: Sample | null = latestUsage;
    if (latestEstimate) {
      if (!latestUsage) {
        best = latestEstimate;
      } else if (latestEstimate.sequence > latestUsage.sequence) {
        const jump = latestEstimate.pct - latestUsage.pct;
        if (latestEstimate.compacted || jump <= 12) {
          best = latestEstimate;
        }
      }
    }

    if (!best) {
      return { inputTokens: 0, maxTokens: windowTokens, pct: 0 };
    }
    return {
      inputTokens: best.tokens,
      maxTokens: best.maxTokens,
      pct: best.pct,
    };
  }, [events, providerModel, providerConfig]);

  // Internal recovery stays in the agent. A credits pause requires user
  // action and survives restarts, so always expose its resolution controls.
  const visibleGuardPause =
    selectedSession?.guardPause?.reason === "out-of-credits"
      ? selectedSession.guardPause
      : null;

  // A guard can outlive the renderer (for example after restarting Electron).
  // Recover the latest visible user message from durable timeline history too,
  // not only from the live socket event above.
  useEffect(() => {
    // Never restore while a retry/new turn is being submitted or is active.
    // The full session summary can briefly retain the previous guard even
    // though the backend has already accepted and started the new turn.
    if (submitting || turnActive) return;
    if (selectedSession?.guardPause?.reason !== "provider-errors") return;
    const timelinePrompt = [...events]
      .reverse()
      .find(
        (item) =>
          item.sessionId === selectedSession.sessionId &&
          item.type === "user_message" &&
          !Boolean(item.data?.hidden) &&
          typeof item.data?.text === "string",
      );
    const text = String(
      timelinePrompt?.data?.text ?? selectedSession.task ?? "",
    ).trim();
    if (!text) return;
    setComposerRetryDraft((current) => {
      if (
        current?.sessionId === selectedSession.sessionId &&
        current.text === text
      )
        return current;
      return {
        sessionId: selectedSession.sessionId,
        text,
        key: (current?.key ?? 0) + 1,
      };
    });
    setError(providerFailureMessage(selectedSession.guardPause.message));
  }, [
    events,
    selectedSession?.guardPause?.reason,
    selectedSession?.guardPause?.message,
    selectedSession?.sessionId,
    selectedSession?.task,
    submitting,
    turnActive,
  ]);

  // Keep the textarea editable while a turn runs so the next message can be drafted/queued.
  const composerDisabled =
    submitting ||
    visibleGuardPause !== null ||
    !props.connected ||
    !agentWorkspacePath ||
    !providerReady;
  // Keep send clickable when exhausted so we can open the out-of-credits dialog.
  const sendBlocked = submitting;
  const composerPlaceholder =
    queuedFollowUps.length > 0
      ? queuedFollowUps.length === 1
        ? "Message queued — edit or send another"
        : `${queuedFollowUps.length} messages queued — send another`
      : turnActive
        ? "Type the next message… Enter queues it"
        : !providerReady
          ? providerAvailability === "loading"
            ? "Checking model availability…"
            : providerAvailability === "missing_credentials"
              ? "Configure API key to start"
              : providerAvailability === "auth_expired"
                ? "Sign in to resume agent"
                : providerAvailability === "incompatible"
                  ? "Model does not support tools for Act mode"
                  : providerAvailability === "connection_error"
                    ? "Connection error — verify provider"
                    : "Model unavailable"
          : !agentWorkspacePath
            ? "Choose a workspace first"
            : activeMode === "plan"
              ? "Analyze, build, or fix — Plan outlines steps first (reads now; Implement applies edits)"
              : activeMode === "ask"
                ? "Ask anything — can read & analyze (no edits or commands)"
                : activeMode === "debug"
                  ? "Describe what to diagnose"
                  : "Ask Coloride to build, inspect, or fix something";
  // While the first sessions/config fetch is in flight, keep the right card on the
  // chat shell if a session id is already known. Otherwise a stored session briefly
  // looks like "empty/new-task" and snaps back when load finishes (visible jump).
  const layoutReady = !loading;
  const hasOpenSession = Boolean(selectedSession);
  const restoringStoredSession =
    Boolean(selectedSessionId && selectedSession) && !layoutReady;
  const isEmptyChat =
    layoutReady &&
    !hasOpenSession &&
    timeline.length === 0 &&
    !historyLoading;
  const showNewTask =
    isEmptyChat &&
    providerReady &&
    props.connected &&
    Boolean(agentWorkspacePath);
  useEffect(() => {
    if (!showNewTask) setNewTaskWorkspaceMenuOpen(false);
    if (showNewTask) {
      setTimelineFadeEdges((current) =>
        current.top || current.bottom ? { top: false, bottom: false } : current,
      );
    }
  }, [showNewTask]);
  const showEmptySetup = isEmptyChat && !showNewTask;
  /** Explorer sidebar keeps the chip on the composer. Agents tab uses the end-of-chat card. */
  const showComposerCheckpointDock = false;
  // Chat chrome (footer composer) for an open chat, a restore, or a blank new task.
  // Sidebar dock always keeps the compact footer composer.
  const showChatShell =
    isSidebar ||
    hasOpenSession ||
    Boolean(selectedSession) ||
    timeline.length > 0 ||
    restoringStoredSession ||
    historyLoading ||
    showNewTask;
  const openWorkspaceKind = (kind: AgentWorkspaceToolKind) => {
    setWorkspaceOpenRequest({ kind, nonce: Date.now() });
  };

  // Open on a Wrote/Edited row:
  // - sidebar → Explorer editor on the left
  // - Agents tab → right workspace card (diff/file panel)
  const { openWorkspaceFile, openWorkspaceTerminal, openWorkspaceBrowser } =
    useAgentWorkspaceNavigation({
      agentWorkspacePath,
      isSidebar,
      props,
      setWorkspaceFileRequest,
      selectedSessionIdRef,
      setWorkspaceOpenRequest,
      SIDEBAR_BROWSER_TAB_ID,
      setWorkspaceBrowserRequest,
    });
  const renderTimelineItem = useCallback(
    (index: number, turn: ReturnType<typeof groupTimelineTurns>[number]) => {
      const localIndex = index;
      const liveRow = turnActive && localIndex === timelineTurns.length - 1;
      const turnCheckpointsForCard = checkpointsFromEntries(turn.items).filter(
        (checkpoint) => !dismissedCheckpointIds.includes(checkpoint.id),
      );
      const showTurnCard = turnCheckpointsForCard.length > 0 && !liveRow;
      return (
        <AgentConversationTurn
          liveRow={liveRow}
          localIndex={localIndex}
          turn={turn}
          showTurnCard={showTurnCard}
          turnCheckpointsForCard={turnCheckpointsForCard}
          keepCheckpoints={keepCheckpoints}
          openWorkspaceFile={openWorkspaceFile}
          setOpenCheckpointTurnId={setOpenCheckpointTurnId}
          setCheckpointReviewOpen={setCheckpointReviewOpen}
          openCheckpointTurnId={openCheckpointTurnId}
          undoCheckpoints={undoCheckpoints}
          restoringCheckpoint={restoringCheckpoint}
          checkpointReviewOpen={checkpointReviewOpen}
          turnActive={turnActive}
          openWorkspaceBrowser={openWorkspaceBrowser}
          openWorkspaceTerminal={openWorkspaceTerminal}
        />
      );
    },
    [
      checkpointReviewOpen,
      dismissedCheckpointIds,
      isSidebar,
      keepCheckpoints,
      markCheckpointsKept,
      openCheckpointTurnId,
      openWorkspaceBrowser,
      openWorkspaceFile,
      openWorkspaceTerminal,
      pathsFromCheckpoints,
      restoringCheckpoint,
      selectedSessionId,
      timelineTurns.length,
      turnActive,
      undoCheckpoints,
    ],
  );
  const timelineRenderStart = Math.max(
    0,
    timelineTurns.length - timelineRenderLimit,
  );
  const renderedTimelineTurns = timelineTurns.slice(timelineRenderStart);
  const timelineCanShowEarlier = timelineRenderStart > 0 || historyHasOlder;

  // When the agent calls browser_open during this session, mirror into our right browser.
  // Seed known keys while history is loading so old tools don't all pop the panel.
  useEffect(() => {
    if (historyLoading) {
      for (const entry of timeline) {
        if (entry.kind !== "tool" || entry.tool !== "browser_open") continue;
        const key = entry.itemId || entry.id;
        if (key) handledBrowserOpenKeys.current.add(key);
      }
      return;
    }
    let latestUrl: string | null = null;
    let latestKey: string | null = null;
    for (const entry of timeline) {
      if (entry.kind !== "tool" || entry.tool !== "browser_open") continue;
      if (!entry.complete || entry.failed) continue;
      const key = entry.itemId || entry.id;
      if (!key || handledBrowserOpenKeys.current.has(key)) continue;
      const meta = entry.metadata as Record<string, unknown>;
      const fromMeta = typeof meta.url === "string" ? meta.url.trim() : "";
      const fromArgs =
        entry.arguments && typeof entry.arguments.url === "string"
          ? String(entry.arguments.url).trim()
          : "";
      const url = fromMeta || fromArgs;
      if (!url) {
        handledBrowserOpenKeys.current.add(key);
        continue;
      }
      latestKey = key;
      latestUrl = url;
      handledBrowserOpenKeys.current.add(key);
    }
    if (latestUrl && latestKey) openWorkspaceBrowser(latestUrl);
  }, [historyLoading, openWorkspaceBrowser, timeline]);

  // Per-session drafts live in composerDrafts (and AgentComposerCard).
  // Switching chats restores that chat's text — never wipe on tab change.

  const sessionTitle =
    (selectedSession
      ? chatTitle(
        selectedSession,
        chatTitles,
        chatHistoryDetails[selectedSession.sessionId],
      )
      : "") || (isSidebar ? "New chat" : "Agent");

  return (
    <div
      ref={agentContextRootRef}
      className={`agent-view flex h-full min-h-0 min-w-0${isSidebar ? " agent-view-sidebar" : ""}`}
    >
      <AgentContextMenu
        rootRef={agentContextRootRef}
        newChatShortcut={newTaskShortcut}
        onNewChat={createNewTask}
        onHistory={
          isSidebar
            ? () => {
              setChatHistoryOpen(true);
            }
            : undefined
        }
      />
      <div
        className={`flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--agent-surface,#212121)] ${isSidebar
          ? "border-0"
          : "app-main-card border border-b-0 border-r-0 border-[var(--agent-border,#333333)]"
          }`}
      >
        {isSidebar ? (
          <AgentChatHeader
            chatTabsScrollRef={chatTabsScrollRef}
            updateChatTabScroll={updateChatTabScroll}
            openChatTabs={openChatTabs}
            activeHeaderTerminal={activeHeaderTerminal}
            selectedSessionId={selectedSessionId}
            sessions={sessions}
            chatTitles={chatTitles}
            chatHistoryDetails={chatHistoryDetails}
            sessionTitle={sessionTitle}
            setActiveHeaderTerminal={setActiveHeaderTerminal}
            selectSession={selectSession}
            setOpenChatTabs={setOpenChatTabs}
            chatTabScroll={chatTabScroll}
            headerTabMenu={headerTabMenu}
            setHeaderTabMenu={setHeaderTabMenu}
            setChatHistoryOpen={setChatHistoryOpen}
            onCloseSidebar={props.onCloseSidebar}
            externalAgentTabs={props.externalAgentTabs}
            activeExternalAgentId={props.activeExternalAgentId}
            onSelectExternalAgent={props.onSelectExternalAgent}
            onCloseExternalAgent={props.onCloseExternalAgent}
          />
        ) : null}
        {isSidebar && props.externalAgentView ? (
          <div
            className={
              props.activeExternalAgentId
                ? "flex min-h-0 min-w-0 flex-1 flex-col"
                : "hidden"
            }
          >
            {props.externalAgentView}
          </div>
        ) : null}
        {isSidebar && headerTabMenu
          ? createPortal(
            <Menu
              ref={headerTabMenuPlacement.ref}
              style={headerTabMenuPlacement.style}
              aria-label="Add tab"
              className="agent-add-tab-menu fixed z-[10060] w-[180px]"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <MenuItem
                compact
                onClick={() => {
                  setHeaderTabMenu(null);
                  const id = `header-terminal-${crypto.randomUUID()}`;
                  setOpenChatTabs((tabs) => [...tabs, id]);
                  setActiveHeaderTerminal(id);
                }}
              >
                Terminal
              </MenuItem>
              <MenuItem
                compact
                shortcut={
                  newTaskShortcut && newTaskShortcut !== "Unassigned"
                    ? newTaskShortcut
                    : undefined
                }
                onClick={() => {
                  setHeaderTabMenu(null);
                  createNewTask();
                }}
              >
                Coloride Agent
              </MenuItem>
              {props.externalAgentOptions?.length ? (
                <div aria-hidden="true" className="agent-add-tab-separator" />
              ) : null}
              {props.externalAgentOptions?.some(
                (agent) => agent.agentId === "codex-acp",
              ) ? (
                <MenuItem
                  compact
                  onClick={() => {
                    setHeaderTabMenu(null);
                    props.onOpenExternalAgent?.("codex-acp");
                  }}
                >
                  <AgentMark agentId="codex-acp" name="Codex" />
                  Codex
                </MenuItem>
              ) : null}
              {props.externalAgentOptions
                ?.filter((agent) => agent.agentId !== "codex-acp")
                .map((agent) => (
                  <MenuItem
                    compact
                    key={agent.agentId}
                    onClick={() => {
                      setHeaderTabMenu(null);
                      props.onOpenExternalAgent?.(agent.agentId);
                    }}
                  >
                    <AgentMark
                      agentId={agent.agentId}
                      icon={agent.icon}
                      name={agent.name}
                    />
                    {agent.name}
                  </MenuItem>
                ))}
            </Menu>,
            document.body,
          )
          : null}
        {isSidebar && chatHistoryOpen ? (
          <ChatHistoryDialog
            sessions={sessions}
            selectedId={selectedSessionId}
            workspacePath={props.workspacePath}
            workspaceKind={props.workspaceKind ?? "ssh"}
            connectionId={
              props.workspaceKind === "local" ? undefined : props.connectionId
            }
            filesystemScope={filesystemScope}
            pinnedIds={pinnedTaskIds}
            archivedIds={archivedTaskIds}
            hiddenIds={hiddenTaskIds}
            titles={chatTitles}
            onDetails={handleHistoryDetails}
            newChatShortcut={newTaskShortcut}
            onClose={() => setChatHistoryOpen(false)}
            onSelect={selectSession}
            onNew={createNewTask}
            onPin={togglePinTask}
            onArchive={async (id) => {
              const archived = await api.archiveAgentSession(id, true);
              setSessions((current) =>
                current.map((item) =>
                  item.sessionId === id
                    ? { ...item, ...archived, archived: true }
                    : item,
                ),
              );
              setArchivedTaskIds((current) =>
                current.includes(id) ? current : [...current, id],
              );
              setPinnedTaskIds((current) =>
                current.filter((item) => item !== id),
              );
              if (selectedSessionIdRef.current === id) selectSession(null);
            }}
            onTrash={(id) => {
              hideTask(id, "sidebar");
              setOpenChatTabs((current) => {
                const remaining = current.filter((item) => item !== id);
                return remaining.length ? remaining : [null];
              });
            }}
            onRename={(id, title) =>
              setChatTitles((current) => ({ ...current, [id]: title }))
            }
            onRestore={async (id) => {
              const session = sessions.find((item) => item.sessionId === id);
              if (session?.archived || archivedTaskIds.includes(id)) {
                const restored = await api.archiveAgentSession(id, false);
                setSessions((current) =>
                  current.map((item) =>
                    item.sessionId === id
                      ? { ...item, ...restored, archived: false }
                      : item,
                  ),
                );
                setArchivedTaskIds((current) =>
                  current.filter((item) => item !== id),
                );
              }
              setHiddenTaskIds((current) =>
                current.filter((item) => item !== id),
              );
            }}
          />
        ) : null}
        <div
          className={
            isSidebar && props.activeExternalAgentId
              ? "hidden"
              : "flex min-h-0 min-w-0 flex-1 overflow-hidden"
          }
        >
          {!isSidebar ? (
            <div
              aria-hidden={!props.sidePanelOpen}
              className={`relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden ${props.sidePanelOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
              style={{
                width: props.sidePanelOpen
                  ? `${props.sidePanelWidth}px`
                  : "0px",
              }}
            >
              <AgentSessionSidebar
                createNewTask={createNewTask}
                newTaskShortcut={newTaskShortcut}
                complementsOpen={complementsOpen}
                setComplementsOpen={setComplementsOpen}
                workspaceSectionOpen={workspaceSectionOpen}
                setWorkspaceSectionOpen={setWorkspaceSectionOpen}
                workspaceGroups={workspaceGroups}
                isWorkspaceGroupOpen={isWorkspaceGroupOpen}
                toggleWorkspaceGroup={toggleWorkspaceGroup}
                pinnedTaskIds={pinnedTaskIds}
                selectedSessionId={selectedSessionId}
                setTaskMenu={setTaskMenu}
                selectSession={selectSession}
                togglePinTask={togglePinTask}
                archiveTask={archiveTask}
                loading={loading}
                filteredSessions={filteredSessions}
              />
            </div>
          ) : null}

          {!isSidebar &&
            taskMenu &&
            createPortal(
              <MotionMenu
                animate={{ opacity: 1, scale: 1, y: 0 }}
                initial={{ opacity: 0, scale: 0.98, y: -3 }}
                onPointerDown={(event) => event.stopPropagation()}
                ref={taskMenuPlacement.ref}
                style={taskMenuPlacement.style}
                transition={{ duration: 0.1, ease: "easeOut" }}
                variant="context"
              >
                <MenuItem onClick={() => togglePinTask(taskMenu.sessionId)}>
                  {pinnedTaskIds.includes(taskMenu.sessionId) ? "Unpin" : "Pin"}
                </MenuItem>
                <MenuItem
                  onClick={() => hideTask(taskMenu.sessionId, "archive")}
                >
                  Archive
                </MenuItem>
                <MenuItem
                  onClick={() => hideTask(taskMenu.sessionId, "sidebar")}
                >
                  Remove from sidebar
                </MenuItem>
                {projects.length > 0 ? (
                  <>
                    <MenuSeparator />
                    <MenuLabel>Move to project</MenuLabel>
                    <MenuItem
                      onClick={() =>
                        moveSessionToProject(taskMenu.sessionId, null)
                      }
                    >
                      Ungrouped tasks
                    </MenuItem>
                    {projects.map((project) => (
                      <MenuItem
                        key={project.id}
                        onClick={() =>
                          moveSessionToProject(taskMenu.sessionId, project.id)
                        }
                      >
                        {project.name}
                      </MenuItem>
                    ))}
                  </>
                ) : null}
              </MotionMenu>,
              document.body,
            )}

          {!isSidebar ? (
            <div
              aria-hidden={!props.sidePanelOpen}
              className={`app-split-seam relative z-10 shrink-0 self-stretch ${props.sidePanelOpen
                ? "w-px opacity-100"
                : "pointer-events-none w-0 opacity-0"
                }`}
            >
              <div
                className="absolute inset-y-0 -left-1.5 z-20 w-3 cursor-ew-resize"
                onMouseDown={props.onResizeStart}
                title="Drag to resize side panel"
              />
            </div>
          ) : null}

          <div
            className={
              complementsOpen ? "flex min-h-0 min-w-0 flex-1" : "hidden"
            }
          >
            <ComplementsView />
          </div>
          {isSidebar
            ? openChatTabs
              .filter((id): id is string =>
                Boolean(id?.startsWith("header-terminal-")),
              )
              .map((id) => (
                <div
                  key={id}
                  className={
                    activeHeaderTerminal === id
                      ? "flex min-h-0 min-w-0 flex-1 px-1.5 pb-1.5"
                      : "hidden"
                  }
                >
                  <XTerminal
                    connected={props.connected}
                    active={viewActive && activeHeaderTerminal === id}
                    focused={viewActive && activeHeaderTerminal === id}
                    sessionId={id}
                    workspaceId={`agent-header:${props.workspaceKind}:${props.connectionId}:${props.workspacePath}`}
                    workspaceKind={props.workspaceKind ?? "ssh"}
                    connectionId={props.connectionId}
                    cwd={props.workspacePath}
                  />
                </div>
              ))
            : null}
          <div
            style={
              isSidebar && activeHeaderTerminal
                ? { display: "none" }
                : undefined
            }
            className={`agent-main-split flex min-h-0 min-w-0 flex-1 overflow-hidden gap-0${complementsOpen ? " hidden" : ""
              }${browserExpanded ? " is-browser-expanded" : ""
              }${workspaceCardOpen ? " has-workspace" : ""}`}
          >
            <section
              aria-hidden={browserExpanded}
              className={`agent-main flex min-h-0 min-w-0 overflow-hidden border-0 ${browserExpanded
                ? "pointer-events-none flex-[0_0_0%] opacity-0"
                : "flex-1 opacity-100"
                }`}
            >
              {/* Chat column — content centers here; tools live in a separate right rail. */}
              <div
                className={`agent-chat-column${isSidebar && isEmptyChat ? " is-empty-chat" : ""} relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden${!isSidebar && showNewTask ? " agent-newtask-home" : ""}`}
              >
                <div className="agent-timeline-shell relative min-h-0 flex-1 overflow-hidden">
                  <AgentTimelineScrubber
                    turns={timelineTurns}
                    visible={
                      !isSidebar &&
                      showChatShell &&
                      timelineTurns.length > 0 &&
                      !showNewTask &&
                      !showEmptySetup
                    }
                    activeIndex={activeTimelineTurn}
                    onJump={jumpToTimelineTurn}
                  />
                  {/* Top fade stays above the history scroller and below sticky user prompts. */}
                  <span
                    aria-hidden="true"
                    className={`scroll-edge-fade agent-timeline-fade agent-timeline-fade-top-sticky pointer-events-none absolute left-0 right-0 top-0 z-[11] block h-3 transition-opacity duration-150 ${timelineFadeEdges.top ? "opacity-100" : "opacity-0"}`}
                    data-edge="top"
                  />
                  {showNewTask ||
                    showEmptySetup ||
                    timelineTurns.length === 0 ? (
                    <div className="agent-timeline absolute inset-0 overflow-x-hidden overflow-y-auto">
                      {showNewTask ? null : showEmptySetup ? (
                        <AgentEmptyState
                          configured={providerReady}
                          connected={props.connected}
                          managedLlm={providerConfig?.managedLlm !== false}
                          workspacePath={agentWorkspacePath}
                        />
                      ) : (
                        <div className="agent-timeline-content agent-chat-measure is-history-loading">
                          <div
                            className="agent-timeline-loading"
                            aria-busy="true"
                            aria-label="Loading chat"
                          >
                            <span className="agent-timeline-loading-bar" />
                            <span className="agent-timeline-loading-bar is-short" />
                            <span className="agent-timeline-loading-bar" />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      key={activeSessionId ?? "no-session"}
                      ref={timelineRef}
                      className="agent-timeline agent-timeline-native absolute inset-0 overflow-x-hidden overflow-y-auto"
                      onScroll={handleTimelineScroll}
                    >
                      <div
                        className="agent-timeline-virtual-header"
                        aria-live="polite"
                      >
                        {timelineCanShowEarlier ? (
                          <button
                            className="agent-timeline-load-earlier"
                            disabled={historyLoadingOlder}
                            onClick={showEarlierTimeline}
                            type="button"
                          >
                            {historyLoadingOlder
                              ? "Loading earlier messages…"
                              : "Load earlier messages"}
                          </button>
                        ) : null}
                      </div>
                      {renderedTimelineTurns.map((turn, offset) => (
                        <div key={turn.id}>
                          {renderTimelineItem(
                            timelineRenderStart + offset,
                            turn,
                          )}
                        </div>
                      ))}
                      <div
                        className={`agent-timeline-virtual-footer${pendingApproval ||
                          dockPlan ||
                          showComposerCheckpointDock
                          ? " has-dock"
                          : ""
                          }`}
                      />
                    </div>
                  )}
                  {/* Bottom fade sits on the timeline/composer boundary (input), under floating docks. */}
                  <span
                    aria-hidden="true"
                    className={`scroll-edge-fade agent-timeline-fade agent-timeline-fade-bottom pointer-events-none absolute bottom-0 left-0 right-[5px] z-20 h-10 transition-opacity duration-150 ${timelineFadeEdges.bottom ? "opacity-100" : "opacity-0"}`}
                    data-edge="bottom"
                  />
                </div>

                <OutOfCreditsDialog
                  open={outOfCreditsOpen}
                  periodEnd={
                    outOfCreditsPeriodEnd ?? llmCredits?.periodEnd ?? null
                  }
                  onDismiss={() => setOutOfCreditsOpen(false)}
                />
                {/* Keep composer dock stable while sessions restore — avoids footer pop-in on the right card. */}
                {showChatShell && (
                  <AgentComposerDock
                    showNewTask={isSidebar ? isEmptyChat : showNewTask}
                    pendingApproval={pendingApproval}
                    dockPlan={dockPlan}
                    showComposerCheckpointDock={showComposerCheckpointDock}
                    checkpointReviewOpen={checkpointReviewOpen}
                    planBusy={planBusy}
                    turnActive={turnActive}
                    planDraftSteps={planDraftSteps}
                    planDraftTitle={planDraftTitle}
                    dismissPlan={dismissPlan}
                    implementPlan={implementPlan}
                    pendingCheckpoints={pendingCheckpoints}
                    pendingCheckpointFileStats={pendingCheckpointFileStats}
                    keepCheckpoints={keepCheckpoints}
                    openWorkspaceFile={openWorkspaceFile}
                    setCheckpointReviewOpen={setCheckpointReviewOpen}
                    undoAllCheckpoints={undoAllCheckpoints}
                    restoringCheckpoint={restoringCheckpoint}
                    isSidebar={isSidebar}
                    timelineFadeEdges={timelineFadeEdges}
                    showEmptySetup={showEmptySetup}
                    scrollTimelineToBottom={scrollTimelineToBottom}
                    newTaskWorkspaceMenuRef={newTaskWorkspaceMenuRef}
                    newTaskWorkspaceMenuOpen={newTaskWorkspaceMenuOpen}
                    setNewTaskWorkspaceMenuOpen={setNewTaskWorkspaceMenuOpen}
                    newTaskNoRepo={newTaskNoRepo}
                    agentWorkspacePath={agentWorkspacePath}
                    setNewTaskWorkspaceQuery={setNewTaskWorkspaceQuery}
                    newTaskWorkspaceSearchRef={newTaskWorkspaceSearchRef}
                    newTaskWorkspaceQuery={newTaskWorkspaceQuery}
                    workspaceMenuScrollRef={workspaceMenuScrollRef}
                    selectableWorkspaces={selectableWorkspaces}
                    selectNewTaskWorkspace={selectNewTaskWorkspace}
                    hostWorkspaceLabel={hostWorkspaceLabel}
                    setNewTaskNoRepo={setNewTaskNoRepo}
                    noRepoWorkspacePath={noRepoWorkspacePath}
                    setNewTaskWorkspacePath={setNewTaskWorkspacePath}
                    props={props}
                    isLocalWorkspace={isLocalWorkspace}
                    visibleGuardPause={visibleGuardPause}
                    resolvingGuard={resolvingGuard}
                    resolveGuard={resolveGuard}
                    resolveApproval={resolveApproval}
                    resolvingApproval={resolvingApproval}
                    effectiveAccessLevel={effectiveAccessLevel}
                    activeMode={activeMode}
                    autoModel={autoModel}
                    llmCredits={llmCredits}
                    composerDisabled={composerDisabled}
                    composerReasoning={composerReasoning}
                    contextUsage={contextUsage}
                    composerDraftKey={composerDraftKey}
                    activeSessionId={activeSessionId}
                    composerRetryDraft={composerRetryDraft}
                    error={error}
                    changeAccess={changeAccess}
                    changeMode={changeMode}
                    setComplementsOpen={setComplementsOpen}
                    openWorkspaceKind={openWorkspaceKind}
                    setQueuedFollowUps={setQueuedFollowUps}
                    selectComposerModel={selectComposerModel}
                    handleSlashCommand={handleSlashCommand}
                    stopGeneration={stopGeneration}
                    submit={submit}
                    composerPlaceholder={composerPlaceholder}
                    providerModel={providerModel}
                    queuedFollowUps={queuedFollowUps}
                    savingProvider={savingProvider}
                    sendBlocked={sendBlocked}
                    setAutoModel={setAutoModel}
                    changeReasoning={changeReasoning}
                    stopping={stopping}
                  />
                )}
              </div>
            </section>

            {/* Seam + resize between chat and workspace (browser / files / terminal). */}
            {!isSidebar && workspaceCardOpen && !browserExpanded ? (
              <div
                className="app-split-seam relative z-10 shrink-0 self-stretch w-px"
                title="Drag to resize workspace"
              >
                <div
                  className="absolute inset-y-0 -left-1.5 z-20 w-3 cursor-ew-resize"
                  onMouseDown={startWorkspaceResize}
                />
              </div>
            ) : null}

            {/* Right pane: flush inside the unified card; resizable when docked. */}
            {!isSidebar ? (
              <section
                aria-hidden={!workspaceCardOpen}
                className={`agent-workspace-card flex min-h-0 overflow-hidden ${workspaceCardOpen
                  ? browserExpanded
                    ? "min-w-0 flex-[1_1_100%] opacity-100"
                    : "shrink-0 opacity-100"
                  : "pointer-events-none min-w-0 flex-[0_0_0%] opacity-0"
                  }${browserExpanded ? " is-browser-expanded" : ""}`}
                style={
                  workspaceCardOpen && !browserExpanded
                    ? {
                      width: workspacePaneWidth,
                      flexBasis: workspacePaneWidth,
                    }
                    : undefined
                }
              >
                <AgentWorkspacePanel
                  active={viewActive && workspaceCardOpen}
                  browserExpanded={browserExpanded}
                  connected={props.connected}
                  onBrowserExpandedChange={setBrowserExpanded}
                  onOpenGitWorkspace={(path) => {
                    void (async () => {
                      const preparedPath = await prepareNewTaskWorkspace(path);
                      if (!preparedPath) return;
                      // Keep composer stable if already on blank new-task.
                      createNewTask();
                      setNewTaskWorkspacePath(preparedPath);
                    })();
                  }}
                  onTabsChange={handleWorkspaceTabsChange}
                  openBrowserRequest={workspaceBrowserRequest}
                  openFileRequest={workspaceFileRequest}
                  terminalRecovery={workspaceTerminalRecovery}
                  openRequest={workspaceOpenRequest}
                  workspacePath={agentWorkspacePath}
                  workspaceKind={props.workspaceKind ?? "ssh"}
                  connectionId={
                    props.workspaceKind === "local"
                      ? "local"
                      : props.connectionId
                  }
                  sessionId={activeSessionId}
                  gitAvailable={props.workspaceKind !== "local"}
                />
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
