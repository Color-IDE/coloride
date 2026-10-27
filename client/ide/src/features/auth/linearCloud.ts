/**
 * Linear OAuth via api.coloride.com (secret stays on the server).
 * Renderer → sidecar /api/cloud-v1/* → /v1/integrations/linear/*
 */

import { getLocalApiBase, getLocalApiToken } from "../../shared/api/client";
import { getValidAccessToken } from "./cloudAuth";

export type LinearCloudStatus = "idle" | "waiting" | "ready" | "error";

export type LinearOAuthStart = {
  authorizeUrl: string;
  state?: string;
};

export type LinearOAuthStatus = {
  status: LinearCloudStatus;
  error?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function nestedMessage(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  for (const key of ["message", "error", "detail"] as const) {
    const nested = record[key];
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return "";
}

function errorMessage(status: number, data: unknown): string {
  const record = asRecord(data);
  const fromError = nestedMessage(record?.error) || nestedMessage(record?.detail) || nestedMessage(record?.message);
  if (fromError) return fromError;
  return `Linear API ${status}`;
}

function unwrapPayload(data: unknown): Record<string, unknown> {
  const record = asRecord(data);
  if (!record) return {};
  const nested = asRecord(record.data) || asRecord(record.result);
  return nested ? { ...record, ...nested } : record;
}

function normalizeStatus(value: unknown): LinearCloudStatus {
  const raw = String(value || "").trim().toLowerCase();
  if (["ready", "connected", "success", "complete", "completed", "authorized", "ok"].includes(raw)) {
    return "ready";
  }
  if (["error", "failed", "failure"].includes(raw)) return "error";
  if (["waiting", "pending", "started", "in_progress", "in-progress"].includes(raw)) return "waiting";
  return "idle";
}

async function linearCloudFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error("Sign in to Coloride to connect Linear.");
  }
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${getLocalApiToken()}`);
  headers.set("X-Cloud-Authorization", `Bearer ${accessToken}`);
  const cleaned = path.replace(/^\/+/, "").replace(/^v1\//, "");
  const response = await fetch(`${getLocalApiBase()}/api/cloud-v1/${cleaned}`, {
    ...init,
    headers,
  });
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
    throw new Error(errorMessage(response.status, data));
  }
  return data as T;
}

export async function startCloudLinearOAuth(): Promise<LinearOAuthStart> {
  const data = unwrapPayload(
    await linearCloudFetch<unknown>("integrations/linear/oauth/start", {
      method: "POST",
      body: "{}",
    }),
  );
  const authorizeUrl = String(
    data.authorizeUrl || data.authorize_url || data.url || "",
  ).trim();
  if (!authorizeUrl) throw new Error("Linear OAuth did not return an authorize URL.");
  return { authorizeUrl, state: typeof data.state === "string" ? data.state : undefined };
}

export async function cloudLinearOAuthStatus(): Promise<LinearOAuthStatus> {
  const data = unwrapPayload(await linearCloudFetch<unknown>("integrations/linear/oauth/status"));
  const status = normalizeStatus(data.status ?? data.state ?? (data.connected === true ? "ready" : ""));
  const error = nestedMessage(data.error) || (typeof data.error === "string" ? data.error : "");
  return { status, error };
}

export async function fetchCloudLinearToken(): Promise<string> {
  const data = unwrapPayload(await linearCloudFetch<unknown>("integrations/linear/token"));
  const token = String(data.accessToken || data.access_token || "").trim();
  if (!token) throw new Error("Linear did not return an access token.");
  return token;
}

export async function tryFetchCloudLinearToken(): Promise<string | null> {
  try {
    return await fetchCloudLinearToken();
  } catch {
    return null;
  }
}

export async function disconnectCloudLinear(): Promise<void> {
  try {
    await linearCloudFetch("integrations/linear", { method: "DELETE" });
  } catch {
    // Local uninstall should still succeed if cloud revoke fails.
  }
}
