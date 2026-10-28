from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ErrorPayload(BaseModel):
    code: str
    message: str
    retryable: bool = False


class Profile(BaseModel):
    id: str
    name: str
    host: str
    port: int = 22
    username: str = "root"
    provider: Literal["do", "hetzner", "aws", "other"] = "other"
    device_id: str = Field(alias="deviceId")
    created_at: datetime = Field(alias="createdAt")
    default_workspace: str | None = Field(default=None, alias="defaultWorkspace")
    workspace_environment: Literal["development", "production"] = Field(default="development", alias="workspaceEnvironment")
    workspace_source_path: str | None = Field(default=None, alias="workspaceSourcePath")
    production_access: Literal["always-ask", "allow-approved"] = Field(
        default="always-ask",
        alias="productionAccess",
    )
    production_capabilities: dict[str, bool] = Field(
        default_factory=lambda: {
            "deploy": True,
            "logs": True,
            "restart": False,
            "pm2": False,
            "systemd": False,
            "nginx": False,
            "docker": False,
        },
        alias="productionCapabilities",
    )
    production_runtime: dict[str, str] = Field(
        default_factory=lambda: {
            "kind": "none",
            "process": "",
            "buildCommand": "",
            "healthCheck": "",
            "customCommand": "",
        },
        alias="productionRuntime",
    )
    default_shell: Literal["default", "bash", "zsh", "fish"] = Field(default="default", alias="defaultShell")
    terminal_persistence: bool = Field(default=True, alias="terminalPersistence")
    monitor_interval: Literal[2, 5, 10, 30] = Field(default=5, alias="monitorInterval")
    access_mode: Literal["restricted"] = Field(default="restricted", alias="accessMode")
    allowed_roots: list[str] = Field(default_factory=list, alias="allowedRoots")


class WorkspaceGrantRequest(BaseModel):
    path: str


class WorkspaceOpenRequest(BaseModel):
    path: str
    # Environment is product metadata only; it never changes the SSH identity.
    environment: Literal["development", "production"] | None = None
    # Accepted for one-version compatibility. User switching has been removed.
    elevate: bool = False


class ProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    default_workspace: str | None = Field(default=None, alias="defaultWorkspace")
    default_shell: Literal["default", "bash", "zsh", "fish"] | None = Field(default=None, alias="defaultShell")
    terminal_persistence: bool | None = Field(default=None, alias="terminalPersistence")
    monitor_interval: Literal[2, 5, 10, 30] | None = Field(default=None, alias="monitorInterval")
    production_access: Literal["always-ask", "allow-approved"] | None = Field(
        default=None,
        alias="productionAccess",
    )
    production_capabilities: dict[str, bool] | None = Field(
        default=None,
        alias="productionCapabilities",
    )
    production_runtime: dict[str, str] | None = Field(
        default=None,
        alias="productionRuntime",
    )


class PairStartRequest(BaseModel):
    host: str
    port: int = 22
    phrase: str


class PairStartResponse(BaseModel):
    profile_id: str = Field(alias="profileId")
    cert_expires_at: datetime = Field(alias="certExpiresAt")


class ConnConnectRequest(BaseModel):
    profile_id: str = Field(alias="profileId")


class ConnDirectRequest(BaseModel):
    name: str | None = None
    host: str
    port: int = 22
    username: str = "root"
    password: str | None = None
    private_key_path: str | None = Field(default=None, alias="privateKeyPath")
    private_key_passphrase: str | None = Field(default=None, alias="privateKeyPassphrase")


class HostKeyInspectRequest(BaseModel):
    host: str
    port: int = Field(default=22, ge=1, le=65535)


class HostKeyTrustRequest(HostKeyInspectRequest):
    fingerprint: str
    public_key: str = Field(alias="publicKey")


class HostKeyInfo(BaseModel):
    host: str
    port: int
    algorithm: str
    fingerprint: str
    public_key: str = Field(alias="publicKey")
    status: Literal["unknown", "trusted", "changed"]
    trusted_fingerprint: str | None = Field(default=None, alias="trustedFingerprint")


