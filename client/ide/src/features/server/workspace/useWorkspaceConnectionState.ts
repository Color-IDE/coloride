import { useEffect, useRef, useState } from "react";
import type { HostKeyInfo, Profile } from "../../../shared/api/types";
import {
  readLocalRecentWorkspaces
} from "../../settings/lastSession";
import {
  type AuthMethod,
  type ConnectionState,
  type PendingConnection
} from "./types";

export function useWorkspaceConnectionState() {
  const [showLoadDropdown, setShowLoadDropdown] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  /** Multi-step connect: server → credentials → host key → done. */
  const [connectStep, setConnectStep] = useState<"server" | "credentials">(
    "server",
  );
  const [isDropdownHiding, setIsDropdownHiding] = useState(false);
  const [showKeyDropdown, setShowKeyDropdown] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("password");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [serverName, setServerName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keyPassphrase, setKeyPassphrase] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [savedProfiles, setSavedProfiles] = useState<Profile[]>([]);
  const [localRecentWorkspaces, setLocalRecentWorkspaces] = useState(() =>
    readLocalRecentWorkspaces(),
  );
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceKind, setWorkspaceKind] = useState<"ssh" | "local">("ssh");

  const loadButtonRef = useRef<HTMLButtonElement>(null);

  const loadDropdownRef = useRef<HTMLDivElement>(null);

  const keyDropdownRef = useRef<HTMLDivElement>(null);

  const sshKeyFileInputRef = useRef<HTMLInputElement>(null);

  const pendingConnectionRef = useRef<PendingConnection | null>(null);

  const connectionUnavailableRef = useRef(false);

  const connectionStateRef = useRef(connectionState);

  const workspacePathRef = useRef(workspacePath);

  const activeProfileIdRef = useRef(activeProfileId);

  /** User-started SSH/local session — boot restore must not overwrite it with a stale idle probe. */
  const userOwnedConnectionRef = useRef(false);

  /** Avoid re-persisting the same workspace path in a tight loop. */
  const lastPersistedWorkspaceRef = useRef<string>("");

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    workspacePathRef.current = workspacePath;
  }, [workspacePath]);

  useEffect(() => {
    activeProfileIdRef.current = activeProfileId;
  }, [activeProfileId]);

  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyInfo | null>(null);

  const [hostKeyTrusting, setHostKeyTrusting] = useState(false);
  return {
    hostKeyPrompt,
    hostKeyTrusting,
    setHostKeyPrompt,
    setHostKeyTrusting,
    loadButtonRef,
    loadDropdownRef,
    keyDropdownRef,
    sshKeyFileInputRef,
    pendingConnectionRef,
    connectionUnavailableRef,
    connectionStateRef,
    workspacePathRef,
    activeProfileIdRef,
    userOwnedConnectionRef,
    lastPersistedWorkspaceRef,
    showLoadDropdown,
    setShowLoadDropdown,
    showConnectModal,
    setShowConnectModal,
    connectStep,
    setConnectStep,
    isDropdownHiding,
    setIsDropdownHiding,
    showKeyDropdown,
    setShowKeyDropdown,
    authMethod,
    setAuthMethod,
    sshKeyPath,
    setSshKeyPath,
    showPassword,
    setShowPassword,
    serverName,
    setServerName,
    host,
    setHost,
    port,
    setPort,
    username,
    setUsername,
    password,
    setPassword,
    keyPassphrase,
    setKeyPassphrase,
    errors,
    setErrors,
    connectionState,
    setConnectionState,
    activeProfileId,
    setActiveProfileId,
    savedProfiles,
    setSavedProfiles,
    localRecentWorkspaces,
    setLocalRecentWorkspaces,
    profilesLoading,
    setProfilesLoading,
    profilesError,
    setProfilesError,
    workspacePath,
    setWorkspacePath,
    workspaceKind,
    setWorkspaceKind,
  };
}
