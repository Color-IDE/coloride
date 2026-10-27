/**
 * Pure Coloride AI credits helpers (no DOM / fetch).
 * Safe to unit-test in Node.
 */

export const PRICING_URL = "";

export type LlmCreditsSnapshot = {
  plan: string | null;
  role: string | null;
  enabled: boolean;
  creditsUsed: number;
  creditsLimit: number;
  creditsRemaining: number;
  periodStart: string | null;
  periodEnd: string | null;
  unmetered: boolean;
  /** When the payload was last applied locally. */
  fetchedAt: number;
};

export type LlmCreditsLevel =
  | "loading"
  | "unavailable"
  | "disabled"
  | "normal"
  | "warning"
  | "critical"
  | "exhausted"
  | "unmetered";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function pickBool(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

/**
 * Parse /v1/me (or /v1/usage) into a credits snapshot.
 * Prefers credits_* fields; falls back to legacy tokens_* / top-level shapes.
 */
export function parseLlmCreditsPayload(raw: unknown, fetchedAt = Date.now()): LlmCreditsSnapshot | null {
  const root = asRecord(raw);
  if (!root) return null;

  const user = asRecord(root.user) ?? asRecord(root.data) ?? root;
  const llm =
    asRecord(user.llm)
    ?? asRecord(root.llm)
    ?? asRecord(user.usage)
    ?? asRecord(root.usage)
    ?? null;

  const plan = pickString(user.plan, root.plan, llm?.plan);
  const role = pickString(user.role, root.role);

  let used = pickNumber(
    llm?.credits_used,
    llm?.creditsUsed,
    root.credits_used,
    root.creditsUsed,
  );
  let limit = pickNumber(
    llm?.credits_limit,
    llm?.creditsLimit,
    root.credits_limit,
    root.creditsLimit,
  );
  let remaining = pickNumber(
    llm?.credits_remaining,
    llm?.creditsRemaining,
    root.credits_remaining,
    root.creditsRemaining,
  );

  if (used == null) {
    used = pickNumber(
      llm?.tokens_used,
      llm?.tokensUsed,
      root.tokens_used,
      root.tokensUsed,
    );
  }
  if (limit == null) {
    limit = pickNumber(
      llm?.tokens_limit,
      llm?.tokensLimit,
      root.tokens_limit,
      root.tokensLimit,
    );
  }
  if (remaining == null) {
    remaining = pickNumber(
      llm?.tokens_remaining,
      llm?.tokensRemaining,
      root.tokens_remaining,
      root.tokensRemaining,
    );
  }

  const unmetered = Boolean(
    pickBool(llm?.unmetered, root.unmetered, user.unmetered) ?? false,
  );

  if (used == null && remaining != null && limit != null) {
    used = Math.max(0, limit - remaining);
  }
  if (remaining == null && used != null && limit != null) {
    remaining = Math.max(0, limit - used);
  }
  if (limit == null && used != null && remaining != null) {
    limit = Math.max(0, used + remaining);
  }

  if (!unmetered && (used == null || limit == null)) {
    if (llm == null && plan == null) return null;
  }

  const enabled = pickBool(llm?.enabled, root.enabled, user.llm_enabled) ?? true;

  const periodStart = pickString(
    llm?.period_start,
    llm?.periodStart,
    root.period_start,
    root.periodStart,
  );
  const periodEnd = pickString(
    llm?.period_end,
    llm?.periodEnd,
    llm?.resets_at,
    llm?.resetsAt,
    root.period_end,
    root.periodEnd,
    root.resets_at,
    root.resetsAt,
  );

  const safeUsed = Math.max(0, Math.floor(used ?? 0));
  const safeLimit = Math.max(0, Math.floor(limit ?? 0));
  let safeRemaining = remaining != null ? Math.max(0, Math.floor(remaining)) : Math.max(0, safeLimit - safeUsed);
  if (!unmetered && safeLimit > 0) {
    safeRemaining = Math.min(safeRemaining, safeLimit);
  }

  return {
    plan,
    role,
    enabled,
    creditsUsed: safeUsed,
    creditsLimit: safeLimit,
    creditsRemaining: safeRemaining,
    periodStart,
    periodEnd,
    unmetered,
    fetchedAt,
  };
}

export function creditsUsagePercent(snapshot: LlmCreditsSnapshot | null | undefined): number {
  if (!snapshot || snapshot.unmetered) return 0;
  const limit = snapshot.creditsLimit;
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((snapshot.creditsUsed / limit) * 100)));
}

export function creditsLevel(
  snapshot: LlmCreditsSnapshot | null | undefined,
  status: "loading" | "ready" | "error" = "ready",
): LlmCreditsLevel {
  if (status === "loading" && !snapshot) return "loading";
  if (status === "error" && !snapshot) return "unavailable";
  if (!snapshot) return "unavailable";
  if (!snapshot.enabled) return "disabled";
  if (snapshot.unmetered) return "unmetered";
  if (snapshot.creditsLimit <= 0) return "unavailable";
  const pct = creditsUsagePercent(snapshot);
  if (pct >= 100 || snapshot.creditsRemaining <= 0) return "exhausted";
  if (pct >= 95) return "critical";
  if (pct >= 80) return "warning";
  return "normal";
}

export function formatCreditsNumber(value: number): string {
  try {
    return new Intl.NumberFormat("en-US").format(Math.max(0, Math.floor(value)));
  } catch {
    return String(Math.max(0, Math.floor(value)));
  }
}

export function formatPeriodEnd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    if (/^\d{4}-\d{2}$/.test(iso)) {
      const [y, m] = iso.split("-").map(Number);
      const end = new Date(Date.UTC(y!, m!, 0));
      return end.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    }
    return iso;
  }
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function isOutOfCreditsError(message: string, data?: unknown): boolean {
  const record = asRecord(data);
  const nested = asRecord(record?.error);
  const code = pickString(record?.error, record?.code, nested?.code, nested?.error);
  if (code && /out_of_credits|payment_required|credits_exhausted/i.test(code)) return true;
  const text = (message || "").toLowerCase();
  return (
    text.includes("out_of_credits")
    || text.includes("out of plan credits")
    || text.includes("out of credits")
    || text.includes("monthly ai credits")
    || (text.includes("credits") && (text.includes("used all") || text.includes("exhausted") || text.includes("upgrade")))
  );
}

export function mapManagedLlmUserMessage(message: string): string {
  const text = (message || "").trim();
  const lower = text.toLowerCase();
  if (!text) return "Agent request failed";

  if (isOutOfCreditsError(text)) {
    return text;
  }
  if (
    lower.includes("session expired")
    || lower.includes("sign in again")
    || lower.includes("unauthorized")
    || lower.includes("cloud_session_expired")
  ) {
    return "Your session has expired. Sign in again.";
  }
  if (lower.includes("rate limit") || lower.includes("too many") || lower.includes("429")) {
    return "Too many AI requests. Wait a moment and try again.";
  }
  if (
    lower.includes("provider_unavailable")
    || (lower.includes("temporarily unavailable") && lower.includes("not charged"))
  ) {
    return "The AI service is temporarily unavailable. Your credits were not charged.";
  }
  if (
    lower.includes("billing_configuration")
    || lower.includes("misconfigured")
    || (lower.includes("not configured") && lower.includes("api"))
  ) {
    return "AI is temporarily unavailable for this model. Your credits were not charged.";
  }
  return text;
}
