import { requireCloudEnabled } from "../../../shared/api/cloudConfig";
import { getLocalApiBase, getLocalApiToken } from "../../../shared/api/client";
import { CloudAuthHttpError } from "./errors";

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Map cloud /auth/* paths onto the local sidecar proxy (avoids CORS Failed to fetch). */
export function proxyPathFor(cloudPath: string): string {
  if (cloudPath.startsWith("/auth/device/code"))
    return "/api/cloud-auth/device/code";
  if (cloudPath.startsWith("/auth/device/poll")) {
    const q = cloudPath.includes("?")
      ? cloudPath.slice(cloudPath.indexOf("?"))
      : "";
    return `/api/cloud-auth/device/poll${q}`;
  }
  if (cloudPath.startsWith("/auth/refresh")) return "/api/cloud-auth/refresh";
  if (cloudPath.startsWith("/auth/logout")) return "/api/cloud-auth/logout";
  if (cloudPath.startsWith("/auth/me")) return "/api/cloud-auth/me";
  // Fallback: strip /auth prefix if present
  return `/api/cloud-auth${cloudPath.replace(/^\/auth/, "")}`;
}

export async function cloudFetch<T>(
  path: string,
  init: RequestInit & { accessToken?: string | null } = {},
): Promise<T> {
  requireCloudEnabled();
  const { accessToken, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (rest.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  // Local sidecar auth (always required).
  headers.set("Authorization", `Bearer ${getLocalApiToken()}`);
  // Cloud access JWT for /me — separate header so it does not overwrite sidecar Bearer.
  if (accessToken) {
    headers.set("X-Cloud-Authorization", `Bearer ${accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${getLocalApiBase()}${proxyPathFor(path)}`, {
      ...rest,
      headers,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    throw new CloudAuthHttpError(
      `Could not reach the local Coloride backend (${reason}). Is the app fully started?`,
      0,
      null,
    );
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
    // Sidecar structured errors: { error: { message } } or FastAPI detail
    let detail = `HTTP ${response.status}`;
    if (data && typeof data === "object" && data !== null) {
      const record = data as Record<string, unknown>;
      if (record.detail != null) detail = String(record.detail);
      else if (
        record.error &&
        typeof record.error === "object" &&
        record.error !== null &&
        "message" in record.error
      ) {
        detail = String((record.error as { message: unknown }).message);
      } else if (typeof record.message === "string") {
        detail = record.message;
      }
    }
    throw new CloudAuthHttpError(
      detail || `HTTP ${response.status}`,
      response.status,
      data,
    );
  }

  // Cloud API wraps many payloads as { ok: true, ...fields }.
  if (data && typeof data === "object" && data !== null && "ok" in data) {
    const record = data as Record<string, unknown>;
    if (record.ok === true) {
      const { ok: _ok, ...restFields } = record;
      // Prefer unwrapped fields when the envelope only adds ok/status helpers.
      if (Object.keys(restFields).length > 0) return restFields as T;
    }
  }

  return data as T;
}

/** Product /v1/me via dedicated sidecar route (dashboard-aligned user fields). */
export async function cloudFetchV1Me(accessToken: string): Promise<unknown> {
  requireCloudEnabled();
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${getLocalApiToken()}`,
    "X-Cloud-Authorization": `Bearer ${accessToken}`,
  });
  const response = await fetch(`${getLocalApiBase()}/api/cloud-v1/me`, {
    method: "GET",
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
    throw new CloudAuthHttpError(
      `HTTP ${response.status}`,
      response.status,
      data,
    );
  }
  if (data && typeof data === "object" && data !== null && "ok" in data) {
    const record = data as Record<string, unknown>;
    if (record.ok === true) {
      const { ok: _ok, ...rest } = record;
      if (Object.keys(rest).length > 0) return rest;
    }
  }
  return data;
}
