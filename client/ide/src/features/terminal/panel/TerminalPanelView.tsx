import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { OverflowFadeText } from "../../../shared/components/OverflowFadeText";
import { Menu } from "../../../shared/ui/Menu";
import { useContextMenuPosition } from "../../../shared/ui/useContextMenuPosition";
import { EditorProblemsPanel } from "../../editor";
import { XTerminal, type XTerminalHandle } from "../XTerminal";
import {
  createTerminalSplit,
  firstTerminalPaneId,
  replaceTerminalPane,
  updateTerminalSplitRatio,
  type SplitPlacement,
} from "../terminalLayout";
import {
  CloseIcon,
  MenuDivider,
  MenuItem,
  TerminalTabIcon,
} from "./MenuControls";
import { PaneDropPreview, TerminalSplitDivider } from "./SplitControls";
import { TERMINAL_TAB_CLASS, TerminalGroupHeader } from "./TerminalGroupHeader";
import {
  baseName,
  compactLayout,
  cx,
  DEFAULT_SHELL,
  isProblemsTab,
  makeProblemsTab,
  newTerminalSessionId,
  paneIds,
  PROBLEMS_TAB_ID,
  resolveActiveIds,
  sameSurfaceRects,
} from "./layout";
import {
  type DropPreview,
  type LayoutNode,
  type PaneId,
  type PointerDrag,
  type SurfaceRect,
  type TerminalMenu,
  type TerminalPanelProps,
} from "./types";
import { useTerminalTabActions } from "./useTerminalTabActions";
import { useTerminalTabDrag } from "./useTerminalTabDrag";
import { useTerminalWorkspace } from "./useTerminalWorkspace";

