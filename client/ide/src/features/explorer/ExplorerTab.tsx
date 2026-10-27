import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentTerminalReference } from "../../shared/api/types";
import type { DiagnosticMarker } from "../editor";
import { ExplorerEditor } from "../editor";
import { lspSessionManager } from "../editor/lsp/LspSessionManager";
import type { ServerWorkspaceController } from "../server/useServerWorkspace";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { FileTree } from "./filetree/FileTree";

export type ExplorerEditorStatus = {
  filePath: string | null;
  line: number;
  column: number;
  errors: number;
  warnings: number;
};

interface ExplorerTabProps {
  connected: boolean;
  /** False while another app tab is shown (Explorer stays mounted). */
  active?: boolean;
  onResizeStart: React.MouseEventHandler<HTMLDivElement>;
  onTerminalResizeStart: React.MouseEventHandler<HTMLDivElement>;
  onTerminalClose: () => void;
  onOpenExternalBrowser: (url: string) => void;
  terminalHeight: number;
  terminalInitialized: boolean;
  terminalOpen: boolean;
  terminalRequest: number;
  agentTerminals?: AgentTerminalReference[];
  onAgentTerminalClose?: (sessionId: string) => void;
  drawerView: "terminal" | "problems";
  onDrawerViewChange: (view: "terminal" | "problems") => void;
  treeWidth: number;
  sidePanelOpen: boolean;
  theme: "light" | "dark";
  workspace: ServerWorkspaceController;
  onEditorStatus?: (status: ExplorerEditorStatus | null) => void;
}

