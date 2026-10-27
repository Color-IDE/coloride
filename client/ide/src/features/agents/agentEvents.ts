import type { AgentApproval, AgentEvent } from "@coloride/contracts";

/**
 * Full durable history window (matches backend max). Chat switches stay fast because
 * we cache after the first load and do not re-fetch hydrated sessions.
 */
export const HISTORY_EVENT_LIMIT = 20_000;

export const HISTORY_PAGE_TURNS = 30;
// History is durable in the sidecar. Keep only nearby chats in renderer memory;
// retaining 24 full event streams plus rebuilt timelines pushed Electron into GBs.
export const HISTORY_CACHE_SESSIONS = 4;
export const PREFETCH_SESSION_COUNT = 1;
export const TIMELINE_RENDER_TURNS = 160;

export const historyPageMayHaveOlder = (page: AgentEvent[]) => {
  if (!page.length) return false;
  let earliest = page[0]!.sequence;
  for (let index = 1; index < page.length; index += 1) {
    earliest = Math.min(earliest, page[index]!.sequence);
  }
  return earliest > 1;
};

export const eventsFingerprint = (list: AgentEvent[]) => {
  if (!list.length) return "0";
  const first = list[0]!;
  const last = list[list.length - 1]!;
  // Include a crumb of last payload so coalesced delta content invalidates cache
  // even if length/ids somehow stall (defensive).
  const lastType = last.type;
  const lastDataLen =
    typeof last.data?.text === "string"
      ? last.data.text.length
      : typeof last.data?.detail === "string"
        ? last.data.detail.length
        : 0;
  return `${list.length}:${first.id}:${first.sequence}:${last.id}:${last.sequence}:${lastType}:${lastDataLen}`;
};

/**
 * Index of the latest user_message (including hidden Implement kickoffs).
 * Hidden messages are not rendered, but they bound the live-turn rebuild slice.
 */
export const findLiveTurnStartIndex = (list: AgentEvent[]) => {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]!.type === "user_message") return i;
  }
  return 0;
};

/**
 * A provider outage is not a completed user turn. Keep its raw events for
 * diagnostics/recovery, but omit the whole failed turn from the visible chat
 * so the restored composer draft is the single obvious retry affordance.
 */
export const withoutProviderFailureTurns = (
  list: AgentEvent[],
): AgentEvent[] => {
  const hidden = new Set<string>();
  for (let index = 0; index < list.length; index += 1) {
    const event = list[index]!;
    if (
      event.type !== "guard_paused" ||
      (event.data as { reason?: unknown })?.reason !== "provider-errors"
    ) {
      continue;
    }
    let start = index;
    while (start > 0) {
      const previous = list[start - 1]!;
      if (
        previous.sessionId === event.sessionId &&
        previous.type === "user_message"
      )
        break;
      start -= 1;
    }
    // Without a matching user prompt, never hide unrelated history.
    if (
      list[start]?.sessionId !== event.sessionId ||
      list[start]?.type !== "user_message"
    )
      continue;
    let end = index;
    while (end + 1 < list.length) {
      const next = list[end + 1]!;
      if (next.sessionId === event.sessionId && next.type === "user_message")
        break;
      end += 1;
    }
    for (let cursor = start; cursor <= end; cursor += 1)
      hidden.add(list[cursor]!.id);
  }
  return hidden.size ? list.filter((event) => !hidden.has(event.id)) : list;
};

export const mergeAgentEvents = (...groups: AgentEvent[][]) => {
  const events = new Map<string, AgentEvent>();
  for (const group of groups) {
    for (const event of group) events.set(event.id, event);
  }
  // Already-ordered groups (disk history + append) skip a full sort when possible.
  const merged = [...events.values()];
  let ordered = true;
  for (let i = 1; i < merged.length; i += 1) {
    if (merged[i]!.sequence < merged[i - 1]!.sequence) {
      ordered = false;
      break;
    }
  }
  const sorted = ordered
    ? merged
    : merged.sort((left, right) => left.sequence - right.sequence);
  return compactLiveFileWriteEvents(sorted);
};

/**
 * A progressive write event contains the latest partial file, not an additive
 * delta. Retaining every snapshot makes one large edit keep many copies of the
 * same file in React state and forces the timeline to rebuild them all. The
 * editor consumes every event before this compaction; chat only needs the most
 * recent snapshot per live tool call.
 */
