export function payloadLooksRevoked(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.revoked === true) return true;
  const status = Number(record.status);
  if (status === 401 || status === 403) return true;
  const nested = record.error;
  const message = [
    record.message,
    record.detail,
    nested && typeof nested === "object"
      ? (nested as { message?: unknown }).message
      : "",
  ]
    .map((item) => String(item || "").toLowerCase())
    .join(" ");
  return (
    message.includes("invalid or expired refresh") ||
    message.includes("invalid_grant") ||
    message.includes("token revoked") ||
    (message.includes("refresh token") && message.includes("invalid"))
  );
}

export function payloadLooksTransient(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).transient === true,
  );
}

export function transientPayloadMessage(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "Coloride Cloud is temporarily unavailable.";
  }
  const record = value as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  return "Coloride Cloud is temporarily unavailable.";
}

/** True only when the cloud explicitly rejected the session (not network / sidecar down). */
export function isAuthRevokedError(error: unknown): boolean {
  if (error instanceof CloudAuthHttpError) {
    // status 0 = failed to reach local backend
    if (error.status === 0) return false;
    if (error.status === 401 || error.status === 403) return true;
    return (
      payloadLooksRevoked(error.body) ||
      payloadLooksRevoked({ message: error.message })
    );
  }
  if (!(error instanceof Error)) return false;
  if (/\((401|403)\)/.test(error.message)) return true;
  return payloadLooksRevoked({ message: error.message });
}

export class CloudAuthHttpError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "CloudAuthHttpError";
    this.status = status;
    this.body = body;
  }
}
