import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { api, hydrateRuntimeFromDesktop } from "../../../shared/api/client";
import type { HostKeyInfo, Profile } from "../../../shared/api/types";
import { clearAgentEditReview } from "../../editor/agentEditBridge";
import { lspSessionManager } from "../../editor/lsp/LspSessionManager";
import {
  closeBrowserEmbed,
  type BrowserTabState,
} from "../../explorer/BrowserPane";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import { readLastSession, writeLastSession } from "../../settings/lastSession";
import type { AppPreferences } from "../../settings/preferences";
import {
  hasInvalidHostFormat,
  inferProfileUsername,
  isApiNotFound,
  isValidPort,
  isValidServerName,
  isValidUsername,
  messageFromError,
} from "./connectionValidation";
import type { TreeUndoEntry } from "./types";
import {
  type AuthMethod,
  type ConnectionState,
  type EditorBuffer,
  type PendingConnection,
} from "./types";

interface Dependencies {
  sessionRestoreGenRef: RefObject<number>;
  setTreeSessionReadyKey: Dispatch<SetStateAction<string>>;
  setEditorSessionReadyKey: Dispatch<SetStateAction<string>>;
  setBrowserTabs: Dispatch<SetStateAction<Record<string, BrowserTabState>>>;
  setTreeItems: Dispatch<SetStateAction<FileTreeItem[]>>;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  setLoadedDirs: Dispatch<SetStateAction<Set<string>>>;
  setLoadingDirs: Dispatch<SetStateAction<Set<string>>>;
  setSelectedFile: Dispatch<SetStateAction<string | null>>;
  setOpenFiles: Dispatch<SetStateAction<string[]>>;
  treeClipboardRef: RefObject<{
    path: string;
    name: string;
    kind: FileTreeItem["kind"];
    mode?: "copy" | "cut";
  } | null>;
  setTreeClipboard: Dispatch<
    SetStateAction<{
      path: string;
      name: string;
      kind: FileTreeItem["kind"];
      mode?: "copy" | "cut";
    } | null>
  >;
  dirFingerprintsRef: RefObject<Map<string, string>>;
  setTreeRefreshing: Dispatch<SetStateAction<boolean>>;
  treeRefreshInFlightRef: RefObject<boolean>;
  editorBuffersRef: RefObject<Map<string, EditorBuffer>>;
  treeUndoStackRef: RefObject<TreeUndoEntry[]>;
  setTreeUndoDepth: Dispatch<SetStateAction<number>>;
  agentEditBaseRef: RefObject<Map<string, string>>;
  editorLoadRequestRef: RefObject<number>;
  setEditorValue: Dispatch<SetStateAction<string>>;
  setEditorImageUrl: Dispatch<SetStateAction<string | null>>;
  setEditorEtag: Dispatch<SetStateAction<string | null>>;
  setEditorDirty: Dispatch<SetStateAction<boolean>>;
  setEditorTruncated: Dispatch<SetStateAction<boolean>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setExplorerError: Dispatch<SetStateAction<string>>;
  connectionStateRef: RefObject<ConnectionState>;
  connectionUnavailableRef: RefObject<boolean>;
  userOwnedConnectionRef: RefObject<boolean>;
  setConnectionState: Dispatch<SetStateAction<ConnectionState>>;
  setActiveProfileId: Dispatch<SetStateAction<string | null>>;
  setWorkspacePath: Dispatch<SetStateAction<string>>;
  setEditorError: Dispatch<SetStateAction<string>>;
  setShowConnectModal: Dispatch<SetStateAction<boolean>>;
  serverName: string;
  host: string;
  port: string;
  setErrors: Dispatch<SetStateAction<Record<string, string>>>;
  username: string;
  authMethod: AuthMethod;
  password: string;
  sshKeyPath: string;
  setProfilesLoading: Dispatch<SetStateAction<boolean>>;
  setProfilesError: Dispatch<SetStateAction<string>>;
  setSavedProfiles: Dispatch<SetStateAction<Profile[]>>;
  setWorkspaceKind: Dispatch<SetStateAction<"local" | "ssh">>;
  activeProfileIdRef: RefObject<string | null>;
  setServerName: Dispatch<SetStateAction<string>>;
  setHost: Dispatch<SetStateAction<string>>;
  setPort: Dispatch<SetStateAction<string>>;
  setUsername: Dispatch<SetStateAction<string>>;
  activateWorkspaceRef: RefObject<
    (
      path: string,
      options?: {
        persist?: boolean;
        forceReload?: boolean;
        skipAccessSetup?: boolean;
      },
    ) => Promise<boolean>
  >;
  appPreferences: AppPreferences;
  openLocalWorkspace: (requestedPath: string) => Promise<boolean>;
  handleLoadSavedProfile: (profile: Profile) => Promise<void>;
  clearErrors: (...keys: string[]) => void;
  activateWorkspace: (
    rootPath: string,
    options?: {
      persist?: boolean;
      forceReload?: boolean;
      skipAccessSetup?: boolean;
    },
  ) => Promise<boolean>;
  pendingConnectionRef: RefObject<PendingConnection | null>;
  setHostKeyPrompt: Dispatch<SetStateAction<HostKeyInfo | null>>;
  setConnectStep: Dispatch<SetStateAction<"server" | "credentials">>;
  hostKeyPrompt: HostKeyInfo | null;
  setHostKeyTrusting: Dispatch<SetStateAction<boolean>>;
}
export function useWorkspaceConnection({
  sessionRestoreGenRef,
  setTreeSessionReadyKey,
  setEditorSessionReadyKey,
  setBrowserTabs,
  setTreeItems,
  setExpandedIds,
  setLoadedDirs,
  setLoadingDirs,
  setSelectedFile,
  setOpenFiles,
  treeClipboardRef,
  setTreeClipboard,
  dirFingerprintsRef,
  setTreeRefreshing,
  treeRefreshInFlightRef,
  editorBuffersRef,
  treeUndoStackRef,
  setTreeUndoDepth,
  agentEditBaseRef,
  editorLoadRequestRef,
  setEditorValue,
  setEditorImageUrl,
  setEditorEtag,
  setEditorDirty,
  setEditorTruncated,
  setDirtyFiles,
  setExplorerError,
  connectionStateRef,
  connectionUnavailableRef,
  userOwnedConnectionRef,
  setConnectionState,
  setActiveProfileId,
  setWorkspacePath,
  setEditorError,
  setShowConnectModal,
  serverName,
  host,
  port,
  setErrors,
  username,
  authMethod,
  password,
  sshKeyPath,
  setProfilesLoading,
  setProfilesError,
  setSavedProfiles,
  setWorkspaceKind,
  activeProfileIdRef,
  setServerName,
  setHost,
  setPort,
  setUsername,
  activateWorkspaceRef,
  appPreferences,
  openLocalWorkspace,
  handleLoadSavedProfile,
  clearErrors,
  activateWorkspace,
  pendingConnectionRef,
  setHostKeyPrompt,
  setConnectStep,
  hostKeyPrompt,
  setHostKeyTrusting,
}: Dependencies) {
  const clearRemoteWorkspace = () => {
    // Invalidate in-flight session restore so it cannot mark ready / write after teardown.
    sessionRestoreGenRef.current += 1;
    setTreeSessionReadyKey("");
    setEditorSessionReadyKey("");
    // Tear down any native Chromium embeds before dropping tab state.
    setBrowserTabs((current) => {
      for (const tab of Object.values(current)) {
        if (tab.browserId) void closeBrowserEmbed(tab.browserId);
      }
      return {};
    });
    setTreeItems([]);
    setExpandedIds(new Set());
    setLoadedDirs(new Set());
    setLoadingDirs(new Set());
    setSelectedFile(null);
    setOpenFiles([]);
    treeClipboardRef.current = null;
    setTreeClipboard(null);
    dirFingerprintsRef.current.clear();
    setTreeRefreshing(false);
    treeRefreshInFlightRef.current = false;
    editorBuffersRef.current.clear();
    treeUndoStackRef.current = [];
    setTreeUndoDepth(0);
    agentEditBaseRef.current.clear();
    // Memory only — keep localStorage so pending Keep/Undo survives reconnect/restart.
    clearAgentEditReview(undefined, { persist: false });
    editorLoadRequestRef.current += 1;
    setEditorValue("");
    setEditorImageUrl(null);
    setEditorEtag(null);
    setEditorDirty(false);
    setEditorTruncated(false);
    setDirtyFiles(new Set());
    lspSessionManager.disposeAll();
  };

  const handleConnectionUnavailable = (
    message = "Connection closed. Reconnect to the server.",
  ) => {
    void (async () => {
      // A single list/stat error during connect is not a drop.
      try {
        const live = await api.connectionState();
        if (live?.state === "connected") {
          setExplorerError(message);
          return;
        }
      } catch {
        // Probe failed — treat as down.
      }
      if (connectionStateRef.current === "connecting") return;
      connectionUnavailableRef.current = true;
      userOwnedConnectionRef.current = false;
      setConnectionState("failed");
      setActiveProfileId(null);
      setWorkspacePath("");
      setExplorerError(message);
      setEditorError("");
      clearRemoteWorkspace();
      setShowConnectModal(false);
    })();
  };

  const cancelWorkspaceSelection = async () => {
    userOwnedConnectionRef.current = false;
    setConnectionState("idle");
    setActiveProfileId(null);
    setWorkspacePath("");
    setExplorerError("");
    setEditorError("");
    clearRemoteWorkspace();
    await api.disconnect().catch(() => {});
  };

  const validateServerStep = () => {
    const newErrors: Record<string, string> = {};
    const trimmedServerName = serverName.trim();
    if (!isValidServerName(trimmedServerName)) {
      newErrors.serverName = "Server name must be\n1–60 characters.";
    }
    const trimmedHost = host.trim();
    if (!trimmedHost) {
      newErrors.host = "Host is required.\nUse IP, domain or IPv6.";
    } else if (hasInvalidHostFormat(trimmedHost)) {
      // Two lines in the error cloud (pre-line).
      newErrors.host = "Invalid host format.\nUse IP, domain or IPv6.";
    }
    const trimmedPort = port.trim() || "22";
    if (!isValidPort(trimmedPort)) {
      newErrors.port = "Port must be between\n1 and 65535.";
    }
    setErrors((current) => {
      const next = { ...current };
      delete next.serverName;
      delete next.host;
      delete next.port;
      return { ...next, ...newErrors };
    });
    return Object.keys(newErrors).length === 0;
  };

  const validateCredentialsStep = () => {
    const newErrors: Record<string, string> = {};
    const trimmedUsername = username.trim();
    if (!isValidUsername(trimmedUsername)) {
      newErrors.username = "Invalid username.";
    }
    if (authMethod === "password" && !password) {
      newErrors.password = "Password required.\nEnter your VPS password.";
    }
    if (authMethod === "ssh-key" && !sshKeyPath) {
      newErrors.sshKey = "Select a private key.";
    }
    setErrors((current) => {
      const next = { ...current };
      delete next.username;
      delete next.password;
      delete next.sshKey;
      return { ...next, ...newErrors };
    });
    return Object.keys(newErrors).length === 0;
  };

  const validateForm = () => validateServerStep() && validateCredentialsStep();

  const loadSavedProfiles = async () => {
    setProfilesLoading(true);
    setProfilesError("");

    try {
      await hydrateRuntimeFromDesktop();
      setSavedProfiles(await api.profiles());
    } catch (error) {
      setProfilesError(messageFromError(error));
    } finally {
      setProfilesLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const applyConnectedProfile = async (
      activeProfile: Profile,
      options?: { workspaceHint?: string },
    ) => {
      // A live saved profile is always an SSH workspace. This matters after
      // switching from a local folder or after a renderer/HMR restoration.
      setWorkspaceKind("ssh");
      setActiveProfileId(activeProfile.id);
      activeProfileIdRef.current = activeProfile.id;
      setServerName(activeProfile.name);
      setHost(activeProfile.host);
      setPort(String(activeProfile.port));
      setUsername(inferProfileUsername(activeProfile));

      const last = readLastSession();
      const lastWorkspace =
        last.profileId === activeProfile.id &&
        last.workspacePath.startsWith("/")
          ? last.workspacePath
          : "";
      const workspaceToOpen =
        (options?.workspaceHint && options.workspaceHint.startsWith("/")
          ? options.workspaceHint
          : "") ||
        lastWorkspace ||
        activeProfile.defaultWorkspace ||
        "";

      writeLastSession({
        profileId: activeProfile.id,
        workspacePath: workspaceToOpen || last.workspacePath || "",
      });

      if (workspaceToOpen) {
        await activateWorkspaceRef.current(workspaceToOpen, {
          persist: true,
          skipAccessSetup: true,
        });
      } else {
        setConnectionState("connected");
      }
      setShowConnectModal(false);
      setErrors({});
    };

    const restoreBackendConnection = async () => {
      try {
        await hydrateRuntimeFromDesktop();
        if (cancelled) return;

        const startupSession = readLastSession();
        if (
          appPreferences.startupBehavior === "restore-session" &&
          startupSession.profileId === "local" &&
          startupSession.workspacePath &&
          !userOwnedConnectionRef.current &&
          connectionStateRef.current !== "connected" &&
          connectionStateRef.current !== "connecting"
        ) {
          // A local folder does not depend on saved SSH profiles or the SSH
          // connection probe. Restore it immediately; keep the server list fresh
          // in the background for the next time the user opens Welcome.
          void api.profiles().then((profiles) => {
            if (!cancelled) setSavedProfiles(profiles);
          }).catch(() => {});
          await openLocalWorkspace(startupSession.workspacePath);
          return;
        }

        // Sidecar can still be booting — retry a few times before giving up.
        let profiles: Profile[] = [];
        let backendState: { state: string; profileId: string | null } = {
          state: "idle",
          profileId: null,
        };
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          if (cancelled) return;
          try {
            profiles = await api.profiles();
            try {
              backendState = await api.connectionState();
            } catch (error) {
              // Missing endpoint or probe failure → treat as disconnected (never fake "connected").
              if (!isApiNotFound(error)) throw error;
              backendState = { state: "idle", profileId: null };
            }
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            await new Promise((resolve) =>
              window.setTimeout(resolve, 250 + attempt * 150),
            );
          }
        }
        if (lastError) throw lastError;
        if (cancelled) return;

        setSavedProfiles(profiles);

        // The user may already have clicked a saved VPS while this probe was
        // retrying. A stale idle snapshot must not tear that session down.
        if (
          userOwnedConnectionRef.current ||
          connectionStateRef.current === "connected" ||
          connectionStateRef.current === "connecting"
        ) {
          return;
        }

        const last = readLastSession();
        if (
          appPreferences.startupBehavior === "restore-session" &&
          backendState.state !== "connected" &&
          last.profileId
        ) {
          const profile = profiles.find((item) => item.id === last.profileId);
          if (profile) {
            await handleLoadSavedProfile(profile);
            return;
          }
        }

        // Sidecar still has a live SSH session (dev HMR / soft reload only).
        // After a normal app quit we disconnect the VPS, so this stays idle and
        // Welcome shows the saved-servers list until the user connects again.
        // Only restore when the backend reports a real connected profile id.
        if (backendState.state === "connected" && backendState.profileId) {
          const activeProfile = profiles.find(
            (profile) => profile.id === backendState.profileId,
          );
          if (activeProfile) {
            await applyConnectedProfile(activeProfile);
          } else {
            // Stale connected flag without a known profile — force disconnect.
            await api.disconnect().catch(() => {});
            setConnectionState("idle");
          }
        } else {
          setConnectionState("idle");
        }
      } catch {
        // The sidecar may still be starting. Keep the neutral welcome state.
      }
    };

    void restoreBackendConnection();
    return () => {
      cancelled = true;
    };
  }, []);

  const connectWithCurrentBackend = async ({
    name,
    host,
    port,
    username,
    password,
    privateKeyPath,
    privateKeyPassphrase,
  }: {
    name: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    privateKeyPassphrase?: string;
  }) => {
    try {
      const connection = await api.connectDirect({
        name,
        host,
        port,
        username,
        password,
        privateKeyPath,
        privateKeyPassphrase,
      });
      return connection.profileId;
    } catch (error) {
      if (
        isApiNotFound(error) &&
        password &&
        username === "root" &&
        !privateKeyPath
      ) {
        const paired = await api.pairStart({ host, port, phrase: password });
        await api.connectProfile(paired.profileId);
        return paired.profileId;
      }

      if (isApiNotFound(error)) {
        throw new Error(
          "Restart Coloride to load the new backend connection endpoint.",
        );
      }

      throw error;
    }
  };

  const completePendingConnection = async (pending: PendingConnection) => {
    userOwnedConnectionRef.current = true;
    setWorkspaceKind("ssh");
    setConnectionState("connecting");
    setExplorerError("");
    setEditorError("");
    setWorkspacePath("");
    clearRemoteWorkspace();
    clearErrors("connect");

    try {
      await hydrateRuntimeFromDesktop();
      let connectedProfileId: string;
      let sessionUsername =
        pending.kind === "direct"
          ? pending.connection.username
          : inferProfileUsername(pending.profile);

      if (pending.kind === "direct") {
        // The SSH identity selected by the user is the identity for the whole
        // connection. Coloride never replaces it with another Linux account.
        connectedProfileId = await connectWithCurrentBackend({
          ...pending.connection,
          name: pending.connection.name ?? "",
        });
      } else {
        // Saved profiles reconnect with their own stored SSH username. A profile
        // for root stays root; a profile for coloride stays coloride.
        connectedProfileId = (await api.connectProfile(pending.profile.id))
          .profileId;
        setServerName(pending.profile.name);
        setHost(pending.profile.host);
        setPort(String(pending.profile.port));
        setUsername(inferProfileUsername(pending.profile));
        sessionUsername = inferProfileUsername(pending.profile);
      }
      setActiveProfileId(connectedProfileId);
      activeProfileIdRef.current = connectedProfileId;
      // The profile passed by Recent may be stale. Restore workspace metadata
      // only from the profile persisted by the backend after connect.
      const freshProfiles = await api.profiles();
      const connectedProfile = freshProfiles.find(
        (profile) => profile.id === connectedProfileId,
      );
      if (!connectedProfile) {
        throw new Error("The connected server profile could not be reloaded.");
      }
      setSavedProfiles(freshProfiles);
      setServerName(connectedProfile.name);
      setHost(connectedProfile.host);
      setPort(String(connectedProfile.port));
      sessionUsername = inferProfileUsername(connectedProfile);
      setUsername(sessionUsername);
      const last = readLastSession();
      const lastWorkspace =
        last.profileId === connectedProfileId &&
        last.workspacePath.startsWith("/")
          ? last.workspacePath
          : "";
      // Isolated copies are stored as defaultWorkspace. Prefer that over a
      // leftover last path that may still point at a live /var/www tree.
      const workspaceToOpen =
        connectedProfile.defaultWorkspace || lastWorkspace || "";
      writeLastSession({
        profileId: connectedProfileId,
        workspacePath: workspaceToOpen,
      });
      if (workspaceToOpen) {
        await activateWorkspace(workspaceToOpen, {
          persist: true,
          // The isolated copy is already prepared; do not grant the live tree.
          skipAccessSetup: true,
        });
      } else {
        setConnectionState("connected");
      }
      pendingConnectionRef.current = null;
      setHostKeyPrompt(null);
      setShowConnectModal(false);
      setConnectStep("server");
      setErrors({});
    } catch (error) {
      const message = messageFromError(error);
      userOwnedConnectionRef.current = false;
      setConnectionState("failed");
      setActiveProfileId(null);
      void api.disconnect().catch(() => {});
      clearRemoteWorkspace();
      setErrors((current) => ({ ...current, connect: message }));
      throw error;
    }
  };

  const requestHostVerification = async (pending: PendingConnection) => {
    const target =
      pending.kind === "direct" ? pending.connection : pending.profile;
    const inspection = await api.inspectHostKey(target.host, target.port);
    if (inspection.status === "trusted") {
      await completePendingConnection(pending);
      return;
    }

    // First connection: record the server identity and continue without an
    // extra UI step. A changed identity still requires an explicit decision;
    // silently replacing a known SSH key would hide a possible MITM attack.
    if (inspection.status === "unknown") {
      await api.trustHostKey(inspection);
      await completePendingConnection(pending);
      return;
    }

    pendingConnectionRef.current = pending;
    setHostKeyPrompt(inspection);
    setConnectionState("idle");
  };

  const trustPendingHostKey = async () => {
    const prompt = hostKeyPrompt;
    const pending = pendingConnectionRef.current;
    if (!prompt || !pending) return;
    setHostKeyTrusting(true);
    clearErrors("connect");
    try {
      await api.trustHostKey(prompt);
      await completePendingConnection(pending);
    } catch (error) {
      setErrors((current) => ({
        ...current,
        connect: messageFromError(error),
      }));
    } finally {
      setHostKeyTrusting(false);
    }
  };

  const cancelHostKeyPrompt = () => {
    pendingConnectionRef.current = null;
    setHostKeyPrompt(null);
    setConnectionState("idle");
    setConnectStep("credentials");
  };

  // Keep latest tree/editor state available to async watch without stale closures.

  return {
    loadSavedProfiles,
    clearRemoteWorkspace,
    handleConnectionUnavailable,
    completePendingConnection,
    requestHostVerification,
    validateServerStep,
    validateCredentialsStep,
    validateForm,
    cancelWorkspaceSelection,
    cancelHostKeyPrompt,
    trustPendingHostKey,
  };
}