const compactLiveFileWriteEvents = (events: AgentEvent[]) => {
  const seen = new Set<string>();
  let removed = false;
  const compacted: AgentEvent[] = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "file_write_delta") {
      const itemId =
        typeof event.data?.itemId === "string" ? event.data.itemId : "";
      if (itemId) {
        const key = `${event.sessionId}:${itemId}`;
        if (seen.has(key)) {
          removed = true;
          continue;
        }
        seen.add(key);
      }
    }
    compacted.push(event);
  }
  if (!removed) return events;
  compacted.reverse();
  return compacted;
};

/**
 * Approval requests are emitted once and are intentionally immutable. If the
 * desktop process was closed while one was waiting, the sidecar marks it
 * expired on startup. Hydrating the current records prevents that old event
 * from reviving a dead approval card in a restored conversation.
 */
export const reconcileApprovalEvents = (
  events: AgentEvent[],
  approvals: AgentApproval[],
) => {
  if (!approvals.length) return events;
  const byId = new Map(approvals.map((approval) => [approval.id, approval]));
  let changed = false;
  const reconciled = events.map((event) => {
    if (event.type !== "approval_required") return event;
    const approvalId = typeof event.data?.id === "string" ? event.data.id : "";
    const current = byId.get(approvalId);
    if (!current || current.state === event.data?.state) return event;
    changed = true;
    return { ...event, data: { ...event.data, ...current } };
  });
  return changed ? reconciled : events;
};

/** Local UI seals/errors that must not outlive the turn they closed. */
const isLocalTurnSealEvent = (event: AgentEvent) =>
  event.id.startsWith("local-watchdog-") ||
  event.id.startsWith("local-seal-") ||
  event.id.startsWith("local-stop-done-");

/** Drop stale local stall/stop seals so "continue" starts a clean turn. */
export const stripLocalTurnSealEvents = (events: AgentEvent[]) =>
  events.filter((event) => !isLocalTurnSealEvent(event));

/** Next sequence after the highest real event (never pin to MAX_SAFE_INTEGER). */
const nextEventSequence = (events: AgentEvent[]) => {
  let max = 0;
  for (const event of events) {
    if (
      typeof event.sequence === "number" &&
      Number.isFinite(event.sequence) &&
      event.sequence > max
    ) {
      max = event.sequence;
    }
  }
  return max + 1;
};

/** Append local seal/error events with proper sequences (and replace prior local seals). */
export const appendLocalTurnEvents = (
  current: AgentEvent[],
  builders: Array<(sequence: number) => AgentEvent>,
) => {
  const base = stripLocalTurnSealEvents(current);
  let sequence = nextEventSequence(base);
  const extras = builders.map((build) => {
    const event = build(sequence);
    sequence += 1;
    return event;
  });
  return mergeAgentEvents(base, extras);
};
export const bufferAgentEvent = (
  buffer: Map<string, AgentEvent[]>,
  event: AgentEvent,
) => {
  const current = buffer.get(event.sessionId) ?? [];
  if (event.type === "file_write_delta") {
    const next = mergeAgentEvents(current, [event]).slice(-HISTORY_EVENT_LIMIT);
    buffer.delete(event.sessionId);
    buffer.set(event.sessionId, next);
    while (buffer.size > HISTORY_CACHE_SESSIONS)
      buffer.delete(buffer.keys().next().value as string);
    return;
  }
  // Fast path: append one live event without rebuilding the whole map.
  const last = current[current.length - 1];
  if (
    last &&
    event.sequence >= last.sequence &&
    !current.some((item) => item.id === event.id)
  ) {
    const next =
      current.length >= HISTORY_EVENT_LIMIT
        ? [...current.slice(-(HISTORY_EVENT_LIMIT - 1)), event]
        : [...current, event];
    buffer.set(event.sessionId, next);
  } else {
    const next = mergeAgentEvents(current, [event]).slice(-HISTORY_EVENT_LIMIT);
    buffer.delete(event.sessionId);
    buffer.set(event.sessionId, next);
  }
  while (buffer.size > HISTORY_CACHE_SESSIONS)
    buffer.delete(buffer.keys().next().value as string);
};