export function TerminalPanel({
  initialTerminal,
  requestedTerminals,
  onAgentTerminalClose,
  connected,
  embedded = false,
  hideHeader = false,
  surfaceActive = true,
  onEmpty,
  onOpenBrowserUrl,
  onOpenRemoteFile,
  terminalRequest = 0,
  workspacePath,
  workspaceKind,
  connectionId,
  enableProblems = false,
  problemsMarkers = [],
  onRevealProblem,
  drawerView = "terminal",
  onDrawerViewChange,
  placement = "drawer",
  onPlacementChange,
}: TerminalPanelProps) {
  const {
    setActivePaneId,
    activeIds,
    tabs,
    layout,
    nextId,
    setTabs,
    setActiveIds,
    setNextId,
    setUserTitles,
    nextPaneId,
    nextSplitId,
    setNextPaneId,
    setNextSplitId,
    setLayout,
    activePaneId,
    terminalIds,
    setTerminalIds,
    setForeground,
    setStatuses,
    foreground,
    statuses,
    userTitles,
    storageKey,
  } = useTerminalWorkspace({
    initialTerminal,
    workspaceKind,
    connectionId,
    workspacePath,
    enableProblems,
    drawerView,
    surfaceActive,
    placement,
  });
  const [draggedTabId, setDraggedTabId] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [dragVisual, setDragVisual] = useState<{
    grabX: number;
    grabY: number;
    width: number;
  } | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const [menu, setMenu] = useState<TerminalMenu>(null);
  const menuPlacement = useContextMenuPosition(menu);
  const terminalRefs = useRef(new Map<number, XTerminalHandle | null>());
  const fitRetryTimers = useRef<number[]>([]);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragPointRef = useRef<{
    tabId: number;
    x: number;
    y: number;
  } | null>(null);
  const removePointerListenersRef = useRef<(() => void) | null>(null);
  const handledTerminalRequest = useRef(terminalRequest);
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const dropPreviewRef = useRef<DropPreview | null>(null);
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  const paneSlotsRef = useRef(new Map<PaneId, HTMLDivElement>());
  const [surfaceRects, setSurfaceRects] = useState<Record<PaneId, SurfaceRect>>(
    {},
  );
  const measureFrameRef = useRef<number | null>(null);
  const contextName = baseName(workspacePath);

  const activatePane = useCallback(
    (paneId: PaneId) => {
      setActivePaneId(paneId);
      const activeId =
        activeIds[paneId] ??
        tabs.find((tab) => tab.paneId === paneId && !isProblemsTab(tab))?.id;
      if (activeId == null) return;
      // Let React commit the selected-pane state before focusing the xterm
      // canvas. This prevents a sibling pane from retaining keyboard input.
      requestAnimationFrame(() => terminalRefs.current.get(activeId)?.focus());
    },
    [activeIds, tabs],
  );

  const addTab = (paneId: PaneId = firstTerminalPaneId(layout)) => {
    const id = nextId;
    setTabs((current) => [
      ...current,
      {
        cwd: workspacePath,
        id,
        paneId,
        kind: "terminal",
        sessionId: newTerminalSessionId(),
      },
    ]);
    setActiveIds((current) => ({ ...current, [paneId]: id }));
    setActivePaneId(paneId);
    setNextId(id + 1);
    onDrawerViewChange?.("terminal");
  };

  // Adopt the existing host identity; never start a second shell for an agent tab.
  const requestedRef = useRef(new Set<string>());
  useEffect(() => {
    const requested = (requestedTerminals ?? []).filter(
      (terminal) =>
        !requestedRef.current.has(terminal.sessionId) &&
        terminal.workspaceKind === workspaceKind &&
        terminal.workspacePath === workspacePath &&
        (workspaceKind === "local" || terminal.connectionId === connectionId),
    );
    if (!requested.length) return;
    for (const terminal of requested)
      requestedRef.current.add(terminal.sessionId);
    const paneId = firstTerminalPaneId(layout);
    const existingIds = new Map(tabs.map((tab) => [tab.sessionId, tab.id]));
    const additions = requested.filter(
      (terminal) => !existingIds.has(terminal.sessionId),
    );
    const ids = new Map(
      requested.map((terminal, index) => [
        terminal.sessionId,
        existingIds.get(terminal.sessionId) ?? nextId + index,
      ]),
    );
    if (additions.length) {
      setTabs((current) => [
        ...current,
        ...additions.map((terminal) => ({
          id: ids.get(terminal.sessionId)!,
          paneId,
          kind: "terminal" as const,
          sessionId: terminal.sessionId,
          cwd: terminal.cwd,
        })),
      ]);
      setNextId(nextId + additions.length);
    }
    setUserTitles((current) => ({
      ...current,
      ...Object.fromEntries(
        requested.map((terminal) => [
          ids.get(terminal.sessionId)!,
          terminal.title || "Agent terminal",
        ]),
      ),
    }));
    const activeId = ids.get(requested.at(-1)!.sessionId)!;
    setActiveIds((current) => ({ ...current, [paneId]: activeId }));
    setActivePaneId(paneId);
    onDrawerViewChange?.("terminal");
  }, [
    requestedTerminals,
    workspaceKind,
    workspacePath,
    connectionId,
    tabs,
    layout,
    nextId,
    onDrawerViewChange,
  ]);

  const splitFromTab = (sourceId: number, placement: SplitPlacement) => {
    const source = tabs.find(
      (tab) => tab.id === sourceId && !isProblemsTab(tab),
    );
    if (!source) return;
    const newPaneId = `pane-${nextPaneId}`;
    const newTabId = nextId;
    const splitId = `split-${nextSplitId}`;
    setNextPaneId((value) => value + 1);
    setNextSplitId((value) => value + 1);
    setNextId((value) => value + 1);
    setTabs((current) => [
      ...current,
      {
        id: newTabId,
        kind: "terminal",
        paneId: newPaneId,
        sessionId: newTerminalSessionId(),
        cwd: source.cwd ?? workspacePath,
      },
    ]);
    setLayout((current) =>
      replaceTerminalPane(
        current,
        source.paneId,
        createTerminalSplit(splitId, source.paneId, newPaneId, placement),
      ),
    );
    setActiveIds((current) => ({
      ...current,
      [source.paneId]: sourceId,
      [newPaneId]: newTabId,
    }));
    setActivePaneId(newPaneId);
    onDrawerViewChange?.("terminal");
  };

  const showProblems = (paneId: PaneId = firstTerminalPaneId(layout)) => {
    setTabs((current) => {
      if (current.some(isProblemsTab)) return current;
      const insertAt = current.findIndex((tab) => tab.paneId === paneId);
      const tab = makeProblemsTab(paneId);
      if (insertAt < 0) return [tab, ...current];
      return [...current.slice(0, insertAt), tab, ...current.slice(insertAt)];
    });
    setActiveIds((current) => ({ ...current, [paneId]: PROBLEMS_TAB_ID }));
    setActivePaneId(paneId);
    onDrawerViewChange?.("problems");
  };

  // A workspace owns its own terminal layout. Switching workspace parks the
  // current descriptors and restores the other workspace without reusing ids.
  const measureSurfaceSlots = useCallback(() => {
    if (measureFrameRef.current !== null)
      cancelAnimationFrame(measureFrameRef.current);
    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = null;
      const root = panelRootRef.current;
      if (!root) return;
      const rootBox = root.getBoundingClientRect();
      const next: Record<PaneId, SurfaceRect> = {};
      for (const [paneId, slot] of paneSlotsRef.current) {
        const box = slot.getBoundingClientRect();
        next[paneId] = {
          height: Math.max(0, box.height),
          left: box.left - rootBox.left - root.clientLeft,
          top: box.top - rootBox.top - root.clientTop,
          width: Math.max(0, box.width),
        };
      }
      setSurfaceRects((current) =>
        sameSurfaceRects(current, next) ? current : next,
      );
    });
  }, []);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(measureSurfaceSlots);
    if (panelRootRef.current) observer.observe(panelRootRef.current);
    for (const slot of paneSlotsRef.current.values()) observer.observe(slot);
    measureSurfaceSlots();
    window.addEventListener("resize", measureSurfaceSlots);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureSurfaceSlots);
      if (measureFrameRef.current !== null)
        cancelAnimationFrame(measureFrameRef.current);
      measureFrameRef.current = null;
    };
  }, [activeIds, layout, measureSurfaceSlots, surfaceActive, tabs]);

  // Runs after React applies the measured rects to stable session hosts.
  useLayoutEffect(() => {
    if (!surfaceActive || drawerView === "problems") return;
    for (const tab of tabs) {
      if (activeIds[tab.paneId] === tab.id)
        terminalRefs.current.get(tab.id)?.fit();
    }
  }, [surfaceRects, surfaceActive, drawerView, activeIds, tabs]);

  useEffect(() => {
    if (terminalRequest === handledTerminalRequest.current) return;
    handledTerminalRequest.current = terminalRequest;
    addTab();
  }, [terminalRequest]);

  useEffect(() => {
    if (!enableProblems) return;
    if (drawerView === "problems") {
      showProblems();
      return;
    }
    setActiveIds((ids) => {
      const problemsTab = tabs.find(isProblemsTab);
      if (!problemsTab || ids[problemsTab.paneId] !== problemsTab.id)
        return ids;
      const terminal = tabs.find(
        (tab) => tab.paneId === problemsTab.paneId && !isProblemsTab(tab),
      );
      if (!terminal) return ids;
      return { ...ids, [problemsTab.paneId]: terminal.id };
    });
    // Only follow App-driven view changes; local tab clicks update App themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerView]);

  // App menu / keyboard shortcuts → Terminal panel commands.
  useEffect(() => {
    const activeTabId = (): number | null => {
      const paneId = paneIds(layout).includes(activePaneId)
        ? activePaneId
        : firstTerminalPaneId(layout);
      const current =
        activeIds[paneId] ??
        tabs.find((tab) => tab.paneId === paneId)?.id ??
        tabs[0]?.id ??
        null;
      const tab = tabs.find((candidate) => candidate.id === current);
      if (tab && !isProblemsTab(tab)) return current;
      return tabs.find((candidate) => !isProblemsTab(candidate))?.id ?? null;
    };

    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === "clear") {
        const id = activeTabId();
        if (id != null) terminalRefs.current.get(id)?.clear();
        return;
      }
      if (detail === "close") {
        const id = activeTabId();
        if (id != null) closeTab(id);
        return;
      }
      if (detail === "kill") {
        const id = activeTabId();
        if (id != null) closeTab(id);
        return;
      }
      if (detail === "restart") {
        const id = activeTabId();
        if (id != null) void restartTab(id);
        else addTab();
        return;
      }
      if (detail === "split") {
        const sourceId = activeTabId();
        if (sourceId == null) {
          addTab();
          return;
        }
        const source = tabs.find((tab) => tab.id === sourceId);
        if (!source) {
          addTab();
          return;
        }
        // Split current pane to the right with a fresh terminal tab.
        const newPaneId = `pane-${nextPaneId}` as PaneId;
        const newTabId = nextId;
        const splitId = `split-${nextSplitId}`;
        setNextPaneId((n) => n + 1);
        setNextSplitId((n) => n + 1);
        setNextId((n) => n + 1);
        setTabs((current) => [
          ...current,
          {
            cwd: source.cwd ?? workspacePath,
            id: newTabId,
            paneId: newPaneId,
            kind: "terminal",
            sessionId: newTerminalSessionId(),
          },
        ]);
        setLayout((current) =>
          replaceTerminalPane(
            current,
            source.paneId,
            createTerminalSplit(splitId, source.paneId, newPaneId, "right"),
          ),
        );
        setActiveIds((current) => ({
          ...current,
          [source.paneId]: sourceId,
          [newPaneId]: newTabId,
        }));
        setActivePaneId(newPaneId);
        return;
      }
    };

    window.addEventListener("coloride:terminal-command", onCommand);
    return () =>
      window.removeEventListener("coloride:terminal-command", onCommand);
  }, [activeIds, activePaneId, layout, nextId, nextPaneId, nextSplitId, tabs]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKeyDown = (event: KeyboardEvent) =>
      event.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  useEffect(
    () => () => {
      removePointerListenersRef.current?.();
      if (dragFrameRef.current !== null)
        cancelAnimationFrame(dragFrameRef.current);
      for (const id of fitRetryTimers.current) window.clearTimeout(id);
      fitRetryTimers.current = [];
    },
    [],
  );

  // Visual unmounts are non-destructive in Terminal V2. Explicit Close/Kill
  // below are the only UI actions allowed to terminate a shell.

  useLayoutEffect(() => {
    const fitActive = () => {
      for (const tab of tabs) {
        if (isProblemsTab(tab)) continue;
        const paneTabs = tabs.filter(
          (candidate) => candidate.paneId === tab.paneId,
        );
        const activeId = activeIds[tab.paneId] ?? paneTabs[0]?.id ?? null;
        if (tab.id !== activeId) continue;
        terminalRefs.current.get(tab.id)?.fit();
      }
    };
    for (const id of fitRetryTimers.current) window.clearTimeout(id);
    fitRetryTimers.current = [0, 100].map((ms) =>
      window.setTimeout(fitActive, ms),
    );
  }, [activeIds, layout, tabs]);

  // Explorer dispatches this after its drawer has reached the final height.
  // This must perform the same reveal/fit as clicking a terminal tab; relying
  // on the earlier mount measurement leaves xterm with a blank first frame.
  useEffect(() => {
    const revealActiveTerminals = () => {
      for (const tab of tabs) {
        if (isProblemsTab(tab)) continue;
        const paneTabs = tabs.filter(
          (candidate) => candidate.paneId === tab.paneId,
        );
        const activeId = activeIds[tab.paneId] ?? paneTabs[0]?.id ?? null;
        if (tab.id === activeId) terminalRefs.current.get(tab.id)?.fit();
      }
    };
    window.addEventListener("coloride:terminal-layout", revealActiveTerminals);
    return () =>
      window.removeEventListener(
        "coloride:terminal-layout",
        revealActiveTerminals,
      );
  }, [activeIds, tabs]);

  useEffect(() => {
    if (tabs.length === 0) return;
    const livePaneIds = new Set(tabs.map((tab) => tab.paneId));
    if (!paneIds(layout).some((paneId) => !livePaneIds.has(paneId))) return;

    const compactedLayout = compactLayout(layout, tabs);
    if (!compactedLayout) return;
    setLayout(compactedLayout);
    setActiveIds((current) => resolveActiveIds(compactedLayout, tabs, current));
  }, [layout, tabs]);

  const { closeTab, restartTab } = useTerminalTabActions({
    tabs,
    setTabs,
    setActiveIds,
    onDrawerViewChange,
    onEmpty,
    layout,
    setLayout,
    activeIds,
    terminalIds,
    initialTerminal,
    requestedRef,
    onAgentTerminalClose,
    setTerminalIds,
    setForeground,
    setStatuses,
    setUserTitles,
    activePaneId,
    setActivePaneId,
  });
  const { finishDrag, startPointerDrag, continuePointerDrag, endPointerDrag } =
    useTerminalTabDrag({
      removePointerListenersRef,
      dragFrameRef,
      pendingDragPointRef,
      pointerDragRef,
      dropPreviewRef,
      setDraggedTabId,
      setDragPosition,
      setDragVisual,
      setDropPreview,
      tabs,
      layout,
      nextPaneId,
      nextSplitId,
      activeIds,
      setTabs,
      setLayout,
      setNextPaneId,
      setNextSplitId,
      setActiveIds,
      setActivePaneId,
      dragGhostRef,
    });
  const runMenuAction = (
    action: (terminal: XTerminalHandle | null) => void | Promise<void>,
  ) => {
    const target = menu;
    setMenu(null);
    if (!target) return;
    void action(terminalRefs.current.get(target.tabId) ?? null);
  };

  const openContextMenu = (event: React.MouseEvent, tabId: number) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      tabId,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const renderPane = (paneId: PaneId) => {
    const paneTabs = tabs.filter((tab) => tab.paneId === paneId);
    const activeId = activeIds[paneId] ?? paneTabs[0]?.id ?? null;
    const preview = dropPreview?.paneId === paneId ? dropPreview : null;

    return (
      <section
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#171717]"
        data-terminal-pane-root={paneId}
        onPointerDown={() => activatePane(paneId)}
      >
        {!hideHeader && (
          <TerminalGroupHeader
            activeId={activeId}
            contextName={contextName}
            enableProblems={enableProblems}
            foreground={foreground}
            onAddProblems={() => showProblems(paneId)}
            onAddTerminal={() => addTab(paneId)}
            onClose={closeTab}
            onPointerCancel={finishDrag}
            onPointerDown={startPointerDrag}
            onPointerMove={continuePointerDrag}
            onPointerUp={endPointerDrag}
            onSelect={(id) => {
              setActiveIds((current) => ({ ...current, [paneId]: id }));
              setActivePaneId(paneId);
              if (id !== PROBLEMS_TAB_ID) {
                requestAnimationFrame(() =>
                  terminalRefs.current.get(id)?.focus(),
                );
              }
              const tab = tabs.find((candidate) => candidate.id === id);
              onDrawerViewChange?.(
                isProblemsTab(tab) ? "problems" : "terminal",
              );
            }}
            paneId={paneId}
            problemsCount={problemsMarkers.length}
            statuses={statuses}
            userTitles={userTitles}
            tabs={paneTabs}
          />
        )}
        <div
          className="relative min-h-0 flex-1 overflow-hidden"
          ref={(node) => {
            if (node) paneSlotsRef.current.set(paneId, node);
            else paneSlotsRef.current.delete(paneId);
          }}
          data-terminal-surface-slot={paneId}
        >
          {enableProblems && activeId === PROBLEMS_TAB_ID ? (
            <EditorProblemsPanel
              markers={problemsMarkers}
              onReveal={(line, column) => onRevealProblem?.(line, column)}
            />
          ) : null}
        </div>
        {draggedTabId && preview && (
          <PaneDropPreview placement={preview.placement} />
        )}
      </section>
    );
  };

  const renderLayout = (node: LayoutNode): React.ReactNode => {
    if (node.type === "pane") {
      return renderPane(node.id);
    }
    return (
      <div
        className={cx(
          "flex min-h-0 min-w-0 flex-1",
          node.direction === "horizontal" ? "flex-row" : "flex-col",
        )}
      >
        <div
          className="flex min-h-0 min-w-0 overflow-hidden"
          style={{
            flexBasis: `${node.ratio * 100}%`,
            flexGrow: 0,
            flexShrink: 0,
          }}
        >
          {renderLayout(node.first)}
        </div>
        <TerminalSplitDivider
          direction={node.direction}
          onRatio={(ratio) =>
            setLayout((current) =>
              updateTerminalSplitRatio(current, node.id, ratio),
            )
          }
        />
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {renderLayout(node.second)}
        </div>
      </div>
    );
  };

  const draggedLabel = draggedTabId
    ? userTitles[draggedTabId] ||
    `${contextName} - ${foreground[draggedTabId] ?? DEFAULT_SHELL}`
    : "";
  const renderedLayout = compactLayout(layout, tabs);
  const latestDragPoint = pendingDragPointRef.current ??
    dragPosition ?? { x: 0, y: 0 };

  return (
    <div
      ref={panelRootRef}
      className={cx(
        "terminal-panel-root relative flex h-full min-h-0 min-w-0 overflow-hidden bg-[#212121]",
        embedded
          ? "rounded-none border-x-0 border-b-0 border-t border-[#333333]"
          : "rounded-2xl border border-[#333333]",
      )}
    >
      {renderedLayout && renderLayout(renderedLayout)}

      <div
        className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
        data-terminal-surface-layer="true"
      >
        {tabs
          .filter((tab) => !isProblemsTab(tab))
          .map((tab) => {
            const rect = surfaceRects[tab.paneId];
            const visible = Boolean(
              rect &&
              rect.width >= 8 &&
              rect.height >= 8 &&
              activeIds[tab.paneId] === tab.id &&
              drawerView !== "problems" &&
              surfaceActive,
            );
            return (
              <div
                aria-hidden={!visible}
                className={cx(
                  "terminal-xterm-host absolute bg-[#171717] pb-1 pl-5 pr-0",
                  visible
                    ? "pointer-events-auto visible"
                    : "invisible pointer-events-none",
                )}
                key={tab.sessionId}
                data-terminal-surface-pane={tab.paneId}
                onContextMenu={(event) => openContextMenu(event, tab.id)}
                onPointerDown={() => activatePane(tab.paneId)}
                style={{
                  height: rect?.height ?? 0,
                  left: rect?.left ?? 0,
                  top: rect?.top ?? 0,
                  width: rect?.width ?? 0,
                }}
              >
                <XTerminal
                  ref={(node) => {
                    if (node) terminalRefs.current.set(tab.id, node);
                    else terminalRefs.current.delete(tab.id);
                  }}
                  active={visible}
                  focused={activePaneId === tab.paneId}
                  connected={connected}
                  cwd={tab.cwd ?? workspacePath}
                  onForeground={(name) =>
                    setForeground((current) =>
                      current[tab.id] === name
                        ? current
                        : { ...current, [tab.id]: name },
                    )
                  }
                  onCwd={(cwd) =>
                    setTabs((current) =>
                      current.map((candidate) =>
                        candidate.id === tab.id && candidate.cwd !== cwd
                          ? { ...candidate, cwd }
                          : candidate,
                      ),
                    )
                  }
                  onOpenBrowserUrl={onOpenBrowserUrl}
                  onOpenRemoteFile={onOpenRemoteFile}
                  onSessionCreated={(termId) =>
                    setTerminalIds((current) => ({
                      ...current,
                      [tab.id]: termId,
                    }))
                  }
                  onStatusChange={(status) =>
                    setStatuses((current) =>
                      current[tab.id] === status
                        ? current
                        : { ...current, [tab.id]: status },
                    )
                  }
                  sessionId={tab.sessionId}
                  workspaceKind={workspaceKind}
                  workspaceId={storageKey}
                  connectionId={connectionId}
                />
              </div>
            );
          })}
      </div>

      {draggedTabId &&
        dragPosition &&
        dragVisual &&
        createPortal(
          <div
            className={cx(
              TERMINAL_TAB_CLASS,
              "pointer-events-none fixed z-[10050] border border-[#444] bg-[#2c2c2c] text-[#f0f4f8] shadow-2xl",
            )}
            ref={dragGhostRef}
            style={{
              left: latestDragPoint.x - dragVisual.grabX,
              position: "fixed",
              top: latestDragPoint.y - dragVisual.grabY,
              transition: "none",
              width: Math.max(dragVisual.width, 120),
              willChange: "left, top",
            }}
          >
            <span className="pointer-events-none relative flex min-w-0 items-center gap-1.5">
              <TerminalTabIcon />
              <OverflowFadeText className="flex-1">
                {draggedLabel}
              </OverflowFadeText>
            </span>
            <span className="absolute right-1.5 flex size-4 items-center justify-center rounded text-[#878888]">
              <CloseIcon />
            </span>
          </div>,
          document.body,
        )}

      {menu &&
        createPortal(
          <Menu
            onMouseDown={(event) => event.stopPropagation()}
            ref={menuPlacement.ref}
            style={menuPlacement.style}
            variant="context"
          >
            <MenuItem
              label={
                placement === "center"
                  ? "Move to Bottom Panel"
                  : "Move to Editor Area"
              }
              onClick={() => {
                onPlacementChange?.(
                  placement === "center" ? "drawer" : "center",
                );
                setMenu(null);
              }}
              shortcut=""
            />
            <MenuItem
              label="Split Right"
              onClick={() => {
                splitFromTab(menu.tabId, "right");
                setMenu(null);
              }}
              shortcut=""
            />
            <MenuItem
              label="Split Down"
              onClick={() => {
                splitFromTab(menu.tabId, "bottom");
                setMenu(null);
              }}
              shortcut=""
            />
            <MenuDivider />
            <MenuItem
              label="Rename"
              shortcut=""
              onClick={() => {
                const current =
                  userTitles[menu.tabId] ||
                  foreground[menu.tabId] ||
                  DEFAULT_SHELL;
                const title = window.prompt("Terminal name", current)?.trim();
                if (title)
                  setUserTitles((titles) => ({
                    ...titles,
                    [menu.tabId]: title.slice(0, 80),
                  }));
                setMenu(null);
              }}
            />
            <MenuItem
              label="Search"
              shortcut="Cmd F"
              onClick={() =>
                runMenuAction((terminal) => {
                  const query = window.prompt("Search terminal output");
                  if (query) terminal?.findNext(query);
                })
              }
            />
            <MenuItem
              label="Copy"
              shortcut="Cmd C"
              onClick={() =>
                runMenuAction((terminal) => terminal?.copySelection())
              }
            />
            <MenuItem
              label="Paste"
              shortcut="Cmd V"
              onClick={() =>
                runMenuAction((terminal) => terminal?.pasteFromClipboard())
              }
            />
            <MenuItem
              label="Paste Text"
              shortcut="Shift Cmd V"
              onClick={() =>
                runMenuAction((terminal) => terminal?.pasteFromClipboard())
              }
            />
            <MenuItem
              label="Select All"
              shortcut="Cmd A"
              onClick={() => runMenuAction((terminal) => terminal?.selectAll())}
            />
            <MenuItem
              label="Clear"
              shortcut="Cmd K"
              onClick={() => runMenuAction((terminal) => terminal?.clear())}
            />
            <MenuItem
              label="Restart"
              shortcut=""
              onClick={() => {
                void restartTab(menu.tabId);
                setMenu(null);
              }}
            />
            <MenuItem
              label="Zoom In"
              shortcut="Cmd +"
              onClick={() => runMenuAction((terminal) => terminal?.zoomIn())}
            />
            <MenuItem
              label="Zoom Out"
              shortcut="Cmd -"
              onClick={() => runMenuAction((terminal) => terminal?.zoomOut())}
            />
            <MenuItem
              label="Reset Zoom"
              shortcut="Cmd 0"
              onClick={() => runMenuAction((terminal) => terminal?.zoomReset())}
            />
            <MenuDivider />
            <MenuItem
              label="Close Terminal Tab"
              shortcut=""
              onClick={() => {
                closeTab(menu.tabId);
                setMenu(null);
              }}
            />
          </Menu>,
          document.body,
        )}
    </div>
  );
}
