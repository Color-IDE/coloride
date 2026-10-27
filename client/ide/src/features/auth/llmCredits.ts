/**
 * Coloride AI credits (managed LLM) — desktop view of cloud plan usage.
 * Truth always comes from GET /v1/me (via sidecar). No hardcoded plan limits.
 */

import { getLocalApiBase, getLocalApiToken } from "../../shared/api/client";
import { getValidAccessToken, subscribeCloudAuth } from "./cloudAuth";
import {
  parseLlmCreditsPayload,
  PRICING_URL,
  type LlmCreditsSnapshot,
} from "./llmCreditsCore";

export * from "./llmCreditsCore";

// ─── Fetch with in-flight dedupe ─────────────────────────────────────────────

let inflight: Promise<LlmCreditsSnapshot | null> | null = null;
let lastSnapshot: LlmCreditsSnapshot | null = null;
let lastError: string | null = null;
type Listener = (snapshot: LlmCreditsSnapshot | null, error: string | null) => void;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) {
    try {
      listener(lastSnapshot, lastError);
    } catch {
      // ignore
    }
  }
}

export function getCachedLlmCredits(): LlmCreditsSnapshot | null {
  return lastSnapshot;
}

export function subscribeLlmCredits(listener: Listener): () => void {
  listeners.add(listener);
  listener(lastSnapshot, lastError);
  return () => {
    listeners.delete(listener);
  };
}

export async function refreshLlmCredits(options?: { force?: boolean }): Promise<LlmCreditsSnapshot | null> {
  const force = Boolean(options?.force);
  if (!force && inflight) return inflight;
  if (
    !force
    && lastSnapshot
    && Date.now() - lastSnapshot.fetchedAt < 2_000
  ) {
    return lastSnapshot;
  }

  const run = (async () => {
    try {
      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        lastSnapshot = null;
        lastError = null;
        notify();
        return null;
      }
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
          data = null;
        }
      }
      if (!response.ok) {
        lastError = response.status === 401
          ? "Your session has expired. Sign in again."
          : "Could not load AI credits.";
        notify();
        return lastSnapshot;
      }
      const parsed = parseLlmCreditsPayload(data);
      if (parsed) {
        lastSnapshot = parsed;
        lastError = null;
      } else {
        lastError = "Could not load AI credits.";
      }
      notify();
      return lastSnapshot;
    } catch {
      lastError = "Could not load AI credits.";
      notify();
      return lastSnapshot;
    } finally {
      inflight = null;
    }
  })();

  inflight = run;
  return run;
}

export function clearLlmCreditsCache(): void {
  lastSnapshot = null;
  lastError = null;
  inflight = null;
  notify();
}

export function startLlmCreditsAuthListener(): () => void {
  return subscribeCloudAuth((session) => {
    if (session?.accessToken) {
      void refreshLlmCredits({ force: true });
    } else {
      clearLlmCreditsCache();
    }
  });
}

export function openPricingPage(): void {
  const url = PRICING_URL;
  if (!url) return;
  try {
    if (typeof window !== "undefined" && window.colorideDesktop?.openExternal) {
      void window.colorideDesktop.openExternal(url);
      return;
    }
  } catch {
    // fall through
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
