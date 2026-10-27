import { cloudConfig } from "../../../shared/api/cloudConfig";
import { type CloudAuthTokens, type CloudAuthUser } from "./types";

/** Public website (opened in system browser). */
export const CLOUD_AUTH_APP_BASE = cloudConfig.appBase;

/** Direct cloud API — only used by the local sidecar proxy, not the renderer. */
export const CLOUD_AUTH_API_BASE = cloudConfig.apiBase;

export const DEFAULT_USER_AVATAR = "/default-user-avatar.png";

/**
 * Build a usable avatar URL from cloud user fields.
 * Prefers absolute avatar_url; otherwise joins avatar_path to the app origin.
 */
export function resolveCloudAvatarUrl(
  user: Pick<CloudAuthUser, "avatar_url" | "avatar_path"> | null | undefined,
): string {
  if (!user) return DEFAULT_USER_AVATAR;
  const url = (user.avatar_url || "").trim();
  if (url) {
    if (
      /^https?:\/\//i.test(url) ||
      url.startsWith("data:") ||
      url.startsWith("blob:")
    ) {
      return url;
    }
    // Protocol-relative or root-relative absolute-looking paths.
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) return `${CLOUD_AUTH_APP_BASE}${url}`;
    return `${CLOUD_AUTH_APP_BASE}/${url.replace(/^\/+/, "")}`;
  }
  const path = (user.avatar_path || "").trim();
  if (!path) return DEFAULT_USER_AVATAR;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`;
  if (path.startsWith("/")) return `${CLOUD_AUTH_APP_BASE}${path}`;
  // Common storage keys without leading slash.
  return `${CLOUD_AUTH_APP_BASE}/${path.replace(/^\/+/, "")}`;
}

export function pickOptionalString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function normalizeUser(raw: unknown): CloudAuthUser | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  // Nested profile blobs from some /me shapes.
  const profile =
    record.profile && typeof record.profile === "object"
      ? (record.profile as Record<string, unknown>)
      : null;
  const id = record.id ?? record.sub ?? profile?.id;
  const email = record.email ?? profile?.email;
  if (typeof id !== "string" && typeof id !== "number") return null;
  if (typeof email !== "string" || !email.trim()) return null;

  const avatar_path = pickOptionalString(
    record.avatar_path,
    record.avatarPath,
    profile?.avatar_path,
    profile?.avatarPath,
    record.picture_path,
    record.image_path,
  );
  let avatar_url = pickOptionalString(
    record.avatar_url,
    record.avatarUrl,
    profile?.avatar_url,
    profile?.avatarUrl,
    record.picture,
    record.picture_url,
    record.image,
    record.image_url,
    record.photo_url,
    record.photoUrl,
    profile?.picture,
    profile?.image,
  );
  // If API only sent a path, promote a resolved absolute URL for UI convenience.
  if (!avatar_url && avatar_path) {
    avatar_url = resolveCloudAvatarUrl({ avatar_url: null, avatar_path });
  } else if (avatar_url) {
    avatar_url = resolveCloudAvatarUrl({ avatar_url, avatar_path: null });
  }

  const first_name = pickOptionalString(
    record.first_name,
    record.firstName,
    profile?.first_name,
    profile?.firstName,
  );
  const last_name = pickOptionalString(
    record.last_name,
    record.lastName,
    profile?.last_name,
    profile?.lastName,
  );
  let name = pickOptionalString(
    record.name,
    profile?.name,
    record.display_name,
    record.displayName,
  );
  if (!name && (first_name || last_name)) {
    name = [first_name, last_name].filter(Boolean).join(" ");
  }

  return {
    id: String(id),
    email: email.trim(),
    name,
    first_name,
    last_name,
    avatar_url,
    avatar_path,
    created_at: pickOptionalString(
      record.created_at,
      record.createdAt,
      profile?.created_at,
      profile?.createdAt,
    ),
  };
}

export function tokensFromPayload(raw: unknown): CloudAuthTokens | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  // Nested envelopes: { tokens: {...} }, { data: {...} }, { session: {...} }
  const nested =
    (record.tokens && typeof record.tokens === "object"
      ? (record.tokens as Record<string, unknown>)
      : null) ||
    (record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : null) ||
    (record.session && typeof record.session === "object"
      ? (record.session as Record<string, unknown>)
      : null) ||
    null;
  const bag = nested ?? record;
  const access = pickOptionalString(
    bag.access_token,
    bag.accessToken,
    record.access_token,
    record.accessToken,
  );
  const refresh = pickOptionalString(
    bag.refresh_token,
    bag.refreshToken,
    record.refresh_token,
    record.refreshToken,
  );
  if (!access) return null;
  const user =
    normalizeUser(bag.user) || normalizeUser(record.user) || normalizeUser(bag);
  return {
    access_token: access,
    refresh_token: refresh || "",
    user: user ?? undefined,
  };
}
