
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ensureCloudSessionAlive } from "../features/auth/cloudAuth";
import { LoginGate } from "../features/auth/LoginGate";
import { StartView } from "../features/start/StartView";
import { useCloudProductSync } from "../features/auth/useCloudProductSync";
import { applyBrowserProxy } from "../features/explorer/browserProxy";
import { ExplorerTab } from "../features/explorer/ExplorerTab";
import type { ServerSubTab } from "../features/server/ServerView";
import { useServerWorkspace } from "../features/server/useServerWorkspace";
import { recordAppActivity } from "../features/settings/activity";
import {
  readLastSession,
  writeLastSession,
} from "../features/settings/lastSession";
import { sendDesktopNotification } from "../features/settings/notifications";
import { NotificationViewport } from "../shared/ui/NotificationViewport";
import { dismissNotification, notify } from "../shared/ui/notifications";
import {
  applyResolvedThemeToDocument,
  getInterfaceFontFamily,
  useAppPreferences,
  useResolvedTheme,
} from "../features/settings/preferences";
import type { SettingsSection } from "../features/settings/SettingsView";
import {
  matchesShortcut,
  shortcutDefinitions,
  useShortcutBindings,
} from "../features/settings/shortcuts";
import { maybeCheckForUpdates } from "../features/settings/updates";
import { hydrateRuntimeFromDesktop } from "../shared/api/client";
import type { AgentTerminalReference } from "../shared/api/types";
import { AppAnimations } from "./shell/AppAnimations";
import { AppStatusBar } from "./shell/AppStatusBar";
import { DesktopTitleBar } from "./shell/DesktopTitleBar";
import {
  NAVIGATION_STORAGE_KEY,
  readStoredNavigation,
  sameLocation,
  tabRequiresVps,
  type NavigationLocation,
} from "./shell/navigationState";
import { PrimaryRail } from "./shell/PrimaryRail";
import { useAppMenuActions } from "./shell/useAppMenuActions";
import { useAppNavigationActions } from "./shell/useAppNavigationActions";
import { useAppNavigationState } from "./shell/useAppNavigationState";
import { useAppPanelResize } from "./shell/useAppPanelResize";
import { useAppPanelSizes } from "./shell/useAppPanelSizes";

import type { ExplorerEditorStatus } from "../features/explorer/ExplorerTab";
import {
  ONBOARDING_FLOW_ENABLED,
  OnboardingFlow,
} from "../features/onboarding/OnboardingFlow";
import { isWindowsDesktop } from "../shared/ui/WindowsWindowControls";

// Keep chat rendering and secondary views out of the initial editor bundle.
// Their loading boundaries must not suspend the workspace tree or editor.
const AgentView = lazy(() => import("./shell/AgentTabsHost").then(module => ({ default: module.AgentTabsHost })));
const SettingsView = lazy(() => import("../features/settings/SettingsView").then(module => ({ default: module.SettingsView })));
const loadServerView = () => import("../features/server/ServerView");
const ServerView = lazy(() => loadServerView().then(module => ({ default: module.ServerView })));

function explorerSidebarWorkspacePath(workspacePath: string): string {
  // Always the open project root. Using the selected file's parent made the
  // sidebar agent treat `app/page.tsx` as cwd `…/app`, then join `app/page.tsx`
  // again (`…/app/app/page.tsx`) until start failed on a missing folder.
  return workspacePath || "/home/coloride";
}

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");
const PANEL_SIZE_KEYS = [
  "tree-width",
  "server-width",
  "settings-width",
  "terminal-height",
  "agent-width",
] as const;
// This browser is deliberately not an Explorer tab. Reusing one native embed
// avoids creating a hidden Chromium view for every title-bar click.
const TITLE_BAR_BROWSER_TAB_ID = "coloride-title-bar-browser";
const ONBOARDING_STEP_KEY = "coloride.onboarding.step.v1";

const readOnboardingStep = () => {
  if (typeof window === "undefined") return "welcome";
  try {
    const step = window.localStorage.getItem(ONBOARDING_STEP_KEY);
    const last = readLastSession();
    if (step === "complete" || (last.profileId && last.workspacePath)) {
      window.localStorage.setItem(ONBOARDING_STEP_KEY, "complete");
      return "complete";
    }
    return step ?? "welcome";
  } catch {
    return "welcome";
  }
};

const readStoredPanelSize = (key: string, fallback: number) => {
  if (typeof window === "undefined") return fallback;
  const stored = Number(window.localStorage.getItem(`coloride.layout.${key}`));
  return Number.isFinite(stored) && stored > 0 ? stored : fallback;
};

