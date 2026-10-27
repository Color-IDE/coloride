import type { AgentCheckpoint, AgentEvent } from "@coloride/contracts";
import {
  useMemo,
  useRef
} from "react";
import {
  buildAgentTimeline,
  groupTimelineTurns
} from "./AgentTimeline";
import {
  eventsFingerprint,
  findLiveTurnStartIndex,
  HISTORY_CACHE_SESSIONS,
  withoutProviderFailureTurns
} from "./agentEvents";

interface Dependencies {
  events: AgentEvent[];
  turnActive: boolean;
  selectedSessionId: string | null;
}

export function useAgentTimelineModel({ events, turnActive, selectedSessionId }: Dependencies) {

  type TimelineTurns = ReturnType<typeof groupTimelineTurns>;
  type TimelineEntries = ReturnType<typeof buildAgentTimeline>;
  // A provider-failure event identifies its own failed turn. Do not also hide
  // based on the session summary: that summary can lag after the user retries
  // and would incorrectly remove later, successful work from the timeline.
  const visibleTimelineEvents = useMemo(
    () => withoutProviderFailureTurns(events),
    [events],
  );
  // Cache sealed history (before current user turn) so live deltas only rebuild the tail.
  const historyTimelineCacheRef = useRef<
    Map<
      string,
      { key: string; timeline: TimelineEntries; turns: TimelineTurns }
    >
  >(new Map());
  const liveTimelineCacheRef = useRef<
    Map<
      string,
      {
        fingerprint: string;
        seal: boolean;
        timeline: TimelineEntries;
        turns: TimelineTurns;
      }
    >
  >(new Map());

  // History (sealed turns) and live turn are built/cached separately so a long chat
  // after context compact does not regroup thousands of entries on every delta.
  const { timeline, timelineTurns } = useMemo(() => {
    const seal = !turnActive;
    const sessionKey = selectedSessionId ?? "__none__";
    const turnStart = findLiveTurnStartIndex(visibleTimelineEvents);
    const historyEvents =
      turnStart > 0 ? visibleTimelineEvents.slice(0, turnStart) : [];
    const liveEvents = visibleTimelineEvents.slice(turnStart);
    const historyKey =
      historyEvents.length === 0
        ? `${sessionKey}:empty`
        : `${sessionKey}:${historyEvents.length}:${historyEvents[0]!.id}:${historyEvents[historyEvents.length - 1]!.id}`;

    let histCached = historyTimelineCacheRef.current.get(sessionKey);
    if (!histCached || histCached.key !== historyKey) {
      const historyTimeline = historyEvents.length
        ? buildAgentTimeline(historyEvents, { sealIncomplete: true })
        : [];
      histCached = {
        key: historyKey,
        timeline: historyTimeline,
        turns: groupTimelineTurns(historyTimeline),
      };
      historyTimelineCacheRef.current.set(sessionKey, histCached);
      while (historyTimelineCacheRef.current.size > HISTORY_CACHE_SESSIONS) {
        historyTimelineCacheRef.current.delete(
          historyTimelineCacheRef.current.keys().next().value as string,
        );
      }
    }

    const liveFingerprint = eventsFingerprint(liveEvents);
    let liveCached = liveTimelineCacheRef.current.get(sessionKey);
    if (
      !liveCached ||
      liveCached.fingerprint !== liveFingerprint ||
      liveCached.seal !== seal
    ) {
      const liveTimeline = buildAgentTimeline(liveEvents, {
        sealIncomplete: seal,
      });
      liveCached = {
        fingerprint: liveFingerprint,
        seal,
        timeline: liveTimeline,
        turns: groupTimelineTurns(liveTimeline),
      };
      liveTimelineCacheRef.current.set(sessionKey, liveCached);
      while (liveTimelineCacheRef.current.size > HISTORY_CACHE_SESSIONS) {
        liveTimelineCacheRef.current.delete(
          liveTimelineCacheRef.current.keys().next().value as string,
        );
      }
    }

    const hist = histCached.timeline;
    const live = liveCached.timeline;
    const mergedTimeline = hist.length ? [...hist, ...live] : live;
    // Stable history turn objects + fresh live turns only — React.memo skips history rows.
    const mergedTurns = histCached.turns.length
      ? [...histCached.turns, ...liveCached.turns]
      : liveCached.turns;
    return { timeline: mergedTimeline, timelineTurns: mergedTurns };
  }, [selectedSessionId, turnActive, visibleTimelineEvents]);
  const pendingApproval = useMemo(() => {
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const entry = timeline[index];
      if (entry?.kind === "approval" && entry.approval.state === "pending") {
        return entry.approval;
      }
    }
    return null;
  }, [timeline]);

  // Checkpoints from the latest turn (after last user message), for the composer dock.
  // Includes in-flight edits so Keep all works mid-discussion, not only when idle.
  const turnCheckpoints = useMemo(() => {
    const collected: AgentCheckpoint[] = [];
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const entry = timeline[index];
      if (!entry) continue;
      if (entry.kind === "user") break;
      if (entry.kind === "checkpoint") collected.push(entry.checkpoint);
    }
    return collected.reverse();
  }, [timeline]);
  return { visibleTimelineEvents, timeline, timelineTurns, pendingApproval, turnCheckpoints };
}
