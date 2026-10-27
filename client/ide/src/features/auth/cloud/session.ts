import { cloudConfig, requireCloudEnabled } from "../../../shared/api/cloudConfig";
import { getLocalApiBase, getLocalApiToken } from "../../../shared/api/client";
import {
  ACCESS_REFRESH_SKEW_MS,
  accessTokenExpiresAtMs,
  accessTokenNeedsRefresh,
} from "../accessToken";
import {
  CloudAuthHttpError,
  isAuthRevokedError,
  payloadLooksRevoked,
  payloadLooksTransient,
  transientPayloadMessage,
} from "./errors";
import {
  CLOUD_AUTH_APP_BASE,
  normalizeUser,
  tokensFromPayload,
} from "./payload";
import {
  clearStoredRefreshToken,
  readLastUser,
  readStoredRefreshToken,
  REFRESH_FALLBACK_KEY,
  writeLastUser,
  writeStoredRefreshToken,
} from "./storage";
import { cloudFetch, cloudFetchV1Me, withTimeout } from "./transport";
import {
  type BrowserLinkSession,
  type CloudAuthSession,
  type CloudAuthTokens,
  type CloudAuthUser,
  type DeviceCodeResponse,
  type DevicePollResult,
  type SessionListener,
} from "./types";

export const SESSION_EVENT = "coloride:cloud-auth-changed";

/** Do not hold the boot splash on a hung api.coloride.com. */
export const CLOUD_BOOT_TIMEOUT_MS = 4_000;

export let memoryAccessToken: string | null = null;

export let memoryUser: CloudAuthUser | null = null;

/** Kept in memory so logout can revoke remotely without awaiting disk/keychain first. */
export let memoryRefreshToken: string | null = null;

/** Last known account restored from disk; splash must not wait on the network. */
export let memoryPendingRefresh = false;

export let bootstrapPromise: Promise<CloudAuthSession | null> | null = null;

/** Bumped on every logout so in-flight bootstrap/refresh cannot restore a dead session. */
export let authEpoch = 0;

/**
 * Explicit Sign Out. Stays true until a real browser-link sign-in succeeds.
 * Disk/keychain may still hold a refresh token for a few ms after notify() —
 * without this flag, keep-alive / bootstrap / ensureCloudSessionAlive would
 * refresh that token and put the user straight back into the app.
 */
export let signedOut = false;

export let refreshInFlight: Promise<CloudAuthTokens> | null = null;

export const listeners = new Set<SessionListener>();

export function notify() {
  const session = getSessionSnapshot();
  for (const listener of listeners) {
    try {
      listener(session);
    } catch {
      // A broken subscriber must not block LoginGate from signing out.
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: session }));
  }
}

export function getSessionSnapshot(): CloudAuthSession | null {
  if (!cloudConfig.enabled) return null;
  if (signedOut) return null;
  if (!memoryUser) return null;
  if (!memoryAccessToken && !memoryPendingRefresh) return null;
  return {
    accessToken: memoryAccessToken || "",
    user: memoryUser,
    pendingRefresh: memoryPendingRefresh || undefined,
  };
}

export function subscribeCloudAuth(listener: SessionListener): () => void {
  listeners.add(listener);
  try {
    listener(getSessionSnapshot());
  } catch {
    // ignore
  }
  return () => {
    listeners.delete(listener);
  };
}

