/**
 * Coloride product API (dashboard sync) — machines, projects, agents, usage.
 *
 * All calls go through the local sidecar `/api/cloud-v1/*` → `https://api.coloride.com/v1/*`
 * with the user access JWT (same pattern as cloudAuth).
 */

import { getLocalApiBase, getLocalApiToken } from "../../shared/api/client";
import {
  CloudAuthHttpError,
  getValidAccessToken,
  subscribeCloudAuth,
  type CloudAuthSession,
} from "./cloudAuth";

const MACHINE_ID_KEY = "coloride.cloud.machine-id.v1";
const PROJECT_MAP_KEY = "coloride.cloud.project-map.v1";

export type CloudProjectStatus = "active" | "paused" | "archived";
export type CloudAgentStatus = "idle" | "running" | "waiting" | "error";

export type CloudMachine = {
  id: string;
  name: string;
  platform?: string;
  app_version?: string;
};

export type CloudProject = {
  id: string;
  name: string;
  path: string;
  status: CloudProjectStatus;
  description?: string | null;
  machineId?: string | null;
  machineName?: string | null;
  updatedAt?: string;
  createdAt?: string;
};

export type CloudAgent = {
  id: string;
  projectId: string;
  projectName?: string;
  status: CloudAgentStatus;
  summary?: string | null;
  startedAt?: string;
  lastActiveAt?: string;
  endedAt?: string | null;
  machineId?: string | null;
  machineName?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function productFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return null;

  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${getLocalApiToken()}`);
  headers.set("X-Cloud-Authorization", `Bearer ${accessToken}`);

  const cleaned = path.replace(/^\/+/, "").replace(/^v1\//, "");
  let response: Response;
  try {
    response = await fetch(`${getLocalApiBase()}/api/cloud-v1/${cleaned}`, {
      ...init,
      headers,
    });
  } catch {
    return null;
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    // Soft-fail product sync — never block the desktop UX on dashboard API issues.
    if (import.meta.env?.DEV) {
      console.warn("[cloudProduct]", path, response.status, data);
    }
    if (response.status === 401) {
      throw new CloudAuthHttpError("Cloud session expired", 401, data);
    }
    return null;
  }

  if (data && typeof data === "object" && data !== null && "ok" in data) {
    const record = data as Record<string, unknown>;
    if (record.ok === true) {
      const { ok: _ok, ...rest } = record;
      if (Object.keys(rest).length > 0) return rest as T;
    }
  }
  return data as T;
}

/** Stable machine id for this install (dashboard "Desktops"). */
export function getMachineId(): string {
  try {
    const existing = window.localStorage.getItem(MACHINE_ID_KEY)?.trim();
    if (existing) return existing;
  } catch {
    // ignore
  }
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `mac_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      : `mac_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  try {
    window.localStorage.setItem(MACHINE_ID_KEY, id);
  } catch {
    // ignore
  }
  return id;
}

function machineName(): string {
  const platform = window.colorideDesktop
    ? navigator.platform || "desktop"
    : `web-${navigator.platform || "browser"}`;
  // Prefer a short friendly label; hostnames aren't always available in Electron renderer.
  return `Coloride on ${platform}`;
}

function appVersion(): string {
  try {
    return String((window as unknown as { __COLORIDE_VERSION__?: string }).__COLORIDE_VERSION__ || "desktop");
  } catch {
    return "desktop";
  }
}

export async function registerMachine(): Promise<CloudMachine | null> {
  const id = getMachineId();
  const payload = {
    id,
    name: machineName(),
    platform: navigator.platform || undefined,
    app_version: appVersion(),
  };
  const raw = await productFetch<unknown>("machines", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!raw) return { ...payload };
  const record = asRecord(raw) ?? asRecord(asRecord(raw)?.machine);
  return {
    id: pickString(record?.id, id) || id,
    name: pickString(record?.name, payload.name) || payload.name,
    platform: pickString(record?.platform, payload.platform) || undefined,
    app_version: pickString(record?.app_version, record?.appVersion, payload.app_version) || undefined,
  };
}

type ProjectMap = Record<string, string>; // path → project id

function readProjectMap(): ProjectMap {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PROJECT_MAP_KEY) || "{}") as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: ProjectMap = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function writeProjectMap(map: ProjectMap) {
  try {
    window.localStorage.setItem(PROJECT_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function projectNameFromPath(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const base = cleaned.split(/[\\/]/).filter(Boolean).pop();
  return base || cleaned || "Workspace";
}

/** Upsert a workspace folder as a cloud project (dashboard Projects). */
export async function syncWorkspaceProject(workspacePath: string): Promise<CloudProject | null> {
  const path = workspacePath.trim();
  if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) return null;

  const map = readProjectMap();
  const machineId = getMachineId();
  const name = projectNameFromPath(path);
  const existingId = map[path];

  const body = {
    ...(existingId ? { id: existingId } : {}),
    name,
    path,
    status: "active" as const,
    machine_id: machineId,
    machine_name: machineName(),
    machineId,
    machineName: machineName(),
  };

  // Prefer POST upsert; if we already know the id, also try PATCH.
  let raw = await productFetch<unknown>("projects", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!raw && existingId) {
    raw = await productFetch<unknown>(`projects/${encodeURIComponent(existingId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        path,
        status: "active",
        machine_id: machineId,
        machine_name: machineName(),
      }),
    });
  }

  if (!raw) return null;
  const record = asRecord(raw) ?? asRecord(asRecord(raw)?.project);
  const id = pickString(record?.id, existingId);
  if (!id) return null;
  map[path] = id;
  writeProjectMap(map);
  return {
    id,
    name: pickString(record?.name, name) || name,
    path: pickString(record?.path, path) || path,
    status: (pickString(record?.status, "active") as CloudProjectStatus) || "active",
    machineId,
    machineName: machineName(),
    updatedAt: pickString(record?.updatedAt, record?.updated_at) || undefined,
    createdAt: pickString(record?.createdAt, record?.created_at) || undefined,
  };
}

