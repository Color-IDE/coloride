import { VerticalScrollHairline } from "../../shared/ui/VerticalScrollHairline";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { installTerminalRenderer } from "./terminalRenderer";
import { disposeTerminalView } from "./terminalTeardown";
import "@xterm/xterm/css/xterm.css";
import { api } from "../../shared/api/client";
import {
  serializeCodeRef,
  terminalCodeRefFromSelection,
  writeCodeRefToClipboard,
} from "../editor/codeRefClipboard";
import { getCodeFontFamily, useAppPreferences, useResolvedTheme } from "../settings/preferences";
import type { TerminalSessionStatus } from "./terminalTypes";
import { getTerminalSessionManager } from "./TerminalSessionManager";
import { installTerminalShellIntegration } from "./terminalShellIntegration";
import type { TerminalShellIntegration } from "./terminalShellIntegration";

/**
 * Terminal wired to the backend PTY over WebSocket.
 *
 * The connect effect follows the SSH state and working directory, so a newly
 * selected workspace starts its shell in that directory.
 *
 * Terminal V2 keeps every surface under one stable layer. Inactive tabs become
 * invisible without destroying their logical session; `active` only drives a
 * refit/focus when a slot becomes visible again.
 *
 * Backend protocol (see api/app.py):
 *   - binary WebSocket: PTY output -> bytes -> term.write()
 *   - keystrokes -> UTF-8 bytes -> ws.send()
 *   - resize goes over HTTP (POST /api/term/{id}/resize), not the socket
 */
export type XTerminalHandle = {
  clear: () => void;
  copySelection: () => Promise<void>;
  focus: () => void;
  fit: () => void;
  findNext: (query: string) => boolean;
  findPrevious: (query: string) => boolean;
  pasteFromClipboard: () => Promise<void>;
  selectAll: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
};

/**
 * xterm's bundled stylesheet forces the viewport to black on macOS so native
 * scrollbars stay opaque. That black becomes visible as a vertical rail in
 * Coloride light mode, even though the terminal canvas is white.
 */
const syncViewportSurface = (term: Terminal, theme: "light" | "dark") => {
  const viewport = term.element?.querySelector<HTMLElement>(".xterm-viewport");
  if (!viewport) return;
  const background = theme === "light" ? "#ffffff" : "#171717";
  viewport.style.setProperty("background", background, "important");
  viewport.style.setProperty("background-color", background, "important");
};

function terminalTheme(theme: "light" | "dark"): ITheme {
  const light = theme === "light";
  return {
    background: light ? "#ffffff" : "#171717",
    foreground: light ? "#202124" : "#f0f4f8",
    cursor: light ? "#202124" : "#f0f4f8",
    cursorAccent: light ? "#ffffff" : "#171717",
    selectionBackground: light ? "#d0d0d6" : "#3a3d45",
    selectionInactiveBackground: light ? "#dddddf" : "#30323a",
    ...(light ? {
      black: "#202124", red: "#b42318", green: "#247137", yellow: "#806000",
      blue: "#245dc1", magenta: "#9635a0", cyan: "#087582", white: "#656970",
      brightBlack: "#656970", brightRed: "#c22f25", brightGreen: "#287c3b",
      brightYellow: "#896700", brightBlue: "#3468c5", brightMagenta: "#a141ab",
      brightCyan: "#087e8b", brightWhite: "#202124",
    } : {}),
  };
}

type XTerminalProps = {
  connected: boolean;
  active: boolean;
  /** The one visible pane currently receiving keyboard input. */
  focused?: boolean;
  /** Optional renderer override; local terminals default to DOM for reliable repaint. */
  renderer?: "dom" | "webgl";
  cwd?: string | null;
  onForeground?: (name: string) => void;
  onCwd?: (cwd: string) => void;
  onOpenBrowserUrl?: (url: string) => void | Promise<unknown>;
  onOpenRemoteFile?: (path: string) => void | Promise<unknown>;
  onSessionCreated?: (termId: string) => void;
  onStatusChange?: (status: TerminalSessionStatus) => void;
  sessionId: string;
  workspaceKind: "local" | "ssh";
  workspaceId: string;
  connectionId?: string | null;
};

