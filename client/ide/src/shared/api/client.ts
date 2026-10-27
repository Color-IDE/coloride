import type {
  AgentApproval,
  AgentInfo,
  AgentMode,
  AgentSessionSummary,
  AgentTool,
  AuthorizedKey,
  BrowserOpenResponse,
  BrowserScreenshotResponse,
  BrowserSessionInfo,
  BugReportRequest,
  BugReportResponse,
  ConnDirectRequest,
  ConnInfo,
  ConnState,
  ConnStats,
  EventEnvelope,
  FileContentSearchResponse,
  FileListResponse,
  FileNameSearchResponse,
  FileReadResponse,
  FileStatResponse,
  FileUnifiedSearchResponse,
  FileWriteResponse,
  GitHistoryCommit,
  GitSafeStatus,
  HostKeyInfo,
  LspLanguage,
  LspSessionInfo,
  PairStartResponse,
  Profile,
  ServerDashboard,
} from "./types";

/** Attachment metadata sent with agent messages (images get vision on the backend). */
export type AgentMessageAttachmentPayload = {
  name: string;
  kind: "image" | "file" | "code";
  mime: string;
  size: number;
  path?: string | null;
  previewDataUrl?: string | null;
  startLine?: number;
  endLine?: number;
};

let runtimeConfig: ColorideRuntimeConfig = window.__COLORIDE__ ?? window.__FORGE__ ?? { port: 8788, token: "dev-token" };

export async function hydrateRuntimeFromDesktop(): Promise<ColorideRuntimeConfig> {
  if (window.colorideDesktop) {
    runtimeConfig = await window.colorideDesktop.getRuntime();
    window.__COLORIDE__ = runtimeConfig;
  }
  return runtimeConfig;
}

const runtime = (): ColorideRuntimeConfig => {
  return runtimeConfig;
};

/** Current local sidecar base URL (after hydrateRuntimeFromDesktop). */
export const getLocalApiBase = () => `http://${runtime().host ?? "127.0.0.1"}:${runtime().port}`;
/** Current local sidecar bearer token. */
export const getLocalApiToken = () => runtime().token;

