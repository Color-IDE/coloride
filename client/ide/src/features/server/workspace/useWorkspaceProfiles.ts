import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  api,
  hydrateRuntimeFromDesktop
} from "../../../shared/api/client";
import type { Profile } from "../../../shared/api/types";
import {
  isAbsoluteWorkspacePath
} from "../../../shared/lib/workspacePath";
import type { LocalRecentWorkspace } from "../../settings/lastSession";
import {
  rememberLocalRecentWorkspace
} from "../../settings/lastSession";
import {
  inferProfileUsername,
  isApiNotFound,
  isValidServerName,
  messageFromError
} from "./connectionValidation";
import type { ConnectionState, PendingConnection } from "./types";

interface Dependencies {
  closeLoadDropdown: () => void;
  userOwnedConnectionRef: RefObject<boolean>;
  activeProfileIdRef: RefObject<string | null>;
  connectionStateRef: RefObject<ConnectionState>;
  completePendingConnection: (pending: PendingConnection) => Promise<void>;
  setShowConnectModal: Dispatch<SetStateAction<boolean>>;
  requestHostVerification: (pending: PendingConnection) => Promise<void>;
  setProfilesError: Dispatch<SetStateAction<string>>;
  setSavedProfiles: Dispatch<SetStateAction<Profile[]>>;
  host: string;
  port: string;
  username: string;
  setConnectionState: Dispatch<SetStateAction<ConnectionState>>;
  setActiveProfileId: Dispatch<SetStateAction<string | null>>;
  setWorkspacePath: Dispatch<SetStateAction<string>>;
  clearRemoteWorkspace: () => void;
  activeProfileId: string | null;
  setServerName: Dispatch<SetStateAction<string>>;
  setUsername: Dispatch<SetStateAction<string>>;
  activateWorkspace: (rootPath: string, options?: { persist?: boolean; forceReload?: boolean; skipAccessSetup?: boolean; }) => Promise<boolean>;
  workspaceKind: "ssh" | "local";
  setExplorerError: Dispatch<SetStateAction<string>>;
  setWorkspaceKind: Dispatch<SetStateAction<"ssh" | "local">>;
  setLocalRecentWorkspaces: Dispatch<SetStateAction<LocalRecentWorkspace[]>>;
  setEditorError: Dispatch<SetStateAction<string>>;
}

