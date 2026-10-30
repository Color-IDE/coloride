import { notify } from "../../shared/ui/notifications";
import {
  FileValidationIcon,
  GlobeIcon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BrowserPane,
  browserTabLabel,
  isBrowserTabKey,
  type BrowserTabState,
} from "../explorer/BrowserPane";
import { FileIcon, fileTreeIconColor } from "../explorer/filetree/FileTree";
import { OverflowFadeText } from "../../shared/components/OverflowFadeText";
import { EditorTabsHairline } from "../../shared/ui/EditorTabsHairline";
import { IconButton } from "../../shared/ui/IconButton";
import { Tab } from "../../shared/ui/Tab";
import { useAppPreferences } from "../settings/preferences";
import { Icon } from "../../shared/ui/Icon";
import { EditorEmptyState } from "./EditorEmptyState";
import { languageFromPath, mapEditorPreferences } from "./core";
import type { DiagnosticMarker, EditorCommandId, EditorCursor, EditorDiagnosticCounts, EditorHandle } from "./core/types";
import { EditorFindBar } from "./EditorFindBar";
import {
  clearAgentEditReview,
  getAgentEditReview,
  notifyIdeRejectedPaths,
  subscribeAgentEditReviews,
  updateAgentEditReviewAfter,
  type AgentEditReview,
} from "./agentEditBridge";
import { CodeEditor } from "./react/CodeEditor";
import { workspaceBasename } from "../../shared/lib/workspacePath";
import { isUntitledPath } from "../server/workspace/untitledFile";
import { agentLogTabLabel, isAgentLogTabKey } from "./agentLogTab";

function isMissingFileError(error: string): boolean {
  return /file not found|Coloride API 404/i.test(error);
}

function normalizeEditorPath(path: string): string {
  try {
    return decodeURIComponent(path).replace(/\/+$/, "") || "/";
  } catch {
    return path.replace(/\/+$/, "") || "/";
  }
}

type ExplorerEditorProps = {
  className?: string;
  filePath?: string | null;
  imageUrl?: string | null;
  value?: string;
  dirty?: boolean;
  dirtyFiles?: ReadonlySet<string>;
  /** Paths the agent is currently writing into. */
  agentStreamingFiles?: ReadonlySet<string>;
  /** Open tabs whose remote file no longer exists. */
  missingFiles?: ReadonlySet<string>;
  loading?: boolean;
  error?: string;
  readOnly?: boolean;
  truncated?: boolean;
  browserTabs?: Record<string, BrowserTabState>;
  /** Navigate editor to a line when token changes (search match open). */
  revealLine?: { line: number; column?: number; token: number } | null;
  onChange?: (value: string) => void;
  onCloseFile?: (path: string) => void;
  onSelectFile?: (path: string) => void;
  onOpenLocation?: (path: string, options?: { line?: number; column?: number }) => void;
  onApplyRenameFiles?: (files: Array<{
    path: string;
    edits: Array<{
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
      newText: string;
    }>;
  }>) => void | Promise<void>;
  onUpdateBrowserTab?: (tabKey: string, next: Partial<BrowserTabState>) => void;
  openFiles?: string[];
  /** Workspace root — used for a quiet relative path bar under the tabs. */
  workspacePath?: string | null;
  workspaceKind?: "local" | "ssh";
  /** Cursor / diagnostics updates for the bottom status bar. */
  onEditorStatus?: (status: {
    filePath: string | null;
    line: number;
    column: number;
    errors: number;
    warnings: number;
  } | null) => void;
  /** Hide native browser embed (other app tab) without destroying it. */
  overlaySuspended?: boolean;
  /** Bumps when agent Accept/Reject reviews change. */
  agentEditReviewTick?: number;
  /** Resolved app theme from the root shell. Keeps editor and chrome in sync. */
  theme: "light" | "dark";
  onAcceptAgentEdit?: (path: string) => void;
  onRejectAgentEdit?: (path: string) => void | Promise<boolean>;
  /** Persist buffer after a hunk reject (write remote + local buffer). */
  onCommitAgentEditContent?: (path: string, content: string) => void | Promise<boolean>;
  /** Live diagnostics for the terminal Problems tab. */
  onProblemsChange?: (
    markers: DiagnosticMarker[],
    reveal: (line: number, column: number) => void,
  ) => void;
};

