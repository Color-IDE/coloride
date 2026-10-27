import type { Profile } from "../../../shared/api/types";

export const MAX_TREE_UNDO = 25;

export const MAX_TREE_UNDO_FILES = 400;

export const MAX_TREE_UNDO_BYTES = 48 * 1024 * 1024;

export const messageFromError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  const jsonStart = raw.indexOf("{");

  if (jsonStart >= 0) {
    try {
      const payload = JSON.parse(raw.slice(jsonStart));
      if (typeof payload.message === "string") {
        return payload.message;
      }
      if (payload.detail && typeof payload.detail.message === "string") {
        return payload.detail.message;
      }
    } catch {}
  }

  return raw;
};

export const isApiNotFound = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  return (
    raw.includes("Coloride API 404") ||
    raw.includes('"detail":"Not Found"') ||
    /file not found/i.test(raw)
  );
};

export const isMissingFileError = (error: string) =>
  /file not found|Coloride API 404|not found/i.test(error);

export const isConnectionNotOpen = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  return (
    raw.includes("Connection not open") ||
    raw.includes("No active SSH connection")
  );
};

export const isValidServerName = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 60;
};

export const isValidIPv4 = (value: string) => {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    // No leading zeros (except "0" itself)
    if (part.length > 1 && part.startsWith("0")) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
};

/** Basic IPv6 (full / compressed). Good enough for SSH host fields. */
export const isValidIPv6 = (value: string) => {
  const host = value.trim();
  if (!host || host.includes(" ")) return false;
  // Fast reject common garbage
  if (!host.includes(":")) return false;
  // Use URL parser — browsers validate IPv6 in brackets.
  try {
    // eslint-disable-next-line no-new
    new URL(`http://[${host}]/`);
    return true;
  } catch {
    return false;
  }
};

/**
 * Strict host: real IPv4/IPv6, localhost, or a proper hostname/domain.
 * Rejects "a", "2", bare numbers, empty labels, schemes, paths.
 */
export const isValidHost = (value: string) => {
  const host = value.trim();
  if (!host || host.length > 253) return false;
  if (
    host.includes("://") ||
    host.includes("@") ||
    host.includes("/") ||
    /\s/.test(host)
  ) {
    return false;
  }

  // Strip optional [ipv6] brackets for checks
  if (host.startsWith("[") && host.endsWith("]")) {
    return isValidIPv6(host.slice(1, -1));
  }

  if (isValidIPv4(host)) return true;
  if (isValidIPv6(host)) return true;

  const lower = host.toLowerCase();
  if (lower === "localhost") return true;

  // Pure digits only → not a host (e.g. "2")
  if (/^\d+$/.test(host)) return false;
  // Single character → too short
  if (host.length < 2) return false;

  // DNS hostname labels
  const labels = host.split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63))
    return false;
  if (labels.some((label) => label.startsWith("-") || label.endsWith("-")))
    return false;
  if (labels.some((label) => !/^[a-zA-Z0-9-]+$/.test(label))) return false;

  if (labels.length === 1) {
    // LAN-style name: must start with a letter, min 2 chars (rejects "a", "2", "x1" ok if starts letter)
    return /^[a-zA-Z][a-zA-Z0-9-]{1,62}$/.test(host);
  }

  // FQDN: last label is TLD-like (letters, ≥2 chars)
  const tld = labels[labels.length - 1] ?? "";
  if (tld.length < 2 || !/^[a-zA-Z]{2,63}$/.test(tld)) return false;

  return true;
};

export const hasInvalidHostFormat = (value: string) => !isValidHost(value);

export const isValidPort = (value: string) => {
  if (!/^\d+$/.test(value)) return false;
  const portNum = Number(value);
  return Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
};

export const isValidUsername = (value: string) => {
  return (
    value.length >= 1 &&
    value.length <= 64 &&
    !/\s/.test(value) &&
    !value.includes("@") &&
    !value.includes("/") &&
    !value.includes("\\")
  );
};

export const normalizeRemoteRoot = (value: string, user: string) => {
  const trimmed = value.trim();
  if (trimmed) {
    return trimmed === "/" ? "/" : trimmed.replace(/\/+$/, "");
  }

  return user === "root" ? "/root" : `/home/${user}`;
};

export const inferProfileUsername = (profile: Profile) => {
  if (profile.username) {
    return profile.username;
  }

  const namePrefix = profile.name.includes("@")
    ? profile.name.split("@")[0]
    : "";
  return namePrefix || "root";
};
