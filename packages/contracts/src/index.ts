export type ConnState = "idle" | "connecting" | "connected" | "degraded" | "reconnecting" | "failed";

export type ConnStats = {
  rttMs: number;
  upBps: number;
  downBps: number;
  certTtlSec: number;
  server?: {
    cpu: number;
    memPct: number;
    diskPct: number;
  };
};

export type DashboardResource = { usedBytes: number; totalBytes: number; pct: number };

export type ServerDashboard = {
  capturedAt: string;
  cpuPct: number;
  load1m: number;
  load5m: number;
  load15m: number;
  memory: DashboardResource;
  swap: DashboardResource;
  disk: DashboardResource;
  diskReadBps: number;
  diskWriteBps: number;
  upBps: number;
  downBps: number;
  processes: { pid: number; name: string; cpuPct: number; memoryBytes: number }[];
  services: { name: string; status: string; description: string }[];
  ports: { port: number; protocol: string; address: string }[];
  logs: { timestamp?: string | null; source: string; level: string; message: string }[];
};

export type AuthorizedKey = {
  id: string;
  algorithm: string;
  fingerprint: string;
  comment: string;
};

export type AgentId = "coloride" | "claude-code" | "codex" | "gemini" | "aider" | "opencode" | string;

export type AgentInfo = {
  id: AgentId;
  name: string;
  version: string;
  installed: boolean;
  needsKey: boolean;
  supported: boolean;
};

export type AgentProvider = "openai" | "xai" | "fireworks" | "gemini";

export type AgentProviderAvailability =
  | "loading"
  | "available"
  | "missing_credentials"
  | "auth_expired"
  | "incompatible"
  | "connection_error";

export type AgentTaskOutcome =
  | "completed"
  | "pending_verification"
  | "blocked"
  | "stopped"
  | "failed"
  | "running"
  | "unknown";

export type AgentProviderConfig = {
  provider: AgentProvider;
  model: string;
  baseUrl: string;
  configured: boolean;
  availability?: AgentProviderAvailability;
  credentialSource: "environment" | "keychain" | "coloride" | "none";
  /** True when calls go through api.coloride.com (plan credits), not BYOK. */
  managedLlm?: boolean;
  capabilities: {
    tools?: boolean;
    streaming: boolean;
    encryptedReasoning: boolean;
    maxContextCharacters: number;
    /** Full model context window in tokens (e.g. Grok 4.5 = 500_000). */
    maxContextTokens: number;
    maxRetries: number;
  };
};

export type AgentMCPServer = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  headerEnv: Record<string, string>;
  status: "configured" | "ready" | "disabled" | "error";
  error: string;
};

export type AgentMetrics = {
  private: true;
  records: number;
  turns: number;
  completedTurns: number;
  failedTurns: number;
  toolCalls: number;
  toolFailures: number;
  checkpoints: number;
  compactions: number;
  inputTokens: number;
  outputTokens: number;
  averageTurnMs: number;
  topTools: { name: string; calls: number }[];
};

export type AgentEvaluation = {
  sessionId: string;
  state: AgentSessionState;
  completed: boolean;
  toolCalls: number;
  toolFailures: number;
  unresolvedTools: number;
  approvalsRequested: number;
  approvalsResolved: number;
  checkpoints: number;
  compactions: number;
  diffs: number;
  errors: number;
  mutationCalls: number;
  protectedMutations: number;
  passedChecks: number;
  totalChecks: number;
  checks: { id: string; label: string; passed: boolean; detail: string }[];
};

export type AgentMode = "ask" | "plan" | "debug" | "act";
export type AgentAccessLevel = "request" | "agent" | "full";

export type AgentSessionState =
  | "starting"
  | "idle"
  | "running"
  | "waiting-approval"
  | "paused-guard"
  | "stopped"
  | "failed";

export type AgentPlanStepStatus = "pending" | "in_progress" | "done" | "skipped";

export type AgentPlanStep = {
  id: string;
  title: string;
  detail?: string | null;
  status: AgentPlanStepStatus;
  note?: string | null;
};

export type AgentPlanStatus =
  | "drafting"
  | "ready"
  | "implementing"
  | "completed"
  | "dismissed";

export type AgentPlan = {
  id: string;
  sessionId: string;
  title: string;
  summary?: string | null;
  steps: AgentPlanStep[];
  status: AgentPlanStatus;
  createdAt: string;
  updatedAt: string;
};

export type AgentReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export type TaskBudget = {
  maxFreshTokens: number;
  maxRuntimeMs: number;
  maxHardStops: number;
  maxConsecutiveProviderErrors: number;
};

export type TaskBudgetUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  freshTokens: number;
  modelCalls: number;
  toolCalls: number;
  runtimeMs: number;
  consecutiveProviderErrors: number;
};

export type GuardReason =
  | "runaway"
  | "fresh-tokens"
  | "runtime"
  | "provider-errors"
  | "context"
  | "out-of-credits";

export type GuardPause = {
  reason: GuardReason;
  message: string;
  actions: string[];
  strategyId: number;
  budget: TaskBudget;
  usage: TaskBudgetUsage;
};

export type AgentChatHistoryEntry = {
  sessionId: string;
  firstMessage: string;
  preview: string;
  snippet: string;
  matches: boolean;
};