export function ExplorerEditor({
  className = "",
  filePath,
  imageUrl = null,
  value = "",
  dirty = false,
  dirtyFiles,
  agentStreamingFiles,
  missingFiles,
  loading = false,
  error = "",
  readOnly = false,
  truncated = false,
  browserTabs = {},
  revealLine = null,
  onChange,
  onCloseFile,
  onSelectFile,
  onOpenLocation,
  onApplyRenameFiles,
  onUpdateBrowserTab,
  openFiles = [],
  workspacePath = null,
  workspaceKind = "ssh",
  onEditorStatus,
  overlaySuspended = false,
  agentEditReviewTick = 0,
  theme,
  onAcceptAgentEdit,
  onRejectAgentEdit,
  onCommitAgentEditContent,
  onProblemsChange,
}: ExplorerEditorProps) {
  const appPreferences = useAppPreferences();
  const language = languageFromPath(filePath, value);
  const editorOptions = useMemo(
    () => mapEditorPreferences(appPreferences, { readOnly }),
    [appPreferences, readOnly],
  );
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [tabFadeEdges, setTabFadeEdges] = useState({ left: false, right: false });
  const [tabScroll, setTabScroll] = useState({ left: 0, width: 0, client: 0 });
  /** Per-tab diagnostic counts (active editor syntax lint). */
  const [tabDiagByPath, setTabDiagByPath] = useState<Record<string, EditorDiagnosticCounts>>({});
  const [findOpen, setFindOpen] = useState(false);
  const [problems, setProblems] = useState<DiagnosticMarker[]>([]);
  const editorHandleRef = useRef<EditorHandle | null>(null);
  const [editorHandle, setEditorHandle] = useState<EditorHandle | null>(null);
  const wasDirtyRef = useRef(dirty);

  const [agentReview, setAgentReview] = useState<AgentEditReview | null>(null);
  const [rejectingAgentEdit, setRejectingAgentEdit] = useState(false);

  useEffect(() => {
    if (wasDirtyRef.current && !dirty && !appPreferences.editorAutoSave) {
      editorHandleRef.current?.markChangeBaseline();
    }
    wasDirtyRef.current = dirty;
  }, [appPreferences.editorAutoSave, dirty]);

  useEffect(() => {
    const sync = () => setAgentReview(getAgentEditReview(filePath));
    sync();
    return subscribeAgentEditReviews(sync);
  }, [filePath, agentEditReviewTick]);

  // When switching back to a tab with a pending review, force the editor handle
  // to repaint green/red (CodeEditor also listens; this covers late ticks).
  useEffect(() => {
    if (!filePath || !agentReview) return;
    const handle = editorHandleRef.current;
    if (!handle) return;
    if (handle.hasAgentEditHunks()) return;
    try {
      handle.highlightAgentEdit(agentReview.before, handle.getValue() || agentReview.after);
    } catch {
      // editor may be mid-teardown
    }
  }, [filePath, agentReview, agentEditReviewTick, editorHandle]);

  const acceptAgentEdit = useCallback(() => {
    if (!filePath || !agentReview) return;
    const handle = editorHandleRef.current;
    if (handle?.hasAgentEditHunks()) {
      handle.acceptAllAgentEditHunks();
      return;
    } else {
      handle?.clearAgentEditHighlight();
    }
    clearAgentEditReview(filePath);
    setAgentReview(null);
    onAcceptAgentEdit?.(filePath);
  }, [agentReview, filePath, onAcceptAgentEdit]);

  const rejectAgentEdit = useCallback(() => {
    if (!filePath || !agentReview || rejectingAgentEdit) return;
    const handle = editorHandleRef.current;
    if (handle?.hasAgentEditHunks()) {
      handle.rejectAllAgentEditHunks();
      return;
    }
    setRejectingAgentEdit(true);
    void Promise.resolve(onRejectAgentEdit?.(filePath))
      .then((ok) => {
        if (ok === false) return;
        handle?.clearAgentEditHighlight();
        clearAgentEditReview(filePath);
        setAgentReview(null);
      })
      .finally(() => setRejectingAgentEdit(false));
  }, [agentReview, filePath, onRejectAgentEdit, rejectingAgentEdit]);

  const reviewCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const reviewPathRef = useRef(filePath);
  reviewPathRef.current = filePath;
  const handleAgentEditHunkResult = useCallback(
    (result: { remaining: number; content: string; baseline: string; changed: boolean }) => {
      if (!filePath) return;
      const path = filePath;
      const handle = editorHandleRef.current;
      const review = getAgentEditReview(path);
      setRejectingAgentEdit(true);
      reviewCommitQueueRef.current = reviewCommitQueueRef.current.then(async () => {
        if (result.changed) {
          const saved = await onCommitAgentEditContent?.(path, result.content);
          if (saved !== true) {
            // Keep the review actionable when a write fails. Never report Undo
            // to the chat before the file has actually been saved.
            if (review && path === reviewPathRef.current && handle === editorHandleRef.current) {
              handle?.restoreAgentEditReview(review.before, review.after, result.content);
            }
            return;
          }
        }
        if (result.remaining > 0) {
          updateAgentEditReviewAfter(path, result.content, result.baseline);
          return;
        }
        clearAgentEditReview(path);
        if (path === reviewPathRef.current && handle === editorHandleRef.current) setAgentReview(null);
        if (!result.changed) onAcceptAgentEdit?.(path);
        else notifyIdeRejectedPaths([path]);
      }).catch(() => {
        if (review && path === reviewPathRef.current && handle === editorHandleRef.current) {
          handle?.restoreAgentEditReview(review.before, review.after, result.content);
        }
      }).finally(() => setRejectingAgentEdit(false));
    },
    [filePath, onAcceptAgentEdit, onCommitAgentEditContent],
  );

  // Shortcuts: ⌘Y / ⌘N accept or reject all remaining hunks for this file.
  useEffect(() => {
    if (!agentReview || !filePath) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.shiftKey) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "y") {
        event.preventDefault();
        acceptAgentEdit();
      } else if (key === "n") {
        event.preventDefault();
        rejectAgentEdit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [acceptAgentEdit, agentReview, filePath, rejectAgentEdit]);
  const activeIsBrowser = Boolean(filePath && isBrowserTabKey(filePath));
  const activeBrowser = activeIsBrowser && filePath ? browserTabs[filePath] : undefined;
  const unsupportedError = (error || "").toLowerCase();
  const isUnsupportedFile = Boolean(
    error
    && (unsupportedError.includes("binary")
      || unsupportedError.includes("too large")
      || unsupportedError.includes("image preview")),
  );
  const showCodeChrome = Boolean(filePath) && !activeIsBrowser && imageUrl === null && !isUnsupportedFile;

  // Drop find chrome when leaving a code buffer.
  useEffect(() => {
    if (showCodeChrome) return;
    setFindOpen(false);
    editorHandleRef.current = null;
    setEditorHandle(null);
  }, [showCodeChrome, filePath]);

  useEffect(() => {
    if (!showCodeChrome) return;
    const onFind = () => setFindOpen(true);
    const onCommand = (event: Event) => {
      const handle = editorHandleRef.current;
      if (!handle) return;
      handle.focus();
      handle.runCommand((event as CustomEvent<EditorCommandId>).detail);
    };
    window.addEventListener("coloride:editor-command", onCommand);
    window.addEventListener("coloride:editor-find", onFind);
    return () => {
      window.removeEventListener("coloride:editor-find", onFind);
      window.removeEventListener("coloride:editor-command", onCommand);
    };
  }, [showCodeChrome]);

  // Native WebContentsView sits above the DOM — hide every embed when the
  // active explorer tab is not a browser (e.g. image.png / code editor).
  useEffect(() => {
    if (activeIsBrowser) return;
    void window.colorideDesktop?.browserEmbed?.hideAll?.();
  }, [activeIsBrowser, filePath]);

  const updateTabFadeEdges = useCallback(() => {
    const element = tabsScrollRef.current;
    if (!element) return;

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    const next = {
      left: maxScrollLeft > 1 && element.scrollLeft > 1,
      right: maxScrollLeft > 1 && element.scrollLeft < maxScrollLeft - 1,
    };
    setTabFadeEdges((current) => (
      current.left === next.left && current.right === next.right ? current : next
    ));
    setTabScroll((current) => {
      const nextScroll = {
        left: element.scrollLeft,
        width: element.scrollWidth,
        client: element.clientWidth,
      };
      return current.left === nextScroll.left
        && current.width === nextScroll.width
        && current.client === nextScroll.client
        ? current
        : nextScroll;
    });
  }, []);

  const revealSelectedTab = useCallback((tab: HTMLElement | null) => {
    const element = tabsScrollRef.current;
    if (!element || !tab) return;

    // Keep a generous breathing room after the selected tab instead of
    // leaving it pinned against the edge of the editor.
    const inset = 200;
    const tabLeft = tab.offsetLeft;
    const tabRight = tabLeft + tab.offsetWidth;
    const visibleLeft = element.scrollLeft;
    const visibleRight = visibleLeft + element.clientWidth;
    let nextScrollLeft = visibleLeft;

    if (tabRight > visibleRight - inset) {
      nextScrollLeft = tabRight - element.clientWidth + inset;
    } else if (tabLeft < visibleLeft + inset) {
      nextScrollLeft = tabLeft - inset;
    }

    if (Math.abs(nextScrollLeft - visibleLeft) < 1) return;
    element.scrollTo({
      left: Math.max(0, nextScrollLeft),
      behavior: "smooth",
    });
  }, []);

  useLayoutEffect(() => {
    updateTabFadeEdges();
  }, [openFiles, updateTabFadeEdges]);

  // A tab can be focused by the agent, a deep link, or the Browser button —
  // not only by clicking the tab itself. Keep that programmatic selection in
  // view as soon as the header has rendered it.
  useLayoutEffect(() => {
    const element = tabsScrollRef.current;
    if (!element || !filePath) return;
    const activeTab = element.querySelector<HTMLElement>('[data-active="true"]');
    revealSelectedTab(activeTab);
  }, [filePath, openFiles, revealSelectedTab]);

  useEffect(() => {
    const element = tabsScrollRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver(updateTabFadeEdges);
    resizeObserver.observe(element);
    window.addEventListener("resize", updateTabFadeEdges);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateTabFadeEdges);
    };
  }, [updateTabFadeEdges]);

  // Status bar: clear when leaving a code file (browser / empty / image).
  useEffect(() => {
    if (!onEditorStatus) return;
    if (activeIsBrowser || !filePath || imageUrl !== null) {
      onEditorStatus(null);
    }
  }, [activeIsBrowser, filePath, imageUrl, onEditorStatus]);

  // Drop diagnostic cache for closed tabs.
  useEffect(() => {
    const open = new Set(openFiles);
    setTabDiagByPath((current) => {
      let changed = false;
      const next: Record<string, EditorDiagnosticCounts> = {};
      for (const [path, counts] of Object.entries(current)) {
        if (open.has(path)) next[path] = counts;
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [openFiles]);


  const statusCursorRef = useRef({ line: 1, column: 1 });
  const statusDiagRef = useRef({ errors: 0, warnings: 0 });

  const pushEditorStatus = useCallback(() => {
    if (!onEditorStatus || !filePath || activeIsBrowser || imageUrl !== null) return;
    onEditorStatus({
      filePath,
      line: statusCursorRef.current.line,
      column: statusCursorRef.current.column,
      errors: statusDiagRef.current.errors,
      warnings: statusDiagRef.current.warnings,
    });
  }, [activeIsBrowser, filePath, imageUrl, onEditorStatus]);

  const handleCursorChange = useCallback(
    (cursor: EditorCursor) => {
      statusCursorRef.current = { line: cursor.line, column: cursor.column };
      pushEditorStatus();
    },
    [pushEditorStatus],
  );

  const handleDiagnosticsChange = useCallback(
    (counts: EditorDiagnosticCounts) => {
      statusDiagRef.current = counts;
      pushEditorStatus();
      setProblems(editorHandleRef.current?.getMarkers() ?? []);
      if (!filePath || isBrowserTabKey(filePath)) return;
      setTabDiagByPath((current) => {
        const prev = current[filePath];
        if (prev && prev.errors === counts.errors && prev.warnings === counts.warnings) {
          return current;
        }
        return { ...current, [filePath]: counts };
      });
    },
    [filePath, pushEditorStatus],
  );

  useEffect(() => {
    setProblems(editorHandle?.getMarkers() ?? []);
  }, [editorHandle, filePath]);

  useEffect(() => {
    if (!onProblemsChange) return;
    onProblemsChange(problems, (line, column) => {
      editorHandleRef.current?.reveal({ line, column });
      editorHandleRef.current?.focus();
    });
  }, [onProblemsChange, problems]);

  return (
    <div className={`explorer-editor-shell relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#171717] ${className}`}>
      {openFiles.length > 0 ? (
      <header className="explorer-editor-header relative flex h-10 flex-shrink-0 items-center gap-1 overflow-hidden bg-[#171717] px-1.5">
        <div
          className="editor-tabs-scroll flex h-full min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden"
          onScroll={updateTabFadeEdges}
          ref={tabsScrollRef}
        >
          {openFiles.map((path, index) => {
            const browser = isBrowserTabKey(path) ? browserTabs[path] : undefined;
            const name = browser
              ? browserTabLabel(browser)
              : isAgentLogTabKey(path)
                ? agentLogTabLabel(path)
                : isUntitledPath(path)
                  ? "Untitled"
                  : workspaceBasename(path);
            const active = path === filePath;
            const tabDirty = browser ? false : (dirtyFiles?.has(path) ?? (active && dirty));
            const tabAgentStreaming = browser ? false : Boolean(agentStreamingFiles?.has(path));
            const tabMissing = browser ? false : Boolean(missingFiles?.has(path));
            const tabErrors = browser
              ? 0
              : (tabDiagByPath[path]?.errors
                ?? tabDiagByPath[normalizeEditorPath(path)]?.errors
                ?? 0);
            const tabHasError = tabErrors > 0;
            const nextPath = openFiles[index + 1];
            const separatorTouchesActive =
              active || (nextPath != null && nextPath === filePath);
            return (
              <div key={path} className="flex shrink-0 items-center">
                <Tab
                  active={active && !tabMissing}
                  className={`editor-file-tab${onCloseFile ? "" : " pr-2.5"}${tabMissing ? " is-missing" : ""}`}
                  title={tabMissing ? `${path} — file not found` : browser ? browser.url || path : path}
                >
                  <button
                    className="absolute inset-0 rounded-[4px]"
                    onClick={(event) => {
                      if (tabMissing) {
                        notify({
                          id: `deleted-file:${path}`,
                          kind: "info",
                          title: "File deleted",
                          description: `"${name}" has been deleted and cannot be opened.`,
                        });
                        return;
                      }
                      onSelectFile?.(path);
                      revealSelectedTab(event.currentTarget.parentElement);
                    }}
                    type="button"
                  />
                  <span className="pointer-events-none relative flex min-w-0 items-center gap-1.5">
                    {tabHasError ? (
                      <span
                        aria-hidden="true"
                        className="editor-tab-error-dot"
                        title={tabErrors === 1 ? "1 error" : `${tabErrors} errors`}
                      />
                    ) : tabAgentStreaming ? (
                      <span aria-hidden="true" className="editor-tab-agent-dot" title="Agent editing" />
                    ) : tabDirty ? (
                      <span aria-hidden="true" className="editor-tab-dirty-dot" title="Unsaved changes" />
                    ) : browser ? (
                      <Icon icon={GlobeIcon} className="size-3.5 flex-shrink-0 text-[#878888]" size={14} strokeWidth={1.8} />
                    ) : null}
                    {!browser ? (
                      <FileIcon
                        className={`size-3.5 shrink-0 ${tabMissing ? "text-[#6f6f6f]" : fileTreeIconColor(name)}`}
                        name={name}
                      />
                    ) : null}
                    <OverflowFadeText className={`flex-1 ${tabMissing ? "editor-tab-missing-label" : ""}`}>
                      {name}
                    </OverflowFadeText>
                  </span>
                  {onCloseFile && (
                    <IconButton
                      label={`Close ${name}`}
                      size="sm"
                      className="absolute right-1.5 z-10"
                      onClick={() => onCloseFile(path)}
                    >
                      <EditorTabCloseIcon />
                    </IconButton>
                  )}
                </Tab>
                {index < openFiles.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={`editor-tab-separator mx-0.5 h-3 w-px flex-shrink-0 bg-white/[0.06] transition-opacity duration-150 ${
                      separatorTouchesActive ? "opacity-0" : ""
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <span
          aria-hidden="true"
          data-edge="left"
          className={`scroll-edge-fade editor-tabs-fade pointer-events-none absolute bottom-1 left-1.5 top-1.5 z-20 w-5 transition-opacity duration-150 ${tabFadeEdges.left ? "opacity-100" : "opacity-0"}`}
        />
        <span
          aria-hidden="true"
          data-edge="right"
          className={`scroll-edge-fade editor-tabs-fade pointer-events-none absolute bottom-1 right-1.5 top-1.5 z-20 w-5 transition-opacity duration-150 ${tabFadeEdges.right ? "opacity-100" : "opacity-0"}`}
        />
        <EditorTabsHairline
          metrics={tabScroll}
          onScrollTo={(left) => tabsScrollRef.current?.scrollTo({ left })}
        />
      </header>
      ) : null}

      <div
        className="explorer-editor-body relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#171717]"
        style={{
          ["--editor-code-font" as string]: editorOptions.fontFamily,
          ["--editor-code-size" as string]: `${editorOptions.fontSize}px`,
        }}
      >
        {showCodeChrome ? (
          <EditorFindBar
            handle={editorHandle}
            onClose={() => setFindOpen(false)}
            open={findOpen}
          />
        ) : null}
        <div className="relative min-h-0 flex-1 overflow-hidden">
        {activeIsBrowser && activeBrowser ? (
          <BrowserPane
            tab={activeBrowser}
            workspaceKind={workspaceKind}
            overlaySuspended={overlaySuspended}
            onUpdate={(next) => {
              if (filePath) onUpdateBrowserTab?.(filePath, next);
            }}
          />
        ) : filePath && imageUrl !== null ? (
          <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-[#171717] p-6">
            {imageUrl && (
              <img
                alt={workspaceBasename(filePath) || "Image preview"}
                className="block max-h-full max-w-full select-none object-contain"
                draggable={false}
                src={imageUrl}
              />
            )}
          </div>
        ) : filePath && isUnsupportedFile ? (
          <EditorUnsupportedFileState error={error} filePath={filePath} />
        ) : filePath ? (
          <CodeEditor
            path={filePath}
            value={value}
            language={language}
            theme={theme}
            options={editorOptions}
            workspaceRoot={workspacePath}
            onOpenPath={onSelectFile}
            onOpenLocation={onOpenLocation}
            onApplyRenameFiles={onApplyRenameFiles}
            reveal={loading ? null : revealLine}
            onChange={(nextValue) => {
              onChange?.(nextValue);
              // Autosave will persist — reset the change gutter after this
              // update so orange ticks never paint (dispatch is illegal mid-update).
              if (appPreferences.editorAutoSave) {
                queueMicrotask(() => editorHandleRef.current?.markChangeBaseline());
              }
            }}
            onCursorChange={handleCursorChange}
            onDiagnosticsChange={handleDiagnosticsChange}
            onFindRequest={() => setFindOpen(true)}
            onAgentEditHunkResult={handleAgentEditHunkResult}
            onReady={(handle) => {
              editorHandleRef.current = handle;
              setEditorHandle(handle);
            }}
            onDispose={(handle) => {
              if (editorHandleRef.current === handle) {
                editorHandleRef.current = null;
                setEditorHandle(null);
              }
            }}
          />
        ) : (
          <EditorEmptyState />
        )}
        {truncated && !loading && !activeIsBrowser && !isUnsupportedFile && (
          <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex min-h-8 items-center gap-2 rounded-lg border border-amber-400/20 bg-[#24211b]/95 px-3 text-[11px] text-amber-200 shadow-lg">
            <Icon icon={FileValidationIcon} size={14} strokeWidth={1.8} />
            <span className="font-medium">{imageUrl !== null ? "Image preview unavailable" : "Large file preview"}</span>
            <span className="text-amber-200/60">{imageUrl !== null ? "Images larger than 10 MB cannot be previewed" : "First 10 MB shown, read only"}</span>
          </div>
        )}
        {(loading || (error && !isUnsupportedFile && !isMissingFileError(error))) && !activeIsBrowser && (
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-[#212121]/95 px-2 py-1 text-[11px] text-[#878888] shadow-lg">
            {loading ? "Loading..." : error}
          </div>
        )}
        </div>
      </div>

    </div>
  );
}

function EditorUnsupportedFileState({
  error,
  filePath,
}: {
  error: string;
  filePath?: string | null;
}) {
  const lower = error.toLowerCase();
  const name = filePath ? workspaceBasename(filePath) : "";
  const ext = name.includes(".") ? name.split(".").pop()?.toUpperCase() ?? "" : "";
  const size = error.match(/\(([^)]+)\)/)?.[1] ?? "";
  const kind = lower.includes("image")
    ? "Image preview unavailable"
    : lower.includes("too large")
      ? "File too large"
      : "Binary file";
  const meta = [ext && `.${ext.toLowerCase()}`, size].filter(Boolean).join(" · ");
  const detail = lower.includes("image")
    ? "This image cannot be previewed in the editor."
    : lower.includes("too large")
      ? "This file is too large to open in the editor."
      : "This file cannot be opened in the text editor.";

  return (
    <div className="pointer-events-none flex h-full flex-col items-center justify-center px-6 text-center">
      <svg
        aria-hidden="true"
        className="size-[72px] text-[#f5c518]/20"
        fill="none"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M0 0h24v24H0z" fill="none" />
        <path
          d="M12 1.67c.955 0 1.845.467 2.39 1.247l.105.16l8.114 13.548a2.914 2.914 0 0 1-2.307 4.363l-.195.008H3.882a2.914 2.914 0 0 1-2.582-4.2l.099-.185l8.11-13.538A2.91 2.91 0 0 1 12 1.67M12.01 15l-.127.007a1 1 0 0 0 0 1.986L12 17l.127-.007a1 1 0 0 0 0-1.986zM12 8a1 1 0 0 0-.993.883L11 9v4l.007.117a1 1 0 0 0 1.986 0L13 13V9l-.007-.117A1 1 0 0 0 12 8"
          fill="currentColor"
        />
      </svg>
      <p className="mt-4 text-[13px] text-[#878888]">{kind}</p>
      {meta ? (
        <p className="mt-1 text-[12px] text-[#6f6f6f]">{meta}</p>
      ) : null}
      <p className="mt-1 max-w-sm text-[12px] leading-5 text-[#5c5c5c]">{detail}</p>
    </div>
  );
}

function EditorTabCloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24" width="12">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
