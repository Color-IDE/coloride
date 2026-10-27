import { closeManagedTerminalSession } from "../terminal/TerminalSessionManager";
import type { AgentTerminalReference } from "../../shared/api/types";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, decodeBase64ToText, encodeTextToBase64 } from "../../shared/api/client";
import {
  CodeEditor,
  languageFromPath as editorLanguageFromPath,
  mapEditorPreferences,
} from "../editor";
import { queueAgentEditHighlight } from "../editor/agentEditBridge";
import { lspSyncChange, lspSyncClose, lspSyncOpen } from "../editor/lsp/documentSync";
import { applyLineEdits } from "../editor/lsp/textEdits";
import {
  BrowserPane,
  browserTabKey,
  type BrowserTabState,
} from "../explorer/BrowserPane";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { OverflowFadeText } from "../../shared/components/OverflowFadeText";
import { EditorTabsHairline } from "../../shared/ui/EditorTabsHairline";
import { IconButton } from "../../shared/ui/IconButton";
import { Tab } from "../../shared/ui/Tab";
import { GitIcon } from "../explorer/filetree/FileTree";
import { useAppPreferences, useResolvedTheme } from "../settings/preferences";
import { AgentGitSourceControl } from "./AgentGitSourceControl";

/** Manual tools from the rail / + menu. Files open only via chat edits. */
export type AgentWorkspaceToolKind = "browser" | "terminal" | "git";
export type AgentWorkspaceKind = AgentWorkspaceToolKind | "file";

export type AgentWorkspaceTab =
  | {
      id: string;
      kind: "file";
      title: string;
      path: string | null;
      value: string;
      /** Last value confirmed by the files API. */
      savedValue: string;
      /** Optimistic-concurrency token returned by the files API. */
      etag: string | null;
      dirty: boolean;
      saving: boolean;
      saveError: string;
      /** Baseline before agent/git change — green/red via CodeEditor agent-edit marks. */
      originalValue?: string | null;
    }
  | { id: string; kind: "browser"; title: string; browserId: string; tab: BrowserTabState }
  | { id: string; kind: "terminal"; title: string; terminal?: AgentTerminalReference }
  | { id: string; kind: "git"; title: string };

function nextId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Agent tools emit workspace-relative paths; the files API needs absolute remote paths. */
function resolveWorkspaceFilePath(filePath: string, workspacePath: string | null | undefined): string {
  const trimmed = filePath.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed;
  const root = (workspacePath ?? "").replace(/\/+$/, "");
  if (!root) return trimmed;
  if (trimmed === ".") return root;
  return `${root}/${trimmed.replace(/^\/+/, "")}`;
}

/**
 * Rebuild "before" content from a unified diff + the current (after) file text.
 * Prefer a verified reverse-apply; if line matching is slightly off (newline
 * quirks), fall back to a looser reconstruction so the side-by-side diff still opens.
 */
function originalFromUnifiedDiff(afterText: string, patch: string): string | null {
  if (!patch.trim() || patch.trim() === "(content unchanged)") return null;

  const patchLines = patch.replace(/\r\n/g, "\n").split("\n");
  const afterLines = afterText.replace(/\r\n/g, "\n").split("\n");
  // Drop trailing empty split artifact when file ends with newline.
  if (afterLines.length > 0 && afterLines[afterLines.length - 1] === "") {
    afterLines.pop();
  }

  type Hunk = {
    oldStart: number;
    newStart: number;
    lines: string[];
  };
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;

  for (const line of patchLines) {
    if (
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("diff ") ||
      line.startsWith("index ")
    ) {
      continue;
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        newStart: Number(header[2]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    // Real unified-diff body lines always start with + / - / space.
    if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
      current.lines.push(line);
    }
  }

  if (!hunks.length) return null;

  const finish = (lines: string[]) => {
    const joined = lines.join("\n");
    if (afterText.endsWith("\n") && !joined.endsWith("\n") && joined.length > 0) {
      return `${joined}\n`;
    }
    return joined;
  };

  // Strict path: verify context/+ lines against the current file.
  const tryStrict = (): string | null => {
    const before: string[] = [];
    let afterCursor = 0;
    for (const hunk of hunks) {
      const newStartIdx = Math.max(0, hunk.newStart - 1);
      while (afterCursor < newStartIdx) {
        if (afterCursor >= afterLines.length) return null;
        before.push(afterLines[afterCursor]);
        afterCursor += 1;
      }
      let localAfter = afterCursor;
      for (const raw of hunk.lines) {
        const tag = raw.charAt(0);
        const body = raw.slice(1);
        if (tag === " ") {
          if (localAfter >= afterLines.length || afterLines[localAfter] !== body) return null;
          before.push(body);
          localAfter += 1;
        } else if (tag === "-") {
          before.push(body);
        } else if (tag === "+") {
          if (localAfter >= afterLines.length || afterLines[localAfter] !== body) return null;
          localAfter += 1;
        }
      }
      afterCursor = localAfter;
    }
    while (afterCursor < afterLines.length) {
      before.push(afterLines[afterCursor]);
      afterCursor += 1;
    }
    return finish(before);
  };

  const strict = tryStrict();
  if (strict != null) return strict;

  // Loose path: trust hunk headers + patch bodies; copy surrounding lines from after.
  const before: string[] = [];
  let afterCursor = 0;
  for (const hunk of hunks) {
    const newStartIdx = Math.max(0, hunk.newStart - 1);
    while (afterCursor < newStartIdx && afterCursor < afterLines.length) {
      before.push(afterLines[afterCursor]);
      afterCursor += 1;
    }
    for (const raw of hunk.lines) {
      const tag = raw.charAt(0);
      const body = raw.slice(1);
      if (tag === " ") {
        before.push(body);
        afterCursor += 1;
      } else if (tag === "-") {
        before.push(body);
      } else if (tag === "+") {
        afterCursor += 1;
      }
    }
  }
  while (afterCursor < afterLines.length) {
    before.push(afterLines[afterCursor]);
    afterCursor += 1;
  }
  return finish(before);
}


/** Build "after" text from + / space lines when the file cannot be read. */
function modifiedFromUnifiedDiff(patch: string): string | null {
  if (!patch.trim() || patch.trim() === "(no changes)") return null;
  const out: string[] = [];
  let inHunk = false;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      inHunk = false;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue;
    const tag = line.charAt(0);
    if (tag === "+" || tag === " ") out.push(line.slice(1));
  }
  return out.length ? `${out.join("\n")}\n` : "";
}