const apiBase = () => getLocalApiBase();
const wsBase = () => `ws://${runtime().host ?? "127.0.0.1"}:${runtime().port}`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${runtime().token}`,
      ...init.headers
    }
  });

  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    try {
      const parsed = JSON.parse(raw) as { message?: unknown; detail?: unknown; code?: unknown };
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        message = parsed.message.trim();
      } else if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        message = parsed.detail.trim();
      }
    } catch {
      // Plain-text errors already contain the most useful user-facing message.
    }
    if (import.meta.env.DEV) {
      // Browser DevTools otherwise only shows a bare 400/503. Do not include
      // request bodies or authorization headers: they can contain paths,
      // prompts, or credentials.
      console.error("[coloride][api] request failed", {
        method: init.method ?? "GET",
        path,
        status: response.status,
        message: message || response.statusText,
      });
    }
    throw new Error(`Coloride API ${response.status}: ${message || response.statusText}`);
  }

  return (await response.json()) as T;
}

export function decodeBase64ToText(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeTextToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
}

/** Encode raw bytes (images, binaries) for `/api/files/write`. */
export function encodeBytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let index = 0; index < view.length; index += 0x8000) {
    binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export const api = {
  health: () => request<{ status: string }>("/api/health"),
  profiles: () => request<Profile[]>("/api/profiles"),
  updateProfile: (profileId: string, body: {
    name?: string;
    defaultWorkspace?: string;
    defaultShell?: "default" | "bash" | "zsh" | "fish";
    terminalPersistence?: boolean;
    monitorInterval?: 2 | 5 | 10 | 30;
  }) =>
    request<Profile>(`/api/profiles/${encodeURIComponent(profileId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteProfile: (profileId: string) =>
    request<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE"
    }),
  connectDirect: (body: ConnDirectRequest) =>
    request<ConnInfo>("/api/conn/connect-direct", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  connectProfile: (profileId: string) =>
    request<ConnInfo>("/api/conn/connect", {
      method: "POST",
      body: JSON.stringify({ profileId })
    }),
  pairStart: (body: { host: string; port: number; phrase: string }) =>
    request<PairStartResponse>("/api/pair/start", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  disconnect: () =>
    request<{ ok: boolean }>("/api/conn/disconnect", {
      method: "POST",
      body: JSON.stringify({})
    }),
  connectionState: () =>
    request<{ state: ConnState; profileId: string | null; socksPort?: number | null }>("/api/conn/state"),
  connStats: () => request<ConnStats>("/api/conn/stats"),
  reconnect: () => request<ConnInfo>("/api/conn/reconnect", { method: "POST", body: JSON.stringify({}) }),
  serverDashboard: () => request<ServerDashboard>("/api/server/dashboard"),
  serverSettings: () => request<import("@coloride/contracts").ServerSettings>("/api/server/settings"),
  authorizedKeys: () => request<{ keys: AuthorizedKey[] }>("/api/server/authorized-keys"),
  addAuthorizedKey: (publicKey: string) =>
    request<{ keys: AuthorizedKey[] }>("/api/server/authorized-keys", {
      method: "POST",
      body: JSON.stringify({ publicKey })
    }),
  deleteAuthorizedKey: (keyId: string) =>
    request<{ keys: AuthorizedKey[] }>(`/api/server/authorized-keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE"
    }),
  inspectHostKey: (host: string, port: number) =>
    request<HostKeyInfo>("/api/conn/host-key/inspect", {
      method: "POST",
      body: JSON.stringify({ host, port })
    }),
  trustHostKey: (body: Pick<HostKeyInfo, "host" | "port" | "fingerprint" | "publicKey">) =>
    request<HostKeyInfo>("/api/conn/host-key/trust", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  forgetHostKey: (host: string, port: number) =>
    request<{ ok: boolean }>("/api/conn/host-key/forget", {
      method: "POST",
      body: JSON.stringify({ host, port })
    }),
  listFiles: (path: string, offset = 0, limit = 500) =>
    request<FileListResponse>("/api/files/list", {
      method: "POST",
      body: JSON.stringify({ path, offset, limit })
    }),
  searchFiles: (path: string, query: string, include = "", limit = 100) =>
    request<FileNameSearchResponse>("/api/files/search", {
      method: "POST",
      body: JSON.stringify({ path, query, include, limit, mode: "name" })
    }),
  searchFileContents: (
    path: string,
    query: string,
    options?: { include?: string; limit?: number; caseSensitive?: boolean },
  ) =>
    request<FileContentSearchResponse>("/api/files/search", {
      method: "POST",
      body: JSON.stringify({
        path,
        query,
        include: options?.include ?? "",
        limit: options?.limit ?? 80,
        mode: "content",
        caseSensitive: options?.caseSensitive ?? false,
      })
    }),
  /** Filenames + content in one SSH round-trip (fast default UI). */
  searchWorkspace: (
    path: string,
    query: string,
    options?: {
      include?: string;
      caseSensitive?: boolean;
      nameLimit?: number;
      contentLimit?: number;
    },
  ) =>
    request<FileUnifiedSearchResponse>("/api/files/search", {
      method: "POST",
      body: JSON.stringify({
        path,
        query,
        include: options?.include ?? "",
        mode: "all",
        caseSensitive: options?.caseSensitive ?? false,
        nameLimit: options?.nameLimit ?? 40,
        contentLimit: options?.contentLimit ?? 80,
      })
    }),
  readFile: (path: string) =>
    request<FileReadResponse>("/api/files/read", {
      method: "POST",
      body: JSON.stringify({ path })
    }),
  /** Lightweight remote probe (etag/mtime) for external-change detection. */
  statFiles: (paths: string | string[]) =>
    request<FileStatResponse>("/api/files/stat", {
      method: "POST",
      body: JSON.stringify(Array.isArray(paths) ? { paths } : { path: paths }),
    }),
  writeFile: (path: string, content: string, etag?: string | null) =>
    request<FileWriteResponse>("/api/files/write", {
      method: "POST",
      body: JSON.stringify({ path, content, etag: etag ?? undefined })
    }),
  /** Read through the workspace grant owned by one agent chat. */
  readAgentSessionFile: (sessionId: string, path: string) =>
    request<FileReadResponse>(
      `/api/agents/sessions/${encodeURIComponent(sessionId)}/files/read`,
      {
        method: "POST",
        body: JSON.stringify({ path }),
      },
    ),
  /** Write through the workspace grant owned by one agent chat. */
  writeAgentSessionFile: (
    sessionId: string,
    path: string,
    content: string,
    etag?: string | null,
  ) =>
    request<FileWriteResponse>(
      `/api/agents/sessions/${encodeURIComponent(sessionId)}/files/write`,
      {
        method: "POST",
        body: JSON.stringify({ path, content, etag: etag ?? undefined }),
      },
    ),
  mkdir: (path: string) =>
    request<{ ok: boolean }>("/api/files/mkdir", {
      method: "POST",
      body: JSON.stringify({ path })
    }),
  deleteFile: (path: string, recursive = false) =>
    request<{ ok: boolean }>("/api/files/delete", {
      method: "POST",
      body: JSON.stringify({ path, recursive })
    }),
  renameFile: (oldPath: string, newPath: string) =>
    request<{ ok: boolean }>("/api/files/rename", {
      method: "POST",
      body: JSON.stringify({ oldPath, newPath })
    }),
  copyFile: (sourcePath: string, destPath: string) =>
    request<{ ok: boolean }>("/api/files/copy", {
      method: "POST",
      body: JSON.stringify({ sourcePath, destPath })
    }),
  listBrowsers: () => request<BrowserSessionInfo[]>("/api/browser/sessions"),
  openBrowser: (body: { url: string; browserId?: string; owner?: string }) =>
    request<BrowserOpenResponse>("/api/browser/open", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  browserScreenshot: (browserId: string) =>
    request<BrowserScreenshotResponse>(`/api/browser/${encodeURIComponent(browserId)}/screenshot`),
  closeBrowser: (browserId: string) =>
    request<{ ok: boolean; browserId: string }>(`/api/browser/${encodeURIComponent(browserId)}/close`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  createTerminal: (body: {
    cols: number;
    rows: number;
    cwd?: string;
    sessionId: string;
    sessionName?: string;
    workspaceKind: "local" | "ssh";
    connectionId?: string | null;
  }) =>
    request<{ termId: string; sessionId: string; restored: boolean }>("/api/term/create", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  resizeTerminal: (termId: string, body: { cols: number; rows: number }) =>
    request<{ ok: boolean }>(`/api/term/${termId}/resize`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  closeTerminal: (termId: string) =>
    request<{ ok: boolean }>(`/api/term/${termId}/close`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  clearTerminal: (termId: string) =>
    request<{ ok: boolean }>(`/api/term/${termId}/clear`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  suspendTerminal: (termId: string) =>
    request<{ ok: boolean }>(`/api/term/${termId}/suspend`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  listTerminals: (body: { workspaceKind?: "local" | "ssh"; connectionId?: string | null } = {}) => {
    const params = new URLSearchParams();
    if (body.workspaceKind) params.set("workspaceKind", body.workspaceKind);
    if (body.connectionId) params.set("connectionId", body.connectionId);
    const query = params.toString();
    return request<Array<{
      termId: string;
      sessionId: string;
      cwd: string | null;
      workspaceKind: "local" | "ssh";
      status: string;
      connectionId: string | null;
      title: string | null;
      agentSessionId: string | null;
      workspacePath: string | null;
      revealed: boolean;
    }>>(`/api/term${query ? `?${query}` : ""}`);
  },
  attachTerminal: (sessionId: string, identity: { workspaceKind?: "local" | "ssh"; connectionId?: string | null } = {}) => {
    const params = new URLSearchParams();
    if (identity.workspaceKind) params.set("workspaceKind", identity.workspaceKind);
    if (identity.connectionId) params.set("connectionId", identity.connectionId);
    const query = params.toString();
    return request<{ termId: string; sessionId: string; restored: boolean }>(`/api/term/session/${encodeURIComponent(sessionId)}/attach${query ? `?${query}` : ""}`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },
  terminalInfo: (termId: string) =>
    request<{ foreground: string; cwd: string | null }>(`/api/term/${termId}/info`),
  createBugReport: (body: BugReportRequest) =>
    request<BugReportResponse>("/api/reports", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  agentsAvailable: () => request<AgentInfo[]>("/api/agents/available"),
  agentConfig: () =>
    request<import("@coloride/contracts").AgentProviderConfig>("/api/agents/config"),
  updateAgentConfig: (body: {
    provider: import("@coloride/contracts").AgentProvider;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }) => request<import("@coloride/contracts").AgentProviderConfig>("/api/agents/config", {
    method: "PUT",
    body: JSON.stringify(body)
  }),
  /** Push cloud user JWT so the Python agent can call managed /v1/llm/responses. */
  setCloudAgentToken: (accessToken: string | null) =>
    accessToken && accessToken.trim()
      ? request<{ ok: boolean }>("/api/cloud-auth/agent-token", {
          method: "PUT",
          body: JSON.stringify({ accessToken: accessToken.trim() }),
        })
      : request<{ ok: boolean }>("/api/cloud-auth/agent-token", {
          method: "DELETE",
        }),
  agentTools: () => request<AgentTool[]>("/api/agents/tools"),
  agentIntegrations: () =>
    request<import("@coloride/contracts").AgentMCPServer[]>("/api/agents/integrations"),
  agentMetrics: () =>
    request<import("@coloride/contracts").AgentMetrics>("/api/agents/metrics"),
  agentDebugLog: (query?: { after?: number; tail?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (query?.after != null) params.set("after", String(query.after));
    if (query?.tail != null) params.set("tail", String(query.tail));
    if (query?.limit != null) params.set("limit", String(query.limit));
    const search = params.toString();
    const suffix = search ? `?${search}` : "";
    return request<{
      path: string;
      after: number;
      nextAfter: number;
      total: number;
      entries: Array<Record<string, unknown> & { msg?: string; ts?: string; line?: number; sessionId?: string }>;
    }>(`/api/agents/debug-log${suffix}`);
  },
  updateAgentIntegrations: (mcpServers: Array<Pick<import("@coloride/contracts").AgentMCPServer, "id" | "name" | "url" | "enabled" | "headerEnv">>) =>
    request<import("@coloride/contracts").AgentMCPServer[]>("/api/agents/integrations", {
      method: "PUT",
      body: JSON.stringify({ mcpServers }),
    }),
  startLinearOAuth: () =>
    request<{ status: string; error: string; authorizeUrl: string }>(
      "/api/agents/integrations/linear/oauth/start",
      { method: "POST" },
    ),
  linearOAuthStatus: () =>
    request<{ status: string; error: string; authorizeUrl: string }>(
      "/api/agents/integrations/linear/oauth/status",
    ),
  cancelLinearOAuth: () =>
    request<{ status: string; error: string; authorizeUrl: string }>(
      "/api/agents/integrations/linear/oauth/cancel",
      { method: "POST" },
    ),
  saveLinearCredentials: (accessToken: string) =>
    request<import("@coloride/contracts").AgentMCPServer[]>("/api/agents/integrations/linear/credentials", {
      method: "POST",
      body: JSON.stringify({ accessToken }),
    }),
  agentSessions: (filter?: {
    cwd?: string | null;
    workspaceKind?: "local" | "ssh";
    connectionId?: string | null;
    filesystemScope?: "workspace" | "server";
  }) => {
    const params = new URLSearchParams();
    if (filter?.cwd) params.set("cwd", filter.cwd);
    if (filter?.workspaceKind) params.set("workspaceKind", filter.workspaceKind);
    if (filter?.connectionId) params.set("connectionId", filter.connectionId);
    if (filter?.filesystemScope) params.set("filesystemScope", filter.filesystemScope);
    const query = params.toString();
    return request<AgentSessionSummary[]>(`/api/agents/sessions${query ? `?${query}` : ""}`);
  },
  agentChatHistory: (filter: { workspaceKind: "local" | "ssh"; connectionId?: string | null; filesystemScope: "workspace" | "server"; query?: string }) => {
    const params = new URLSearchParams({ workspaceKind: filter.workspaceKind, filesystemScope: filter.filesystemScope });
    if (filter.connectionId) params.set("connectionId", filter.connectionId);
    if (filter.query) params.set("q", filter.query);
    return request<import("@coloride/contracts").AgentChatHistoryEntry[]>(`/api/agents/sessions/history?${params}`);
  },
  agentSession: (sessionId: string) =>
    request<AgentSessionSummary>(`/api/agents/sessions/${encodeURIComponent(sessionId)}`),
  updateAgentWorkspace: (
    sessionId: string,
    body: { cwd: string; workspaceKind: "local" | "ssh"; connectionId?: string | null },
  ) => request<AgentSessionSummary>(`/api/agents/sessions/${encodeURIComponent(sessionId)}/workspace`, {
    method: "PUT",
    body: JSON.stringify(body),
  }),
  // Match the backend cap so long chats reload without losing early turns.
  agentDebugDump: (sessionId: string) =>
    request<{
      path: string;
      fileName: string;
      bytes: number;
      eventCount: number;
      content: string;
    }>(`/api/agents/sessions/${encodeURIComponent(sessionId)}/debug-dump`),
  agentEvents: (sessionId: string, limit = 20_000) =>
    request<import("@coloride/contracts").AgentEvent[]>(
      `/api/agents/sessions/${encodeURIComponent(sessionId)}/events?limit=${limit}`
    ),
  agentEventsPage: (
    sessionId: string,
    options: { beforeSequence?: number; turns?: number; limit?: number } = {},
  ) => {
    const params = new URLSearchParams();
    params.set("limit", String(options.limit ?? 20_000));
    if (options.beforeSequence != null) {
      params.set("before_sequence", String(options.beforeSequence));
    }
    if (options.turns != null) params.set("turns", String(options.turns));
    return request<import("@coloride/contracts").AgentEvent[]>(
      `/api/agents/sessions/${encodeURIComponent(sessionId)}/events?${params.toString()}`,
    );
  },
  agentApprovals: (sessionId: string) =>
    request<AgentApproval[]>(`/api/agents/sessions/${encodeURIComponent(sessionId)}/approvals`),
  agentCheckpoints: (sessionId: string) =>
    request<import("@coloride/contracts").AgentCheckpoint[]>(
      `/api/agents/sessions/${encodeURIComponent(sessionId)}/checkpoints`
    ),
  agentEvaluation: (sessionId: string) =>
    request<import("@coloride/contracts").AgentEvaluation>(
      `/api/agents/sessions/${encodeURIComponent(sessionId)}/evaluation`
    ),
  restoreAgentCheckpoint: (sessionId: string, checkpointId: string) =>
    request<{ checkpoint: import("@coloride/contracts").AgentCheckpoint; rollbackCheckpoint?: import("@coloride/contracts").AgentCheckpoint | null }>(
      "/api/agents/session/checkpoint/restore",
      {
        method: "POST",
        body: JSON.stringify({ sessionId, checkpointId })
      }
    ),
  startAgentSession: (body: {
    agent: string;
    task?: string;
    cwd: string;
    workspaceKind: "local" | "ssh";
    connectionId?: string;
    filesystemScope?: "workspace" | "server";
    mode: AgentMode;
    accessLevel: "request" | "agent" | "full";
    budgetUsd?: number;
    budget?: import("@coloride/contracts").TaskBudget;
    reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
    attachments?: AgentMessageAttachmentPayload[];
    pluginIds?: string[];
  }) =>
    request<{ sessionId: string }>("/api/agents/session/start", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  sendAgentMessage: (
    sessionId: string,
    message: string,
    options?: {
      reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
      attachments?: AgentMessageAttachmentPayload[];
      pluginIds?: string[];
    },
  ) =>
    request<{ ok: boolean }>("/api/agents/session/send", {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        message,
        ...(options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
        ...(options?.attachments?.length ? { attachments: options.attachments } : {}),
        ...(options?.pluginIds !== undefined ? { pluginIds: options.pluginIds } : {}),
      })
    }),
  stopAgentSession: (sessionId: string) =>
    request<{ ok: boolean }>("/api/agents/session/stop", {
      method: "POST",
      body: JSON.stringify({ sessionId })
    }),
  forkAgentSession: (sessionId: string) =>
    request<{ sessionId: string }>("/api/agents/session/fork", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
  setAgentMode: (sessionId: string, mode: AgentMode) =>
    request<AgentSessionSummary>("/api/agents/session/mode", {
      method: "POST",
      body: JSON.stringify({ sessionId, mode })
    }),
  setAgentAccess: (sessionId: string, accessLevel: "request" | "agent" | "full") =>
    request<AgentSessionSummary>("/api/agents/session/access", {
      method: "POST",
      body: JSON.stringify({ sessionId, accessLevel })
    }),
  setAgentReasoning: (sessionId: string, reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh" | "max") =>
    request<AgentSessionSummary>("/api/agents/session/reasoning", {
      method: "POST",
      body: JSON.stringify({ sessionId, reasoningEffort })
    }),
  archiveAgentSession: (sessionId: string, archived = true) =>
    request<AgentSessionSummary>("/api/agents/session/archive", {
      method: "POST",
      body: JSON.stringify({ sessionId, archived }),
    }),
  getAgentPlan: (sessionId: string) =>
    request<import("@coloride/contracts").AgentPlan>(
      `/api/agents/sessions/${encodeURIComponent(sessionId)}/plan`,
    ),
  updateAgentPlan: (
    sessionId: string,
    body: {
      title?: string;
      summary?: string | null;
      steps?: import("@coloride/contracts").AgentPlanStep[];
    },
  ) =>
    request<import("@coloride/contracts").AgentPlan>("/api/agents/session/plan", {
      method: "PUT",
      body: JSON.stringify({ sessionId, ...body }),
    }),
  implementAgentPlan: (
    sessionId: string,
    body?: {
      title?: string;
      summary?: string | null;
      steps?: import("@coloride/contracts").AgentPlanStep[];
    },
  ) =>
    request<AgentSessionSummary>("/api/agents/session/plan/implement", {
      method: "POST",
      body: JSON.stringify({ sessionId, ...(body || {}) }),
    }),
  dismissAgentPlan: (sessionId: string) =>
    request<import("@coloride/contracts").AgentPlan>("/api/agents/session/plan/dismiss", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
  resolveAgentApproval: (
    approvalId: string,
    decision: "approve" | "approve-session" | "decline" | "cancel"
  ) =>
    request<{ ok: boolean }>("/api/agents/session/approval", {
      method: "POST",
      body: JSON.stringify({ approvalId, decision })
    }),
  resolveAgentGuard: (
    sessionId: string,
    action: "retry-strategy" | "continue-once" | "update-budget" | "stop",
    budget?: import("@coloride/contracts").TaskBudget,
  ) =>
    request<{ ok: boolean }>(
      `/api/agents/sessions/${encodeURIComponent(sessionId)}/guard/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ action, ...(budget ? { budget } : {}) }),
      },
    ),
  events: (onEvent: (event: EventEnvelope) => void) => {
    const token = encodeURIComponent(runtime().token);
    const socket = new WebSocket(`${wsBase()}/ws/events?token=${token}`);
    socket.addEventListener("message", (message) => onEvent(JSON.parse(message.data) as EventEnvelope));
    return socket;
  },
  terminal: (termId: string, resume?: { offset: number | null }) => {
    const token = encodeURIComponent(runtime().token);
    return new WebSocket(`${wsBase()}/ws/term/${termId}?token=${token}${resume ? `&protocol=2${resume.offset === null ? "" : `&offset=${resume.offset}`}` : ""}`);
  },
  browserStream: (browserId: string) => {
    const token = encodeURIComponent(runtime().token);
    return new WebSocket(
      `${wsBase()}/ws/browser/${encodeURIComponent(browserId)}?token=${token}`,
    );
  },
  lspStart: (language: LspLanguage, rootPath: string) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 180_000);
    return request<LspSessionInfo>("/api/lsp/sessions", {
      method: "POST",
      body: JSON.stringify({ language, rootPath }),
      signal: controller.signal,
    }).finally(() => {
      window.clearTimeout(timer);
    });
  },
  lspStop: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/lsp/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }),
  lspSocket: (sessionId: string) => {
    const token = encodeURIComponent(runtime().token);
    return new WebSocket(`${wsBase()}/ws/lsp/${encodeURIComponent(sessionId)}?token=${token}`);
  },
  /** Provision restricted `coloride` user on the connected VPS (bootstrap session). */
  setupRestricted: () =>
    request<{ profileId: string; username: string; allowedRoots: string[] }>("/api/conn/setup-restricted", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  grantWorkspace: (path: string) =>
    request<{
      path: string;
      allowedRoots: string[];
      sessionUser?: string;
      elevated?: boolean;
    }>("/api/workspaces/grant", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  openWorkspace: (path: string) =>
    request<{
      path: string;
      sourcePath: string;
      environment: "development" | "production";
      allowedRoots: string[];
      sessionUser?: string;
      elevated?: boolean;
    }>("/api/workspaces/open", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  prepareAgentWorkspace: (path: string) =>
    request<{
      path: string;
      sourcePath: string;
      environment: "development" | "production";
      allowedRoots: string[];
      sessionUser?: string;
      elevated?: boolean;
    }>("/api/workspaces/prepare-agent", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  openLocalWorkspace: (path: string) =>
    request<{ mode: "local"; path: string }>("/api/local-workspace/open", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  /** Safe Git: isolated workspace under /home/coloride/workspaces. */
  gitSafeEnsure: (productionPath: string) =>
    request<GitSafeStatus>("/api/git/safe/ensure", {
      method: "POST",
      body: JSON.stringify({ productionPath }),
    }),
  gitSafeStatus: (productionPath: string) =>
    request<GitSafeStatus>("/api/git/safe/status", {
      method: "POST",
      body: JSON.stringify({ productionPath }),
    }),
  gitSafeDiff: (productionPath: string, path: string) =>
    request<{ path: string; diff: string }>("/api/git/safe/diff", {
      method: "POST",
      body: JSON.stringify({ productionPath, path }),
    }),
  gitSafeHistory: (productionPath: string, limit = 40) =>
    request<{ commits: GitHistoryCommit[] }>("/api/git/safe/history", {
      method: "POST",
      body: JSON.stringify({ productionPath, limit }),
    }),
  gitSafeCommit: (productionPath: string, message: string) =>
    request<GitSafeStatus>("/api/git/safe/commit", {
      method: "POST",
      body: JSON.stringify({ productionPath, message }),
    }),
};
