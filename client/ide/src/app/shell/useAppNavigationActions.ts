import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { type ServerSubTab } from "../../features/server/ServerView";
import type { ServerWorkspaceController } from "../../features/server/useServerWorkspace";
import type { NavigationHistory, NavigationLocation } from "./navigationState";

interface Dependencies {
  setActiveTab: Dispatch<SetStateAction<string | null>>;
  setServerSubTab: Dispatch<SetStateAction<ServerSubTab>>;
  navigationRef: RefObject<NavigationHistory>;
  setNavigation: Dispatch<SetStateAction<NavigationHistory>>;
  workspace: ServerWorkspaceController;
  showLocalModeNotice: (message: string) => void;
  tabRequiresVps: (
    tab: string | null | undefined,
  ) => tab is "explorer" | "server" | "agents";
  serverConnectedRef: RefObject<boolean>;
  denyProtectedTab: (_tab: "explorer" | "server" | "agents") => void;
  sameLocation: (
    left: NavigationLocation,
    right: NavigationLocation,
  ) => boolean;
  activeTab: string | null;
  serverSubTab: ServerSubTab;
}
export function useAppNavigationActions({
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
}: Dependencies) {
  const applyLocation = useCallback((location: NavigationLocation) => {
    setActiveTab(location.activeTab);
    setServerSubTab(location.serverSubTab);
  }, []);

  const resetToWelcome = useCallback(() => {
    const location: NavigationLocation = {
      activeTab: null,
      serverSubTab: "health",
    };
    const nextHistory: NavigationHistory = { entries: [location], index: 0 };
    navigationRef.current = nextHistory;
    setNavigation(nextHistory);
    applyLocation(location);
  }, [applyLocation]);

  const navigateTo = useCallback(
    (location: NavigationLocation) => {
      if (
        location.activeTab === "server" &&
        workspace.workspaceKind === "local"
      ) {
        showLocalModeNotice("Server is only available for SSH workspaces.");
        return;
      }
      // Hard gate: never land on Explorer/Server without a live VPS session
      // (blocks history, menu, and racey double-clicks).
      if (tabRequiresVps(location.activeTab) && !serverConnectedRef.current) {
        const denied =
          location.activeTab === "server"
            ? "server"
            : location.activeTab === "agents"
              ? "agents"
              : "explorer";
        denyProtectedTab(denied);
        return;
      }

      const currentHistory = navigationRef.current;
      const currentLocation = { activeTab, serverSubTab };
      if (sameLocation(currentLocation, location)) return;

      const entries = currentHistory.entries.slice(0, currentHistory.index + 1);
      entries[currentHistory.index] = currentLocation;
      entries.push(location);
      const nextHistory = { entries, index: entries.length - 1 };
      navigationRef.current = nextHistory;
      setNavigation(nextHistory);
      applyLocation(location);
    },
    [
      activeTab,
      applyLocation,
      denyProtectedTab,
      serverSubTab,
      showLocalModeNotice,
      workspace.workspaceKind,
    ],
  );

  const goBack = useCallback(() => {
    const current = navigationRef.current;
    if (current.index <= 0) return;
    let index = current.index - 1;
    // Skip history entries that require a VPS while disconnected.
    while (index >= 0) {
      const entry = current.entries[index];
      if (
        !entry ||
        (tabRequiresVps(entry.activeTab) && !serverConnectedRef.current)
      ) {
        index -= 1;
        continue;
      }
      const next = { ...current, index };
      navigationRef.current = next;
      setNavigation(next);
      applyLocation(entry);
      return;
    }
  }, [applyLocation]);

  const goForward = useCallback(() => {
    const current = navigationRef.current;
    if (current.index >= current.entries.length - 1) return;
    let index = current.index + 1;
    while (index < current.entries.length) {
      const entry = current.entries[index];
      if (
        !entry ||
        (tabRequiresVps(entry.activeTab) && !serverConnectedRef.current)
      ) {
        index += 1;
        continue;
      }
      const next = { ...current, index };
      navigationRef.current = next;
      setNavigation(next);
      applyLocation(entry);
      return;
    }
  }, [applyLocation]);

  return { resetToWelcome, navigateTo, goBack, goForward };
}