class ConnInfo(BaseModel):
    profile_id: str = Field(alias="profileId")
    server_version: str = Field(alias="serverVersion")
    cert_expires_at: datetime = Field(alias="certExpiresAt")
    # Local SOCKS5 port tunneling browser traffic through the VPS (Electron embed).
    socks_port: int | None = Field(default=None, alias="socksPort")


ConnState = Literal["idle", "connecting", "connected", "degraded", "reconnecting", "failed"]


class ConnStatePayload(BaseModel):
    state: ConnState
    profile_id: str | None = Field(default=None, alias="profileId")
    socks_port: int | None = Field(default=None, alias="socksPort")


class ServerStats(BaseModel):
    cpu: float
    mem_pct: float = Field(alias="memPct")
    disk_pct: float = Field(alias="diskPct")


class ConnStatsPayload(BaseModel):
    rtt_ms: int = Field(alias="rttMs")
    up_bps: int = Field(alias="upBps")
    down_bps: int = Field(alias="downBps")
    cert_ttl_sec: int = Field(alias="certTtlSec")
    server: ServerStats | None = None


class DashboardResource(BaseModel):
    used_bytes: int = Field(alias="usedBytes")
    total_bytes: int = Field(alias="totalBytes")
    pct: float


class DashboardProcess(BaseModel):
    pid: int
    name: str
    cpu_pct: float = Field(alias="cpuPct")
    memory_bytes: int = Field(alias="memoryBytes")


class DashboardService(BaseModel):
    name: str
    status: str
    description: str = ""


class DashboardPort(BaseModel):
    port: int
    protocol: str = "tcp"
    address: str


class DashboardLog(BaseModel):
    timestamp: str | None = None
    source: str = "system"
    level: str = "info"
    message: str


class ServerDashboardResponse(BaseModel):
    captured_at: datetime = Field(alias="capturedAt")
    cpu_pct: float = Field(alias="cpuPct")
    load1m: float
    load5m: float
    load15m: float
    memory: DashboardResource
    swap: DashboardResource
    disk: DashboardResource
    disk_read_bps: int = Field(alias="diskReadBps")
    disk_write_bps: int = Field(alias="diskWriteBps")
    up_bps: int = Field(alias="upBps")
    down_bps: int = Field(alias="downBps")
    processes: list[DashboardProcess]
    services: list[DashboardService]
    ports: list[DashboardPort]
    logs: list[DashboardLog]


class ServerSettingsResponse(BaseModel):
    profile_id: str = Field(alias="profileId")
    authentication_method: Literal["password", "private-key", "certificate", "ssh-agent"] = Field(alias="authenticationMethod")
    host_key_status: Literal["trusted", "unknown"] = Field(alias="hostKeyStatus")
    host_key_algorithm: str | None = Field(default=None, alias="hostKeyAlgorithm")
    host_key_fingerprint: str | None = Field(default=None, alias="hostKeyFingerprint")
    hostname: str
    operating_system: str = Field(alias="operatingSystem")
    architecture: str
    kernel: str
    uptime_seconds: int = Field(alias="uptimeSeconds")


class AuthorizedKey(BaseModel):
    id: str
    algorithm: str
    fingerprint: str
    comment: str = ""


class AuthorizedKeysResponse(BaseModel):
    keys: list[AuthorizedKey]


class AuthorizedKeyAddRequest(BaseModel):
    public_key: str = Field(alias="publicKey", min_length=20, max_length=16_384)


class Entry(BaseModel):
    name: str
    path: str
    kind: Literal["file", "dir", "link"]
    size: int
    mtime: datetime


class FileListRequest(BaseModel):
    path: str
    offset: int = 0
    limit: int = 500


class FileSearchRequest(BaseModel):
    path: str
    query: str = Field(min_length=1, max_length=120)
    include: str = Field(default="", max_length=120)
    limit: int = Field(default=80, ge=1, le=200)
    # "all" = filenames + content in one SSH round-trip (default UI).
    # "name" / "content" kept for callers that want a single slice.
    mode: Literal["all", "name", "content"] = "all"
    case_sensitive: bool = Field(default=False, alias="caseSensitive")
    name_limit: int = Field(default=40, ge=1, le=100, alias="nameLimit")
    content_limit: int = Field(default=80, ge=1, le=200, alias="contentLimit")