export async function applyTokens(
  tokens: CloudAuthTokens,
  epoch = authEpoch,
  options: { fromSignIn?: boolean } = {},
): Promise<CloudAuthUser> {
  // A logout happened while we were refreshing — drop the result.
  if (epoch !== authEpoch) {
    throw new Error("Sign-in superseded by sign-out.");
  }
  // Keep-alive / bootstrap after Sign Out must not resurrect the session.
  // Only the browser-link approval path may clear the signed-out latch.
  if (signedOut && !options.fromSignIn) {
    throw new Error("Sign-in superseded by sign-out.");
  }

  memoryAccessToken = tokens.access_token;
  if (tokens.refresh_token) {
    memoryRefreshToken = tokens.refresh_token;
    try {
      await writeStoredRefreshToken(tokens.refresh_token);
    } catch {
      // Memory session still works for this run.
    }
  }
  if (epoch !== authEpoch) {
    memoryAccessToken = null;
    memoryRefreshToken = null;
    memoryUser = null;
    throw new Error("Sign-in superseded by sign-out.");
  }

  // Always refresh /me so avatar + profile fields are complete (device poll
  // often returns a minimal user without picture). Never block boot on a
  // hung api.coloride.com — fall back to the token payload / last user.
  let user = tokens.user ?? memoryUser ?? readLastUser();
  try {
    const fresh = await withTimeout(
      fetchMe(tokens.access_token),
      2500,
      "account profile",
    );
    if (epoch !== authEpoch) {
      throw new Error("Sign-in superseded by sign-out.");
    }
    user = {
      ...(user || fresh),
      ...fresh,
      // Keep whichever side has an avatar if one is missing.
      avatar_url: fresh.avatar_url || user?.avatar_url || null,
      avatar_path: fresh.avatar_path || user?.avatar_path || null,
    };
  } catch (error) {
    if (epoch !== authEpoch) throw error;
    // A cloud 401/403 is authoritative (expired, revoked, or banned). Never
    // accept the partial user returned by device-login/refresh in that case:
    // doing so would let a banned account enter the desktop until its next
    // periodic session check.
    if (isAuthRevokedError(error)) throw error;
    if (!user) throw new Error("Could not load account profile.");
  }
  if (epoch !== authEpoch || (signedOut && !options.fromSignIn)) {
    memoryAccessToken = null;
    memoryRefreshToken = null;
    memoryUser = null;
    throw new Error("Sign-in superseded by sign-out.");
  }
  memoryUser = user;
  memoryPendingRefresh = false;
  if (options.fromSignIn) signedOut = false;
  writeLastUser(user);
  notify();
  // Python agent needs the same JWT for managed LLM (api.coloride.com/v1/llm/*).
  void pushAgentCloudToken(tokens.access_token);
  return user;
}

/**
 * Store (or clear) the cloud access JWT on the local sidecar so the agent
 * provider can call managed `/v1/llm/responses` without BYOK.
 */