export function useWorkspaceProfiles({
  closeLoadDropdown,
  userOwnedConnectionRef,
  activeProfileIdRef,
  connectionStateRef,
  completePendingConnection,
  setShowConnectModal,
  requestHostVerification,
  setProfilesError,
  setSavedProfiles,
  host,
  port,
  username,
  setConnectionState,
  setActiveProfileId,
  setWorkspacePath,
  clearRemoteWorkspace,
  activeProfileId,
  setServerName,
  setUsername,
  activateWorkspace,
  workspaceKind,
  setExplorerError,
  setWorkspaceKind,
  setLocalRecentWorkspaces,
  setEditorError,
}: Dependencies) {
  const handleLoadSavedProfile = async (profile: Profile) => {
    closeLoadDropdown();
    userOwnedConnectionRef.current = true;
    // Already on this VPS — do not tear SSH down just to click the same row.
    if (
      activeProfileIdRef.current === profile.id &&
      (connectionStateRef.current === "connected" ||
        connectionStateRef.current === "connecting")
    ) {
      return;
    }
    try {
      await completePendingConnection({ kind: "profile", profile });
    } catch (error) {
      if (
        messageFromError(error).includes("host identity has not been trusted")
      ) {
        setShowConnectModal(true);
        await requestHostVerification({ kind: "profile", profile });
      }
    }
  };

  const handleDeleteSavedProfile = async (profile: Profile) => {
    const confirmed = window.confirm(`Delete saved server "${profile.name}"?`);
    if (!confirmed) return;

    setProfilesError("");

    try {
      await hydrateRuntimeFromDesktop();
      await api.deleteProfile(profile.id);
      setSavedProfiles((current) =>
        current.filter((candidate) => candidate.id !== profile.id),
      );

      const matchesActiveConnection =
        profile.host === host &&
        String(profile.port) === String(port) &&
        inferProfileUsername(profile) === username;

      if (matchesActiveConnection) {
        setConnectionState("idle");
        setActiveProfileId(null);
        setWorkspacePath("");
        clearRemoteWorkspace();
      }
    } catch (error) {
      if (isApiNotFound(error)) {
        setProfilesError("Restart Coloride to enable deleting saved servers.");
        return;
      }

      setProfilesError(messageFromError(error));
    }
  };

  const saveServerName = async (requestedName: string) => {
    const name = requestedName.trim();
    if (!isValidServerName(name)) {
      throw new Error("Server name must be 1-60 characters.");
    }
    if (!activeProfileId) {
      throw new Error("No active server profile is available to update.");
    }

    await hydrateRuntimeFromDesktop();
    const updated = await api.updateProfile(activeProfileId, { name });
    setServerName(updated.name);
    setSavedProfiles((current) =>
      current.map((profile) => (profile.id === updated.id ? updated : profile)),
    );
    setProfilesError("");
  };

  const saveDefaultWorkspace = async (requestedPath: string) => {
    const path = requestedPath.trim();
    if (!path || !path.startsWith("/")) {
      throw new Error("Use an absolute server path.");
    }
    if (!activeProfileId) {
      throw new Error("No active server profile is available to update.");
    }

    await hydrateRuntimeFromDesktop();
    const workspace = await api.openWorkspace(path);
    if (workspace.sessionUser) {
      setUsername(workspace.sessionUser);
    }
    const opened = await activateWorkspace(workspace.path, {
      persist: true,
      forceReload: true,
      skipAccessSetup: true,
    });
    if (!opened) {
      throw new Error("Unable to open this folder.");
    }
    setSavedProfiles((current) =>
      current.map((profile) =>
        profile.id === activeProfileId
          ? {
            ...profile,
            defaultWorkspace: workspace.path,
            workspaceSourcePath: workspace.sourcePath,
          }
          : profile,
      ),
    );
    setProfilesError("");
  };

  const prepareAgentWorkspace = async (requestedPath: string) => {
    const path = requestedPath.trim();
    if (!path || !path.startsWith("/")) {
      throw new Error("Use an absolute server path.");
    }
    if (!activeProfileId || workspaceKind !== "ssh") {
      throw new Error("Connect to a server before choosing a chat workspace.");
    }

    await hydrateRuntimeFromDesktop();
    const prepared = await api.prepareAgentWorkspace(path);
    if (prepared.sessionUser) {
      setUsername(prepared.sessionUser);
    }
    return prepared.path;
  };

  const openLocalWorkspace = async (requestedPath: string) => {
    const path = requestedPath.trim();
    if (!path || !isAbsoluteWorkspacePath(path)) {
      throw new Error("Choose an absolute local folder.");
    }
    setShowConnectModal(false);
    userOwnedConnectionRef.current = true;
    setConnectionState("connecting");
    setExplorerError("");
    try {
      await hydrateRuntimeFromDesktop();
      const local = await api.openLocalWorkspace(path);
      setShowConnectModal(false);
      setWorkspaceKind("local");
      setActiveProfileId("local");
      activeProfileIdRef.current = "local";
      const opened = await activateWorkspace(local.path, {
        persist: true,
        forceReload: true,
        skipAccessSetup: true,
      });
      if (!opened) throw new Error("Unable to open this local folder.");
      setLocalRecentWorkspaces(rememberLocalRecentWorkspace(local.path));
      return true;
    } catch (error) {
      userOwnedConnectionRef.current = false;
      setWorkspaceKind("ssh");
      setActiveProfileId(null);
      activeProfileIdRef.current = null;
      setConnectionState("idle");
      setExplorerError(messageFromError(error));
      throw error;
    }
  };

  const updateServerPreferences = async (preferences: {
    defaultShell?: "default" | "bash" | "zsh" | "fish";
    terminalPersistence?: boolean;
    monitorInterval?: 2 | 5 | 10 | 30;
  }) => {
    if (!activeProfileId) {
      throw new Error("No active server profile is available to update.");
    }
    await hydrateRuntimeFromDesktop();
    const updated = await api.updateProfile(activeProfileId, preferences);
    setSavedProfiles((current) =>
      current.map((profile) => (profile.id === updated.id ? updated : profile)),
    );
    setProfilesError("");
    return updated;
  };

  const disconnectServer = async () => {
    await hydrateRuntimeFromDesktop();
    await api.disconnect();
    userOwnedConnectionRef.current = false;
    setConnectionState("idle");
    setActiveProfileId(null);
    setWorkspacePath("");
    setExplorerError("");
    setEditorError("");
    clearRemoteWorkspace();
  };

  const forgetActiveServer = async () => {
    if (!activeProfileId) {
      throw new Error("No active server profile is available to remove.");
    }
    await hydrateRuntimeFromDesktop();
    const profileId = activeProfileId;
    await api.deleteProfile(profileId);
    setSavedProfiles((current) =>
      current.filter((profile) => profile.id !== profileId),
    );
    userOwnedConnectionRef.current = false;
    setConnectionState("idle");
    setActiveProfileId(null);
    setWorkspacePath("");
    setExplorerError("");
    setEditorError("");
    clearRemoteWorkspace();
  };
  return {
    handleLoadSavedProfile,
    handleDeleteSavedProfile,
    saveServerName,
    saveDefaultWorkspace,
    prepareAgentWorkspace,
    openLocalWorkspace,
    updateServerPreferences,
    disconnectServer,
    forgetActiveServer,
  };
}
