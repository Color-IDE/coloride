/** Typical product access JWTs live ~15 minutes. Refresh before they die mid-turn. */
export const ACCESS_REFRESH_SKEW_MS = 90_000;

export function accessTokenExpiresAtMs(token: string | null | undefined): number | null {
  const raw = (token || "").trim();
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1] || "";
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const data = JSON.parse(json) as { exp?: unknown };
    const exp = typeof data.exp === "number" ? data.exp : Number(data.exp);
    if (!Number.isFinite(exp)) return null;
    return exp * 1000;
  } catch {
    return null;
  }
}

export function accessTokenNeedsRefresh(
  token: string | null | undefined,
  now = Date.now(),
  skewMs = ACCESS_REFRESH_SKEW_MS,
): boolean {
  if (!token?.trim()) return true;
  const expiresAt = accessTokenExpiresAtMs(token);
  if (expiresAt == null) return false;
  return now >= expiresAt - Math.max(0, skewMs);
}
