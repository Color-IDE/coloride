export type CloudAuthUser = {
  id: string;
  email: string;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  /** Absolute URL ready for <img src>, when known. */
  avatar_url?: string | null;
  /** Relative path from the product API (e.g. /uploads/avatars/…). */
  avatar_path?: string | null;
  created_at?: string | null;
};

export type CloudAuthTokens = {
  access_token: string;
  refresh_token: string;
  user?: CloudAuthUser;
};

/**
 * Cursor-style device login payload from POST /auth/device/code.
 *
 * Primary path: open `verification_uri_complete` (loginDeepControl?challenge=&uuid=)
 * and poll with `device_code` (=== `challenge`, long secret).
 * Short `user_code` is optional fallback only.
 */
export type DeviceCodeResponse = {
  /** Long secret used for poll (`device_code` === `challenge`). */
  device_code: string;
  /** Same as device_code when API sends Cursor-style challenge. */
  challenge?: string;
  uuid?: string;
  /** Short human code — fallback only; not shown in desktop UI. */
  user_code?: string;
  verification_uri: string;
  /** Prefer this: https://app.coloride.com/loginDeepControl?challenge=…&uuid=…&mode=login */
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

export type DevicePollPending = { status: "pending" };

export type DevicePollTerminal = {
  status: "expired" | "denied";
  detail?: string;
};

export type DevicePollApproved = {
  status: "approved";
  access_token: string;
  refresh_token: string;
  user: CloudAuthUser;
};

export type DevicePollResponse =
  DevicePollPending | DevicePollTerminal | DevicePollApproved;

export type CloudAuthSession = {
  user: CloudAuthUser;
  /** Access JWT — memory only. Empty while a stored session is still refreshing. */
  accessToken: string;
  /** True when the last account was restored locally and cloud refresh is in flight. */
  pendingRefresh?: boolean;
};

export type SessionListener = (session: CloudAuthSession | null) => void;

export type DevicePollResult = DevicePollResponse & {
  /** When status is pending, optional server hint to back off (seconds). */
  intervalHint?: number;
};

/** In-flight browser linking session (no codes exposed to UI). */
export type BrowserLinkSession = {
  /** HTTPS link opened in the system browser (login or link-desktop). */
  linkUrl: string;
  expiresAt: number;
  /** Resolves when the website linked this desktop, or rejects on cancel/expire/deny. */
  done: Promise<CloudAuthUser>;
  cancel: () => void;
};

/** @deprecated Use BrowserLinkSession */
export type DeviceLoginSession = BrowserLinkSession;
