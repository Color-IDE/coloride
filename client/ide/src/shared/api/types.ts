export type {
  AgentTerminalReference,
  AgentApproval,
  AgentEvent,
  AgentInfo,
  AgentMode,
  AgentSessionState,
  AgentSessionSummary,
  AgentTool,
  BugReportRequest,
  BugReportResponse,
  AuthorizedKey,
  ConnState,
  ConnStats,
  ServerDashboard,
  EventEnvelope,
  HostKeyInfo,
  ServerSettings,
} from "@coloride/contracts";

export type Entry = {
  name: string;
  path: string;
  kind: "file" | "dir" | "link";
  size: number;
  mtime: string;
};

export type ContentSearchMatch = {
  path: string;
  line: number;
  text: string;
  column?: number | null;
};

export type FileNameHit = {
  name: string;
  path: string;
};

export type FileNameSearchResponse = {
  mode?: "name";
  entries: Entry[];
};

export type FileContentSearchResponse = {
  mode: "content";
  matches: ContentSearchMatch[];
  truncated: boolean;
  engine: "rg" | "grep" | "none";
};

/** Unified search: filenames + content matches in one response. */
export type FileUnifiedSearchResponse = {
  mode: "all";
  files: FileNameHit[];
  matches: ContentSearchMatch[];
  filesTruncated: boolean;
  matchesTruncated: boolean;
  engine: "rg" | "grep" | "none";
};

export type FileSearchResponse =
  | FileNameSearchResponse
  | FileContentSearchResponse
  | FileUnifiedSearchResponse;

export type Profile = {
  id: string;
  name: string;
  host: string;
  port: number;
  username?: string;
  provider: "do" | "hetzner" | "aws" | "other";
  deviceId: string;
  createdAt: string;
  defaultWorkspace?: string | null;
  workspaceSourcePath?: string | null;
  defaultShell: "default" | "bash" | "zsh" | "fish";
  terminalPersistence: boolean;
  monitorInterval: 2 | 5 | 10 | 30;
  accessMode: "restricted";
  allowedRoots: string[];
};

export type ConnInfo = {
  profileId: string;
  serverVersion: string;
  certExpiresAt: string;
  /** Local SOCKS5 port tunneling browser traffic through the VPS (Electron embed). */
  socksPort?: number | null;
};

export type PairStartResponse = {
  profileId: string;
  certExpiresAt: string;
};

export type ConnDirectRequest = {
  name?: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
};

export type FileListResponse = {
  entries: Entry[];
};

export type FileReadResponse = {
  content: string;
  etag: string;
  truncated: boolean;
};

export type FileStatEntry = {
  path: string;
  exists: boolean;
  kind?: "file" | "dir" | "link" | null;
  size?: number | null;
  mtime?: number | null;
  etag?: string | null;
};

export type FileStatResponse = {
  entries: FileStatEntry[];
};

export type FileWriteResponse = {
  etag: string;
};

export type LspLanguage = string;

export type LspSessionInfo = {
  sessionId: string;
  language: LspLanguage;
  rootPath: string;
  command: string;
  status: "starting" | "ready" | "error" | "exited";
  error?: string | null;
};

export type BrowserSessionInfo = {
  id: string;
  owner: string;
  url: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type BrowserOpenResponse = {
  browserId: string;
  url: string;
  title: string;
  owner: string;
  snapshot?: string | null;
  refCount?: number | null;
};

export type BrowserScreenshotResponse = {
  browserId: string;
  url: string;
  title: string;
  mimeType: string;
  imageBase64: string;
  byteLength?: number | null;
};

/** Safe Git — isolated work tree under the Coloride folder. */
export type GitChangedFile = {
  path: string;
  status: string;
  insertions: number;
  deletions: number;
};

export type GitSafeStatus = {
  productionPath: string;
  workspacePath: string;
  ready: boolean;
  isGitRepo: boolean;
  branch: string | null;
  productionCommit: string | null;
  workspaceCommit: string | null;
  dirty: boolean;
  filesChanged: number;
  insertions: number;
  deletions: number;
  ahead: number;
  behind: number;
  canDeploy: boolean;
  message?: string | null;
  files: GitChangedFile[];
  lastDeployCommit?: string | null;
  lastDeployStatus?: string | null;
  health?: string | null;
  drift?: boolean;
  deployedCommits?: string[];
  deployCommit?: string;
  deployMessage?: string | null;
  healthOk?: boolean | null;
  needsRollback?: boolean;
  steps?: Array<{ id: string; label: string; ok: boolean; detail?: string }>;
};

export type GitHistoryCommit = {
  short: string;
  hash: string;
  subject: string;
  relative: string;
  author: string;
};
