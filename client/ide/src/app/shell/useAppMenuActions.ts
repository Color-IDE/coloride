import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import { type ServerSubTab } from "../../features/server/ServerView";
import type { ServerWorkspaceController } from "../../features/server/useServerWorkspace";
import type { AppPreferences } from "../../features/settings/preferences";
import { updateAppPreference } from "../../features/settings/preferences";
import { type SettingsSection } from "../../features/settings/SettingsView";
import { maybeCheckForUpdates } from "../../features/settings/updates";
import { type NavigationLocation } from "./navigationState";
interface Dependencies {
  goBack: () => void;
  goForward: () => void;
  setExplorerAgentOpen: Dispatch<SetStateAction<boolean>>;
  sidePanelOpen: boolean;
  explorerAgentOpen: boolean;
  terminalOpen: boolean;
  setSidePanelOpen: Dispatch<SetStateAction<boolean>>;
  ensureTerminalOpen: () => boolean;
  setTerminalOpen: Dispatch<SetStateAction<boolean>>;
  navigateTo: (location: NavigationLocation) => void;
  appPreferences: AppPreferences;
  openSettings: (section?: SettingsSection) => void;
  serverSubTab: ServerSubTab;
  serverConnected: boolean;
  denyProtectedTab: (_tab: "explorer" | "server" | "agents") => void;
  activeTab: string | null;
  sidePanelAvailable: boolean;
  handleToggleTerminal: () => void;
  workspace: ServerWorkspaceController;
  openLocalFolderPicker: (options?: {
    revealExplorer?: boolean;
  }) => Promise<void>;
  showLocalModeNotice: (message: string) => void;
  openRemoteFilePicker: (folderOnly?: boolean) => void;
  handleSelectTab: (tab: string) => void;
  handleNewTerminal: () => void;
  resetToWelcome: () => void;
  terminalInitialized: boolean;
  workspaceReady: boolean;
}
export function useAppMenuActions({
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
}: Dependencies) {
  // Native macOS menu + Windows in-app menu → same actions.
  useEffect(() => {
    const handleMenuAction = (action: string) => {
      if (action.startsWith("editor-command:")) {
        window.dispatchEvent(
          new CustomEvent("coloride:editor-command", {
            detail: action.slice("editor-command:".length),
          }),
        );
        return;
      }
      switch (action) {
        case "navigation-back":
          goBack();
          break;
        case "navigation-forward":
          goForward();
          break;
        case "toggle-right-dock":
          setExplorerAgentOpen((current) => !current);
          break;
        case "toggle-all-docks": {
          const next = !(sidePanelOpen || explorerAgentOpen || terminalOpen);
          setSidePanelOpen(next);
          setExplorerAgentOpen(next);
          if (next) {
            void ensureTerminalOpen();
          } else setTerminalOpen(false);
          break;
        }
        case "toggle-problems":
          window.dispatchEvent(new Event("coloride:toggle-problems"));
          break;
        case "editor-zoom-in":
          updateAppPreference(
            "codeFontSize",
            Math.min(32, appPreferences.codeFontSize + 1),
          );
          break;
        case "editor-zoom-out":
          updateAppPreference(
            "codeFontSize",
            Math.max(8, appPreferences.codeFontSize - 1),
          );
          break;
        case "editor-zoom-reset":
          updateAppPreference("codeFontSize", 13);
          break;
        case "editor-zoom-reset-all":
          updateAppPreference("codeFontSize", 13);
          updateAppPreference("interfaceFontSize", 13);
          break;
        case "open-settings":
          openSettings();
          break;
        case "open-server":
          if (!serverConnected) {
            denyProtectedTab("server");
            break;
          }
          navigateTo({ activeTab: "server", serverSubTab });
          break;
        case "open-agents":
          if (!serverConnected) {
            denyProtectedTab("agents");
            break;
          }
          navigateTo({ activeTab: "agents", serverSubTab });
          break;
        case "new-agent-task":
          if (!serverConnected) {
            denyProtectedTab("agents");
            break;
          }
          if (activeTab === "explorer") setExplorerAgentOpen(true);
          else navigateTo({ activeTab: "agents", serverSubTab });
          window.dispatchEvent(new CustomEvent("coloride:new-agent-task"));
          break;
        case "open-explorer":
          if (!serverConnected) {
            denyProtectedTab("explorer");
            break;
          }
          navigateTo({ activeTab: "explorer", serverSubTab });
          break;
        case "toggle-side-panel":
          if (sidePanelAvailable) setSidePanelOpen((current) => !current);
          break;
        case "toggle-terminal":
          handleToggleTerminal();
          break;
        case "connect-server":
        case "reconnect-server":
        case "open-ssh-workspace":
          showLocalModeNotice("SSH connections are turned off in this build.");
          break;
        case "open-folder": // Compatibility with older native app menus.
        case "open-local-folder":
          void openLocalFolderPicker();
          break;
        case "open-file":
          void openLocalFolderPicker();
          break;
        case "new-file":
          handleSelectTab("explorer");
          void workspace.handleNewFile();
          break;
        case "new-folder":
          handleSelectTab("explorer");
          void workspace.handleNewFolder();
          break;
        case "save-file":
          void workspace.saveSelectedFile();
          break;
        case "save-all-files":
          void workspace.saveAllFiles();
          break;
        case "toggle-auto-save":
          updateAppPreference("editorAutoSave", !appPreferences.editorAutoSave);
          break;
        case "revert-file":
          if (workspace.selectedFile) {
            void workspace.reloadEditorFromRemote(workspace.selectedFile, {
              force: true,
            });
          }
          break;
        case "close-editor":
          if (workspace.selectedFile)
            workspace.closeEditorFile(workspace.selectedFile);
          break;
        case "window-close":
          void window.colorideDesktop?.windowControls?.close();
          break;
        case "refresh-files":
          handleSelectTab("explorer");
          workspace.handleRefreshTree();
          break;
        case "new-terminal":
          handleNewTerminal();
          break;
        case "clear-terminal":
          if (ensureTerminalOpen()) {
            window.dispatchEvent(
              new CustomEvent("coloride:terminal-command", { detail: "clear" }),
            );
          }
          break;
        case "close-terminal":
          window.dispatchEvent(
            new CustomEvent("coloride:terminal-command", { detail: "close" }),
          );
          break;
        case "split-terminal":
          if (ensureTerminalOpen()) {
            window.dispatchEvent(
              new CustomEvent("coloride:terminal-command", { detail: "split" }),
            );
          }
          break;
        case "restart-terminal":
          if (ensureTerminalOpen()) {
            window.dispatchEvent(
              new CustomEvent("coloride:terminal-command", {
                detail: "restart",
              }),
            );
          }
          break;
        case "kill-terminal":
          window.dispatchEvent(
            new CustomEvent("coloride:terminal-command", { detail: "kill" }),
          );
          break;
        case "check-for-updates":
          void maybeCheckForUpdates(appPreferences.updateChannel);
          break;
        case "sign-out":
          window.dispatchEvent(new CustomEvent("coloride:sign-out"));
          break;
        case "new-window":
          break;
        case "close-workspace":
          void workspace.disconnectServer().catch(() => undefined);
          resetToWelcome();
          break;
        case "edit-find":
          window.dispatchEvent(new CustomEvent("coloride:editor-find"));
          break;
        case "edit-replace":
          window.dispatchEvent(new CustomEvent("coloride:editor-replace"));
          break;
        case "command-palette":
          if (!serverConnected) {
            denyProtectedTab("agents");
            break;
          }
          navigateTo({ activeTab: "agents", serverSubTab });
          window.dispatchEvent(new CustomEvent("coloride:command-palette"));
          break;
        case "open-browser":
          if (!serverConnected) {
            denyProtectedTab("explorer");
            break;
          }
          navigateTo({ activeTab: "explorer", serverSubTab });
          window.dispatchEvent(new CustomEvent("coloride:open-browser"));
          break;
        case "agent-mode-ask":
        case "agent-mode-plan":
        case "agent-mode-debug":
          if (!serverConnected) {
            denyProtectedTab("agents");
            break;
          }
          navigateTo({ activeTab: "agents", serverSubTab });
          window.dispatchEvent(
            new CustomEvent("coloride:agent-mode", {
              detail: action.replace("agent-mode-", ""),
            }),
          );
          break;
        case "agent-select-model":
          if (!serverConnected) {
            denyProtectedTab("agents");
            break;
          }
          navigateTo({ activeTab: "agents", serverSubTab });
          window.dispatchEvent(new CustomEvent("coloride:agent-select-model"));
          break;
        case "agent-access-request":
        case "agent-access-agent":
        case "agent-access-full":
          window.dispatchEvent(
            new CustomEvent("coloride:agent-access", {
              detail: action.replace("agent-access-", ""),
            }),
          );
          break;
        case "stop-agent":
          window.dispatchEvent(new CustomEvent("coloride:agent-stop"));
          break;
        case "reconnect-server": {
          const profile = workspace.savedProfiles.find(
            (item) => item.id === workspace.activeProfileId,
          );
          if (profile) {
            void workspace.handleLoadSavedProfile(profile);
          } else {
            workspace.setShowConnectModal(true);
          }
          break;
        }
        case "disconnect-server":
          void workspace.disconnectServer().catch(() => undefined);
          resetToWelcome();
          break;
        case "open-server-settings":
        case "connection-info":
          if (!serverConnected) {
            denyProtectedTab("server");
            break;
          }
          navigateTo({ activeTab: "server", serverSubTab: "settings" });
          break;
        case "open-shortcuts":
          openSettings("shortcuts");
          break;
        case "open-diagnostics":
          openSettings("diagnostics");
          break;
        case "help-report-bug":
          window.dispatchEvent(new CustomEvent("coloride:report-bug"));
          break;
        default:
          if (action.startsWith("open-recent:")) {
            const raw = action.slice("open-recent:".length);
            if (raw.startsWith("local:")) {
              void workspace.openLocalWorkspace(raw.slice("local:".length));
            } else if (raw.startsWith("ssh:")) {
              const profile = workspace.savedProfiles.find(
                (item) => item.id === raw.slice("ssh:".length),
              );
              if (profile) void workspace.handleLoadSavedProfile(profile);
            }
          }
          break;
      }
    };

    const unsubscribe = window.colorideDesktop?.onMenuAction((action) => {
      handleMenuAction(action);
    });
    const onAppMenu = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string") handleMenuAction(detail);
    };
    window.addEventListener("coloride:app-menu-action", onAppMenu);
    return () => {
      unsubscribe?.();
      window.removeEventListener("coloride:app-menu-action", onAppMenu);
    };
  }, [
    appPreferences,
    explorerAgentOpen,
    sidePanelOpen,
    terminalOpen,
    goBack,
    goForward,
    denyProtectedTab,
    ensureTerminalOpen,
    handleNewTerminal,
    handleToggleTerminal,
    navigateTo,
    openSettings,
    openLocalFolderPicker,
    openRemoteFilePicker,
    resetToWelcome,
    serverConnected,
    serverSubTab,
    sidePanelAvailable,
    terminalInitialized,
    workspace,
    workspaceReady,
  ]);
}