class ContentSearchMatch(BaseModel):
    path: str
    line: int
    text: str
    # Optional 1-based column when available.
    column: int | None = None


class ContentSearchResponse(BaseModel):
    matches: list[ContentSearchMatch]
    truncated: bool = False
    engine: Literal["rg", "grep", "none"] = "rg"


class FileNameHit(BaseModel):
    name: str
    path: str


class FileReadRequest(BaseModel):
    path: str


class FileReadResponse(BaseModel):
    content: str
    etag: str
    truncated: bool = False


class FileStatRequest(BaseModel):
    """Lightweight existence/version probe (no content). Supports single or batch."""
    path: str | None = None
    paths: list[str] = Field(default_factory=list)


class FileStatEntry(BaseModel):
    path: str
    exists: bool
    kind: Literal["file", "dir", "link"] | None = None
    size: int | None = None
    mtime: int | None = None
    etag: str | None = None


class FileStatResponse(BaseModel):
    entries: list[FileStatEntry]


class FileWriteRequest(BaseModel):
    path: str
    content: str
    etag: str | None = None


class FileWriteResponse(BaseModel):
    etag: str


class FileMkdirRequest(BaseModel):
    path: str


class FileDeleteRequest(BaseModel):
    path: str
    recursive: bool = False


class FileRenameRequest(BaseModel):
    old_path: str = Field(alias="oldPath")
    new_path: str = Field(alias="newPath")


class FileCopyRequest(BaseModel):
    source_path: str = Field(alias="sourcePath")
    dest_path: str = Field(alias="destPath")


class LocalWorkspaceOpenRequest(BaseModel):
    path: str


class LspStartRequest(BaseModel):
    language: str = Field(default="typescript", min_length=1, max_length=40, pattern=r"^[A-Za-z][A-Za-z0-9.+_-]{0,39}$")
    root_path: str = Field(alias="rootPath")


class LspSessionInfo(BaseModel):
    session_id: str = Field(alias="sessionId")
    language: str = "typescript"
    root_path: str = Field(alias="rootPath")
    command: str
    status: Literal["starting", "ready", "error", "exited"]
    error: str | None = None


class TermCreateRequest(BaseModel):
    cols: int = Field(ge=20, le=400)
    rows: int = Field(ge=5, le=120)
    cwd: str | None = None
    session_id: str | None = Field(default=None, alias="sessionId", pattern=r"^[A-Za-z0-9_-]{8,120}$")
    session_name: str | None = Field(default=None, alias="sessionName", pattern=r"^[A-Za-z0-9_-]{1,80}$")
    workspace_kind: Literal["local", "ssh"] = Field(default="ssh", alias="workspaceKind")
    connection_id: str | None = Field(default=None, alias="connectionId")


class TermCreateResponse(BaseModel):
    term_id: str = Field(alias="termId")
    session_id: str = Field(alias="sessionId")
    restored: bool = False


class TermSessionInfo(BaseModel):
    term_id: str = Field(alias="termId")
    session_id: str = Field(alias="sessionId")
    cwd: str | None = None
    workspace_kind: Literal["local", "ssh"] = Field(alias="workspaceKind")
    connection_id: str | None = Field(default=None, alias="connectionId")
    status: Literal["connecting", "ready", "suspended", "exited"]


    agent_session_id: str | None = Field(default=None, alias="agentSessionId")
    workspace_path: str | None = Field(default=None, alias="workspacePath")
    title: str | None = None
    revealed: bool = True


class TermInfoResponse(BaseModel):
    # Name of the process running in the foreground of the terminal's tmux pane
    # (e.g. "bash" when idle, or "vim"/"node"/"python" while something runs).
    foreground: str
    cwd: str | None = None


class BrowserOpenRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2_000)
    browser_id: str | None = Field(default=None, alias="browserId")
    owner: str = Field(default="ui", min_length=1, max_length=120)


class BrowserOpenResponse(BaseModel):
    browser_id: str = Field(alias="browserId")
    url: str
    title: str = ""
    owner: str = "ui"
    snapshot: str | None = None
    ref_count: int | None = Field(default=None, alias="refCount")