export function cloudProjectIdForPath(workspacePath: string): string | null {
  const path = workspacePath.trim();
  if (!path) return null;
  return readProjectMap()[path] || null;
}

const agentMapKey = (sessionId: string) => `coloride.cloud.agent:${sessionId}`;

function mapAgentStatus(state: string | undefined | null): CloudAgentStatus {
  const value = (state || "").toLowerCase();
  if (value === "running" || value === "starting") return "running";
  if (value === "waiting-approval" || value === "waiting") return "waiting";
  if (value === "failed" || value === "error") return "error";
  return "idle";
}

/** Report / update an agent session on the dashboard. */
export async function syncAgentSession(input: {
  sessionId: string;
  workspacePath?: string | null;
  projectId?: string | null;
  task?: string | null;
  state?: string | null;
}): Promise<CloudAgent | null> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) return null;

  let projectId = input.projectId?.trim() || null;
  if (!projectId && input.workspacePath) {
    projectId = cloudProjectIdForPath(input.workspacePath);
    if (!projectId) {
      const project = await syncWorkspaceProject(input.workspacePath);
      projectId = project?.id || null;
    }
  }
  if (!projectId) return null;

  let cloudAgentId: string | null = null;
  try {
    cloudAgentId = window.sessionStorage.getItem(agentMapKey(sessionId));
  } catch {
    cloudAgentId = null;
  }

  const machineId = getMachineId();
  const status = mapAgentStatus(input.state);
  const summary = (input.task || "").trim() || "Agent session";
  const payload = {
    ...(cloudAgentId ? { id: cloudAgentId } : {}),
    // Keep a stable client id so re-POSTs update instead of duplicating when the API supports it.
    client_id: sessionId,
    session_id: sessionId,
    project_id: projectId,
    projectId,
    status,
    summary,
    machine_id: machineId,
    machine_name: machineName(),
    machineId,
    machineName: machineName(),
  };

  const raw = await productFetch<unknown>("agents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!raw) return null;
  const record = asRecord(raw) ?? asRecord(asRecord(raw)?.agent);
  const id = pickString(record?.id, cloudAgentId, sessionId);
  if (!id) return null;
  try {
    window.sessionStorage.setItem(agentMapKey(sessionId), id);
  } catch {
    // ignore
  }
  return {
    id,
    projectId,
    status,
    summary,
    machineId,
    machineName: machineName(),
    lastActiveAt: new Date().toISOString(),
  };
}

/** Push LLM token usage delta to the dashboard (period = current YYYY-MM). */
export async function reportUsageDelta(tokensDelta: number): Promise<boolean> {
  const delta = Math.floor(tokensDelta);
  if (!Number.isFinite(delta) || delta <= 0) return false;
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const raw = await productFetch<unknown>("usage", {
    method: "POST",
    body: JSON.stringify({
      tokens_delta: delta,
      tokensDelta: delta,
      period,
      machine_id: getMachineId(),
    }),
  });
  return raw != null;
}

let machineRegisteredForUser: string | null = null;

/** Call after login / bootstrap — registers this PC once per user session. */
export async function ensureCloudMachineRegistered(): Promise<void> {
  const token = await getValidAccessToken();
  if (!token) {
    machineRegisteredForUser = null;
    return;
  }
  // Dedupe in-memory; still OK to POST again (upsert).
  if (machineRegisteredForUser === token.slice(0, 16)) return;
  await registerMachine();
  machineRegisteredForUser = token.slice(0, 16);
}

/**
 * Keep machine registration in sync with cloud auth lifecycle.
 * Safe to call once from App root.
 */
export function startCloudProductAuthListener(): () => void {
  let lastUserId: string | null = null;
  const onSession = (session: CloudAuthSession | null) => {
    const userId = session?.user?.id || null;
    if (userId && userId !== lastUserId) {
      lastUserId = userId;
      void ensureCloudMachineRegistered();
    }
    if (!userId) {
      lastUserId = null;
      machineRegisteredForUser = null;
    }
  };
  return subscribeCloudAuth(onSession);
}