export type AgentSessionSummary = {
  sessionId: string;
  agent: AgentId;
  task: string;
  cwd: string;
  workspaceKind?: "local" | "ssh";
  connectionId?: string | null;
  filesystemScope?: "workspace" | "server";
  mode: AgentMode;
  accessLevel?: AgentAccessLevel;
  state: AgentSessionState;
  model?: string | null;
  spentUsd: number;
  budgetUsd?: number | null;
  budget?: TaskBudget | null;
  budgetUsage?: TaskBudgetUsage | null;
  guardPause?: GuardPause | null;
  reasoningEffort?: AgentReasoningEffort | null;
  preferredLinuxUser?: "admin" | "coloride" | null;
  startedAt: string;
  updatedAt: string;
  lastError?: string | null;
  /** Persisted on disk — survives app restarts. */
  archived?: boolean;
  plan?: AgentPlan | null;
};

export type AgentApprovalState = "pending" | "approved" | "declined" | "cancelled" | "expired";

export type AgentApproval = {
  id: string;
  sessionId: string;
  kind: string;
  title: string;
  details: Record<string, unknown>;
  state: AgentApprovalState;
  createdAt: string;
  resolvedAt?: string | null;
};

export type AgentTool = {
  id: string;
  name: string;
  description: string;
  risk: "read" | "write" | "execute";
  modes: AgentMode[];
};

export type AgentCheckpoint = {
  id: string;
  sessionId: string;
  tool: string;
  callId: string;
  cwd: string;
  createdAt: string;
  paths: { path: string; kind: string }[];
};

export type Profile = {
  id: string;
  name: string;
  host: string;
  port: number;
  provider: "do" | "hetzner" | "aws" | "other";
  deviceId: string;
  createdAt: string;
  defaultWorkspace?: string | null;
  defaultShell: "default" | "bash" | "zsh" | "fish";
  terminalPersistence: boolean;
  monitorInterval: 2 | 5 | 10 | 30;
  accessMode: "restricted";
  allowedRoots: string[];
};

export type ProfileUpdateRequest = {
  name?: string;
  defaultWorkspace?: string;
  defaultShell?: "default" | "bash" | "zsh" | "fish";
  terminalPersistence?: boolean;
  monitorInterval?: 2 | 5 | 10 | 30;
};

export type ServerSettings = {
  profileId: string;
  authenticationMethod: "password" | "private-key" | "certificate" | "ssh-agent";
  hostKeyStatus: "trusted" | "unknown";
  hostKeyAlgorithm?: string | null;
  hostKeyFingerprint?: string | null;
  hostname: string;
  operatingSystem: string;
  architecture: string;
  kernel: string;
  uptimeSeconds: number;
};

export type HostKeyInfo = {
  algorithm: string;
  fingerprint: string;
  host: string;
  port: number;
  publicKey: string;
  status: "unknown" | "trusted" | "changed";
  trustedFingerprint?: string | null;
};

export type PairStartRequest = {
  host: string;
  port?: number;
  phrase: string;
};

export type PairStartResponse = {
  profileId: string;
  certExpiresAt: string;
};

export type FileMkdirRequest = {
  path: string;
};

export type FileDeleteRequest = {
  path: string;
};

export type FileRenameRequest = {
  oldPath: string;
  newPath: string;
};

export type BugReportCategory = "editor" | "terminal" | "connection" | "files" | "agent" | "other";

export type BugReportRequest = {
  categories: BugReportCategory[];
  description: string;
  includeDiagnostics: boolean;
};

export type BugReportResponse = {
  reportId: string;
  createdAt: string;
  storedLocally: boolean;
};

export type AgentEventType =
  | "user_message"
  | "activity"
  | "text"
  | "text_delta"
  | "text_replace"
  | "reasoning_delta"
  | "plan_delta"
  | "plan_updated"
  | "tool_call"
  | "tool_progress"
  | "tool_output"
  | "tool_result"
  | "file_write_delta"
  | "diff"
  | "diff_preview"
  | "context_compacted"
  | "context_snapshot"
  | "checkpoint_created"
  | "checkpoint_restored"
  | "approval_required"
  | "approval_resolved"
  | "guard_paused"
  | "guard_resolved"
  | "progress_observed"
  | "soft_replan"
  | "trajectory_abandoned"
  | "mode_changed"
  | "reasoning_changed"
  | "cloud_session_refreshing"
  | "workspace_changed"
  | "status"
  | "usage"
  | "error"
  | "done"
  | "loop_warning"
  | "task_outcome"
  | "task_recovery";

export type AgentEvent = {
  id: string;
  sessionId: string;
  sequence: number;
  type: AgentEventType;
  data: Record<string, unknown>;
  createdAt: string;
};

/** A terminal created by an agent and adopted by the native IDE terminal UI. */
export type AgentTerminalReference = {
  termId: string;
  sessionId: string;
  title: string | null;
  cwd: string | null;
  workspaceKind: "local" | "ssh";
  connectionId: string | null;
  agentSessionId: string | null;
  workspacePath: string | null;
  revealed?: boolean;
};

export type EventEnvelope =
  | { event: "conn:state"; payload: { state: ConnState; profileId?: string | null } }
  | { event: "conn:stats"; payload: ConnStats }
  | { event: "agent:event"; payload: AgentEvent }
  | { event: "agent:cost"; payload: { sessionId: string; spentUsd: number; budgetUsd?: number } }
  | { event: "agent:state"; payload: { sessionId: string; state: string } }
  | { event: "term:reveal"; payload: AgentTerminalReference }
  | { event: "term:exit"; payload: { termId: string; code: number | null } }
  | { event: string; payload: Record<string, unknown> };