class BrowserSessionInfo(BaseModel):
    id: str
    owner: str
    url: str
    title: str = ""
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class BrowserScreenshotResponse(BaseModel):
    browser_id: str = Field(alias="browserId")
    url: str = ""
    title: str = ""
    mime_type: str = Field(default="image/png", alias="mimeType")
    image_base64: str = Field(default="", alias="imageBase64")
    byte_length: int | None = Field(default=None, alias="byteLength")


BugReportCategory = Literal["editor", "terminal", "connection", "files", "agent", "other"]


class BugReportRequest(BaseModel):
    categories: list[BugReportCategory] = Field(min_length=1, max_length=6)
    description: str = Field(min_length=10, max_length=4000)
    include_diagnostics: bool = Field(default=True, alias="includeDiagnostics")


class BugReportResponse(BaseModel):
    report_id: str = Field(alias="reportId")
    created_at: datetime = Field(alias="createdAt")
    stored_locally: bool = Field(alias="storedLocally")


class AgentInfo(BaseModel):
    id: str
    name: str
    version: str
    installed: bool
    needs_key: bool = Field(alias="needsKey")
    supported: bool = True


class AgentDiscoveredModel(BaseModel):
    capabilities: dict[str, object] | None = None
    id: str
    label: str


class AgentProviderConnectRequest(BaseModel):
    api_key: str | None = Field(default=None, alias="apiKey", min_length=1, max_length=500, repr=False)


class AgentProviderRegistrationRequest(BaseModel):
    id: str = Field(pattern=r"^custom:[a-z0-9][a-z0-9-]{0,47}$")
    label: str = Field(min_length=1, max_length=80)
    protocol: Literal["responses", "chat-completions", "gemini"] = "chat-completions"
    base_url: str = Field(alias="baseUrl", max_length=500)
    requires_key: bool = Field(default=True, alias="requiresKey")
    models: dict[str, dict[str, object]] = Field(default_factory=dict)


class AgentProviderConfiguration(BaseModel):
    label: str = ""
    protocol: str = "responses"
    requires_key: bool = Field(default=True, alias="requiresKey")
    show_in_settings: bool = Field(default=True, alias="showInSettings")
    available_models: list[AgentDiscoveredModel] = Field(default_factory=list, alias="availableModels")
    provider: str
    model: str
    base_url: str = Field(alias="baseUrl")
    configured: bool
    credential_source: Literal["environment", "keychain", "local", "none"] = Field(alias="credentialSource")
    active: bool


class AgentConfigResponse(BaseModel):
    provider: str
    model: str
    base_url: str = Field(alias="baseUrl")
    configured: bool
    availability: str | None = None
    credential_source: Literal["environment", "keychain", "coloride", "local", "none"] = Field(
        alias="credentialSource"
    )
    managed_llm: bool = Field(default=False, alias="managedLlm")
    capabilities: dict[str, object]
    providers: list[AgentProviderConfiguration] = Field(default_factory=list)


class AgentConfigUpdateRequest(BaseModel):
    activate: bool = True
    provider: str = "openai"
    model: str = Field(min_length=1, max_length=120)
    api_key: str | None = Field(default=None, alias="apiKey", min_length=1, max_length=500)
    base_url: str | None = Field(default=None, alias="baseUrl", max_length=500)


class AgentMessageAttachment(BaseModel):
    """Composer attachment metadata (images may also be loaded for vision)."""

    name: str
    kind: Literal["image", "file", "code"] = "file"
    mime: str = "application/octet-stream"
    size: int = 0
    path: str | None = None
    preview_data_url: str | None = Field(default=None, alias="previewDataUrl")
    start_line: int | None = Field(default=None, alias="startLine", ge=1)
    end_line: int | None = Field(default=None, alias="endLine", ge=1)


class TaskBudgetModel(BaseModel):
    max_fresh_tokens: int = Field(default=1_000_000, alias="maxFreshTokens", ge=1)
    max_runtime_ms: int = Field(default=3_600_000, alias="maxRuntimeMs", ge=1_000)
    max_hard_stops: int = Field(default=3, alias="maxHardStops", ge=1)
    max_consecutive_provider_errors: int = Field(
        default=5, alias="maxConsecutiveProviderErrors", ge=1
    )


