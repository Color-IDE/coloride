import { cloudConfig } from "../../../shared/api/cloudConfig";
import { normalizeUser } from "./payload";
import { type CloudAuthUser } from "./types";

const endpointSuffix = cloudConfig.apiBase ? `:${encodeURIComponent(cloudConfig.apiBase)}` : "";
export const REFRESH_FALLBACK_KEY = "coloride.cloud-auth.refresh.v1" + endpointSuffix;

export const LAST_USER_KEY = "coloride.cloud-auth.last-user.v1" + endpointSuffix;

export function readLocalRefreshFallback(): string | null {
  try {
    const value = window.localStorage.getItem(REFRESH_FALLBACK_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function readLastUser(): CloudAuthUser | null {
  try {
    const raw = window.localStorage.getItem(LAST_USER_KEY);
    if (!raw) return null;
    return normalizeUser(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeLastUser(user: CloudAuthUser | null): void {
  try {
    if (!user) {
      window.localStorage.removeItem(LAST_USER_KEY);
      return;
    }
    window.localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
  } catch {
    // ignore quota / private mode
  }
}

export async function readStoredRefreshToken(): Promise<string | null> {
  const desktop = window.colorideDesktop?.cloudAuth;
  if (desktop?.hasSession) {
    try {
      return (await desktop.hasSession()) ? "electron-main-process" : null;
    } catch {
      return null;
    }
  }
  // Browser-only fallback. Electron never exposes or mirrors refresh tokens here.
  return readLocalRefreshFallback();
}

export async function writeStoredRefreshToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (window.colorideDesktop?.cloudAuth) return;
  // Web build fallback only.
  try {
    window.localStorage.setItem(REFRESH_FALLBACK_KEY, trimmed);
  } catch {
    // ignore
  }
}

export async function clearStoredRefreshToken(): Promise<void> {
  const desktop = window.colorideDesktop?.cloudAuth;
  if (desktop?.logout) {
    try {
      await desktop.logout(false);
    } catch {
      // ignore
    }
    return;
  }
  try {
    window.localStorage.removeItem(REFRESH_FALLBACK_KEY);
  } catch {
    // ignore
  }
}
