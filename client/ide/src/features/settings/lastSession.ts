/**
 * Last-session snapshot for workspace restore across app restarts.
 * Complements profile.defaultWorkspace + editor-session keys.
 */

import {
  isAbsoluteWorkspacePath,
  workspaceBasename,
} from "../../shared/lib/workspacePath";

const isStoredPath = (value: string) => isAbsoluteWorkspacePath(value);

export const LAST_SESSION_STORAGE_KEY = "coloride.session.last.v1";
const LOCAL_RECENTS_STORAGE_KEY = "coloride.workspace.local-recents.v1";
const MAX_LOCAL_RECENTS = 8;

export type LocalRecentWorkspace = {
  name: string;
  path: string;
  openedAt: number;
};

export type LastSessionSnapshot = {
  profileId: string | null;
  workspacePath: string;
  /** Last file/folder path shown in the bottom status bar. */
  selectedPath: string;
  /** Explorer tree folders that were expanded. */
  expandedPaths: string[];
  activeTab: string | null;
  serverSubTab: string;
  sidePanelOpen: boolean;
  /** Agent dock on the right of Explorer. */
  rightPanelOpen: boolean;
  terminalOpen: boolean;
  agentToolsOpen: boolean;
  updatedAt: number;
};

const empty = (): LastSessionSnapshot => ({
  profileId: null,
  workspacePath: "",
  selectedPath: "",
  expandedPaths: [],
  activeTab: null,
  serverSubTab: "health",
  sidePanelOpen: true,
  rightPanelOpen: true,
  terminalOpen: false,
  agentToolsOpen: true,
  updatedAt: 0,
});

export function readLastSession(): LastSessionSnapshot {
  if (typeof window === "undefined") return empty();
  try {
    const raw = window.localStorage.getItem(LAST_SESSION_STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<LastSessionSnapshot>;
    return {
      profileId: typeof parsed.profileId === "string" ? parsed.profileId : null,
      workspacePath:
        typeof parsed.workspacePath === "string" && isStoredPath(parsed.workspacePath)
          ? parsed.workspacePath
          : "",
      selectedPath:
        typeof parsed.selectedPath === "string" && isStoredPath(parsed.selectedPath)
          ? parsed.selectedPath
          : "",
      expandedPaths: Array.isArray(parsed.expandedPaths)
        ? parsed.expandedPaths.filter((p): p is string => typeof p === "string" && isStoredPath(p)).slice(0, 200)
        : [],
      activeTab: typeof parsed.activeTab === "string" || parsed.activeTab === null
        ? (parsed.activeTab as string | null)
        : null,
      serverSubTab: typeof parsed.serverSubTab === "string" ? parsed.serverSubTab : "health",
      sidePanelOpen: parsed.sidePanelOpen !== false,
      rightPanelOpen: parsed.rightPanelOpen !== false,
      terminalOpen: Boolean(parsed.terminalOpen),
      agentToolsOpen: parsed.agentToolsOpen !== false,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return empty();
  }
}

export function writeLastSession(patch: Partial<LastSessionSnapshot>): LastSessionSnapshot {
  const current = readLastSession();
  const next: LastSessionSnapshot = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
  return next;
}

export function clearLastSession(): void {
  try {
    window.localStorage.removeItem(LAST_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function readLocalRecentWorkspaces(): LocalRecentWorkspace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Partial<LocalRecentWorkspace> => Boolean(item) && typeof item === "object")
      .filter((item) => typeof item.path === "string" && isStoredPath(item.path))
      .map((item) => {
        const path = item.path as string;
        const name = typeof item.name === "string" && item.name.trim()
          ? item.name
          : workspaceBasename(path);
        return { name, path, openedAt: typeof item.openedAt === "number" ? item.openedAt : 0 };
      })
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, MAX_LOCAL_RECENTS);
  } catch {
    return [];
  }
}

export function rememberLocalRecentWorkspace(path: string): LocalRecentWorkspace[] {
  const normalizedPath = path.trim();
  if (!isAbsoluteWorkspacePath(normalizedPath)) return readLocalRecentWorkspaces();
  const next: LocalRecentWorkspace[] = [
    {
      name: workspaceBasename(normalizedPath),
      path: normalizedPath,
      openedAt: Date.now(),
    },
    ...readLocalRecentWorkspaces().filter((workspace) => workspace.path !== normalizedPath),
  ].slice(0, MAX_LOCAL_RECENTS);
  try {
    window.localStorage.setItem(LOCAL_RECENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
  return next;
}

export function treeSessionStorageKey(profileId: string, workspacePath: string): string {
  return `coloride.tree-session.v1:${profileId}:${workspacePath}`;
}

export function readTreeSession(profileId: string, workspacePath: string): { expandedPaths: string[] } {
  if (typeof window === "undefined") return { expandedPaths: [] };
  try {
    const raw = window.localStorage.getItem(treeSessionStorageKey(profileId, workspacePath));
    if (!raw) return { expandedPaths: [] };
    const parsed = JSON.parse(raw) as { expandedPaths?: unknown };
    const expandedPaths = Array.isArray(parsed.expandedPaths)
      ? parsed.expandedPaths.filter((p): p is string => typeof p === "string" && isStoredPath(p)).slice(0, 200)
      : [];
    return { expandedPaths };
  } catch {
    return { expandedPaths: [] };
  }
}

export function writeTreeSession(
  profileId: string,
  workspacePath: string,
  expandedPaths: string[],
): void {
  try {
    window.localStorage.setItem(
      treeSessionStorageKey(profileId, workspacePath),
      JSON.stringify({ expandedPaths: expandedPaths.slice(0, 200), updatedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}