export const XTerminal = forwardRef<XTerminalHandle, XTerminalProps>(function XTerminal({
  connected,
  active,
  focused = false,
  renderer,
  cwd,
  onForeground,
  onCwd,
  onOpenBrowserUrl,
  onOpenRemoteFile,
  onSessionCreated,
  onStatusChange,
  sessionId,
  workspaceKind,
  workspaceId,
  connectionId,
}, ref) {
  const appPreferences = useAppPreferences();
  const resolvedTheme = useResolvedTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollControlsId = useId();
  const termRef = useRef<Terminal | null>(null);
  const [scrollMetrics, setScrollMetrics] = useState({ top: 0, height: 0, client: 0 });
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const termIdRef = useRef<string | null>(null);
  const sessionManagerRef = useRef<ReturnType<typeof getTerminalSessionManager> | null>(null);
  const shellIntegrationRef = useRef<TerminalShellIntegration | null>(null);
  const lastPtySizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  /** True after the connect effect tears down — blocks late fit/rAF work. */
  const disposedRef = useRef(false);

  const writeTerminalSelectionToClipboard = async (event?: ClipboardEvent | null) => {
    const term = termRef.current;
    if (!term) return false;
    const selection = term.getSelection();
    if (!selection) return false;
    const pos = term.getSelectionPosition?.() ?? null;
    const payload = terminalCodeRefFromSelection({
      text: selection,
      cwd: cwdRef.current,
      startRow: pos ? pos.start.y : null,
      endRow: pos ? pos.end.y : null,
    });
    if (!payload) return false;
    return writeCodeRefToClipboard(payload, event ?? null);
  };

  /** Fit xterm to the container, then tell the remote PTY the same cols×rows. */
  const fitFrameRef = useRef<number | null>(null);
  const revealPaintRef = useRef(true);
  const performFit = useRef(() => {
    if (disposedRef.current || !activeRef.current) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const el = containerRef.current;
    // FitAddon.getDimensions crashes if core/element is already gone after dispose.
    if (!term || !fit || !el) return;
    if (!(term as { element?: unknown }).element) return;
    if (el.clientWidth < 8 || el.clientHeight < 8) return;
    try {
      const dimensions = fit.proposeDimensions();
      if (!dimensions) return;
      const cols = clampTerminalSize(dimensions.cols, 20, 400, 80);
      const rows = clampTerminalSize(dimensions.rows, 5, 120, 24);
      if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
    } catch {
      return;
    }
    const cols = clampTerminalSize(term.cols, 20, 400, 80);
    const rows = clampTerminalSize(term.rows, 5, 120, 24);
    // resize() already schedules rendering. Only an actual reveal needs a
    // full refresh at unchanged dimensions; routine layout notifications do not.
    if (revealPaintRef.current) {
      revealPaintRef.current = false;
      term.refresh(0, term.rows - 1);
    }
    const id = termIdRef.current;
    if (!id) return;
    const prev = lastPtySizeRef.current;
    if (prev && prev.cols === cols && prev.rows === rows) return;

    lastPtySizeRef.current = { cols, rows };
    void sessionManagerRef.current?.resize(sessionIdRef.current, cols, rows).catch(() => {
      // Allow retry next fit.
      lastPtySizeRef.current = null;
    });
  });
  // Coalesce layout/font/activation requests and read the final DOM geometry.
  const fitAndSyncPty = useRef(() => {
    if (fitFrameRef.current !== null || disposedRef.current) return;
    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null;
      performFit.current();
    });
  });
  // Keep the latest callback in a ref so foreground updates do not reconnect
  // the terminal.
  const onForegroundRef = useRef(onForeground);
  const onCwdRef = useRef(onCwd);
  const onOpenBrowserUrlRef = useRef(onOpenBrowserUrl);
  const onOpenRemoteFileRef = useRef(onOpenRemoteFile);
  const onSessionCreatedRef = useRef(onSessionCreated);
  const onStatusChangeRef = useRef(onStatusChange);
  const appPreferencesRef = useRef(appPreferences);
  const zoomOffsetRef = useRef(0);
  onForegroundRef.current = onForeground;
  onCwdRef.current = onCwd;
  onOpenBrowserUrlRef.current = onOpenBrowserUrl;
  onOpenRemoteFileRef.current = onOpenRemoteFile;
  onSessionCreatedRef.current = onSessionCreated;
  onStatusChangeRef.current = onStatusChange;
  appPreferencesRef.current = appPreferences;

  const pasteTextIntoTerminal = async (preferredText?: string | null) => {
    let text = typeof preferredText === "string" ? preferredText : "";
    if (!text) {
      // Electron main clipboard is reliable; navigator.clipboard often fails without gesture/permissions.
      try {
        const fromDesktop = await window.colorideDesktop?.readClipboardText?.();
        if (typeof fromDesktop === "string" && fromDesktop.length > 0) text = fromDesktop;
      } catch {
        // fall through
      }
    }
    if (!text) {
      try {
        text = (await navigator.clipboard?.readText?.()) || "";
      } catch {
        text = "";
      }
    }
    if (!text) return;
    pasteTextIntoPty(text);
  };

  const pasteTextIntoPty = (raw: string) => {
    const term = termRef.current;
    if (!term || !raw) return;
    // Normalize Windows CRLF so shells don't double-run lines.
    const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    // A selected xterm range is painted in a separate layer; leaving it alive
    // while pasting makes duplicate-looking fragments appear during redraw.
    term.clearSelection();
    term.focus();
    // term.paste() goes through onData → WebSocket (same path as typing).
    term.paste(normalized);
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      // The backend clears PTY scrollback too, therefore retain no stale
      // command decorations from the former screen.
      shellIntegrationRef.current?.reset();
      termRef.current?.clear();
      void sessionManagerRef.current?.clear(sessionIdRef.current).catch(() => { });
    },
    copySelection: async () => {
      await writeTerminalSelectionToClipboard();
    },
    focus: () => termRef.current?.focus(),
    fit: () => fitAndSyncPty.current(),
    findNext: (query) => searchRef.current?.findNext(query, { decorations: { activeMatchColorOverviewRuler: "#7dd3fc", matchOverviewRuler: "#64748b" } }) ?? false,
    findPrevious: (query) => searchRef.current?.findPrevious(query, { decorations: { activeMatchColorOverviewRuler: "#7dd3fc", matchOverviewRuler: "#64748b" } }) ?? false,
    pasteFromClipboard: () => pasteTextIntoTerminal(),
    selectAll: () => termRef.current?.selectAll(),
    zoomIn: () => {
      zoomOffsetRef.current = Math.min(8, zoomOffsetRef.current + 1);
      const term = termRef.current;
      if (term) term.options.fontSize = appPreferencesRef.current.codeFontSize + zoomOffsetRef.current;
      fitAndSyncPty.current();
    },
    zoomOut: () => {
      zoomOffsetRef.current = Math.max(-6, zoomOffsetRef.current - 1);
      const term = termRef.current;
      if (term) term.options.fontSize = Math.max(8, appPreferencesRef.current.codeFontSize + zoomOffsetRef.current);
      fitAndSyncPty.current();
    },
    zoomReset: () => {
      zoomOffsetRef.current = 0;
      const term = termRef.current;
      if (term) term.options.fontSize = appPreferencesRef.current.codeFontSize;
      fitAndSyncPty.current();
    },
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    const pendingWrites = new Set<() => void>();
    disposedRef.current = false;
    let termId: string | null = null;
    let detachManagedSession: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    termIdRef.current = null;
    lastPtySizeRef.current = null;

    revealPaintRef.current = true;
    const term = new Terminal({
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: appPreferencesRef.current.terminalCursorBlink,
      cursorStyle: appPreferencesRef.current.terminalCursorStyle,
      fontSize: appPreferences.codeFontSize,
      fontFamily: getCodeFontFamily(appPreferences.codeFontFamily),
      // Fixed metrics — avoids col drift when font falls back mid-session.
      fontWeight: "400",
      fontWeightBold: "700",
      lineHeight: 1.0,
      letterSpacing: 0,
      macOptionIsMeta: appPreferencesRef.current.terminalMacOptionIsMeta,
      minimumContrastRatio: appPreferencesRef.current.terminalMinimumContrastRatio,
      scrollback: appPreferencesRef.current.terminalScrollback,
      // Start with native scrolling. Coarse mouse-wheel events opt into the
      // optional animation below; pixel-precision trackpads already provide
      // their own momentum and must never queue a second animation.
      smoothScrollDuration: 0,
      theme: terminalTheme(resolvedTheme),
    });
    termRef.current = term;

    const canOpenLink = (event: MouseEvent) => (
      !appPreferencesRef.current.terminalRequireLinkModifier || event.metaKey || event.ctrlKey
    );

    /** Prefer Coloride embedded browser (VPS SOCKS); fall back to system browser. */
    const openHttpUrl = (uri: string) => {
      const cleaned = sanitizeTerminalUrl(uri);
      if (!cleaned) return;
      if (onOpenBrowserUrlRef.current) {
        void onOpenBrowserUrlRef.current(cleaned);
        return;
      }
      if (window.colorideDesktop?.openExternal) {
        void window.colorideDesktop.openExternal(cleaned);
        return;
      }
      window.open(cleaned, "_blank", "noopener,noreferrer");
    };

    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (!canOpenLink(event)) return;
      event.preventDefault();
      openHttpUrl(uri);
    });
    term.loadAddon(webLinksAddon);

    // OAuth / CLI auth URLs (Codex, gh, etc.) often wrap across many terminal
    // lines. WebLinksAddon only sees one line — reassemble and open in browser.
    const wrappedUrlLinkProvider = term.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const found = findWrappedHttpLinks(term, bufferLineNumber);
        if (!found.length) {
          callback(undefined);
          return;
        }
        callback(
          found.map((link) => ({
            text: link.url,
            range: link.range,
            decorations: { pointerCursor: true, underline: true },
            activate: (event: MouseEvent) => {
              // Auth links are intentional — plain click is enough (no Cmd required).
              event.preventDefault();
              openHttpUrl(link.url);
            },
          })),
        );
      },
    });

    const fileLinkProvider = term.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const text = term.buffer.active.getLine(bufferLineNumber)?.translateToString(true) ?? "";
        const links = [...text.matchAll(/\/(?:[A-Za-z0-9._~@%+=:-]+\/)*[A-Za-z0-9._~@%+=:-]+/g)]
          .map((match) => ({ path: match[0].replace(/[:),.;]+$/, ""), index: match.index ?? 0 }))
          .filter(({ index }) => !text.slice(Math.max(0, index - 1), index + 2).endsWith("://"))
          .filter(({ path }) => isLikelyFilePath(path))
          .map(({ path, index }) => ({
            text: path,
            range: {
              start: { x: index + 1, y: bufferLineNumber + 1 },
              end: { x: index + path.length, y: bufferLineNumber + 1 },
            },
            decorations: { pointerCursor: true, underline: true },
            activate: (event: MouseEvent) => {
              if (!canOpenLink(event)) return;
              event.preventDefault();
              void onOpenRemoteFileRef.current?.(path);
            },
          }));
        callback(links.length > 0 ? links : undefined);
      },
    });

    const fitAddon = new FitAddon();
    fitRef.current = fitAddon;
    term.loadAddon(fitAddon);
    const searchAddon = new SearchAddon();
    searchRef.current = searchAddon;
    term.loadAddon(searchAddon);
    term.open(container);
    let scrollFrame = 0;
    const updateScrollMetrics = () => {
      scrollFrame = 0;
      if (disposed) return;
      const buffer = term.buffer.active;
      const next = { top: buffer.viewportY, height: buffer.baseY + term.rows, client: term.rows };
      setScrollMetrics(old => old.top === next.top && old.height === next.height && old.client === next.client ? old : next);
    };
    const scheduleScrollMetrics = () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScrollMetrics); };
    const scrollSubscriptions = [term.onScroll(scheduleScrollMetrics), term.onWriteParsed(scheduleScrollMetrics),
      term.onResize(scheduleScrollMetrics), term.buffer.onBufferChange(scheduleScrollMetrics)];
    scheduleScrollMetrics();
    term.attachCustomWheelEventHandler((event) => {
      const isPrecisionScroll = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL;
      const nextDuration = !isPrecisionScroll && appPreferencesRef.current.terminalSmoothScrolling
        ? 60
        : 0;
      if (term.options.smoothScrollDuration !== nextDuration) {
        term.options.smoothScrollDuration = nextDuration;
      }
      return true;
    });
    const disposeRenderer = installTerminalRenderer(term, renderer ?? (workspaceKind === "local" ? "dom" : "webgl"));
    syncViewportSurface(term, resolvedTheme);

    // Only fit when actually visible. Inactive tabs are display:none / 0-size,
    // where measuring would produce a bogus (tiny) grid and desync the PTY.
    const safeFit = () => {
      if (disposed || disposedRef.current) return;
      if (!activeRef.current) return;
      if (container.clientWidth < 8 || container.clientHeight < 8) return;
      fitAndSyncPty.current();
    };
    // Queue the initial fit before attaching the output consumer.
    safeFit();

    const encoder = new TextEncoder();
    const sessionManager = getTerminalSessionManager({ workspaceId, workspaceKind, connectionId, cwd });
    sessionManagerRef.current = sessionManager;
    const shellIntegration = installTerminalShellIntegration(term, {
      rerun: (command) => {
        term.clearSelection();
        term.focus();
        sessionManager.send(sessionId, encoder.encode(`${command}\r`));
      },
      copy: async (command) => {
        await navigator.clipboard.writeText(command);
      },
    });
    shellIntegrationRef.current = shellIntegration;

    // Keystrokes -> backend PTY (UTF-8 bytes, since it uses receive_bytes()).
    const dataListener = term.onData((data) => {
      sessionManager.send(sessionId, encoder.encode(data));
    });

    const readAndPasteClipboard = () => {
      void (async () => {
        let text = "";
        try {
          const fromDesktop = await window.colorideDesktop?.readClipboardText?.();
          if (typeof fromDesktop === "string" && fromDesktop.length > 0) text = fromDesktop;
        } catch {
          // fall through
        }
        if (!text) {
          try {
            text = (await navigator.clipboard?.readText?.()) || "";
          } catch {
            text = "";
          }
        }
        if (text) pasteTextIntoPty(text);
      })();
    };

    // Cmd/Ctrl+V (and Shift+Insert) — navigator paste is unreliable in Electron.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      const mac = /Mac/.test(navigator.platform);
      const pasteMod = mac ? event.metaKey : event.ctrlKey;
      const copyMod = mac ? event.metaKey : event.ctrlKey;
      // Paste
      if ((pasteMod && !event.altKey && key === "v") || (event.shiftKey && key === "insert")) {
        event.preventDefault();
        event.stopPropagation();
        readAndPasteClipboard();
        return false;
      }
      // Copy selection with Cmd/Ctrl+C only when there is a selection (else send ^C).
      if (copyMod && !event.altKey && !event.shiftKey && key === "c") {
        const selection = term.getSelection();
        if (selection) {
          event.preventDefault();
          void writeTerminalSelectionToClipboard();
          return false;
        }
        if (mac) { event.preventDefault(); return false; }
      }
      if (event.ctrlKey && !event.metaKey && key === "c") term.clearSelection();
      return true;
    });

    // Browser paste event (right-click → Paste, or some OS paste routes).
    const onDomPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      event.preventDefault();
      event.stopPropagation();
      pasteTextIntoPty(text);
    };
    container.addEventListener("paste", onDomPaste, true);

    // Right-click Copy / Edit → Copy: attach Coloride terminal code-ref for agent chips.
    // Must stay synchronous so clipboardData.setData runs inside the copy event.
    const onDomCopy = (event: ClipboardEvent) => {
      const selection = term.getSelection();
      if (!selection || !event.clipboardData) return;
      const pos = term.getSelectionPosition?.() ?? null;
      const payload = terminalCodeRefFromSelection({
        text: selection,
        cwd: cwdRef.current,
        startRow: pos ? pos.start.y : null,
        endRow: pos ? pos.end.y : null,
      });
      if (!payload) return;
      try {
        event.clipboardData.setData("text/plain", payload.text);
        event.clipboardData.setData(
          "application/x-coloride-code-ref",
          serializeCodeRef(payload),
        );
        event.preventDefault();
        event.stopPropagation();
        // Also mirror to Electron custom format for paste reliability.
        void writeTerminalSelectionToClipboard();
      } catch {
        // let browser handle copy
      }
    };
    container.addEventListener("copy", onDomCopy, true);

    let copiedSelection = "";
    const selectionListener = term.onSelectionChange(() => {
      if (!appPreferencesRef.current.terminalCopyOnSelect) {
        copiedSelection = "";
        return;
      }
      const selection = term.getSelection();
      if (!selection || selection === copiedSelection) return;
      copiedSelection = selection;
      void writeTerminalSelectionToClipboard();
    });
    const resizeObserver = new ResizeObserver(() => fitAndSyncPty.current());
    resizeObserver.observe(container);

    let restoredPromptTimer: number | null = null;
    let restoredPromptPending = false;
    let receivedSessionOutput = false;
    let restoredPromptPlaced = false;

    const placeRestoredPromptMarker = () => {
      if (!restoredPromptPending || restoredPromptPlaced || disposed) return;
      restoredPromptPlaced = shellIntegration.ensurePromptMarker();
    };

    const connectSession = async () => {
      if (disposed || !connected) return;
      onStatusChangeRef.current?.("connecting");
      try {
        // Measure once in the shared frame before creating the PTY. Later
        // layout changes are observed, rather than guessed with delays.
        safeFit();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (disposed) return;

        const cols = clampTerminalSize(term.cols, 20, 400, 80);
        const rows = clampTerminalSize(term.rows, 5, 120, 24);
        try {
          term.resize(cols, rows);
        } catch {
          /* ignore */
        }
        const attachment = sessionManager.attach({
          cols,
          rows,
          cwd,
          sessionId,
          sessionName: getPersistentSessionName(sessionId, cwd),
          workspaceKind,
          connectionId,
          onData: (data) => new Promise<void>((resolve) => {
            if (disposed) { resolve(); return; }
            const finished = () => { pendingWrites.delete(finished); resolve(); };
            pendingWrites.add(finished);
            term.write(data, () => {
              if (!disposed) {
                receivedSessionOutput = true;
                placeRestoredPromptMarker();
              }
              finished();
            });
          }),
          onReset: (truncated) => {
            term.reset();
            shellIntegration.reset();
            if (truncated) term.writeln("\x1b[90m[Earlier terminal history was truncated]\x1b[0m");
          },
          onStatus: (status) => {
            if (!disposed) {
              term.options.disableStdin = status !== "ready";
              container.dataset.terminalStatus = status;
              onStatusChangeRef.current?.(status);
              // The prompt can arrive after the tab selection effect ran.
              // Claim focus only for the selected pane, so opening a fresh
              // terminal is immediately typeable without stealing a split.
              if (status === "ready" && activeRef.current && focusedRef.current) {
                requestAnimationFrame(() => {
                  if (!disposed && activeRef.current && focusedRef.current) term.focus();
                });
              }
            }
          },
        });
        detachManagedSession = attachment.detach;
        const id = await attachment.ready;

        if (disposed) {
          return;
        }
        termId = id;
        termIdRef.current = id;
        lastPtySizeRef.current = { cols, rows };
        // A persistent terminal replays its tmux/local scrollback over the
        // socket. Those old bytes no longer contain OSC 633 sequences, so
        // create the hollow marker from the restored prompt itself. Fresh
        // shells keep using their live ColoridePrompt event.
        if (sessionManager.wasRestored(sessionId)) {
          restoredPromptPending = true;
          if (receivedSessionOutput) {
            requestAnimationFrame(placeRestoredPromptMarker);
          } else {
            restoredPromptTimer = window.setTimeout(placeRestoredPromptMarker, 450);
          }
        }
        // Re-fit after the session exists — layout may have settled further.
        safeFit();
        onSessionCreatedRef.current?.(id);

        // Poll tmux for the foreground process so the tab can show what's
        // actually running (bash when idle, vim/node/etc while busy).
        const pollForeground = async () => {
          // Hidden tabs keep their PTY/WebSocket alive, but they do not need
          // a process/cwd query until they become visible again.
          if (disposed || !termId || !activeRef.current) return;
          try {
            const { foreground, cwd: currentCwd } = await api.terminalInfo(termId);
            if (!disposed && foreground) onForegroundRef.current?.(foreground);
            if (!disposed && currentCwd) onCwdRef.current?.(currentCwd);
          } catch {
            /* transient; keep the last known value */
          }
        };
        void pollForeground();
        pollTimer = setInterval(() => void pollForeground(), workspaceKind === "local" ? 4000 : 2000);
      } catch (error) {
        if (!disposed) {
          onStatusChangeRef.current?.("error");
          const detail = error instanceof Error ? error.message : String(error);
          term.writeln("\r\n\x1b[31mCould not start terminal.\x1b[0m");
          if (detail && detail.length < 240) {
            term.writeln(`\x1b[90m${detail}\x1b[0m`);
          }
        }
      }
    };

    if (!connected) {
      onStatusChangeRef.current?.("disconnected");
      term.writeln("\x1b[33mNot connected to a server.\x1b[0m");
      term.writeln("\x1b[90mConnect to a server to start the terminal.\x1b[0m");
    } else {
      void connectSession();
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(scrollFrame);
      for (const subscription of scrollSubscriptions) subscription.dispose();
      disposedRef.current = true;
      for (const finished of pendingWrites) finished();
      pendingWrites.clear();
      if (pollTimer) clearInterval(pollTimer);
      if (restoredPromptTimer) window.clearTimeout(restoredPromptTimer);
      if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current);
      fitFrameRef.current = null;
      // Drop fit handle first so late rAF / ResizeObserver cannot call FitAddon.
      fitRef.current = null;
      searchRef.current = null;
      container.removeEventListener("paste", onDomPaste, true);
      container.removeEventListener("copy", onDomCopy, true);
      wrappedUrlLinkProvider.dispose();
      fileLinkProvider.dispose();
      resizeObserver.disconnect();
      selectionListener.dispose();
      disposeRenderer();
      shellIntegration.dispose();
      if (shellIntegrationRef.current === shellIntegration) shellIntegrationRef.current = null;
      dataListener.dispose();
      detachManagedSession?.();
      if (sessionManagerRef.current === sessionManager) sessionManagerRef.current = null;
      termIdRef.current = null;
      lastPtySizeRef.current = null;
      termRef.current = null;
      try {
        disposeTerminalView(term);
      } catch {
        /* already disposed */
      }
    };
    // cwd changes while the shell runs (cd) must not recreate the session.
    // A workspace switch changes sessionId because TerminalPanel restores the
    // destination workspace's descriptors.
  }, [connected, connectionId, renderer, sessionId, workspaceId, workspaceKind]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = Math.max(8, appPreferences.codeFontSize + zoomOffsetRef.current);
    fitAndSyncPty.current();
  }, [appPreferences.codeFontSize]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = getCodeFontFamily(appPreferences.codeFontFamily);
    fitAndSyncPty.current();
  }, [appPreferences.codeFontFamily]);

  // Refresh cached cell metrics once the requested web font is available.
  useEffect(() => {
    const term = termRef.current;
    if (!term || !document.fonts) return;
    let cancelled = false;
    const family = getCodeFontFamily(appPreferences.codeFontFamily);
    const size = Math.max(8, appPreferences.codeFontSize + zoomOffsetRef.current);
    void Promise.all([
      document.fonts.load(`400 ${size}px ${family}`),
      document.fonts.load(`700 ${size}px ${family}`),
    ]).then(() => {
      if (cancelled || disposedRef.current || termRef.current !== term) return;
      // Changing this equivalent font stack triggers xterm's public option
      // measurement without resizing/reflowing the buffer twice.
      term.options.fontFamily = `${family}, monospace`;
      term.clearTextureAtlas();
      fitAndSyncPty.current();
    }).catch(() => {
      // Missing fonts retain the configured fallback stack.
    });
    return () => { cancelled = true; };
  }, [appPreferences.codeFontFamily, appPreferences.codeFontSize, connected, connectionId, sessionId, workspaceId, workspaceKind]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.cursorBlink = appPreferences.terminalCursorBlink;
    term.options.cursorStyle = appPreferences.terminalCursorStyle;
    term.options.macOptionIsMeta = appPreferences.terminalMacOptionIsMeta;
    term.options.minimumContrastRatio = appPreferences.terminalMinimumContrastRatio;
    term.options.scrollback = appPreferences.terminalScrollback;
    // Pixel-precision devices are switched to 0 by the wheel handler. Keep 0
    // here so changing settings never reintroduces queued trackpad animation.
    term.options.smoothScrollDuration = 0;
  }, [
    appPreferences.terminalCursorBlink,
    appPreferences.terminalCursorStyle,
    appPreferences.terminalMacOptionIsMeta,
    appPreferences.terminalMinimumContrastRatio,
    appPreferences.terminalScrollback,
    appPreferences.terminalSmoothScrolling,
  ]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = terminalTheme(resolvedTheme);
    syncViewportSurface(term, resolvedTheme);
    // xterm keeps the rendered canvas until its next paint. Repaint the
    // existing buffer so a live terminal changes background immediately too.
    try {
      term.clearTextureAtlas();
      if (term.rows > 0) term.refresh(0, term.rows - 1);
    } catch {
      // Terminal may be between dispose and HMR replacement.
    }
  }, [resolvedTheme]);

  // Becoming visible means we were likely hidden — refit + sync PTY cols so
  // long commands (www.coloride.com) wrap on the same line the user sees.
  // Do not focus here: multiple split panes are visible at the same time and
  // would otherwise continually steal keyboard focus from one another.
  useEffect(() => {
    if (!active) return;
    revealPaintRef.current = true;
    fitAndSyncPty.current();
  }, [active]);

  // Only the pane explicitly selected by the user may claim keyboard focus.
  useEffect(() => {
    if (!active || !focused) return;
    const raf = requestAnimationFrame(() => termRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [active, focused]);

  return (
    <div className="coloride-terminal vertical-scroll-surface relative h-full w-full bg-[#171717]">
      <div
        ref={containerRef}
        id={scrollControlsId}
        className="h-full w-full"
        data-terminal-surface="true"
        style={{ backgroundColor: "#171717" }}
        // Clicking a split pane must always move input to this xterm.
        onMouseDown={() => termRef.current?.focus()}
      />
      <VerticalScrollHairline controlsId={scrollControlsId} metrics={scrollMetrics} label="Terminal history scroll"
        onScrollTo={top => termRef.current?.scrollToLine(Math.round(top))}
        onWheelScroll={event => {
          const term = termRef.current;
          if (!term || !event.deltaY) return;
          const height = containerRef.current?.clientHeight ?? term.rows * 16;
          const lines = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2
            ? event.deltaY * term.rows : event.deltaY / Math.max(1, height / term.rows);
          term.scrollLines(Math.sign(lines) * Math.max(1, Math.round(Math.abs(lines))));
        }} />
    </div>
  );
});

