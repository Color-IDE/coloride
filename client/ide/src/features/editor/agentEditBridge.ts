/** Queue green/red agent-edit highlights + Accept/Reject review state. */

export type AgentEditReview = {
  path: string;
  before: string;
  after: string;
};

type Pending = AgentEditReview;

// v1 could persist a baseline captured from the previously active tab during
// a rapid agent file switch. Do not restore those potentially unsafe Undo
// payloads into the file now shown by the editor.
const STORAGE_KEY = "coloride.agent-edit-reviews.v2";
/** Soft cap so localStorage stays healthy (paths + full file texts). */
const MAX_STORED_REVIEWS = 40;
const MAX_PAYLOAD_CHARS = 3_500_000;

let pendingHighlight: Pending | null = null;
/** Reviews waiting for Accept / Reject (keyed by normalized path). */
const reviews = new Map<string, AgentEditReview>();
const reviewListeners = new Set<() => void>();
let hydrated = false;

type StoredShape = {
  version: 2;
  updatedAt: number;
  items: AgentEditReview[];
};

/** Normalize path for stable Map keys across agent / explorer / tabs. */
export function normalizeAgentPath(path: string): string {
  if (!path) return "";
  try {
    let p = decodeURIComponent(path).trim();
    p = p.replace(/\/+$/, "") || "/";
    return p;
  } catch {
    return path.trim().replace(/\/+$/, "") || "/";
  }
}

export function pathsMatchAgent(a: string, b: string): boolean {
  return normalizeAgentPath(a) === normalizeAgentPath(b);
}

function isReview(value: unknown): value is AgentEditReview {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.path === "string"
    && v.path.length > 0
    && typeof v.before === "string"
    && typeof v.after === "string"
    && v.before !== v.after
  );
}

function persistReviews() {
  if (typeof window === "undefined") return;
  try {
    const items = [...reviews.values()].slice(-MAX_STORED_REVIEWS);
    const payload: StoredShape = {
      version: 2,
      updatedAt: Date.now(),
      items,
    };
    let raw = JSON.stringify(payload);
    while (raw.length > MAX_PAYLOAD_CHARS && payload.items.length > 1) {
      payload.items.shift();
      raw = JSON.stringify(payload);
    }
    if (raw.length > MAX_PAYLOAD_CHARS) return;
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // quota / private mode
  }
}

/** Load reviews saved across restarts (Keep/Undo not yet applied). */
export function hydrateAgentEditReviews(force = false): number {
  if (typeof window === "undefined") return 0;
  if (hydrated && !force) return reviews.size;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return reviews.size;
    const parsed = JSON.parse(raw) as Partial<StoredShape>;
    if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.items)) return reviews.size;
    let n = 0;
    for (const item of parsed.items) {
      if (!isReview(item)) continue;
      const key = normalizeAgentPath(item.path);
      if (!key) continue;
      if (force || !reviews.has(key)) {
        reviews.set(key, {
          path: key,
          before: item.before,
          after: item.after,
        });
      }
      n += 1;
    }
    return n;
  } catch {
    return reviews.size;
  }
}

// Eager hydrate so first paint after restart can see pending reviews.
hydrateAgentEditReviews();

function notifyReviews(options?: { persist?: boolean }) {
  if (options?.persist !== false) persistReviews();
  for (const listener of reviewListeners) listener();
}

export function subscribeAgentEditReviews(listener: () => void): () => void {
  reviewListeners.add(listener);
  return () => {
    reviewListeners.delete(listener);
  };
}

export function queueAgentEditHighlight(path: string, before: string, after: string) {
  hydrateAgentEditReviews();
  const key = normalizeAgentPath(path);
  if (!key || before === after) {
    if (pendingHighlight && normalizeAgentPath(pendingHighlight.path) === key) {
      pendingHighlight = null;
    }
    if (key) reviews.delete(key);
    notifyReviews();
    return;
  }
  const review = { path: key, before, after };
  pendingHighlight = review;
  reviews.set(key, review);
  notifyReviews();
}

export function takeAgentEditHighlight(path: string): Pending | null {
  hydrateAgentEditReviews();
  const key = normalizeAgentPath(path);
  if (!pendingHighlight || normalizeAgentPath(pendingHighlight.path) !== key) return null;
  const hit = pendingHighlight;
  pendingHighlight = null;
  return hit;
}

export function getAgentEditReview(path: string | null | undefined): AgentEditReview | null {
  hydrateAgentEditReviews();
  if (!path) return null;
  return reviews.get(normalizeAgentPath(path)) ?? null;
}

export function getAllAgentEditReviews(): AgentEditReview[] {
  hydrateAgentEditReviews();
  return [...reviews.values()];
}

/** Drop orphaned reviews only after a successful, complete directory listing.
 * Collapsed descendants still count when their immediate child directory exists.
 */
export function reconcileAgentEditReviewDirectory(directory: string, childPaths: readonly string[]) {
  hydrateAgentEditReviews();
  const root = normalizeAgentPath(directory);
  const prefix = root === "/" ? "/" : `${root}/`;
  const children = new Set(childPaths.map(normalizeAgentPath));
  let changed = false;
  for (const key of reviews.keys()) {
    if (!key.startsWith(prefix)) continue;
    const relative = key.slice(prefix.length);
    const child = `${prefix}${relative.split("/")[0]}`;
    if (children.has(child)) continue;
    reviews.delete(key);
    if (pendingHighlight?.path === key) pendingHighlight = null;
    changed = true;
  }
  if (changed) notifyReviews();
}