/** For pure deletes: reconstruct left side only from '-' lines. */
function originalFromMinusLines(patch: string): string | null {
  if (!patch.trim()) return null;
  const out: string[] = [];
  let inHunk = false;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      inHunk = false;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue;
    if (line.startsWith("-")) out.push(line.slice(1));
  }
  return out.length ? `${out.join("\n")}\n` : "";
}

interface AgentWorkspacePanelProps {
  active: boolean;
  connected: boolean;
  /** Browser / Terminal from the rail or + menu. */
  terminalRecovery?: AgentTerminalReference[];
  openRequest: { kind: AgentWorkspaceToolKind; nonce: number; terminal?: AgentTerminalReference } | null;
  /**
   * Open a remote file in the agent workspace — driven by chat tool edits
   * (write_file / replace_in_file), not a manual File button.
   */
  openFileRequest: { path: string; patch?: string; content?: string; line?: number; nonce: number } | null;
  /**
   * Open / navigate the right-side Coloride browser (chat links, agent browser_open).
   * Uses the embedded SOCKS browser — not the system browser.
   */
  openBrowserRequest: { url: string; nonce: number } | null;
  /** Notify parent so the right card can collapse when the last tab closes. */
  onTabsChange?: (count: number) => void;
  /** Browser fills the agent main area (chat column collapsed). */
  browserExpanded?: boolean;
  onBrowserExpandedChange?: (expanded: boolean) => void;
  workspacePath: string | null;
  workspaceKind: "local" | "ssh";
  connectionId?: string | null;
  /** Selected chat whose independent local/SSH workspace grant scopes file IO. */
  sessionId?: string | null;
  gitAvailable?: boolean;
  /** Switch agent/explorer cwd to the isolated Git workspace path. */
  onOpenGitWorkspace?: (path: string) => void;
}