export async function pushAgentCloudToken(
  accessToken: string | null,
): Promise<void> {
  try {
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${getLocalApiToken()}`,
    });
    if (accessToken && accessToken.trim()) {
      headers.set("Content-Type", "application/json");
      await fetch(`${getLocalApiBase()}/api/cloud-auth/agent-token`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ accessToken: accessToken.trim() }),
      });
    } else {
      await fetch(`${getLocalApiBase()}/api/cloud-auth/agent-token`, {
        method: "DELETE",
        headers,
      });
    }
  } catch {
    // Agent will surface "sign in" if the token never lands.
  }
}

export async function fetchMe(accessToken: string): Promise<CloudAuthUser> {
  // Prefer product profile (/v1/me) when the dashboard API is available; fall back to /auth/me.
  const tryPaths = ["/v1/me", "/auth/me"] as const;
  let lastError: unknown = null;
  for (const path of tryPaths) {
    try {
      const raw =
        path === "/v1/me"
          ? await cloudFetchV1Me(accessToken)
          : await cloudFetch<unknown>("/auth/me", {
              method: "GET",
              accessToken,
            });
      const direct = normalizeUser(raw);
      if (direct) return direct;
      if (raw && typeof raw === "object" && "user" in raw) {
        const nested = normalizeUser((raw as { user: unknown }).user);
        if (nested) return nested;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Unexpected /auth/me response shape.");
}

export async function refreshSession(
  refreshToken?: string,
): Promise<CloudAuthTokens> {
  if (signedOut) throw new Error("Sign-in superseded by sign-out.");
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const desktopRefresh = window.colorideDesktop?.cloudAuth?.refreshSession;
    if (desktopRefresh) {
      const raw = await desktopRefresh();
      if (payloadLooksRevoked(raw)) {
        throw new CloudAuthHttpError(
          "Invalid or expired refresh token",
          401,
          raw,
        );
      }
      if (payloadLooksTransient(raw)) {
        throw new CloudAuthHttpError(transientPayloadMessage(raw), 0, raw);
      }
      const tokens = tokensFromPayload(raw);
      if (!tokens) throw new Error("No stored Coloride session.");
      return tokens;
    }
    if (!refreshToken?.trim())
      throw new Error("No refresh token is available.");
    const raw = await cloudFetch<unknown>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const tokens = tokensFromPayload(raw);
    if (!tokens) throw new Error("Unexpected /auth/refresh response shape.");
    return tokens;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  requireCloudEnabled();
  const raw = window.colorideDesktop?.cloudAuth?.requestDeviceCode
    ? await window.colorideDesktop.cloudAuth.requestDeviceCode()
    : await cloudFetch<Record<string, unknown>>("/auth/device/code", {
        method: "POST",
        body: JSON.stringify({}),
      });

  // device_code and challenge are the same long secret. Either field is enough.
  const deviceCode =
    (typeof raw.device_code === "string" && raw.device_code.trim()) ||
    (typeof raw.challenge === "string" && raw.challenge.trim()) ||
    "";
  const challenge =
    (typeof raw.challenge === "string" && raw.challenge.trim()) ||
    deviceCode ||
    undefined;
  const uuid =
    typeof raw.uuid === "string" && raw.uuid.trim()
      ? raw.uuid.trim()
      : undefined;
  const userCode =
    typeof raw.user_code === "string" && raw.user_code.trim()
      ? raw.user_code.trim()
      : undefined;

  if (!deviceCode) {
    throw new Error(
      "Unexpected /auth/device/code response shape (missing device_code/challenge).",
    );
  }

  // Prefer the server-built URL; otherwise assemble loginDeepControl locally.
  let verificationComplete =
    typeof raw.verification_uri_complete === "string" &&
    raw.verification_uri_complete.trim()
      ? raw.verification_uri_complete.trim()
      : "";
  if (!verificationComplete) {
    const params = new URLSearchParams({
      challenge: challenge || deviceCode,
      mode: "login",
    });
    if (uuid) params.set("uuid", uuid);
    verificationComplete = `${CLOUD_AUTH_APP_BASE}/loginDeepControl?${params.toString()}`;
  }

  // Last-resort short-code URL only if API gave a classic user_code and no deep link.
  if (!verificationComplete && userCode) {
    verificationComplete = `${CLOUD_AUTH_APP_BASE}/device?user_code=${encodeURIComponent(userCode)}`;
  }

  const verificationUri =
    (typeof raw.verification_uri === "string" && raw.verification_uri.trim()) ||
    `${CLOUD_AUTH_APP_BASE}/loginDeepControl`;

  return {
    device_code: deviceCode,
    challenge,
    uuid,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationComplete,
    expires_in: Number(raw.expires_in) || 900,
    interval: Math.max(2, Number(raw.interval) || 5),
  };
}

export async function pollDeviceCode(
  deviceCode: string,
): Promise<DevicePollResult> {
  // device_code === challenge; send both names for API compatibility.
  const q = new URLSearchParams({
    device_code: deviceCode,
    challenge: deviceCode,
  });
  const raw = window.colorideDesktop?.cloudAuth?.pollDeviceCode
    ? await window.colorideDesktop.cloudAuth.pollDeviceCode(deviceCode)
    : await cloudFetch<Record<string, unknown>>(
        `/auth/device/poll?${q.toString()}`,
        { method: "GET" },
      );

  const status =
    typeof raw.status === "string" ? raw.status.toLowerCase().trim() : "";
  const intervalRaw = Number(raw.interval);
  const tokens = tokensFromPayload(raw);

  // Terminal failures
  if (
    status === "expired" ||
    status === "access_denied" ||
    status === "denied" ||
    status === "cancelled" ||
    status === "canceled"
  ) {
    return {
      status:
        status === "access_denied" || status === "denied"
          ? "denied"
          : "expired",
      detail: typeof raw.detail === "string" ? raw.detail : undefined,
    };
  }

  // Explicit approved / success — even if token field names vary.
  if (
    status === "approved" ||
    status === "complete" ||
    status === "completed" ||
    status === "success" ||
    status === "authorized"
  ) {
    if (!tokens) {
      throw new Error(
        "Login was approved but the server did not return tokens. Try again.",
      );
    }
    const user = tokens.user ?? (await fetchMe(tokens.access_token));
    return {
      status: "approved",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user,
    };
  }

  // Tokens present without status → treat as approved (some servers omit status).
  if (tokens) {
    const user = tokens.user ?? (await fetchMe(tokens.access_token));
    return {
      status: "approved",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user,
    };
  }

  // Still waiting (or slow_down).
  if (
    !status ||
    status === "pending" ||
    status === "authorization_pending" ||
    status === "slow_down" ||
    status === "waiting"
  ) {
    const hint =
      status === "slow_down" && Number.isFinite(intervalRaw) && intervalRaw > 0
        ? Math.max(2, intervalRaw)
        : undefined;
    return {
      status: "pending",
      ...(hint ? { intervalHint: hint } : {}),
    };
  }

  // Unknown status without tokens — keep polling rather than hard-fail.
  return { status: "pending" };
}

export async function openVerificationUrl(url: string): Promise<void> {
  // HTTPS only — never deep-link into the app (no coloride://).
  if (!/^https:\/\//i.test(url)) {
    throw new Error("Verification URL must be HTTPS.");
  }
  if (window.colorideDesktop?.openExternal) {
    await window.colorideDesktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Bring the Electron main window forward after Approve (poll success). */
export async function focusDesktopWindow(): Promise<void> {
  try {
    await window.colorideDesktop?.focusMainWindow?.();
  } catch {
    // Non-Electron / older preload — ignore.
  }
}

/**
 * Device login by polling, with no custom protocol:
 * 1. POST /auth/device/code → device_code/challenge + verification_uri_complete
 * 2. Open loginDeepControl?challenge=…&uuid=…&mode=login in the system browser
 * 3. Poll GET /auth/device/poll?device_code=<challenge> every `interval` seconds
 * 4. On approved → save tokens, focus main window
 *
 * Web only writes Approve to the DB; desktop discovers it via poll.
 */
export async function startBrowserLinkLogin(): Promise<BrowserLinkSession> {
  requireCloudEnabled();
  const code = await requestDeviceCode();
  const expiresAt = Date.now() + code.expires_in * 1000;
  // Prefer the long link. Never surface the short user_code in the UI.
  const linkUrl = code.verification_uri_complete;
  // Poll secret: device_code === challenge (~256-bit).
  const pollCode = code.device_code || code.challenge || "";
  if (!linkUrl || !pollCode) {
    throw new Error(
      "Device login response missing verification URL or challenge.",
    );
  }

  let cancelled = false;
  let wake: (() => void) | null = null;

  const cancel = () => {
    cancelled = true;
    wake?.();
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        window.clearTimeout(timer);
        wake = null;
        resolve();
      };
    });

  await openVerificationUrl(linkUrl);

  // Poll at least every 2s so "All set!" on the web maps quickly to a focused app.
  let intervalMs = Math.max(2, Math.min(Number(code.interval) || 5, 5)) * 1000;
  const done = (async (): Promise<CloudAuthUser> => {
    // First poll quickly — Approve may already be done if the user was signed in.
    await sleep(600);

    let hardFailures = 0;
    while (!cancelled) {
      if (Date.now() >= expiresAt) {
        throw new Error("The browser link expired. Try again.");
      }
      if (cancelled) throw new Error("Sign-in cancelled.");

      let result: DevicePollResult;
      try {
        result = await pollDeviceCode(pollCode);
        hardFailures = 0;
      } catch (error) {
        // Token-shape / approved-without-tokens should surface immediately.
        if (
          error instanceof Error &&
          /approved but the server did not return tokens/i.test(error.message)
        ) {
          throw error;
        }
        hardFailures += 1;
        if (hardFailures >= 8) {
          const detail =
            error instanceof Error ? error.message : "network error";
          throw new Error(`Could not reach Coloride login (${detail}).`);
        }
        await sleep(intervalMs);
        continue;
      }

      if (result.status === "pending") {
        if (result.intervalHint) {
          intervalMs = Math.max(2_000, result.intervalHint * 1000);
        }
        await sleep(intervalMs);
        continue;
      }
      if (result.status === "expired")
        throw new Error("The browser link expired. Try again.");
      if (result.status === "denied") {
        throw new Error(result.detail || "Linking was denied in the browser.");
      }
      if (result.status !== "approved") {
        throw new Error("Unexpected sign-in response.");
      }

      // Website marked approved in DB → store session and bring the app forward.
      // (The website does NOT open the app — we discover Approve via this poll.)
      const user = await applyTokens(
        {
          access_token: result.access_token,
          refresh_token: result.refresh_token,
          user: result.user,
        },
        authEpoch,
        { fromSignIn: true },
      );
      // Focus twice — macOS often ignores the first steal while Chrome is frontmost.
      await focusDesktopWindow();
      window.setTimeout(() => {
        void focusDesktopWindow();
      }, 350);
      return user;
    }
    throw new Error("Sign-in cancelled.");
  })();

  return {
    linkUrl,
    expiresAt,
    done,
    cancel,
  };
}

/** @deprecated Use startBrowserLinkLogin */
export async function startDeviceLogin(): Promise<BrowserLinkSession> {
  return startBrowserLinkLogin();
}

/** Wait briefly for the local sidecar runtime (port/token) before auth calls. */
export async function ensureLocalRuntimeReady(maxAttempts = 12): Promise<void> {
  try {
    const { hydrateRuntimeFromDesktop } =
      await import("../../../shared/api/client");
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const runtime = await hydrateRuntimeFromDesktop();
        if (runtime?.token && runtime?.port) return;
      } catch {
        // retry
      }
      await new Promise((resolve) =>
        window.setTimeout(resolve, 150 + attempt * 50),
      );
    }
  } catch {
    // ignore — callers still try refresh
  }
}

/** Restore session from keychain / local backup (call once on app mount). */
export async function bootstrapCloudAuth(): Promise<CloudAuthSession | null> {
  if (!cloudConfig.enabled) return null;
  if (signedOut) return null;
  // Already signed in — don't restart bootstrap (and don't return a stale promise
  // from before a logout).
  if (memoryUser && (memoryAccessToken || memoryPendingRefresh)) {
    return getSessionSnapshot();
  }
  if (bootstrapPromise) return bootstrapPromise;
  const epoch = authEpoch;
  bootstrapPromise = (async () => {
    const refreshToken = await readStoredRefreshToken();
    if (epoch !== authEpoch) return null;
    if (!refreshToken) {
      memoryAccessToken = null;
      memoryRefreshToken = null;
      memoryUser = null;
      memoryPendingRefresh = false;
      writeLastUser(null);
      notify();
      return null;
    }

    // Browser builds keep it in memory. Electron keeps it exclusively in main.
    memoryRefreshToken = window.colorideDesktop?.cloudAuth ? null : refreshToken;

    const lastUser = readLastUser();
    memoryPendingRefresh = true;
    if (lastUser) {
      memoryUser = lastUser;
      notify();
      void refreshStoredSessionInBackground(refreshToken, epoch);
      return getSessionSnapshot();
    }

    // Existing installs have a refresh token but no cached profile yet.
    // Cap the wait so the splash cannot sit on a hung refresh.
    await withTimeout(
      refreshStoredSessionInBackground(refreshToken, epoch, 1),
      CLOUD_BOOT_TIMEOUT_MS,
      "cloud session restore",
    ).catch(() => undefined);
    return getSessionSnapshot();
  })();
  try {
    return await bootstrapPromise;
  } finally {
    // Allow retry after failure / logout.
    if ((!memoryAccessToken && !memoryPendingRefresh) || epoch !== authEpoch) {
      bootstrapPromise = null;
    }
  }
}

export async function refreshStoredSessionInBackground(
  refreshToken: string,
  epoch: number,
  maxAttempts = 3,
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (epoch !== authEpoch) return;
    try {
      await ensureLocalRuntimeReady(8);
      if (epoch !== authEpoch) return;
      const tokens = await withTimeout(
        refreshSession(refreshToken),
        CLOUD_BOOT_TIMEOUT_MS,
        "cloud session refresh",
      );
      if (epoch !== authEpoch) return;
      await applyTokens(tokens, epoch);
      return;
    } catch (error) {
      lastError = error;
      if (isAuthRevokedError(error)) break;
      // Electron already applies a cooldown after a timeout. Retrying here
      // only duplicates work and previously produced several identical IPC
      // errors during app startup.
      if (error instanceof CloudAuthHttpError && error.status === 0) break;
      await new Promise((resolve) =>
        window.setTimeout(resolve, 400 + attempt * 250),
      );
    }
  }

  if (epoch !== authEpoch) return;

  if (isAuthRevokedError(lastError)) {
    await logoutCloudAuth({ remote: false });
    return;
  }

  // Offline / slow cloud: keep the last account on screen. Agents still need a
  // later successful refresh before managed LLM calls work.
  memoryPendingRefresh = Boolean(memoryUser);
  notify();
}

export async function getValidAccessToken(): Promise<string | null> {
  if (!cloudConfig.enabled) return null;
  if (signedOut) return null;
  // Readable JWTs: refresh before exp so a long agent turn does not 401 mid-loop.
  if (memoryAccessToken && !accessTokenNeedsRefresh(memoryAccessToken)) {
    return memoryAccessToken;
  }

  if (memoryAccessToken && accessTokenExpiresAtMs(memoryAccessToken) == null) {
    try {
      await fetchMe(memoryAccessToken);
      return memoryAccessToken;
    } catch (error) {
      if (!isAuthRevokedError(error)) {
        // Network blip — keep token.
        return memoryAccessToken;
      }
    }
  }

  const refreshToken = (await readStoredRefreshToken()) || memoryRefreshToken;
  if (!refreshToken) {
    // No stored session at all.
    return null;
  }
  try {
    const tokens = await refreshSession(refreshToken);
    await applyTokens(tokens);
    return tokens.access_token;
  } catch (error) {
    // Only hard-logout when cloud says the refresh token is dead.
    if (isAuthRevokedError(error)) {
      await logoutCloudAuth({ remote: false });
    }
    return null;
  }
}

export let agentTokenKeepAliveStop: (() => void) | null = null;

/**
 * Refresh the cloud JWT before it dies and keep the sidecar copy in sync.
 * Agent turns last longer than the ~15 minute access token.
 */
export function startCloudAgentTokenKeepAlive(): () => void {
  if (!cloudConfig.enabled) return () => {};
  if (typeof window === "undefined") return () => {};
  agentTokenKeepAliveStop?.();
  let cancelled = false;
  let timer: number | null = null;
  let socket: WebSocket | null = null;

  const clearTimer = () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    if (cancelled) return;
    clearTimer();
    const expiresAt = accessTokenExpiresAtMs(memoryAccessToken);
    const delay =
      expiresAt == null
        ? 30_000
        : Math.max(5_000, expiresAt - Date.now() - ACCESS_REFRESH_SKEW_MS);
    timer = window.setTimeout(() => {
      void sync();
    }, delay);
  };

  const sync = async () => {
    if (cancelled || signedOut) return;
    try {
      const token = await getValidAccessToken();
      if (cancelled || signedOut) return;
      if (token) await pushAgentCloudToken(token);
    } catch {
      // Next timer tick retries. Do not sign the user out from a keep-alive blip.
    }
    if (!signedOut) schedule();
  };

  void sync();
  const unsubscribe = subscribeCloudAuth(() => {
    if (cancelled) return;
    if (memoryAccessToken) void pushAgentCloudToken(memoryAccessToken);
    schedule();
  });

  // Mid-turn 401: sidecar asks the renderer to push a fresh JWT immediately.
  void import("../../../shared/api/client").then(({ api }) => {
    if (cancelled) return;
    socket = api.events((envelope) => {
      if (envelope.event !== "agent:event") return;
      const type = (envelope.payload as { type?: unknown } | undefined)?.type;
      if (type === "cloud_session_refreshing") void sync();
    });
  });

  const stop = () => {
    cancelled = true;
    unsubscribe();
    clearTimer();
    try {
      socket?.close();
    } catch {
      // ignore
    }
    socket = null;
    if (agentTokenKeepAliveStop === stop) agentTokenKeepAliveStop = null;
  };
  agentTokenKeepAliveStop = stop;
  return stop;
}

/**
 * Re-validate the cloud session (website logout / revoked refresh).
 * Transient network errors do NOT sign the user out.
 * Returns true when still signed in (or offline with a stored session).
 */
export async function ensureCloudSessionAlive(): Promise<boolean> {
  if (!cloudConfig.enabled) return false;
  if (signedOut) return false;
  if (memoryAccessToken && memoryUser) {
    if (!accessTokenNeedsRefresh(memoryAccessToken)) {
      try {
        await fetchMe(memoryAccessToken);
        return true;
      } catch (error) {
        if (!isAuthRevokedError(error)) return true;
      }
    }
    const token = await getValidAccessToken();
    if (token) return true;
    // If token refresh failed transiently, still treat as signed-in when we
    // still hold a refresh token on disk (don't flash login offline).
    const stored = await readStoredRefreshToken();
    return Boolean(stored || memoryRefreshToken);
  }

  // Cold path: try restore without wiping on network errors.
  const restored = await bootstrapCloudAuth();
  if (restored) return true;
  const stored = await readStoredRefreshToken();
  return Boolean(stored);
}

export async function logoutCloudAuth(
  options: { remote?: boolean } = {},
): Promise<void> {
  const remote = options.remote !== false;

  // Invalidate any in-flight bootstrap / applyTokens BEFORE async work.
  authEpoch += 1;
  signedOut = true;
  const refreshToken = memoryRefreshToken;

  // Synchronous local wipe — LoginGate must flip on this tick, no awaits above.
  memoryAccessToken = null;
  memoryRefreshToken = null;
  memoryUser = null;
  memoryPendingRefresh = false;
  writeLastUser(null);
  bootstrapPromise = null;
  notify();

  // Persistence + remote revoke are best-effort and never block the UI again.
  void (async () => {
    try {
      await pushAgentCloudToken(null);
    } catch {
      // ignore
    }
    const desktopLogout = window.colorideDesktop?.cloudAuth?.logout;
    if (desktopLogout) {
      try {
        await desktopLogout(remote);
      } catch {
        // Local main-process cleanup still runs in its finally block.
      }
      return;
    }
    try {
      await clearStoredRefreshToken();
    } catch {
      /* ignore */
    }
    try {
      window.localStorage.removeItem(REFRESH_FALLBACK_KEY);
    } catch {
      // ignore
    }
    if (remote && refreshToken) {
      try {
        await cloudFetch("/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {
        // ignore
      }
    }
  })();
}
