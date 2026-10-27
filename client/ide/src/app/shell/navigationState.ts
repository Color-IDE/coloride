import { type ServerSubTab } from "../../features/server/ServerView";

export type NavigationLocation = {
  activeTab: string | null;
  serverSubTab: ServerSubTab;
};

export type NavigationHistory = {
  entries: NavigationLocation[];
  index: number;
};

export const NAVIGATION_STORAGE_KEY = "coloride.session.navigation.v1";

export const sameLocation = (
  left: NavigationLocation,
  right: NavigationLocation,
) =>
  left.activeTab === right.activeTab &&
  left.serverSubTab === right.serverSubTab;

export const tabRequiresVps = (tab: string | null | undefined) =>
  tab === "explorer" || tab === "server" || tab === "agents";

export const readStoredNavigation = (): NavigationLocation => {
  if (typeof window === "undefined")
    return { activeTab: null, serverSubTab: "health" };
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(NAVIGATION_STORAGE_KEY) ?? "null",
    ) as NavigationLocation | null;
    const validTabs = new Set([
      null,
      "explorer",
      "server",
      "agents",
      "settings",
    ]);
    const validServerTabs = new Set<ServerSubTab>([
      "health",
      "processes",
      "services",
      "ports",
      "logs",
      "settings",
    ]);
    if (
      stored &&
      validTabs.has(stored.activeTab) &&
      validServerTabs.has(stored.serverSubTab)
    )
      return stored;
  } catch {}
  return { activeTab: null, serverSubTab: "health" };
};