export function AgentWorkspacePanel({
  active,
  connected,
  openRequest,
  terminalRecovery,
  openFileRequest,
  openBrowserRequest,
  onTabsChange,
  browserExpanded = false,
  onBrowserExpandedChange,
  workspacePath,
  workspaceKind,
  connectionId,
  sessionId,
  gitAvailable = true,
  onOpenGitWorkspace,
}: AgentWorkspacePanelProps) {
  const appPreferences = useAppPreferences();
  const resolvedTheme = useResolvedTheme();
  const editorOptions = useMemo(
    () =>
      mapEditorPreferences(appPreferences, {
        readOnly: appPreferences.permissionMode === "read-only",
      }),
    [appPreferences],
  );
  const editorTheme = resolvedTheme === "light" ? "light" : "dark";
  const panelScopeKey = sessionId
    ? `${workspaceKind}:${connectionId ?? ""}:session:${sessionId}`
    : `${workspaceKind}:${connectionId ?? ""}:new:${workspacePath ?? ""}`;
  const [tabs, setTabs] = useState<AgentWorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [fileLoadError, setFileLoadError] = useState("");
  const addMenuRef = useRef<HTMLDivElement>(null);
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [tabScroll, setTabScroll] = useState({ left: 0, width: 0, client: 0 });
  const handledOpenNonce = useMemo(() => ({ current: 0 }), []);
  const handledFileNonce = useMemo(() => ({ current: 0 }), []);
  const handledBrowserNonce = useMemo(() => ({ current: 0 }), []);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const panelScopeKeyRef = useRef(panelScopeKey);
  const panelStateByScopeRef = useRef(
    new Map<string, { tabs: AgentWorkspaceTab[]; activeTabId: string | null }>(),
  );

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const browserIsActive = activeTab?.kind === "browser";

  const onTabsChangeRef = useRef(onTabsChange);
  onTabsChangeRef.current = onTabsChange;
  const onBrowserExpandedChangeRef = useRef(onBrowserExpandedChange);
  onBrowserExpandedChangeRef.current = onBrowserExpandedChange;
  const lastTabsCountRef = useRef<number | null>(null);

  // Each chat owns its file/Git/browser tabs. Switching chats must neither show
  // another workspace's buffers nor save an old tab through the new session grant.
  useLayoutEffect(() => {
    const previousScope = panelScopeKeyRef.current;
    if (previousScope === panelScopeKey) return;
    panelStateByScopeRef.current.set(previousScope, {
      tabs: tabsRef.current,
      activeTabId: activeTabIdRef.current,
    });
    const next = panelStateByScopeRef.current.get(panelScopeKey);
    panelScopeKeyRef.current = panelScopeKey;
    setTabs(next?.tabs ?? []);
    setActiveTabId(next?.activeTabId ?? null);
    setFileLoadError("");
    setAddMenuOpen(false);
    onBrowserExpandedChangeRef.current?.(false);
  }, [panelScopeKey]);

  useEffect(() => {
    panelStateByScopeRef.current.set(panelScopeKey, { tabs, activeTabId });
  }, [activeTabId, panelScopeKey, tabs]);

  useEffect(() => {
    if (lastTabsCountRef.current === tabs.length) return;
    lastTabsCountRef.current = tabs.length;
    onTabsChangeRef.current?.(tabs.length);
  }, [tabs.length]);

  // Leaving the browser tab (or closing all tabs) always exits expanded mode.
  useEffect(() => {
    if (!browserIsActive && browserExpanded) {
      onBrowserExpandedChangeRef.current?.(false);
    }
  }, [browserExpanded, browserIsActive]);

  useEffect(() => {
    if (!browserExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onBrowserExpandedChangeRef.current?.(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [browserExpanded]);

  // Inline + picker lives in the tab bar (HTML only) — never covers the native browser embed.
  useEffect(() => {
    if (!addMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (addMenuRef.current?.contains(target)) return;
      setAddMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [addMenuOpen]);

  /** Open/focus a file tab in the shared CodeEditor (same as Explorer / agent edits). */
  const upsertFileTab = useCallback(
    (
      resolved: string,
      name: string,
      value: string,
      original: string | null,
      etag: string | null,
    ) => {
      const existing = tabsRef.current.find(
        (tab) => tab.kind === "file" && tab.path === resolved,
      );
      const tabId = existing?.id ?? nextId("file");

      // Green/red hunks use the same agent-edit decorations as chat edits.
      if (original != null && original !== value) {
        queueAgentEditHighlight(resolved, original, value);
      }

      setTabs((current) => {
        const found = current.find((tab) => tab.kind === "file" && tab.path === resolved);
        if (found && found.kind === "file") {
          if (
            found.value === value &&
            found.originalValue === original &&
            found.title === name &&
            found.etag === etag &&
            !found.dirty
          ) {
            return current;
          }
          return current.map((tab) =>
            tab.id === found.id
              ? {
                  ...tab,
                  title: name,
                  path: resolved,
                  value,
                  savedValue: value,
                  etag,
                  dirty: false,
                  saving: false,
                  saveError: "",
                  originalValue: original,
                }
              : tab,
          );
        }
        return [
          ...current,
          {
            id: tabId,
            kind: "file" as const,
            title: name,
            path: resolved,
            value,
            savedValue: value,
            etag,
            dirty: false,
            saving: false,
            saveError: "",
            originalValue: original,
          },
        ];
      });
      setActiveTabId(tabId);
      void lspSyncOpen(resolved, value);
    },
    [],
  );

  const openFileFromPath = useCallback(
    async (filePath: string, patch?: string) => {
      const resolved = resolveWorkspaceFilePath(filePath, workspacePath);
      if (!resolved) return;

      const name = resolved.split("/").filter(Boolean).at(-1) || resolved;
      const wantDiff = Boolean(patch && patch.trim());

      const existing = tabsRef.current.find((tab) => tab.kind === "file" && tab.path === resolved);
      if (existing) {
        setActiveTabId(existing.id);
        setFileLoadError("");
        if (existing.kind === "file" && existing.dirty) {
          setTabs((current) =>
            current.map((tab) =>
              tab.id === existing.id && tab.kind === "file"
                ? {
                    ...tab,
                    saveError:
                      "This tab has unsaved changes. Save or discard them before reloading the file.",
                  }
                : tab,
            ),
          );
          return;
        }
      } else {
        const id = nextId("file");
        setTabs((current) => {
          if (current.some((tab) => tab.kind === "file" && tab.path === resolved)) return current;
          return [
            ...current,
            {
              id,
              kind: "file",
              title: name,
              path: resolved,
              value: "",
              savedValue: "",
              etag: null,
              dirty: false,
              saving: false,
              saveError: "",
              originalValue: null,
            },
          ];
        });
        setActiveTabId(id);
        setFileLoadError("");
      }

      try {
        const response = sessionId
          ? await api.readAgentSessionFile(sessionId, resolved)
          : await api.readFile(resolved);
        const value = decodeBase64ToText(response.content);
        const original =
          wantDiff && patch ? originalFromUnifiedDiff(value, patch) : null;
        upsertFileTab(
          resolved,
          name,
          value,
          typeof original === "string" ? original : null,
          response.etag,
        );
        setFileLoadError("");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFileLoadError(message);
      }
    },
    [sessionId, upsertFileTab, workspacePath],
  );

  /**
   * Safe Git → same CodeEditor tab as agent edits, with green/red hunk marks vs HEAD.
   */
  const openGitFileDiff = useCallback(
    async (args: {
      path: string;
      workspaceRoot: string;
      diff: string;
      status?: string;
    }) => {
      const root = args.workspaceRoot.replace(/\/+$/, "");
      const rel = args.path.replace(/^\/+/, "");
      const resolved = args.path.startsWith("/")
        ? args.path
        : root
          ? `${root}/${rel}`
          : rel;
      if (!resolved) return;

      const name = resolved.split("/").filter(Boolean).at(-1) || resolved;
      setFileLoadError("");

      const existing = tabsRef.current.find(
        (tab) => tab.kind === "file" && tab.path === resolved,
      );
      if (existing?.kind === "file" && existing.dirty) {
        setActiveTabId(existing.id);
        setTabs((current) =>
          current.map((tab) =>
            tab.id === existing.id && tab.kind === "file"
              ? {
                  ...tab,
                  saveError:
                    "This tab has unsaved changes. Save or discard them before opening the Git version.",
                }
              : tab,
          ),
        );
        return;
      }

      const statusCode = (args.status || "").toUpperCase();
      const isDeleted = statusCode === "D";
      const isAdded = statusCode === "A" || statusCode === "U" || statusCode === "?";
      const patch = args.diff || "";

      let modified = "";
      let etag: string | null = null;
      if (!isDeleted) {
        try {
          const response = sessionId
            ? await api.readAgentSessionFile(sessionId, resolved)
            : await api.readFile(resolved);
          modified = decodeBase64ToText(response.content);
          etag = response.etag;
        } catch {
          modified = modifiedFromUnifiedDiff(patch) ?? "";
        }
      }

      let original: string | null = null;
      const nullOld =
        isAdded ||
        /\/dev\/null/.test(patch.split("\n").find((l) => l.startsWith("---")) || "");
      if (nullOld) {
        original = "";
      } else if (patch.trim() && patch.trim() !== "(no changes)") {
        original = originalFromUnifiedDiff(modified, patch);
      }
      if (original == null) {
        if (isDeleted) {
          original = originalFromUnifiedDiff("", patch) ?? originalFromMinusLines(patch) ?? "";
          modified = "";
        } else {
          original = null;
        }
      }

      upsertFileTab(resolved, name, modified, original, etag);
    },
    [sessionId, upsertFileTab],
  );

  /** Create a brand-new browser tab (always). Optional url to navigate on open. */
  const openNewBrowserTab = useCallback((rawUrl?: string) => {
    setAddMenuOpen(false);
    const url = String(rawUrl || "").trim();

    setTabs((current) => {
      const browserId = nextId("ui");
      const id = browserTabKey(browserId);
      const count = current.filter((tab) => tab.kind === "browser").length;
      setActiveTabId(id);
      const browserTab: BrowserTabState = {
        browserId,
        url,
        title: "",
        loading: Boolean(url),
        error: "",
        navToken: url ? 1 : 0,
      };
      return [
        ...current,
        {
          id,
          kind: "browser",
          title: count === 0 ? "Browser" : `Browser ${count + 1}`,
          browserId,
          tab: browserTab,
        },
      ];
    });
  }, []);

  /**
   * Navigate an existing browser (prefer active), or open one if none.
   * Used by chat links / agent browser_open — not by the + menu.
   */
  const openBrowserUrl = useCallback((rawUrl?: string) => {
    setAddMenuOpen(false);
    const url = String(rawUrl || "").trim();

    setTabs((current) => {
      const activeBrowser =
        activeTabId != null
          ? current.find((tab) => tab.id === activeTabId && tab.kind === "browser")
          : undefined;
      const existing =
        (activeBrowser && activeBrowser.kind === "browser" ? activeBrowser : null) ??
        current.find((tab) => tab.kind === "browser");

      if (existing && existing.kind === "browser") {
        setActiveTabId(existing.id);
        if (!url) return current;
        return current.map((tab) =>
          tab.id === existing.id && tab.kind === "browser"
            ? {
                ...tab,
                tab: {
                  ...tab.tab,
                  url,
                  loading: true,
                  error: "",
                  // Bump so BrowserPane navigates even if the same URL is repeated.
                  navToken: (tab.tab.navToken ?? 0) + 1,
                },
              }
            : tab,
        );
      }

      const browserId = nextId("ui");
      const id = browserTabKey(browserId);
      setActiveTabId(id);
      const browserTab: BrowserTabState = {
        browserId,
        url,
        title: "",
        loading: Boolean(url),
        error: "",
        navToken: url ? 1 : 0,
      };
      return [
        ...current,
        {
          id,
          kind: "browser",
          title: "Browser",
          browserId,
          tab: browserTab,
        },
      ];
    });
  }, [activeTabId]);

  const openKind = useCallback((kind: AgentWorkspaceToolKind) => {
    setAddMenuOpen(false);
    if (kind === "git" && !gitAvailable) return;

    // Each + → Browser / Terminal opens a NEW outer tab (never reuse).
    if (kind === "browser") {
      openNewBrowserTab();
      return;
    }

    if (kind === "git") {
      setTabs((current) => {
        const existing = current.find((tab) => tab.kind === "git");
        if (existing) {
          setActiveTabId(existing.id);
          return current;
        }
        const id = nextId("git");
        setActiveTabId(id);
        return [...current, { id, kind: "git", title: "Source Control" }];
      });
      return;
    }

    setTabs((current) => {
      const id = nextId("term");
      const count = current.filter((tab) => tab.kind === "terminal").length;
      setActiveTabId(id);
      return [
        ...current,
        {
          id,
          kind: "terminal",
          title: count === 0 ? "Terminal" : `Terminal ${count + 1}`,
        },
      ];
    });
  }, [gitAvailable, openNewBrowserTab]);

  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.nonce === handledOpenNonce.current) return;
    handledOpenNonce.current = openRequest.nonce;
    if (openRequest.terminal) {
      const terminal = openRequest.terminal;
      const id = `agent-terminal:${terminal.sessionId}`;
      setTabs((current) => current.some((tab) => tab.id === id) ? current : [...current, {id, kind: "terminal", title: terminal.title || "Agent terminal", terminal}]);
      setActiveTabId(id);
    } else {
      openKind(openRequest.kind);
    }
  }, [handledOpenNonce, openKind, openRequest]);

  useEffect(() => {
    if (!sessionId || !terminalRecovery?.length) return;
    const owned = terminalRecovery.filter((terminal) => terminal.agentSessionId === sessionId);
    setTabs((current) => {
      const missing = owned.filter((terminal) => !current.some((tab) => tab.id === `agent-terminal:${terminal.sessionId}`));
      if (!missing.length) return current;
      setActiveTabId(`agent-terminal:${missing[missing.length - 1].sessionId}`);
      return [...current, ...missing.map((terminal) => ({id: `agent-terminal:${terminal.sessionId}`, kind: "terminal" as const, title: terminal.title || "Agent terminal", terminal}))];
    });
  }, [sessionId, terminalRecovery]);

  // Explicit Open from chat Wrote/Edited rows only (never auto-open on tool finish).
  useEffect(() => {
    if (!openFileRequest) return;
    if (openFileRequest.nonce === handledFileNonce.current) return;
    handledFileNonce.current = openFileRequest.nonce;
    const path = String(openFileRequest.path || "").trim();
    if (!path) return;
    if (typeof openFileRequest.content === "string") {
      const name = path.replace(/^.*[/\\]/, "") || path;
      upsertFileTab(path, name, openFileRequest.content, null, "agent-log");
      setFileLoadError("");
      return;
    }
    void openFileFromPath(path, openFileRequest.patch);
  }, [handledFileNonce, openFileFromPath, openFileRequest, upsertFileTab]);

  // Chat links + agent browser_open → our right-side browser (not Chrome/Safari).
  useEffect(() => {
    if (!openBrowserRequest) return;
    if (openBrowserRequest.nonce === handledBrowserNonce.current) return;
    handledBrowserNonce.current = openBrowserRequest.nonce;
    const url = String(openBrowserRequest.url || "").trim();
    if (!url) return;
    openBrowserUrl(url);
  }, [handledBrowserNonce, openBrowserRequest, openBrowserUrl]);

  // Hide only THIS panel's browser embeds when suspended — never hideAll(),
  // which would also blank Explorer browser tabs that stay mounted.
  const agentBrowserIds = useMemo(
    () =>
      tabs
        .filter((tab): tab is Extract<AgentWorkspaceTab, { kind: "browser" }> => tab.kind === "browser")
        .map((tab) => tab.browserId),
    [tabs],
  );

  useEffect(() => {
    if (active) return;
    for (const browserId of agentBrowserIds) {
      void window.colorideDesktop?.browserEmbed?.hide?.({ tabId: browserId });
    }
  }, [active, agentBrowserIds]);

  useEffect(() => {
    if (!active) return;
    if (activeTab?.kind === "browser") return;
    for (const browserId of agentBrowserIds) {
      void window.colorideDesktop?.browserEmbed?.hide?.({ tabId: browserId });
    }
  }, [active, activeTab?.id, activeTab?.kind, agentBrowserIds]);

  const saveFileTab = useCallback(
    async (id: string) => {
      const file = tabsRef.current.find(
        (tab): tab is Extract<AgentWorkspaceTab, { kind: "file" }> =>
          tab.id === id && tab.kind === "file",
      );
      if (!file?.path || !file.dirty || file.saving) return;

      if (appPreferences.permissionMode === "read-only") {
        setTabs((current) =>
          current.map((tab) =>
            tab.id === id && tab.kind === "file"
              ? { ...tab, saveError: "Explorer file access is read only." }
              : tab,
          ),
        );
        return;
      }

      if (
        appPreferences.permissionMode === "confirm-changes" &&
        !window.confirm(`Save changes to ${file.title}?`)
      ) {
        return;
      }

      const valueBeingSaved = file.value;
      setTabs((current) =>
        current.map((tab) =>
          tab.id === id && tab.kind === "file"
            ? { ...tab, saving: true, saveError: "" }
            : tab,
        ),
      );

      try {
        const encoded = encodeTextToBase64(valueBeingSaved);
        const response = sessionId
          ? await api.writeAgentSessionFile(sessionId, file.path, encoded, file.etag)
          : await api.writeFile(file.path, encoded, file.etag);
        setTabs((current) =>
          current.map((tab) => {
            if (tab.id !== id || tab.kind !== "file") return tab;
            return {
              ...tab,
              savedValue: valueBeingSaved,
              etag: response.etag,
              dirty: tab.value !== valueBeingSaved,
              saving: false,
              saveError: "",
            };
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setTabs((current) =>
          current.map((tab) =>
            tab.id === id && tab.kind === "file"
              ? { ...tab, saving: false, saveError: message }
              : tab,
          ),
        );
      }
    },
    [appPreferences.permissionMode, sessionId],
  );

  useEffect(() => {
    if (!active || activeTab?.kind !== "file") return;
    const id = activeTab.id;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void saveFileTab(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, activeTab?.id, activeTab?.kind, saveFileTab]);

  const closeTab = (id: string) => {
    const closing = tabsRef.current.find((tab) => tab.id === id);
    if (
      closing?.kind === "file" &&
      closing.dirty &&
      !window.confirm(`Discard unsaved changes to ${closing.title}?`)
    ) {
      return;
    }
    if (closing?.kind === "browser") {
      void window.colorideDesktop?.browserEmbed?.close?.({ tabId: closing.browserId });
    }
    if (closing?.kind === "terminal" && closing.terminal) {
      void closeManagedTerminalSession(closing.terminal.sessionId)
        .then((closed) => closed ? undefined : api.closeTerminal(closing.terminal!.termId))
        .catch(() => undefined);
    }
    if (closing?.kind === "file" && closing.path) {
      void lspSyncClose(closing.path);
    }
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      setActiveTabId((activeId) => {
        if (activeId !== id) return activeId;
        const index = current.findIndex((tab) => tab.id === id);
        const fallback = next[index] ?? next[index - 1] ?? next[0] ?? null;
        return fallback?.id ?? null;
      });
      return next;
    });
  };

  const updateBrowserTab = (id: string, next: Partial<BrowserTabState>) => {
    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== id || tab.kind !== "browser") return tab;
        const updated = { ...tab.tab, ...next };
        // Prefer the page title when present; keep the tab label (Browser / Browser 2) otherwise.
        const pageTitle = String(updated.title || "").trim();
        return {
          ...tab,
          tab: updated,
          title: pageTitle || tab.title || "Browser",
        };
      }),
    );
  };

  const updateFileValue = (id: string, value: string) => {
    if (appPreferences.permissionMode === "read-only") return;
    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== id || tab.kind !== "file") return tab;
        if (tab.path) lspSyncChange(tab.path, value);
        return {
          ...tab,
          value,
          dirty: value !== tab.savedValue,
          saveError: "",
        };
      }),
    );
  };

  const updateTabScroll = useCallback(() => {
    const element = tabsScrollRef.current;
    if (!element) return;
    setTabScroll((current) => {
      const next = {
        left: element.scrollLeft,
        width: element.scrollWidth,
        client: element.clientWidth,
      };
      return current.left === next.left
        && current.width === next.width
        && current.client === next.client
        ? current
        : next;
    });
  }, []);

  useLayoutEffect(() => {
    updateTabScroll();
  }, [tabs, updateTabScroll]);

  useEffect(() => {
    const element = tabsScrollRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(updateTabScroll);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [updateTabScroll]);

  const tabLabel = (tab: AgentWorkspaceTab) => {
    if (tab.kind === "browser") return tab.title || "Browser";
    if (tab.kind === "terminal") return tab.title || "Terminal";
    if (tab.kind === "git") return tab.title || "Source Control";
    return tab.title || tab.path?.split("/").filter(Boolean).at(-1) || "Untitled";
  };

  return (
    <div className="agent-workspace-panel flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#212121]">
      <header className="explorer-editor-header relative z-20 flex h-10 flex-shrink-0 items-center bg-[#1e1e1e] px-1.5">
        <div
          className="editor-tabs-scroll flex h-full min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden"
          onScroll={updateTabScroll}
          ref={tabsScrollRef}
        >
          {tabs.map((tab, index) => {
            const activeTabMatch = tab.id === (activeTab?.id ?? null);
            const name = tabLabel(tab);
            const next = tabs[index + 1];
            const separatorTouchesActive =
              activeTabMatch || (next != null && next.id === activeTab?.id);
            return (
              <div key={tab.id} className="flex shrink-0 items-center">
                <Tab
                  active={activeTabMatch}
                  className="agent-workspace-tab editor-file-tab"
                  title={name}
                >
                  <button
                    aria-label={`Open ${name}`}
                    className="absolute inset-0 rounded-[4px]"
                    onClick={() => setActiveTabId(tab.id)}
                    type="button"
                  />
                  <span className="pointer-events-none relative flex min-w-0 items-center gap-1.5">
                    {tab.kind === "browser" && <AgentWorkspaceBrowserGlyph />}
                    {tab.kind === "terminal" && <AgentWorkspaceTerminalGlyph />}
                    {tab.kind === "git" && <AgentWorkspaceGitGlyph />}
                    {tab.kind === "file" && <AgentWorkspaceFileGlyph />}
                    <OverflowFadeText className="flex-1">{name}</OverflowFadeText>
                    {tab.kind === "file" && tab.dirty ? (
                      <span
                        aria-label="Unsaved changes"
                        className="size-1.5 shrink-0 rounded-full bg-[#c6c6c6]"
                      />
                    ) : null}
                  </span>
                  <IconButton
                    label={`Close ${name}`}
                    size="sm"
                    className="absolute right-1.5 z-10"
                    onClick={() => closeTab(tab.id)}
                  >
                    <EditorTabCloseIcon />
                  </IconButton>
                </Tab>
                {index < tabs.length - 1 && (
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

          {/*
            + picker stays IN the tab bar (HTML layer above the embed).
            No floating portal / no native popup / no embed hide or top-inset.
          */}
          <div ref={addMenuRef} className="relative ml-0.5 flex shrink-0 items-center">
            {!addMenuOpen ? (
              <IconButton
                aria-expanded={false}
                aria-haspopup="menu"
                label="Add tab"
                onClick={() => setAddMenuOpen(true)}
              >
                <AgentWorkspaceAddIcon />
              </IconButton>
            ) : (
              <div
                className="agent-workspace-add-inline flex h-7 items-center gap-0.5 rounded-[4px] bg-[#272727] p-0.5"
                role="menu"
              >
                <button
                  className="flex h-6 items-center gap-1.5 rounded-lg px-2 text-[12px] text-[#d4d4d7] transition-colors hover:bg-white/[0.08] hover:text-white"
                  onClick={() => openKind("browser")}
                  role="menuitem"
                  type="button"
                >
                  <AgentWorkspaceBrowserGlyph />
                  Browser
                </button>
                <button
                  className="flex h-6 items-center gap-1.5 rounded-lg px-2 text-[12px] text-[#d4d4d7] transition-colors hover:bg-white/[0.08] hover:text-white"
                  onClick={() => openKind("terminal")}
                  role="menuitem"
                  type="button"
                >
                  <AgentWorkspaceTerminalGlyph />
                  Terminal
                </button>
                {gitAvailable ? <button
                  className="flex h-6 items-center gap-1.5 rounded-lg px-2 text-[12px] text-[#d4d4d7] transition-colors hover:bg-white/[0.08] hover:text-white"
                  onClick={() => openKind("git")}
                  role="menuitem"
                  type="button"
                >
                  <AgentWorkspaceGitGlyph />
                  Git
                </button> : null}
                <button
                  aria-label="Close add menu"
                  className="flex size-6 items-center justify-center rounded-lg text-[#878888] transition-colors hover:bg-white/[0.08] hover:text-white"
                  onClick={() => setAddMenuOpen(false)}
                  type="button"
                >
                  <EditorTabCloseIcon />
                </button>
              </div>
            )}
          </div>
        </div>
        <EditorTabsHairline
          metrics={tabScroll}
          onScrollTo={(left) => tabsScrollRef.current?.scrollTo({ left })}
        />
        {activeTab?.kind === "file" ? (
          <div className="ml-2 flex shrink-0 items-center gap-2">
            <button
              className="inline-flex h-7 min-w-[58px] items-center justify-center rounded-lg bg-white/[0.08] px-2.5 text-[12px] text-[#d4d4d7] transition-colors hover:bg-white/[0.12] hover:text-white disabled:cursor-default disabled:opacity-45"
              disabled={
                appPreferences.permissionMode === "read-only" ||
                !activeTab.dirty ||
                activeTab.saving
              }
              onClick={() => void saveFileTab(activeTab.id)}
              title={
                appPreferences.permissionMode === "read-only"
                  ? "Explorer file access is read only"
                  : "Save (Cmd/Ctrl+S)"
              }
              type="button"
            >
              {activeTab.saving
                ? "Saving…"
                : appPreferences.permissionMode === "read-only"
                  ? "Read only"
                  : "Save"}
            </button>
          </div>
        ) : null}
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#1e1e1e]">
        <div className="relative min-h-0 flex-1 overflow-hidden">
        {(fileLoadError || (activeTab?.kind === "file" && activeTab.saveError)) && (
          <div
            aria-live="polite"
            className="absolute left-3 right-3 top-3 z-20 rounded-lg border border-red-400/20 bg-[#2a1d1d]/95 px-3 py-2 text-[12px] text-red-200 shadow-lg"
          >
            {activeTab?.kind === "file" && activeTab.saveError
              ? activeTab.saveError
              : fileLoadError}
          </div>
        )}
        {!activeTab ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[13px] text-[#878888]">No tab open</p>
            <p className="max-w-xs text-[12px] leading-5 text-[#5c5c5c]">
              Use + for Browser, Terminal, or Git. Files open here when the agent edits them in chat.
            </p>
          </div>
        ) : null}

        {/* Keep terminal mounted while its tab exists so PTY output survives tab switches. */}
        {tabs
          .filter((tab): tab is Extract<AgentWorkspaceTab, { kind: "terminal" }> => tab.kind === "terminal")
          .map((tab) => {
            const visible = activeTab?.id === tab.id;
            return (
              <div
                key={tab.id}
                aria-hidden={!visible}
                className={`absolute inset-0 min-h-0 ${visible ? "z-10" : "pointer-events-none invisible z-0"}`}
              >
                <TerminalPanel
                  initialTerminal={tab.terminal}
                  connected={connected}
                  embedded
                  hideHeader
                  surfaceActive={visible && active}
                  onOpenBrowserUrl={(url) => openBrowserUrl(url)}
                  workspacePath={workspacePath}
                  workspaceKind={workspaceKind}
                  connectionId={connectionId}
                />
              </div>
            );
          })}

        {tabs
          .filter((tab): tab is Extract<AgentWorkspaceTab, { kind: "git" }> => tab.kind === "git")
          .map((tab) => {
            const visible = activeTab?.id === tab.id;
            return (
              <div
                key={tab.id}
                aria-hidden={!visible}
                className={`absolute inset-0 min-h-0 ${visible ? "z-10" : "pointer-events-none invisible z-0"}`}
              >
                <AgentGitSourceControl
                  connected={connected}
                  workspacePath={workspacePath}
                  onOpenWorkspacePath={onOpenGitWorkspace}
                  onOpenFileDiff={openGitFileDiff}
                />
              </div>
            );
          })}

        {/* Keep browsers mounted while their tab exists so embeds/history survive tab switches. */}
        {tabs
          .filter((tab): tab is Extract<AgentWorkspaceTab, { kind: "browser" }> => tab.kind === "browser")
          .map((tab) => {
            const visible = activeTab?.id === tab.id;
            return (
              <div
                key={tab.id}
                aria-hidden={!visible}
                className={`absolute inset-0 min-h-0 ${visible ? "z-10" : "pointer-events-none invisible z-0"}`}
              >
                <BrowserPane
                  tab={tab.tab}
                  workspaceKind={workspaceKind}
                  onUpdate={(next) => updateBrowserTab(tab.id, next)}
                  // Only the focused browser tab may show its native WebContentsView.
                  overlaySuspended={!visible || !active}
                  expanded={browserExpanded && visible}
                  onToggleExpanded={
                    visible && onBrowserExpandedChange
                      ? () => onBrowserExpandedChange(!browserExpanded)
                      : undefined
                  }
                />
              </div>
            );
          })}

        {activeTab?.kind === "file" ? (
          <div className="absolute inset-0 z-10 min-h-0 w-full overflow-hidden">
            <div className="absolute inset-0 min-h-0 min-w-0">
              <CodeEditor
                key={activeTab.id}
                path={activeTab.path ?? activeTab.id}
                value={activeTab.value}
                language={editorLanguageFromPath(activeTab.path, activeTab.value)}
                reveal={openFileRequest?.path === activeTab.path && openFileRequest.line
                  ? { line: openFileRequest.line, token: openFileRequest.nonce } : null}
                theme={editorTheme}
                options={editorOptions}
                workspaceRoot={workspacePath}
                onOpenPath={(absolutePath) => {
                  void openFileFromPath(absolutePath);
                }}
                onOpenLocation={(absolutePath) => {
                  void openFileFromPath(absolutePath);
                }}
                onApplyRenameFiles={async (files) => {
                  for (const file of files) {
                    if (!file.path || !file.edits.length) continue;
                    const tab = tabs.find((item) => item.kind === "file" && item.path === file.path);
                    let text: string | null = tab && tab.kind === "file" ? tab.value : null;
                    if (text == null) {
                      try {
                        const read = await api.readFile(file.path);
                        text = decodeBase64ToText(read.content);
                      } catch {
                        continue;
                      }
                    }
                    const next = applyLineEdits(text, file.edits);
                    if (tab && tab.kind === "file") {
                      updateFileValue(tab.id, next);
                      continue;
                    }
                    try {
                      await api.writeFile(file.path, encodeTextToBase64(next), null);
                      lspSyncChange(file.path, next);
                    } catch {
                      // ignore
                    }
                  }
                }}
                onChange={(nextValue) => updateFileValue(activeTab.id, nextValue)}
                className="h-full w-full"
              />
            </div>
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}

function EditorTabCloseIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d="M18 6L12 12M12 12L6 18M12 12L18 18M12 12L6 6" />
    </svg>
  );
}

function AgentWorkspaceAddIcon() {
  return (
    <svg aria-hidden="true" className="size-[15px]" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function AgentWorkspaceBrowserGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5 shrink-0 text-[#878888]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12C8 18 12 22 12 22C12 22 16 18 16 12C16 6 12 2 12 2C12 2 8 6 8 12Z" strokeLinejoin="round" />
      <path d="M21 15H3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 9H3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Plain file icon (document + folded corner — no type-specific <>). */
function AgentWorkspaceFileGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5 shrink-0 text-[#878888]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M14 2.5V3c0 2.828 0 4.243.879 5.121C15.757 9 17.172 9 20 9h.5" />
      <path d="M20 10.657V14c0 3.771 0 5.657-1.172 6.828C17.657 22 15.771 22 12 22c-3.771 0-5.657 0-6.828-1.172C4 19.657 4 17.771 4 14V9.456c0-3.245 0-4.867.886-5.967.179-.222.381-.424.603-.603C6.588 2 8.211 2 11.456 2c.705 0 1.058 0 1.381.114.067.024.133.051.197.082.31.148.559.397 1.058.896L18.828 7.828c.578.578.867.867 1.019 1.235.153.367.153.776.153 1.594Z" />
    </svg>
  );
}

function AgentWorkspaceGitGlyph() {
  return <GitIcon className="size-3.5 shrink-0 text-[#878888]" />;
}

function AgentWorkspaceTerminalGlyph() {
  return (
    <svg aria-hidden="true" className="size-3.5 shrink-0 text-[#878888]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M7.5 7.5L8.72654 8.55719C9.24218 9.00163 9.5 9.22386 9.5 9.5C9.5 9.77614 9.24218 9.99836 8.72654 10.4428L7.5 11.5" />
      <path d="M11.5 12.5H15.5" />
      <path d="M12 21C15.7497 21 17.6246 21 18.9389 20.0451C19.3634 19.7367 19.7367 19.3634 20.0451 18.9389C21 17.6246 21 15.7497 21 12C21 8.25027 21 6.3754 20.0451 5.06107C19.7367 4.6366 19.3634 4.26331 18.9389 3.95491C17.6246 3 15.7497 3 12 3C8.25027 3 6.3754 3 5.06107 3.95491C4.6366 4.26331 4.26331 4.6366 3.95491 5.06107C3 6.3754 3 8.25027 3 12C3 15.7497 3 17.6246 3.95491 18.9389C4.26331 19.3634 4.6366 19.7367 5.06107 20.0451C6.3754 21 8.25027 21 12 21Z" />
    </svg>
  );
}