export function ExplorerTab({
  connected,
  active = true,
  onResizeStart,
  onTerminalResizeStart,
  onTerminalClose,
  onOpenExternalBrowser,
  terminalHeight,
  terminalInitialized,
  terminalOpen,
  terminalRequest,
  agentTerminals,
  onAgentTerminalClose,
  drawerView,
  onDrawerViewChange,
  treeWidth,
  sidePanelOpen,
  theme,
  workspace,
  onEditorStatus,
}: ExplorerTabProps) {
  const [editorStatus, setEditorStatus] = useState<ExplorerEditorStatus | null>(
    null,
  );
  const [errorPaths, setErrorPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [problemMarkers, setProblemMarkers] = useState<DiagnosticMarker[]>([]);
  const [terminalPlacement, setTerminalPlacement] = useState<
    "drawer" | "center"
  >("drawer");
  const revealProblemRef = useRef<(line: number, column: number) => void>(
    () => { },
  );

  const handleProblemsChange = useCallback(
    (
      markers: DiagnosticMarker[],
      reveal: (line: number, column: number) => void,
    ) => {
      revealProblemRef.current = reveal;
      setProblemMarkers(markers);
    },
    [],
  );

  useEffect(() => lspSessionManager.subscribeTreeErrors(setErrorPaths), []);

  useEffect(() => {
    const key = `coloride.terminal.placement:${workspace.workspaceKind}:${workspace.activeProfileId || "local"}:${workspace.workspacePath || "workspace"}`;
    const saved = localStorage.getItem(key);
    setTerminalPlacement(saved === "center" ? "center" : "drawer");
  }, [
    workspace.activeProfileId,
    workspace.workspaceKind,
    workspace.workspacePath,
  ]);

  const updateTerminalPlacement = useCallback(
    (placement: "drawer" | "center") => {
      setTerminalPlacement(placement);
      const key = `coloride.terminal.placement:${workspace.workspaceKind}:${workspace.activeProfileId || "local"}:${workspace.workspacePath || "workspace"}`;
      localStorage.setItem(key, placement);
    },
    [
      workspace.activeProfileId,
      workspace.workspaceKind,
      workspace.workspacePath,
    ],
  );

  useEffect(() => {
    if (!terminalOpen) return;
    const timers = [0, 80, 200, 360].map((ms) =>
      window.setTimeout(
        () => window.dispatchEvent(new Event("coloride:terminal-layout")),
        ms,
      ),
    );
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [terminalOpen, terminalHeight]);

  const handleEditorStatus = useCallback(
    (next: ExplorerEditorStatus | null) => {
      setEditorStatus((current) => {
        if (current === next) return current;
        if (!current || !next) return next;
        return current.filePath === next.filePath &&
          current.line === next.line &&
          current.column === next.column &&
          current.errors === next.errors &&
          current.warnings === next.warnings
          ? current
          : next;
      });
    },
    [],
  );

  const editorRevealLine = useMemo(() => {
    const reveal = workspace.editorReveal;
    const selectedFile = workspace.selectedFile;
    if (!reveal || !selectedFile) return null;
    if (
      reveal.path !== selectedFile &&
      reveal.path.replace(/\/+$/, "") !== selectedFile.replace(/\/+$/, "")
    ) {
      return null;
    }
    return {
      line: reveal.line,
      column: reveal.column,
      token: reveal.token,
    };
  }, [workspace.editorReveal, workspace.selectedFile]);

  useEffect(() => {
    onEditorStatus?.(editorStatus);
  }, [editorStatus, onEditorStatus]);

  // Persist caret for session restore (deps are primitives so workspace identity is irrelevant).
  useEffect(() => {
    if (!editorStatus?.filePath || editorStatus.line < 1) return;
    workspace.noteEditorCursor(editorStatus.line, editorStatus.column);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- noteEditorCursor is stable enough via refs inside
  }, [editorStatus?.filePath, editorStatus?.line, editorStatus?.column]);

  useEffect(() => {
    return () => onEditorStatus?.(null);
  }, [onEditorStatus]);

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <div className="app-main-card flex h-full min-h-0 min-w-0 flex-1 overflow-hidden border border-b-0 border-r-0 border-[#333333] bg-[#212121]">
        <div
          aria-hidden={!sidePanelOpen}
          className={`relative flex h-full min-h-0 flex-shrink-0 flex-col overflow-hidden transition-opacity duration-200 ease-out ${sidePanelOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
          style={{ width: sidePanelOpen ? `${treeWidth}px` : "0px" }}
        >
          <FileTree
            expandedIds={workspace.expandedIds}
            connected={connected}
            dirtyPaths={workspace.dirtyFiles}
            errorPaths={errorPaths}
            items={workspace.treeItems}
            loadingPaths={workspace.loadingDirs}
            onCreateFile={workspace.createFileAt}
            onCreateFolder={workspace.createFolderAt}
            createRequest={workspace.createRequest}
            onDeleteItem={workspace.handleDeleteTreeItem}
            onDeleteItems={workspace.handleDeleteTreeItems}
            onUndo={workspace.undoTreeAction}
            canUndo={workspace.treeCanUndo}
            onOpenRemoteFile={workspace.openRemoteFile}
            onRenameItem={workspace.handleRenameTreeItem}
            onMoveItem={workspace.handleMoveTreeItem}
            onCutItem={workspace.handleCutTreeItem}
            onCopyItem={workspace.handleCopyTreeItem}
            onDuplicateItem={workspace.handleDuplicateTreeItem}
            onPasteItem={workspace.handlePasteTreeItem}
            canPaste={connected || Boolean(workspace.treeClipboard)}
            onUploadFiles={workspace.uploadLocalFiles}
            onRefresh={workspace.handleRefreshTree}
            refreshing={workspace.treeRefreshing}
            revealPath={workspace.revealRequest?.path ?? null}
            revealToken={workspace.revealRequest?.token ?? 0}
            onSelectFile={workspace.handleSelectFile}
            onToggleDir={workspace.handleToggleDir}
            onExpandAllFolders={workspace.expandAllTreeFolders}
            workspaceKind={workspace.workspaceKind}
            connectionId={workspace.activeProfileId}
            onCollapseAllFolders={workspace.collapseAllTreeFolders}
            selectedPath={workspace.selectedFile}
            workspacePath={workspace.workspacePath}
          />

          {workspace.explorerError && (
            <div className="pointer-events-none absolute bottom-2 left-2 right-2 truncate rounded-md bg-[#171717]/90 px-2 py-1 text-[11px] text-[#878888]">
              {workspace.explorerError}
            </div>
          )}
        </div>

        <div
          aria-hidden={!sidePanelOpen}
          className={`app-split-seam relative z-10 flex-shrink-0 self-stretch transition-opacity duration-200 ease-out ${sidePanelOpen
            ? "w-px opacity-100"
            : "pointer-events-none w-0 opacity-0"
            }`}
        >
          <div
            className="absolute inset-y-0 -left-1.5 z-20 w-1.5 cursor-ew-resize"
            onMouseDown={onResizeStart}
            title="Drag to resize file tree"
          />
        </div>

        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${terminalPlacement === "center" && terminalOpen ? "hidden" : "flex"}`}
          >
            <ExplorerEditor
              browserTabs={workspace.browserTabs}
              className="rounded-none border-0"
              dirty={workspace.editorDirty}
              dirtyFiles={workspace.dirtyFiles}
              agentStreamingFiles={workspace.agentStreamingPaths}
              missingFiles={workspace.missingFiles}
              agentEditReviewTick={workspace.agentEditReviewTick}
              onAcceptAgentEdit={workspace.acceptAgentEdit}
              onRejectAgentEdit={workspace.rejectAgentEdit}
              onCommitAgentEditContent={workspace.commitAgentEditContent}
              error={workspace.editorError}
              filePath={workspace.selectedFile}
              imageUrl={workspace.editorImageUrl}
              loading={workspace.editorLoading}
              overlaySuspended={!active}
              onChange={workspace.handleEditorChange}
              onCloseFile={workspace.closeEditorFile}
              onSelectFile={(path) => {
                void workspace.selectEditorFile(path, true, { reveal: true });
              }}
              onOpenLocation={workspace.openRemoteFile}
              onApplyRenameFiles={workspace.applyRenameFiles}
              onUpdateBrowserTab={workspace.updateBrowserTab}
              openFiles={workspace.openFiles}
              readOnly={workspace.editorReadOnly}
              revealLine={editorRevealLine}
              truncated={workspace.editorTruncated}
              theme={theme}
              value={workspace.editorValue}
              workspacePath={workspace.workspacePath}
              workspaceKind={workspace.workspaceKind}
              onEditorStatus={handleEditorStatus}
              onProblemsChange={handleProblemsChange}
            />
          </div>

          {terminalInitialized && (
            <div
              aria-hidden={!terminalOpen}
              className={`terminal-drawer relative min-h-0 min-w-0 overflow-hidden ${terminalPlacement === "center" && terminalOpen
                ? "is-open flex-1"
                : `flex-shrink-0 ${terminalOpen ? "is-open" : "is-closed pointer-events-none"}`
                }`}
              onTransitionEnd={(event) => {
                if (event.propertyName !== "height") return;
                window.dispatchEvent(new Event("coloride:terminal-layout"));
              }}
              style={{
                height:
                  terminalPlacement === "center" && terminalOpen
                    ? "100%"
                    : terminalOpen
                      ? `${terminalHeight}px`
                      : "0px",
              }}
            >
              {terminalOpen && terminalPlacement === "drawer" ? (
                <div
                  className="group absolute -top-1 left-0 right-0 z-20 flex h-2 cursor-ns-resize items-center justify-center"
                  onMouseDown={onTerminalResizeStart}
                  title="Drag to resize terminal"
                >
                  <div className="terminal-resize-divider h-px w-full bg-transparent transition-colors group-hover:bg-[#555] group-active:bg-[#777]" />
                </div>
              ) : null}

              <div
                className="terminal-drawer-inner absolute inset-x-0 bottom-0"
                style={{
                  height:
                    terminalPlacement === "center"
                      ? "100%"
                      : `${Math.max(terminalHeight, 100)}px`,
                }}
              >
                <TerminalPanel
                  requestedTerminals={agentTerminals}
                  onAgentTerminalClose={onAgentTerminalClose}
                  connected={connected}
                  embedded
                  surfaceActive={active && terminalOpen}
                  onEmpty={onTerminalClose}
                  onOpenBrowserUrl={onOpenExternalBrowser}
                  onOpenRemoteFile={workspace.openRemoteFile}
                  terminalRequest={terminalRequest}
                  workspacePath={workspace.workspacePath}
                  workspaceKind={workspace.workspaceKind}
                  connectionId={workspace.activeProfileId}
                  enableProblems
                  problemsMarkers={problemMarkers}
                  onRevealProblem={(line, column) =>
                    revealProblemRef.current(line, column)
                  }
                  drawerView={drawerView}
                  onDrawerViewChange={onDrawerViewChange}
                  placement={terminalPlacement}
                  onPlacementChange={updateTerminalPlacement}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