export function hasAgentEditReviews(): boolean {
  hydrateAgentEditReviews();
  return reviews.size > 0;
}

/**
 * Clear one path or all reviews.
 * `persist: false` clears memory only (e.g. workspace disconnect) so restart
 * restore still finds pending Keep/Undo work on disk.
 */
export function clearAgentEditReview(path?: string, options?: { persist?: boolean }) {
  hydrateAgentEditReviews();
  if (!path) {
    reviews.clear();
    pendingHighlight = null;
    if (options?.persist === false) {
      hydrated = false;
      notifyReviews({ persist: false });
      return;
    }
  } else {
    const key = normalizeAgentPath(path);
    reviews.delete(key);
    if (pendingHighlight && normalizeAgentPath(pendingHighlight.path) === key) {
      pendingHighlight = null;
    }
  }
  notifyReviews({ persist: options?.persist !== false });
}

export function clearQueuedAgentEditHighlight(path?: string) {
  if (!path) {
    pendingHighlight = null;
    return;
  }
  const key = normalizeAgentPath(path);
  if (pendingHighlight && normalizeAgentPath(pendingHighlight.path) === key) {
    pendingHighlight = null;
  }
}

/** After a partial hunk reject/accept, keep review but point `after` at the new buffer. */
export function updateAgentEditReviewAfter(path: string, after: string, baseline?: string) {
  hydrateAgentEditReviews();
  const key = normalizeAgentPath(path);
  const current = reviews.get(key);
  if (!current) return;
  const before = baseline ?? current.before;
  if (before === current.before && after === current.after) return;
  if (before === after) {
    clearAgentEditReview(key);
    return;
  }
  const next = { path: key, before, after };
  reviews.set(key, next);
  if (pendingHighlight && normalizeAgentPath(pendingHighlight.path) === key) {
    pendingHighlight = next;
  }
  persistReviews();
}

/** Peek without consuming — used to (re)paint green/red after stream settles. */
export function peekAgentEditHighlight(path: string): Pending | null {
  hydrateAgentEditReviews();
  const key = normalizeAgentPath(path);
  if (pendingHighlight && normalizeAgentPath(pendingHighlight.path) === key) {
    return pendingHighlight;
  }
  return reviews.get(key) ?? null;
}

/**
 * Resolve the buffer text that should be shown for a path that still has a
 * pending review. If the tab cache was reset to the pre-agent baseline, put
 * the post-agent `after` back so green/red can paint again.
 */
export function resolveReviewBufferText(path: string, current: string): string {
  const review = getAgentEditReview(path);
  if (!review) return current;
  // Buffer lost agent content (still at baseline) — restore reviewed after.
  if (current === review.before && review.after !== review.before) {
    return review.after;
  }
  // Empty / not loaded yet while we know the agent result.
  if (!current && review.after) {
    return review.after;
  }
  return current;
}

/* ── Sync IDE Accept/Reject ↔ agent chat Keep all / Undo all ─────────────── */

export type AgentCheckpointSyncHandlers = {
  /** IDE accepted a file (all hunks) — hide matching checkpoint dock entries. */
  onIdeAcceptPaths: (paths: string[]) => void;
  /** IDE rejected a file — optional agent-side bookkeeping (file already written). */
  onIdeRejectPaths: (paths: string[]) => void | Promise<void>;
};

let checkpointSyncHandlers: AgentCheckpointSyncHandlers | null = null;

/** Registered by AgentView (one instance: sidebar + full tab share it). */
export function registerAgentCheckpointSync(
  handlers: AgentCheckpointSyncHandlers,
): () => void {
  checkpointSyncHandlers = handlers;
  return () => {
    if (checkpointSyncHandlers === handlers) checkpointSyncHandlers = null;
  };
}

/** Call from IDE when the user Accepts a file’s agent edits. */
export function notifyIdeAcceptedPaths(paths: string[]) {
  const cleaned = paths.map((p) => p.trim()).filter(Boolean);
  if (!cleaned.length) return;
  checkpointSyncHandlers?.onIdeAcceptPaths(cleaned);
}

/** Call from IDE when the user Rejects a file’s agent edits (content already restored). */
export function notifyIdeRejectedPaths(paths: string[]) {
  const cleaned = paths.map((p) => p.trim()).filter(Boolean);
  if (!cleaned.length) return;
  return checkpointSyncHandlers?.onIdeRejectPaths(cleaned);
}

/** Agent Keep all / Undo all — drop IDE green/red + Accept UI for those paths. */
export function clearIdeReviewsForPaths(paths: string[]) {
  hydrateAgentEditReviews();
  let changed = false;
  for (const path of paths) {
    if (!path) continue;
    const key = normalizeAgentPath(path);
    if (reviews.has(key) || (pendingHighlight && normalizeAgentPath(pendingHighlight.path) === key)) {
      reviews.delete(key);
      if (pendingHighlight && normalizeAgentPath(pendingHighlight.path) === key) {
        pendingHighlight = null;
      }
      changed = true;
    }
  }
  if (changed) notifyReviews();
}

export function clearAllIdeReviews() {
  hydrateAgentEditReviews();
  if (!reviews.size && !pendingHighlight) return;
  reviews.clear();
  pendingHighlight = null;
  notifyReviews();
}