class TaskBudgetUsageModel(BaseModel):
    input_tokens: int = Field(default=0, alias="inputTokens")
    cached_input_tokens: int = Field(default=0, alias="cachedInputTokens")
    output_tokens: int = Field(default=0, alias="outputTokens")
    fresh_tokens: int = Field(default=0, alias="freshTokens")
    model_calls: int = Field(default=0, alias="modelCalls")
    tool_calls: int = Field(default=0, alias="toolCalls")
    runtime_ms: int = Field(default=0, alias="runtimeMs")
    consecutive_provider_errors: int = Field(default=0, alias="consecutiveProviderErrors")


class AgentGuardResolveRequest(BaseModel):
    action: Literal["retry-strategy", "continue-once", "update-budget", "stop"]
    budget: TaskBudgetModel | None = None


class AgentSessionStartRequest(BaseModel):
    agent: str
    task: str | None = None
    cwd: str
    workspace_kind: Literal["local", "ssh"] = Field(default="ssh", alias="workspaceKind")
    connection_id: str | None = Field(default=None, alias="connectionId")
    filesystem_scope: Literal["workspace", "server"] = Field(
        default="workspace",
        alias="filesystemScope",
    )
    budget_usd: float | None = Field(default=None, alias="budgetUsd")
    budget: TaskBudgetModel | None = None
    mode: Literal["ask", "plan", "debug", "act"] = "act"
    access_level: Literal["request", "agent", "full"] = Field(default="request", alias="accessLevel")
    reasoning_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] = Field(
        default="medium",
        alias="reasoningEffort",
    )
    attachments: list[AgentMessageAttachment] | None = None
    plugin_ids: list[str] | None = Field(default=None, alias="pluginIds")


class AgentSessionStartResponse(BaseModel):
    session_id: str = Field(alias="sessionId")


class AgentSessionSendRequest(BaseModel):
    session_id: str = Field(alias="sessionId")
    message: str
    reasoning_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] | None = Field(
        default=None,
        alias="reasoningEffort",
    )
    attachments: list[AgentMessageAttachment] | None = None
    plugin_ids: list[str] | None = Field(default=None, alias="pluginIds")


class AgentSessionWorkspaceRequest(BaseModel):
    cwd: str
    workspace_kind: Literal["local", "ssh"] = Field(alias="workspaceKind")
    connection_id: str | None = Field(default=None, alias="connectionId")


class AgentSessionStopRequest(BaseModel):
    session_id: str = Field(alias="sessionId")


class AgentSessionForkRequest(BaseModel):
    session_id: str = Field(alias="sessionId")


class AgentSessionModeRequest(BaseModel):
    session_id: str = Field(alias="sessionId")
    mode: Literal["ask", "plan", "debug", "act"]


class AgentSessionAccessRequest(BaseModel):
    session_id: str = Field(alias="sessionId")
    access_level: Literal["request", "agent", "full"] = Field(alias="accessLevel")


class AgentSessionReasoningRequest(BaseModel):
    session_id: str = Field(alias="sessionId")
    reasoning_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] = Field(alias="reasoningEffort")


class AgentSessionArchiveRequest(BaseModel):
    session_id: str = Field(alias="sessionId")
    archived: bool = True


class AgentApprovalRequest(BaseModel):
    approval_id: str = Field(alias="approvalId")
    decision: Literal["approve", "approve-session", "decline", "cancel"]


class AgentCheckpointRestoreRequest(BaseModel):
    session_id: str = Field(alias="sessionId")
    checkpoint_id: str = Field(alias="checkpointId")


class AgentMCPServerConfig(BaseModel):
    id: str
    name: str
    url: str
    enabled: bool = True
    header_env: dict[str, str] = Field(default_factory=dict, alias="headerEnv")


class AgentIntegrationsUpdateRequest(BaseModel):
    mcp_servers: list[AgentMCPServerConfig] = Field(alias="mcpServers")


class AgentLinearCredentialRequest(BaseModel):
    access_token: str = Field(alias="accessToken", min_length=8)


class AgentEvaluationCheck(BaseModel):
    id: str
    label: str
    passed: bool
    detail: str


