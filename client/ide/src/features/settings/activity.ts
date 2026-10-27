const STORAGE_KEY = "coloride.local-activity.v1";

export interface LocalActivity {
  days: Record<string, number>;
  firstUsedAt: string;
  launches: number;
  /** Actual managed-LLM tokens used per local calendar day. */
  tokenDays: Record<string, number>;
  /** Lifetime total kept locally for the Account summary. */
  tokensUsed: number;
  /** Prevent duplicate WebSocket deliveries from incrementing a turn twice. */
  usageEventIds: string[];
}

const emptyActivity = (): LocalActivity => ({
  days: {},
  firstUsedAt: new Date().toISOString(),
  launches: 0,
  tokenDays: {},
  tokensUsed: 0,
  usageEventIds: [],
});

export const readLocalActivity = (): LocalActivity => {
  if (typeof window === "undefined") return emptyActivity();

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return emptyActivity();
    const parsed = JSON.parse(stored) as Partial<LocalActivity>;
    return {
      days: parsed.days ?? {},
      firstUsedAt: parsed.firstUsedAt ?? new Date().toISOString(),
      launches: parsed.launches ?? 0,
      tokenDays: parsed.tokenDays ?? {},
      tokensUsed: Math.max(0, Math.floor(parsed.tokensUsed ?? 0)),
      usageEventIds: Array.isArray(parsed.usageEventIds)
        ? parsed.usageEventIds.filter((value): value is string => typeof value === "string").slice(-2_000)
        : [],
    };
  } catch {
    return emptyActivity();
  }
};

let recordedThisRuntime = false;

const saveActivity = (activity: LocalActivity) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(activity));
    window.dispatchEvent(new CustomEvent("coloride:activity-changed"));
  } catch {
    // Activity remains optional when local storage is unavailable.
  }
};

export const recordAppActivity = (enabled = true) => {
  if (typeof window === "undefined" || recordedThisRuntime || !enabled) return;
  recordedThisRuntime = true;

  const activity = readLocalActivity();
  const today = new Date().toISOString().slice(0, 10);
  const next: LocalActivity = {
    ...activity,
    days: {
      ...activity.days,
      [today]: (activity.days[today] ?? 0) + 1,
    },
    launches: activity.launches + 1,
  };

  saveActivity(next);
};

/** Record the authoritative token total emitted by one completed model response. */
export const recordTokenActivity = (tokens: number, usageEventId: string, enabled = true) => {
  const tokenCount = Math.max(0, Math.floor(tokens));
  const id = usageEventId.trim();
  if (typeof window === "undefined" || !enabled || tokenCount <= 0 || !id) return;

  const activity = readLocalActivity();
  if (activity.usageEventIds.includes(id)) return;
  const today = new Date().toISOString().slice(0, 10);
  const next: LocalActivity = {
    ...activity,
    tokenDays: {
      ...activity.tokenDays,
      [today]: (activity.tokenDays[today] ?? 0) + tokenCount,
    },
    tokensUsed: activity.tokensUsed + tokenCount,
    usageEventIds: [...activity.usageEventIds, id].slice(-2_000),
  };
  saveActivity(next);
};

export const clearLocalActivity = () => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("coloride:activity-changed"));
  } catch {
    // Clearing local history is best-effort when storage is unavailable.
  }
};