function isLikelyFilePath(path: string) {
  const name = path.split("/").at(-1) ?? "";
  return name.includes(".") || ["README", "Makefile", "Dockerfile", "LICENSE"].includes(name);
}

/** Clamp xterm grid size to backend TermCreateRequest bounds. */
function clampTerminalSize(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Strip trailing junk CLIs sometimes print after a URL. */
function sanitizeTerminalUrl(raw: string): string {
  let url = String(raw || "").trim();
  // Soft-wrap artifacts: spaces/newlines inside the URL (Codex OAuth dumps).
  url = url.replace(/[\s\u0000-\u001f]+/g, "");
  // Trim common trailing punctuation from terminal prose.
  url = url.replace(/[),.;:'"\]]+$/g, "");
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    // Validate — reject garbage concatenations.
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

type WrappedHttpLink = {
  url: string;
  range: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
};

/**
 * Detect http(s) URLs that soft-wrap across terminal lines (OAuth authorize
 * URLs from Codex, device-flow dumps, etc.). Rebuilds the full URL and makes
 * the current line (start or continuation) clickable → embedded browser.
 */
function findWrappedHttpLinks(term: Terminal, bufferLineNumber: number): WrappedHttpLink[] {
  const buf = term.buffer.active;
  // xterm buffer lines are 0-based; provideLinks receives 1-based y.
  const y0 = bufferLineNumber - 1;
  if (y0 < 0 || y0 >= buf.length) return [];

  const lineText = (y: number) => buf.getLine(y)?.translateToString(true) ?? "";
  const trimLine = (y: number) => lineText(y).replace(/\s+$/, "");
  const results: WrappedHttpLink[] = [];

  // Walk upward to the line that starts the URL (contains https?://).
  let startY = y0;
  let startCol = -1;
  for (let look = 0; look < 40; look += 1) {
    const y = y0 - look;
    if (y < 0) break;
    const t = trimLine(y);
    const idx = t.search(/https?:\/\//i);
    if (idx >= 0) {
      // If this line starts a URL, it's the head — unless we're on a later
      // continuation of an earlier URL on the same visual block.
      startY = y;
      startCol = idx;
      break;
    }
    // Pure continuation lines have no scheme; keep scanning up.
    const cont = t.replace(/^\s+/, "");
    if (!cont || !isUrlContinuation(cont) || /^https?:\/\//i.test(cont)) break;
  }
  if (startCol < 0) return [];

  // Assemble full URL from startY forward.
  let assembled = "";
  let endY = startY;
  const maxExtra = 40;
  for (let step = 0; step < maxExtra; step += 1) {
    const y = startY + step;
    if (y >= buf.length) break;
    const trimmedRight = trimLine(y);
    if (y === startY) {
      assembled = trimmedRight.slice(startCol);
    } else {
      const cont = trimmedRight.replace(/^\s+/, "");
      if (!cont || !isUrlContinuation(cont) || /^https?:\/\//i.test(cont)) break;
      assembled += cont;
    }
    endY = y;
    const nextY = y + 1;
    if (nextY >= buf.length) break;
    const nextTrim = trimLine(nextY).replace(/^\s+/, "");
    if (!nextTrim || !isUrlContinuation(nextTrim) || /^https?:\/\//i.test(nextTrim)) break;
  }

  const url = sanitizeTerminalUrl(assembled);
  if (!url) return [];

  // Current line must be part of [startY, endY].
  if (y0 < startY || y0 > endY) return [];

  const current = trimLine(y0);
  if (!current.trim()) return [];

  // Highlight the URL segment on this row (full line for continuations,
  // from scheme onward on the start line).
  let rangeStartX = 1;
  let rangeEndX = Math.max(1, current.length);
  if (y0 === startY) {
    rangeStartX = startCol + 1;
    rangeEndX = Math.max(rangeStartX, current.length);
  } else {
    // Skip leading spaces on continuation rows.
    const lead = current.match(/^\s*/)?.[0].length ?? 0;
    rangeStartX = lead + 1;
    rangeEndX = Math.max(rangeStartX, current.length);
  }

  results.push({
    url,
    range: {
      start: { x: rangeStartX, y: bufferLineNumber },
      end: { x: rangeEndX, y: bufferLineNumber },
    },
  });
  return results;
}

/** Characters that validly continue a soft-wrapped http(s) URL. */
function isUrlContinuation(chunk: string): boolean {
  // Path/query/fragment + percent-encoding + common OAuth punctuation.
  return /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/.test(chunk);
}

/**
 * Build a remote tmux session name for this tab.
 * Backend allows [A-Za-z0-9_-]{1,80}. Must be unique per open tab so two
 * tabs never share a shell (tmux new-session -A reattaches on name match).
 * sessionKey is the primary identity (UUID from TerminalPanel); clientId
 * only namespaces this machine; cwd hash is intentionally NOT included so
 * two tabs in the same folder stay independent.
 */
function getPersistentSessionName(sessionKey: string | undefined, _cwd: string | null | undefined) {
  if (!sessionKey || typeof window === "undefined") return undefined;

  const clientStorageKey = "coloride-terminal-client-id";
  let clientId = window.localStorage.getItem(clientStorageKey);
  if (!clientId) {
    clientId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replaceAll("-", "")
        : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(clientStorageKey, clientId);
  }

  // Sanitize + cap: backend pattern is 1..80 alnum/_/-
  const raw = `${clientId.slice(0, 12)}_${sessionKey}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return raw || undefined;
}