export function App() {
  const isElectron =
    typeof window !== "undefined" &&
    (!!window.colorideDesktop ||
      navigator.userAgent.toLowerCase().includes("electron"));

  const appPreferences = useAppPreferences();
  const [onboardingStep, setOnboardingStep] = useState(readOnboardingStep);
  const shortcutBindings = useShortcutBindings();
  const workspace = useServerWorkspace();
  // Open-source builds do not register this machine or upload folder paths.
  // Sign-in and the managed agent keep their own Coloride API calls.
  useCloudProductSync(workspace.workspacePath);
  const resolvedTheme = useResolvedTheme();
  const openExternalBrowser = useCallback((url = "https://www.google.com") => {
    const target = url.trim() || "https://www.google.com";
    if (window.colorideDesktop?.openExternal && /^https:\/\//i.test(target)) {
      void window.colorideDesktop.openExternal(target);
      return;
    }
    window.open(target, "_blank", "noopener,noreferrer");
  }, []);
  const lastSessionRef = useRef(readLastSession());
  const hadOpenProject =
    appPreferences.startupBehavior === "restore-session" &&
    Boolean(lastSessionRef.current.workspacePath);
  const initialLocation: NavigationLocation = hadOpenProject
    ? readStoredNavigation({ activeTab: "explorer", serverSubTab: "health" })
    : { activeTab: null, serverSubTab: "health" };
  const {
    activeTab,
    setActiveTab,
    setServerSubTab,
    navigationRef,
    setNavigation,
    serverSubTab,
    navigation,
  } = useAppNavigationState({ initialLocation });
  const [sidePanelOpen, setSidePanelOpen] = useState(() =>
    appPreferences.startupBehavior === "restore-session"
      ? lastSessionRef.current.sidePanelOpen
      : true,
  );
  const {
    serverWidth,
    settingsWidth,
    treeWidth,
    setServerWidth,
    setSettingsWidth,
    setTreeWidth,
    agentPanelWidth,
    setAgentPanelWidth,
    terminalHeight,
    setTerminalHeight,
  } = useAppPanelSizes({
    appPreferences,
    readStoredPanelSize,
    PANEL_SIZE_KEYS,
  });
  const [terminalOpen, setTerminalOpen] = useState(() =>
    appPreferences.startupBehavior === "restore-session"
      ? lastSessionRef.current.terminalOpen
      : false,
  );
  const [terminalInitialized, setTerminalInitialized] = useState(
    () =>
      appPreferences.startupBehavior === "restore-session" &&
      lastSessionRef.current.terminalOpen,
  );
  const [terminalRequest, setTerminalRequest] = useState(0);
  const [agentTerminals, setAgentTerminals] = useState<
    AgentTerminalReference[]
  >([]);
  const [drawerView, setDrawerView] = useState<"terminal" | "problems">(
    () => appPreferences.startupBehavior === "restore-session" ? lastSessionRef.current.drawerView : "terminal",
  );
  /** Agent chat docked on the right inside Explorer. */
  const [explorerAgentOpen, setExplorerAgentOpen] = useState(() =>
    appPreferences.startupBehavior === "restore-session"
      ? lastSessionRef.current.rightPanelOpen
      : true,
  );
  const agentWorkspaceResolverRef = useRef<
    ((path: string | null) => void) | null
  >(null);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>(() => {
      try { return (localStorage.getItem("coloride.settings.section.v1") || "general") as SettingsSection; }
      catch { return "general"; }
    });
  const [editorStatus, setEditorStatus] = useState<ExplorerEditorStatus | null>(
    null,
  );
  const [localFolderOpening, setLocalFolderOpening] = useState(false);

  const serverConnected = workspace.connectionState === "connected";
  const sshConnected = serverConnected && workspace.workspaceKind === "ssh";
  const localWorkspaceOpen =
    serverConnected && workspace.workspaceKind === "local";
  const browserAvailable = sshConnected || localWorkspaceOpen;
  const workspaceReady = serverConnected && Boolean(workspace.workspacePath);
  const workspaceSelectionRequired =
    serverConnected && !workspace.workspacePath;
  const sidePanelAvailable =
    activeTab === "explorer" ||
    activeTab === "server" ||
    activeTab === "agents" ||
    activeTab === "settings";
  const terminalVisible = terminalOpen && activeTab === "explorer";
  const workspaceReadyRef = useRef(workspaceReady);
  const serverConnectedRef = useRef(serverConnected);
  serverConnectedRef.current = serverConnected;
  const workspaceKindRef = useRef(workspace.workspaceKind);
  workspaceKindRef.current = workspace.workspaceKind;
  const navigationPersistenceReadyRef = useRef(false);
  const previousConnectionStateRef = useRef(workspace.connectionState);
  /** True after the user clicks Connect / a saved server — not boot auto-reconnect. */
  const userConnectIntentRef = useRef(false);
  /** Rising edge only — do not re-open the picker / kick Welcome on every tab click. */
  const workspaceSelectionPromptedRef = useRef(false);
  /** Bumped when the user clicks a saved VPS so we can enter an already-live session. */
  const [connectIntentNonce] = useState(0);
  void connectIntentNonce;



  const showLocalModeNotice = useCallback((message: string) => {
    if (!message) {
      dismissNotification("local-mode");
      return;
    }
    notify({ id: "local-mode", kind: "warning", title: "Workspace notice", description: message });
  }, []);

  /** Protected tabs stay gray in the rail; no shake/modal — just ignore. */
  const denyProtectedTab = useCallback(
    (_tab: "explorer" | "server" | "agents") => {
      // no-op
    },
    [],
  );

  const openRemoteFilePicker = useCallback((_folderOnly = false) => {
    void window.colorideDesktop?.openFolder();
  }, []);

  const openAgentWorkspacePicker = useCallback((): Promise<string | null> => {
    agentWorkspaceResolverRef.current?.(null);
    return window.colorideDesktop?.openFolder() ?? Promise.resolve(null);
  }, []);

  const closeRemoteFilePicker = useCallback(() => {
    agentWorkspaceResolverRef.current?.(null);
    agentWorkspaceResolverRef.current = null;
  }, []);

  const { resetToWelcome, navigateTo, goBack, goForward } =
    useAppNavigationActions({
      setActiveTab,
      setServerSubTab,
      navigationRef,
      setNavigation,
      workspace,
      showLocalModeNotice,
      tabRequiresVps,
      serverConnectedRef,
      denyProtectedTab,
      sameLocation,
      activeTab,
      serverSubTab,
    });
  const openLocalFolderPicker = useCallback(
    async (options?: { revealExplorer?: boolean }) => {
      if (localFolderOpening) return;
      setLocalFolderOpening(true);
      dismissNotification("local-mode");
      dismissNotification("open-local-folder");
      workspace.setShowConnectModal(false);
      try {
        const path = await window.colorideDesktop?.openFolder();
        if (!path) return;
        await workspace.openLocalWorkspace(path);
        // Local folders are a connected workspace, not a VPS session.
        serverConnectedRef.current = true;
        if (options?.revealExplorer !== false) {
          navigateTo({ activeTab: "explorer", serverSubTab: "health" });
        }
      } catch (error) {
        notify({
          id: "open-local-folder", kind: "error", title: "Unable to open folder",
          description: error instanceof Error ? error.message : "Unable to open this local folder.",
        });
      } finally {
        setLocalFolderOpening(false);
      }
    },
    [localFolderOpening, navigateTo, workspace],
  );

  const openRecentLocalWorkspace = async (path: string) => {
    if (localFolderOpening) return;
    setLocalFolderOpening(true);
    dismissNotification("open-local-folder");
    dismissNotification("local-mode");
    try {
      const opened = await workspace.openLocalWorkspace(path);
      if (!opened) return;
      // Match Open Project: navigation runs before React commits connection state.
      serverConnectedRef.current = true;
      navigateTo({ activeTab: "explorer", serverSubTab: "health" });
    } catch (error) {
      notify({
        id: "open-local-folder", kind: "error", title: "Unable to open folder",
        description: error instanceof Error ? error.message : "Unable to open this recent project.",
      });
    } finally {
      setLocalFolderOpening(false);
    }
  };

  /** Opens Coloride Browser in its own native window, never in the Monaco pane. */
  const openColorideBrowser = useCallback(() => {
    if (!serverConnectedRef.current) {
      denyProtectedTab("explorer");
      return;
    }

    const browserEmbed = window.colorideDesktop?.browserEmbed;
    if (!browserEmbed?.popOut) return;

    void (async () => {
      try {
        // Local = this computer (direct). SSH = VPS via SOCKS.
        await applyBrowserProxy(workspaceKindRef.current);
        await browserEmbed.popOut({
          tabId: TITLE_BAR_BROWSER_TAB_ID,
          url: "https://www.google.com",
          title: "Google",
        });
      } catch (error) {
        console.error("[coloride] failed to open browser window", error);
      }
    })();
  }, [denyProtectedTab]);

  // After the user connects (list or modal) and a workspace is ready → Explorer.
  // Also covers clicking the same saved VPS while SSH is already up.
  useEffect(() => {
    const becameReady = !workspaceReadyRef.current && workspaceReady;
    workspaceReadyRef.current = workspaceReady;
    if (!userConnectIntentRef.current) return;
    if (!becameReady && !connectIntentNonce) return;
    if (!workspaceReady) return;
    userConnectIntentRef.current = false;
    workspace.setShowConnectModal(false);
    closeRemoteFilePicker();
    navigateTo({ activeTab: "explorer", serverSubTab: "health" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to ready + explicit re-click
  }, [closeRemoteFilePicker, connectIntentNonce, navigateTo, workspaceReady]);

  // Keep the embed's proxy in sync when switching local folder ↔ SSH.
  useEffect(() => {
    if (!serverConnected) return;
    void applyBrowserProxy(workspace.workspaceKind);
  }, [serverConnected, workspace.workspaceKind]);

  // If a live SSH session actually drops while on Explorer/Server → Welcome.
  // Do not kick during connecting, boot restore, or a first click before the
  // sidecar reports connected — that was bouncing back to Welcome after 1–2s.
  const lastProtectedConnectionRef = useRef(workspace.connectionState);
  useEffect(() => {
    const previous = lastProtectedConnectionRef.current;
    const current = workspace.connectionState;
    lastProtectedConnectionRef.current = current;
    if (current === "connected" || current === "connecting") return;
    if (!tabRequiresVps(activeTab)) return;
    if (previous !== "connected") return;
    resetToWelcome();
    setTerminalOpen(false);
    setTerminalInitialized(false);
  }, [activeTab, resetToWelcome, workspace.connectionState]);

  // Detect website logout / revoked tokens — only after the app has settled.
  // Never wipe login on transient network / sidecar boot races.
  useEffect(() => {
    let cancelled = false;
    const verify = () => {
      void ensureCloudSessionAlive().then((alive) => {
        if (cancelled || alive) return;
        // LoginGate already flipped. Do not also reset the VPS tab — a
        // transient cloud check must not bounce Explorer/Server to Welcome.
      });
    };
    // Delay first check so bootstrapCloudAuth + sidecar can finish first.
    const bootTimer = window.setTimeout(verify, 12_000);
    const interval = window.setInterval(verify, 60_000);
    const onFocus = () => verify();
    const onVis = () => {
      if (document.visibilityState === "visible") verify();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearTimeout(bootTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [resetToWelcome]);

  useEffect(() => {
    void hydrateRuntimeFromDesktop().catch(() => {});
    recordAppActivity(appPreferences.recordLocalActivity);
  }, [appPreferences.recordLocalActivity]);

  useEffect(() => {
    if (!appPreferences.checkForUpdatesAutomatically) return;
    void maybeCheckForUpdates(appPreferences.updateChannel);
  }, [
    appPreferences.checkForUpdatesAutomatically,
    appPreferences.updateChannel,
  ]);

  useEffect(() => {
    if (!navigationPersistenceReadyRef.current) {
      navigationPersistenceReadyRef.current = true;
      return;
    }
    window.localStorage.setItem(
      NAVIGATION_STORAGE_KEY,
      JSON.stringify({ activeTab, serverSubTab }),
    );
    writeLastSession({
      activeTab,
      serverSubTab,
      sidePanelOpen,
      rightPanelOpen: explorerAgentOpen,
      terminalOpen,
      drawerView,
    });
  }, [activeTab, serverSubTab, sidePanelOpen, explorerAgentOpen, terminalOpen, drawerView]);

  useEffect(() => {
    const previous = previousConnectionStateRef.current;
    const current = workspace.connectionState;
    previousConnectionStateRef.current = current;
    if (!appPreferences.notifyConnectionChanges || previous === current) return;

    if (current === "connected") {
      sendDesktopNotification(
        "VPS connected",
        workspace.serverName || workspace.host || "Server is ready",
      );
    } else if (current === "failed") {
      sendDesktopNotification(
        "VPS connection lost",
        workspace.explorerError || "The server is no longer available.",
      );
    } else if (current === "idle" && previous === "connected") {
      sendDesktopNotification(
        "VPS disconnected",
        workspace.serverName || workspace.host || "The connection was closed.",
      );
    }
  }, [
    appPreferences.notifyConnectionChanges,
    workspace.connectionState,
    workspace.explorerError,
    workspace.host,
    workspace.serverName,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    document.body.classList.toggle("electron-frameless", isElectron);
    return () => document.body.classList.remove("electron-frameless");
  }, [isElectron]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const pointerOn = Boolean(appPreferences.pointerCursors);

    body.dataset.motion = appPreferences.motionPreference;
    body.dataset.fontSmoothing = String(appPreferences.fontSmoothing);
    // Login chrome owns dark while the gate is up. After that, restore saved theme
    // so the editor and shell cannot stay split (white Monaco + dark chrome).
    if (
      !html.classList.contains("login-gate-active") &&
      !body.classList.contains("login-gate-active")
    ) {
      applyResolvedThemeToDocument();
    }
    html.style.setProperty("--accent-color", appPreferences.accentColor);
    html.style.setProperty(
      "--font-sans",
      getInterfaceFontFamily(appPreferences.interfaceFontFamily),
    );
    html.style.setProperty(
      "--interface-font-size",
      `${appPreferences.interfaceFontSize}px`,
    );
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        resolvedTheme === "light" ? "#ffffff" : "#171717",
      );

    // Keep Electron's native plate + traffic lights in sync with light/dark chrome.
    // A dark #171717 plate under light UI has been seen to hide macOS buttons after
    // text selection ends (compositor thrash on titleBarStyle:hidden).
    if (isElectron) {
      void window.colorideDesktop?.setWindowBackdrop?.("opaque", {
        appearance: resolvedTheme === "light" ? "light" : "dark",
      });
      void window.colorideDesktop?.ensureTrafficLights?.();
    }

    // Pointer cursors: class + data-attr on html and body so CSS cannot miss it
    // after a restart / HMR, and so login-gate theme rewrites cannot drop it.
    const applyPointer = (el: HTMLElement) => {
      el.dataset.pointerCursors = pointerOn ? "true" : "false";
      el.classList.toggle("pointer-cursors-on", pointerOn);
      el.classList.toggle("pointer-cursors-off", !pointerOn);
    };
    applyPointer(html);
    applyPointer(body);

    // Clear a stuck panel/terminal resize cursor left over from a lost mouseup.
    if (
      !body.classList.contains("is-resizing-panel") &&
      !body.classList.contains("is-resizing-terminal")
    ) {
      body.style.removeProperty("cursor");
      body.style.removeProperty("user-select");
    }
  }, [
    appPreferences.accentColor,
    appPreferences.fontSmoothing,
    appPreferences.interfaceFontFamily,
    appPreferences.interfaceFontSize,
    appPreferences.motionPreference,
    appPreferences.pointerCursors,
    isElectron,
    resolvedTheme,
  ]);

  // After text selection ends, macOS traffic lights can vanish in light mode.
  // Re-assert on mouseup / selection collapse (debounced).
  useEffect(() => {
    if (!isElectron || typeof document === "undefined") return;
    let timer: number | null = null;
    const kick = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void window.colorideDesktop?.ensureTrafficLights?.();
      }, 40);
    };
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) kick();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("mouseup", kick);
    window.addEventListener("blur", kick);
    window.addEventListener("focus", kick);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("mouseup", kick);
      window.removeEventListener("blur", kick);
      window.removeEventListener("focus", kick);
    };
  }, [isElectron]);

  useEffect(() => {
    window.colorideDesktop?.setKeyboardShortcuts(shortcutBindings);
  }, [shortcutBindings]);

  useEffect(() => {
    const recents = [
      ...workspace.localRecentWorkspaces.map((item) => ({
        id: `local:${item.path}`,
        label: item.name,
      })),
    ].slice(0, 8);
    window.colorideDesktop?.setMenuRecents?.(recents);
  }, [workspace.localRecentWorkspaces, workspace.savedProfiles]);

  const ensureTerminalOpen = () => {
    if (!workspaceReady) {
      void openLocalFolderPicker({ revealExplorer: false });
      return false;
    }
    navigateTo({ activeTab: "explorer", serverSubTab });
    if (!terminalInitialized) setTerminalInitialized(true);
    setTerminalOpen(true);
    return true;
  };

  useEffect(() => {
    const reveal = (event: Event) => {
      const terminal = (event as CustomEvent<AgentTerminalReference>).detail;
      if (
        terminal.workspaceKind !== workspace.workspaceKind ||
        terminal.workspacePath !== workspace.workspacePath
      )
        return;
      if (
        terminal.workspaceKind === "ssh" &&
        terminal.connectionId !== workspace.activeProfileId
      )
        return;
      setAgentTerminals((current) => [
        ...current.filter((item) => item.sessionId !== terminal.sessionId),
        terminal,
      ]);
      setTerminalInitialized(true);
      setTerminalOpen(true);
      setDrawerView("terminal");
    };
    window.addEventListener("coloride:agent-terminal", reveal);
    return () => window.removeEventListener("coloride:agent-terminal", reveal);
  }, [
    workspace.workspaceKind,
    workspace.workspacePath,
    workspace.activeProfileId,
  ]);

  const handleNewTerminal = () => {
    const wasInitialized = terminalInitialized;
    if (!ensureTerminalOpen()) return;
    setDrawerView("terminal");
    // First open creates the default tab via init; further calls request another tab.
    if (wasInitialized) {
      setTerminalRequest((current) => current + 1);
    }
  };

  const handleToggleTerminal = () => {
    if (terminalVisible) {
      setTerminalOpen(false);
      return;
    }
    setDrawerView("terminal");
    void ensureTerminalOpen();
  };

  useEffect(() => {
    const onToggleProblems = () => {
      if (!workspaceReady) {
        void openLocalFolderPicker({ revealExplorer: false });
        return;
      }
      navigateTo({ activeTab: "explorer", serverSubTab });
      if (!terminalInitialized) setTerminalInitialized(true);
      setTerminalOpen(true);
      setDrawerView((current) =>
        terminalOpen && current === "problems" ? "terminal" : "problems",
      );
    };
    window.addEventListener("coloride:toggle-problems", onToggleProblems);
    return () =>
      window.removeEventListener("coloride:toggle-problems", onToggleProblems);
  }, [
    navigateTo,
    openLocalFolderPicker,
    serverSubTab,
    terminalInitialized,
    terminalOpen,
    workspace.workspaceKind,
    workspaceReady,
  ]);

  useEffect(() => {
    if (!workspaceSelectionRequired) {
      workspaceSelectionPromptedRef.current = false;
      return;
    }
    // navigateTo is recreated on every tab change. Only react the first time
    // we are connected without a folder — otherwise the first Server click
    // lands, then this effect kicks back to Welcome.
    if (workspaceSelectionPromptedRef.current) return;
    workspaceSelectionPromptedRef.current = true;
    setTerminalOpen(false);
    setTerminalInitialized(false);
    void openLocalFolderPicker({ revealExplorer: false });
    // Stay on Server / Agents / Settings if the user already went there.
    // Only continue into Explorer when they just connected from Welcome.
    if (userConnectIntentRef.current) {
      userConnectIntentRef.current = false;
      navigateTo({ activeTab: "explorer", serverSubTab: "health" });
    }
  }, [navigateTo, openLocalFolderPicker, workspaceSelectionRequired]);

  useEffect(() => {
    if (!workspace.showConnectModal) return;
    closeRemoteFilePicker();
  }, [closeRemoteFilePicker, workspace.showConnectModal]);

  useEffect(() => {
    if (workspace.connectionState !== "failed") return;
    closeRemoteFilePicker();
    setTerminalOpen(false);
    setTerminalInitialized(false);
    if (tabRequiresVps(activeTab)) {
      resetToWelcome();
    }
  }, [
    activeTab,
    closeRemoteFilePicker,
    resetToWelcome,
    workspace.connectionState,
  ]);

  useEffect(() => {
    if (!sshConnected || !workspace.host || !workspace.username) return;
    const connectionKey = `${workspace.username}@${workspace.host}:${workspace.port}`;
    void loadServerView().then(module => module.prefetchServerDashboard(connectionKey)).catch(() => {});
  }, [sshConnected, workspace.host, workspace.port, workspace.username]);

  const { startPanelResize, startAgentPanelResize, startTerminalResize } =
    useAppPanelResize({
      activeTab,
      serverWidth,
      settingsWidth,
      treeWidth,
      setServerWidth,
      setSettingsWidth,
      setTreeWidth,
      agentPanelWidth,
      setAgentPanelWidth,
      terminalHeight,
      setTerminalHeight,
    });
  const openSettings = useCallback((section?: string) => {
    const known = new Set(["general", "appearance", "shortcuts", "editor", "terminal", "agent", "external-agents", "providers", "security", "updates", "diagnostics", "about"]);
    const requested = section === "account" ? "general" : section;
    const next = requested && known.has(requested) ? requested as SettingsSection : undefined;
    if (window.colorideDesktop?.openSettings) {
      void window.colorideDesktop.openSettings(next);
      return;
    }
    setSettingsSection(next || "general");
    navigateTo({ activeTab: "settings", serverSubTab });
  }, [navigateTo, serverSubTab]);

  const handleSelectTab = (tab: string) => {
    if (tab === "server" && workspace.workspaceKind === "local") {
      showLocalModeNotice("Server is only available for SSH workspaces.");
      return;
    }
    // Always read the live ref — avoids stale closures on rapid clicks at boot.
    if (tabRequiresVps(tab) && !serverConnectedRef.current) {
      denyProtectedTab(
        tab === "server" ? "server" : tab === "agents" ? "agents" : "explorer",
      );
      return;
    }
    if (tab === "settings") {
      openSettings();
      return;
    }
    navigateTo({ activeTab: tab, serverSubTab });
  };

  const handleOpenSettings = () => openSettings();

  const handleServerSubTabChange = (tab: ServerSubTab) => {
    navigateTo({ activeTab: "server", serverSubTab: tab });
  };

  useEffect(() => {
    const onOpenSettings = (event: Event) => {
      const section = (event as CustomEvent<{ section?: string }>).detail?.section;
      openSettings(section && section.trim() ? section : undefined);
    };
    const onOpenLogs = () => {
      if (!serverConnectedRef.current || workspace.workspaceKind === "local") {
        openSettings("diagnostics");
        return;
      }
      navigateTo({ activeTab: "server", serverSubTab: "logs" });
    };
    window.addEventListener("coloride:open-settings", onOpenSettings);
    window.addEventListener("coloride:open-server-logs", onOpenLogs);
    return () => {
      window.removeEventListener("coloride:open-settings", onOpenSettings);
      window.removeEventListener("coloride:open-server-logs", onOpenLogs);
    };
  }, [navigateTo, openSettings, serverSubTab, workspace.workspaceKind]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      if (
        (event.target as Element | null)?.closest?.(
          '[data-shortcut-recorder="true"]',
        )
      )
        return;

      const definition = shortcutDefinitions.find((candidate) =>
        matchesShortcut(event, shortcutBindings[candidate.id]),
      );
      if (!definition) return;
      if (definition.id === "editor.toggle-problems") {
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(new CustomEvent("coloride:toggle-problems"));
        return;
      }
      if (definition.category === "Editor") return;

      event.preventDefault();
      event.stopPropagation();

      switch (definition.id) {
        case "navigation.back":
          goBack();
          break;
        case "navigation.forward":
          goForward();
          break;
        case "navigation.explorer":
          handleSelectTab("explorer");
          break;
        case "navigation.server":
          handleSelectTab("server");
          break;
        case "navigation.settings":
          handleSelectTab("settings");
          break;
        case "layout.toggle-sidebar":
          if (sidePanelAvailable) setSidePanelOpen((current) => !current);
          break;
        case "files.open-browser":
          void openLocalFolderPicker();
          break;
        case "files.new-file":
          navigateTo({ activeTab: "explorer", serverSubTab });
          workspace.handleNewFile();
          break;
        case "files.new-folder":
          if (!workspaceReady) {
            void openLocalFolderPicker();
          } else {
            navigateTo({ activeTab: "explorer", serverSubTab });
            void workspace.handleNewFolder();
          }
          break;
        case "files.save":
          if (
            activeTab === "explorer" &&
            workspace.selectedFile &&
            !workspace.editorReadOnly
          ) {
            void workspace.saveSelectedFile();
          }
          break;
        case "files.save-all":
          void workspace.saveAllFiles();
          break;
        case "files.close-editor":
          if (workspace.selectedFile)
            workspace.closeEditorFile(workspace.selectedFile);
          break;
        case "terminal.new":
          handleNewTerminal();
          break;
        case "terminal.toggle":
          handleToggleTerminal();
          break;
        case "terminal.clear":
          if (ensureTerminalOpen()) {
            window.dispatchEvent(
              new CustomEvent("coloride:terminal-command", { detail: "clear" }),
            );
          }
          break;
        case "terminal.close":
          window.dispatchEvent(
            new CustomEvent("coloride:terminal-command", { detail: "close" }),
          );
          break;
        case "agents.new-task":
          if (!serverConnected) {
            denyProtectedTab("agents");
            break;
          }
          if (activeTab === "explorer") setExplorerAgentOpen(true);
          else navigateTo({ activeTab: "agents", serverSubTab });
          window.dispatchEvent(new CustomEvent("coloride:new-agent-task"));
          break;
      }
    };

    window.addEventListener("keydown", onShortcut, true);
    return () => window.removeEventListener("keydown", onShortcut, true);
  }, [
    activeTab,
    denyProtectedTab,
    ensureTerminalOpen,
    goBack,
    goForward,
    handleNewTerminal,
    handleToggleTerminal,
    navigateTo,
    openLocalFolderPicker,
    serverConnected,
    serverSubTab,
    shortcutBindings,
    sidePanelAvailable,
    workspace,
    workspaceReady,
  ]);

  // Full-bleed shell — macOS uses native window chrome (traffic lights); OS owns corners.
  const electronShellClass = isElectron
    ? "p-0 overflow-hidden"
    : "p-[18px] max-[820px]:p-2";

  useAppMenuActions({
    goBack,
    goForward,
    setExplorerAgentOpen,
    sidePanelOpen,
    explorerAgentOpen,
    terminalOpen,
    setSidePanelOpen,
    ensureTerminalOpen,
    setTerminalOpen,
    navigateTo,
    appPreferences,
    openSettings,
    serverSubTab,
    serverConnected,
    denyProtectedTab,
    activeTab,
    sidePanelAvailable,
    handleToggleTerminal,
    workspace,
    openLocalFolderPicker,
    showLocalModeNotice,
    openRemoteFilePicker,
    handleSelectTab,
    handleNewTerminal,
    resetToWelcome,
    terminalInitialized,
    workspaceReady,
  });
  return (
    <LoginGate allowLocal>
      {ONBOARDING_FLOW_ENABLED && onboardingStep !== "complete" ? (
        <OnboardingFlow
          onComplete={() => {
            try {
              window.localStorage.setItem(ONBOARDING_STEP_KEY, "complete");
            } catch {
              // A private-storage browser can still continue for this runtime.
            }
            setOnboardingStep("complete");
          }}
        />
      ) : null}
      <main
        className={cx(
          "app-canvas fixed inset-0 flex bg-[#171717]",
          electronShellClass,
        )}
        style={
          isElectron && isWindowsDesktop()
            ? ({ ["--win-chrome-radius"]: "0px" } as CSSProperties)
            : undefined
        }
      >
        <section
          className={cx(
            "app-canvas flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#171717] [-webkit-app-region:no-drag]",
            activeTab === null && "app-start-surface",
            isElectron
              ? "border-0 shadow-none"
              : "rounded-xl border border-white/10 shadow-[0_24px_60px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.03)]",
          )}
          aria-label="Coloride desktop app"
        >
          <DesktopTitleBar
            accountActive={activeTab === "settings"}
            browserAvailable={browserAvailable}
            browserLocal={localWorkspaceOpen}
            canGoBack={navigation.index > 0}
            canGoForward={navigation.index < navigation.entries.length - 1}
            isElectron={isElectron}
            onGoBack={goBack}
            onGoForward={goForward}
            onOpenSettings={handleOpenSettings}
            onOpenBrowser={openColorideBrowser}
            onToggleRightPanel={() =>
              setExplorerAgentOpen((current) => !current)
            }
            onToggleSidePanel={() => setSidePanelOpen((current) => !current)}
            onToggleTerminal={handleToggleTerminal}
            rightPanelAvailable={activeTab === "explorer" && serverConnected}
            rightPanelOpen={explorerAgentOpen}
            sidePanelAvailable={sidePanelAvailable}
            sidePanelOpen={sidePanelOpen}
            terminalAvailable={workspaceReady}
            terminalOpen={terminalVisible}
          />

          <div className="app-workspace-region flex flex-1 min-h-0">
            {activeTab !== null ? (
            <PrimaryRail
              activeTab={activeTab}
              onSelectTab={handleSelectTab}
              serverConnected={serverConnected}
            />
            ) : null}

            <div className="app-canvas flex-1 flex flex-col min-h-0 min-w-0 bg-[#171717] overflow-hidden">
              <div className="relative flex-1 min-h-0 overflow-hidden">
                {/*
                Explorer + Agents stay mounted while connected so terminal PTYs,
                browser embeds, composer drafts, and scroll survive tab switches.
                Server/Settings/Welcome still use the shared enter/exit animation.
              */}
                {/*
                Agents tab and Explorer sidebar are separate chats. Agents can
                work across the VPS; Explorer stays inside the open workspace.
              */}
                {serverConnected && (
                  <div
                    aria-hidden={
                      activeTab !== "explorer" && activeTab !== "agents"
                    }
                    className={`absolute inset-0 flex min-h-0 ${
                      activeTab === "explorer" || activeTab === "agents"
                        ? "z-[1] visible"
                        : "z-0 invisible pointer-events-none"
                    }`}
                  >
                    <div
                      aria-hidden={activeTab !== "explorer"}
                      className={`h-full min-h-0 min-w-0 ${
                        activeTab === "explorer"
                          ? "flex-1"
                          : "pointer-events-none absolute inset-0 opacity-0"
                      }`}
                    >
                      <ExplorerTab
                        active={activeTab === "explorer"}
                        connected={workspaceReady}
                        onEditorStatus={setEditorStatus}
                        onResizeStart={startPanelResize}
                        onTerminalClose={() => {
                          setTerminalOpen(false);
                          setTerminalInitialized(false);
                        }}
                        onOpenExternalBrowser={openExternalBrowser}
                        onTerminalResizeStart={startTerminalResize}
                        terminalHeight={terminalHeight}
                        terminalInitialized={terminalInitialized}
                        terminalOpen={terminalOpen}
                        agentTerminals={agentTerminals}
                        onAgentTerminalClose={(sessionId) => {
                          setAgentTerminals((current) =>
                            current.filter(
                              (item) => item.sessionId !== sessionId,
                            ),
                          );
                        }}
                        terminalRequest={terminalRequest}
                        drawerView={drawerView}
                        onDrawerViewChange={setDrawerView}
                        theme={resolvedTheme}
                        treeWidth={treeWidth}
                        sidePanelOpen={sidePanelOpen}
                        workspace={workspace}
                      />
                    </div>

                    {/* Dock outer width animates; inner width stays fixed so UI doesn’t squash. */}
                    <div
                      aria-hidden={
                        activeTab !== "agents" &&
                        !(activeTab === "explorer" && explorerAgentOpen)
                      }
                      className={
                        activeTab === "agents"
                          ? "h-full min-h-0 min-w-0 flex-1"
                          : `explorer-agent-dock relative h-full min-h-0 shrink-0 overflow-hidden ${
                              activeTab === "explorer" && explorerAgentOpen
                                ? "is-open"
                                : "is-closed pointer-events-none"
                            }`
                      }
                      style={
                        activeTab === "explorer"
                          ? { width: explorerAgentOpen ? agentPanelWidth : 0 }
                          : undefined
                      }
                    >
                      <div
                        className={
                          activeTab === "explorer"
                            ? "explorer-agent-dock-inner flex h-full min-h-0"
                            : "h-full min-h-0 w-full"
                        }
                        style={
                          activeTab === "explorer"
                            ? { width: agentPanelWidth }
                            : undefined
                        }
                      >
                        {activeTab === "explorer" ? (
                          <div
                            aria-hidden="true"
                            className="app-split-seam explorer-agent-dock-seam relative z-10 w-px flex-shrink-0 self-stretch"
                          >
                            <div
                              className="absolute inset-y-0 -left-1.5 z-20 w-3 cursor-ew-resize"
                              onMouseDown={startAgentPanelResize}
                              title="Drag to resize agent"
                            />
                          </div>
                        ) : null}
                        <div className="h-full min-h-0 min-w-0 flex-1">
                          <Suspense fallback={null}>
                            <AgentView
                              active={
                                activeTab === "agents" ||
                                (activeTab === "explorer" && explorerAgentOpen)
                              }
                              onApplyAgentFileStream={
                                workspace.applyAgentFileStream
                              }
                              onCloseSidebar={() => setExplorerAgentOpen(false)}
                              onOpenExplorerFile={(path, options) => {
                                void workspace.openRemoteFile(path, options);
                              }}
                              onOpenAgentLogDump={(fileName, content) => {
                                workspace.openAgentLogDump(fileName, content);
                              }}
                              onResizeStart={startPanelResize}
                              onBrowseWorkspace={async () => {
                                // profile id is the transport authority; workspaceKind
                                // can briefly be stale while reconnect/HMR settles.
                                if (workspace.activeProfileId === "local") {
                                  return (
                                    (await window.colorideDesktop?.openFolder()) ??
                                    null
                                  );
                                }
                                return openAgentWorkspacePicker();
                              }}
                              onPrepareWorkspace={async (path) => {
                                // Sidebar and Agents are two presentations of the same
                                // full agent. Workspace authorization belongs to the
                                // session/backend, never to the surface that opened it.
                                return path;
                              }}
                              presentation={
                                activeTab === "explorer" ? "sidebar" : "full"
                              }
                              sessionPane="agent"
                              filesystemScope={
                                workspace.activeProfileId === "local"
                                  ? "workspace"
                                  : "server"
                              }
                              serverName={workspace.serverName}
                              sidePanelOpen={
                                activeTab === "agents" && sidePanelOpen
                              }
                              sidePanelWidth={treeWidth}
                              workspaceKind={
                                workspace.activeProfileId === "local"
                                  ? "local"
                                  : "ssh"
                              }
                              connectionId={workspace.activeProfileId}
                              connected={
                                workspace.activeProfileId === "local"
                                  ? workspaceReady
                                  : serverConnected
                              }
                              // The agent owns a per-chat workspace, but its terminal
                              // must begin in the project currently open in Coloride.
                              // `/home/coloride` is only the SSH user's home, never a
                              // meaningful project default.
                              workspacePath={explorerSidebarWorkspacePath(
                                workspace.workspacePath,
                              )}
                            />
                          </Suspense>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab !== "agents" && activeTab !== "explorer" && (
                  <div
                    key={activeTab ?? "start"}
                    className="relative z-[2] h-full min-h-0"
                  >
                    {activeTab === null && (
                      <StartView
                        localFolderOpening={localFolderOpening}
                        onCloneRepository={() => {
                          notify({
                            id: "clone-repository",
                            kind: "info",
                            title: "Clone a repository",
                            description: "Open the agent and ask it to clone the repository into a local folder.",
                          });
                        }}
                        onCommandPalette={() => {
                          window.dispatchEvent(new CustomEvent("coloride:command-palette"));
                        }}
                        onNewFile={() => {
                          navigateTo({ activeTab: "explorer", serverSubTab: "health" });
                          workspace.handleNewFile();
                        }}
                        onOpenProject={() => void openLocalFolderPicker()}
                        onOpenRecent={(path) => void openRecentLocalWorkspace(path)}
                        recents={workspace.localRecentWorkspaces}
                        servers={[]}
                      />
                    )}

                    {activeTab === "server" && serverConnected && (
                      <Suspense fallback={null}>
                        <ServerView
                          host={workspace.host}
                          onDisconnect={async () => {
                            await workspace.disconnectServer();
                            setTerminalOpen(false);
                            setTerminalInitialized(false);
                            resetToWelcome();
                          }}
                          onForgetServer={async () => {
                            await workspace.forgetActiveServer();
                            setTerminalOpen(false);
                            setTerminalInitialized(false);
                            resetToWelcome();
                          }}
                          onOpenExplorer={() => void openLocalFolderPicker()}
                          onPreferencesChange={workspace.updateServerPreferences}
                          onResizeStart={startPanelResize}
                          onServerNameChange={workspace.saveServerName}
                          onServerSubTabChange={handleServerSubTabChange}
                          onWorkspaceChange={workspace.saveDefaultWorkspace}
                          port={workspace.port}
                          profile={
                            workspace.savedProfiles.find(
                              (profile) =>
                                profile.id === workspace.activeProfileId,
                            ) ?? null
                          }
                          serverName={workspace.serverName}
                          serverSubTab={serverSubTab}
                          serverWidth={serverWidth}
                          sidePanelOpen={sidePanelOpen}
                          username={workspace.username}
                          workspacePath={workspace.workspacePath}
                        />
                      </Suspense>
                    )}

                    {activeTab === "settings" && (
                      <Suspense fallback={null}>
                        <SettingsView
                          initialSection={settingsSection}
                          onSectionChange={setSettingsSection}
                          sidePanelOpen={sidePanelOpen}
                        />
                      </Suspense>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Full window width — under rail + workspace, flush left → right */}
          <AppStatusBar
            filePath={activeTab === "explorer" ? editorStatus?.filePath : null}
            onInfo={() => {
              openSettings("about");
            }}
            onToggleTerminal={handleToggleTerminal}
            terminalOpen={terminalVisible}
            workspacePath={workspace.workspacePath}
          />
        </section>

        <AppAnimations />
      </main>
      <NotificationViewport />
    </LoginGate>
  );
}
