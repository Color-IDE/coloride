/**
 * External ACP agents (Codex and later registry agents).
 *
 * These types are not Coloride agent providers. `AgentProvider` stays the
 * list of models used by the built-in agent.
 */

export type ExternalAgentDistributionKind = "npx" | "uvx" | "binary";

export type ExternalAgentInstallationStatus =
  | "installed"
  | "installing"
  | "failed"
  | "missing-runtime";

export type ExternalAgentExecutionTarget = "local";

export type ExternalAgentConnectionPhase =
  | "installed"
  | "starting"
  | "needs-login"
  | "authenticating"
  | "ready"
  | "failed"
  | "closed"
  | "unsupported";

export type ExternalAgentTurnState = "idle" | "running" | "cancelling";

/** Coloride id, catalog id, process and ACP conversation are different things. */
export type ExternalAgentSessionIdentity = {
  id: string;
  agentId: string;
  installationVersion: string;
  acpSessionId: string | null;
  workspacePath: string;
  executionTarget: ExternalAgentExecutionTarget;
};

export type ExternalAgentAuthMethod = {
  id: string;
  name: string;
  description?: string | null;
  type: "agent" | "terminal" | "env";
};

export type ExternalAgentCapabilities = {
  loadSession: boolean;
  promptImage: boolean;
  promptAudio: boolean;
  sessionList: boolean;
  sessionDelete: boolean;
  sessionClose: boolean;
  sessionResume: boolean;
  authLogout: boolean;
};

export type ExternalAgentRegistryEntry = {
  id: string;
  name: string;
  version: string;
  description: string;
  repository?: string | null;
  website?: string | null;
  license?: string | null;
  licenseUrl?: string | null;
  icon?: string | null;
  distributionKind: ExternalAgentDistributionKind;
  packageSpec?: string | null;
  installed: boolean;
  installedVersion?: string | null;
};

export type ExternalAgentInstallation = {
  id: string;
  agentId: string;
  name: string;
  version: string;
  distribution: ExternalAgentDistributionKind;
  status: ExternalAgentInstallationStatus;
  error?: string | null;
  installedAt?: string | null;
  packageSpec?: string | null;
  executable?: string | null;
};

export type ExternalAgentSession = ExternalAgentSessionIdentity & {
  installationId: string;
  title: string;
  phase: ExternalAgentConnectionPhase;
  turn: ExternalAgentTurnState;
  processId: string | null;
  supportsLoad: boolean;
  supportsImages?: boolean;
  authMethods: ExternalAgentAuthMethod[];
  configOptions: ExternalAgentConfigOption[];
  error?: string | null;
  updatedAt: string;
};

export type ExternalAgentConfigChoice = {
  value: string;
  name: string;
  description?: string | null;
  group?: string | null;
  groupName?: string | null;
};

export type ExternalAgentConfigOption = {
  id: string;
  name: string;
  description?: string | null;
  category: string | null;
  type: "select" | "boolean";
  currentValue: string | boolean;
  options: ExternalAgentConfigChoice[];
};

export type ExternalAgentConfig = {
  sessionId: string;
  options: ExternalAgentConfigOption[];
  pending: Record<string, string | boolean>;
};

export type ExternalAgentSessionUpdate = {
  sessionUpdate: string;
  [key: string]: unknown;
};

export type ExternalAgentEvent = {
  sessionId: string;
  sequence: number;
  update: ExternalAgentSessionUpdate;
  createdAt: string;
};

export type ExternalAgentPermissionOption = {
  optionId: string;
  name: string;
  kind: string;
};

export type ExternalAgentPermissionRequest = {
  requestId: string;
  sessionId: string;
  toolCallId?: string | null;
  title?: string | null;
  kind?: string | null;
  options: ExternalAgentPermissionOption[];
};

export type ExternalAgentPromptAcceptance = {
  accepted: true;
  sessionId: string;
  turnId: string;
};

export type ExternalAgentTerminalAuth = {
  methodId: string;
  command: string;
  args: string[];
  cwd: string;
};

export type ExternalAgentImage = {
  data: string;
  mimeType: string;
  name: string;
};

/** Account quota, distinct from the conversation context window. */
export type ExternalAgentAccountUsage = {
  agentId: string;
  name: string;
  status: "available" | "unavailable" | "unsupported";
  windows: { usedPercent: number; windowMinutes: number; resetsAt: number | null }[];
  updatedAt: string | null;
};

export type ExternalAgentHistoryEntry = {
  session: ExternalAgentSession;
  firstMessage: string;
  preview: string;
  snippet: string;
  matches: boolean;
};