class AgentEvaluationResponse(BaseModel):
    session_id: str = Field(alias="sessionId")
    state: Literal["starting", "idle", "running", "waiting-approval", "paused-guard", "stopped", "failed"]
    completed: bool
    tool_calls: int = Field(alias="toolCalls")
    tool_failures: int = Field(alias="toolFailures")
    unresolved_tools: int = Field(alias="unresolvedTools")
    approvals_requested: int = Field(alias="approvalsRequested")
    approvals_resolved: int = Field(alias="approvalsResolved")
    checkpoints: int
    compactions: int
    diffs: int
    errors: int
    mutation_calls: int = Field(alias="mutationCalls")
    protected_mutations: int = Field(alias="protectedMutations")
    passed_checks: int = Field(alias="passedChecks")
    total_checks: int = Field(alias="totalChecks")
    checks: list[AgentEvaluationCheck]


class AgentEventResponse(BaseModel):
    id: str
    session_id: str = Field(alias="sessionId")
    sequence: int
    type: str
    data: dict[str, Any]
    created_at: datetime = Field(alias="createdAt")


class AgentApprovalResponse(BaseModel):
    id: str
    session_id: str = Field(alias="sessionId")
    kind: str
    title: str
    details: dict[str, Any]
    state: Literal["pending", "approved", "declined", "cancelled", "expired"]
    created_at: datetime = Field(alias="createdAt")
    resolved_at: datetime | None = Field(default=None, alias="resolvedAt")


class AgentToolInfo(BaseModel):
    id: str
    name: str
    description: str
    risk: Literal["read", "write", "execute"]
    modes: list[Literal["ask", "plan", "debug", "act"]]


class AgentPlanStepModel(BaseModel):
    id: str
    title: str
    detail: str | None = None
    status: Literal["pending", "in_progress", "done", "skipped"] = "pending"
    note: str | None = None


class AgentPlanModel(BaseModel):
    id: str
    session_id: str = Field(alias="sessionId")
    title: str
    summary: str | None = None
    steps: list[AgentPlanStepModel]
    status: Literal["drafting", "ready", "implementing", "completed", "dismissed"]
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class AgentPlanUpdateRequest(BaseModel):
    session_id: str = Field(alias="sessionId")
    title: str | None = None
    summary: str | None = None
    steps: list[AgentPlanStepModel] | None = None


class AgentPlanImplementRequest(BaseModel):
    session_id: str = Field(alias="sessionId")
    title: str | None = None
    summary: str | None = None
    steps: list[AgentPlanStepModel] | None = None


class AgentPlanDismissRequest(BaseModel):
    session_id: str = Field(alias="sessionId")


class SessionSummary(BaseModel):
    session_id: str = Field(alias="sessionId")
    agent: str
    task: str
    cwd: str
    workspace_kind: Literal["local", "ssh"] = Field(default="ssh", alias="workspaceKind")
    connection_id: str | None = Field(default=None, alias="connectionId")
    filesystem_scope: Literal["workspace", "server"] = Field(
        default="workspace",
        alias="filesystemScope",
    )
    mode: Literal["ask", "plan", "debug", "act"]
    access_level: Literal["request", "agent", "full"] = Field(default="request", alias="accessLevel")
    state: Literal["starting", "idle", "running", "waiting-approval", "paused-guard", "stopped", "failed"]
    model: str | None = None
    spent_usd: float = Field(alias="spentUsd")
    budget_usd: float | None = Field(default=None, alias="budgetUsd")
    budget: TaskBudgetModel | None = None
    budget_usage: TaskBudgetUsageModel | None = Field(default=None, alias="budgetUsage")
    guard_pause: dict[str, Any] | None = Field(default=None, alias="guardPause")
    reasoning_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] = Field(
        default="medium",
        alias="reasoningEffort",
    )
    preferred_linux_user: Literal["admin", "coloride"] | None = Field(
        default=None,
        alias="preferredLinuxUser",
    )
    started_at: datetime = Field(alias="startedAt")
    updated_at: datetime = Field(alias="updatedAt")
    last_error: str | None = Field(default=None, alias="lastError")
    archived: bool = False
    plan: AgentPlanModel | None = None


class EventEnvelope(BaseModel):
    event: str
    payload: dict[str, Any]
