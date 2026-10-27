import type { AgentActivityDetail } from "../settings/preferences";
import type {
  AgentAssistantTimelineEntry,
  AgentTimelineEntry,
  ExploreTimelineItem,
} from "./AgentTimeline";

const WRITE_TOOLS = new Set([
  "write_file",
  "replace_in_file",
  "create_directory",
  "rename_path",
  "move_path",
  "delete_path",
]);

const COMMAND_TOOLS = new Set([
  "execute_command",
  "start_process",
  "stop_process",
  "switch_user",
  "change_workspace",
]);

const EXPLORE_TOOLS = new Set([
  "read_file",
  "read_tool_output",
  "search_files",
  "list_files",
  "git_status",
  "git_diff",
  "get_diagnostics",
  "fetch_url",
]);

const RETRIEVAL_TOOLS = new Set(["search_chat_history"]);

type PhaseKind = "recovery" | "explore" | "edit" | "working";
type NormalPhaseItem = ExploreTimelineItem | AgentAssistantTimelineEntry;

export function presentTurnItems(
  items: AgentTimelineEntry[],
  detail: AgentActivityDetail = "normal",
  turnActive = false,
): AgentTimelineEntry[] {
  const flat = flattenTimelineItems(items);
  if (detail === "verbose") return flat;
  if (detail === "minimal") return presentMinimal(flat, turnActive);
  return presentNormal(flat, turnActive);
}

export function flattenTimelineItems(items: AgentTimelineEntry[]): AgentTimelineEntry[] {
  const result: AgentTimelineEntry[] = [];
  for (const entry of items) {
    if (entry.kind === "explore_group") {
      result.push(...entry.items);
      continue;
    }
    result.push(entry);
  }
  return result;
}

function presentNormal(
  items: AgentTimelineEntry[],
  turnActive: boolean,
): AgentTimelineEntry[] {
  const result: AgentTimelineEntry[] = [];
  let buffer: NormalPhaseItem[] = [];
  let suppressStandaloneThoughts = false;

  const flush = () => {
    if (!buffer.length) return;
    const phaseItems = buffer.filter(
      (entry): entry is ExploreTimelineItem => entry.kind !== "assistant",
    );
    const tools = phaseItems.filter((entry) => entry.kind === "tool");
    const thoughts = phaseItems.filter((entry) => entry.kind === "activity");
    const narrations = buffer.filter(
      (entry): entry is AgentAssistantTimelineEntry => entry.kind === "assistant",
    );
    const runningThought = turnActive ? lastRunningActivity(phaseItems) : undefined;

    // A thought must not vanish when its activity changes from running to
    // completed. Keep the latest row for phases that did not invoke a tool;
    // this preserves the visible lifecycle without filling the transcript
    // with provider retry/iteration noise.
    if (!tools.length) {
      const latestCompletedThought = [...thoughts]
        .reverse()
        .find((entry) => entry.state !== "running");
      const latestThought = suppressStandaloneThoughts
        ? undefined
        : runningThought ?? latestCompletedThought;
      if (latestThought) result.push(latestThought);
      result.push(...narrations);
      buffer = [];
      suppressStandaloneThoughts = false;
      return;
    }

    const phase = inferPhase(tools);
    // File edits stay as their own cards. Exploring keeps Thinking nested
    // inside the phase so it does not sit as a separate row above.
    if (phase === "edit") {
      result.push(...thoughts);
      result.push(...tools);
    } else if (phase === "explore") {
      if (thoughts.length > 0) {
        result.push(phaseFromBuffer(phaseItems, phase));
      } else if (tools.length === 1) {
        result.push(tools[0]!);
      } else {
        result.push(phaseFromBuffer(tools, phase));
      }
    } else {
      result.push(...thoughts);
      result.push(phaseFromBuffer(tools, phase));
    }
    // Narration is associated with this phase for grouping purposes, but it
    // remains normal chat text outside the expandable exploration trace.
    result.push(...narrations);
    buffer = [];
    suppressStandaloneThoughts = false;
  };

  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index]!;
    // Malformed model arguments are returned to the model so it can repair
    // them, but they are implementation noise for users. Keep them in the
    // durable timeline and Verbose view; hide them from the normal transcript.
    if (isInternalRecoverableFailure(entry)) {
      continue;
    }
    // Context maintenance and history recovery are implementation details.
    // They remain in the stored timeline and are available in Verbose, but
    // never flash in and out of the normal conversation.
    if (isContextActivity(entry)) {
      continue;
    }
    if (isRetrievalTool(entry)) {
      // Hiding internal history lookup must not discard earlier visible work
      // or narration accumulated in the current phase.
      if (buffer.some((item) => item.kind === "tool" || item.kind === "assistant")) {
        flush();
      }
      // The surrounding thought belongs to private session-memory recovery.
      // Keep both the retrieval call and its status out of the normal chat.
      buffer = [];
      suppressStandaloneThoughts = true;
      continue;
    }
    // Assistant messages bound phases so later tools never move above them.
    if (entry.kind === "tool") suppressStandaloneThoughts = false;
    if (classifyPhase(entry) === "surface" || (entry.kind !== "activity" && entry.kind !== "tool")) {
      flush();
      result.push(entry);
      continue;
    }
    if (buffer.length) {
      const current = inferPhase(
        buffer.filter(
          (item): item is ExploreTimelineItem => item.kind !== "assistant",
        ),
      );
      const nextKind = classifyPhase(entry);
      if (
        nextKind !== "surface"
        && nextKind !== "working"
        && current !== "working"
        && current !== nextKind
      ) {
        flush();
      }
    }
    buffer.push(entry);
  }
  flush();
  return result;
}

function presentMinimal(
  items: AgentTimelineEntry[],
  turnActive: boolean,
): AgentTimelineEntry[] {
  const result: AgentTimelineEntry[] = [];
  const writes: ExploreTimelineItem[] = [];
  let runningThought: Extract<AgentTimelineEntry, { kind: "activity" }> | null = null;

  for (const entry of items) {
    if (isInternalRecoverableFailure(entry)) {
      continue;
    }
    if (isContextActivity(entry) || isRetrievalTool(entry)) {
      continue;
    }
    if (entry.kind === "assistant" || entry.kind === "plan" || entry.kind === "error" || entry.kind === "user") {
      result.push(entry);
      continue;
    }
    if (entry.kind === "approval") {
      result.push(entry);
      continue;
    }
    if (entry.kind === "tool") {
      if (entry.waitingApproval || entry.failed || COMMAND_TOOLS.has(entry.tool)) {
        result.push(entry);
        continue;
      }
      if (WRITE_TOOLS.has(entry.tool)) {
        writes.push(entry);
        continue;
      }
      continue;
    }
    if (entry.kind === "activity" && turnActive && entry.state === "running") {
      runningThought = entry;
    }
  }

  if (writes.length) {
    result.unshift({
      id: `files-changed-${writes[0]!.id}`,
      kind: "explore_group",
      items: writes,
    });
  }
  if (runningThought) result.unshift(runningThought);
  return result;
}

function classifyPhase(entry: AgentTimelineEntry): PhaseKind | "surface" {
  if (entry.kind === "activity") {
    return entry.activityKind === "context" ? "surface" : "working";
  }
  if (entry.kind !== "tool") return "surface";
  if (entry.waitingApproval || entry.failed) return "surface";
  if (WRITE_TOOLS.has(entry.tool)) return "edit";
  if (COMMAND_TOOLS.has(entry.tool)) return "surface";
  if (entry.tool.startsWith("mcp__") || entry.tool.startsWith("browser_")) return "surface";
  if (RETRIEVAL_TOOLS.has(entry.tool)) return "recovery";
  if (EXPLORE_TOOLS.has(entry.tool)) return "explore";
  return "surface";
}

function isContextActivity(entry: AgentTimelineEntry): boolean {
  return entry.kind === "activity" && entry.activityKind === "context";
}

function isRetrievalTool(entry: AgentTimelineEntry): boolean {
  return entry.kind === "tool" && RETRIEVAL_TOOLS.has(entry.tool);
}

function isInternalRecoverableFailure(entry: AgentTimelineEntry): boolean {
  return (
    entry.kind === "tool"
    && entry.failed
    && entry.metadata.internalRecoverableFailure === true
  );
}

function lastRunningActivity(
  items: ExploreTimelineItem[],
): Extract<ExploreTimelineItem, { kind: "activity" }> | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "activity" && item.state === "running") return item;
  }
  return undefined;
}

function phaseFromBuffer(
  items: ExploreTimelineItem[],
  phase: PhaseKind | null,
): AgentTimelineEntry {
  // A lone thought has no children to summarise. Wrapping it in a generic
  // "Reviewed session context" group rendered the same activity twice: once
  // as the group label and again as its only row.
  if (items.length === 1 && items[0]?.kind === "activity") {
    return items[0];
  }
  const resolved = phase ?? inferPhase(items);
  if (resolved === "explore") {
    const exploreTools = items.filter((item) => item.kind === "tool" && EXPLORE_TOOLS.has(item.tool));
    const thoughts = items.filter((item) => item.kind === "activity");
    if (exploreTools.length === 1 && thoughts.length === 0) {
      return exploreTools[0]!;
    }
  }
  return {
    id: `${resolved}-${items[0]!.id}`,
    kind: "explore_group",
    items,
  };
}

function inferPhase(items: ExploreTimelineItem[]): PhaseKind {
  if (items.some((item) => item.kind === "tool" && RETRIEVAL_TOOLS.has(item.tool))) {
    return "recovery";
  }
  if (items.some((item) => item.kind === "tool" && EXPLORE_TOOLS.has(item.tool))) {
    return "explore";
  }
  if (items.some((item) => item.kind === "tool" && WRITE_TOOLS.has(item.tool))) {
    return "edit";
  }
  return "working";
}

export function phaseGroupMeta(items: ExploreTimelineItem[], running: boolean) {
  const filePaths = new Set<string>();
  let searches = 0;
  let lists = 0;
  let outputs = 0;
  let historySearches = 0;
  let scanned = 0;
  let topics = 0;
  let writes = 0;
  let durationMs = 0;
  for (const item of items) {
    if (item.kind === "activity") {
      durationMs += item.durationMs ?? 0;
      continue;
    }
    if (item.kind !== "tool") continue;
    if (item.tool === "read_file") {
      const path = item.arguments.path;
      filePaths.add(typeof path === "string" && path.trim() ? path.trim() : item.id);
    }
    else if (item.tool === "search_files") searches += 1;
    else if (item.tool === "list_files") lists += 1;
    else if (item.tool === "read_tool_output") outputs += 1;
    else if (item.tool === "search_chat_history") {
      historySearches += 1;
      scanned = Math.max(scanned, numberish(item.metadata.scanned));
      topics += topicCountFromTool(item);
    } else if (WRITE_TOOLS.has(item.tool)) {
      writes += 1;
    }
  }
  const files = filePaths.size;

  if (writes > 0 && historySearches === 0 && files === 0 && searches === 0 && lists === 0) {
    return {
      kind: "files" as const,
      verb: running ? "Changing files" : `${writes} file${writes === 1 ? "" : "s"} changed`,
      detail: "",
      durationMs,
      hideThoughts: true,
    };
  }

  if (historySearches > 0 && files === 0 && searches === 0 && lists === 0) {
    const parts: string[] = [];
    const reviewed = topics || historySearches;
    if (reviewed > 0) {
      parts.push(`${reviewed} topic${reviewed === 1 ? "" : "s"} reviewed`);
    }
    if (scanned > 0) parts.push(`${scanned} events`);
    return {
      kind: "recovery" as const,
      verb: running ? "Recovering session context" : "Session context recovered",
      detail: parts.join(" · "),
      durationMs,
      hideThoughts: true,
    };
  }

  if (files + searches + lists + outputs > 0) {
    const parts: string[] = [];
    if (files > 0) parts.push(`${files} file${files === 1 ? "" : "s"}`);
    if (searches > 0) parts.push(`${searches} search${searches === 1 ? "" : "es"}`);
    if (lists > 0) parts.push(`${lists} list${lists === 1 ? "" : "s"}`);
    if (outputs > 0) parts.push(`${outputs} tool output${outputs === 1 ? "" : "s"}`);
    return {
      kind: "explore" as const,
      verb: running ? "Exploring" : "Explored",
      detail: parts.join(", "),
      durationMs,
      hideThoughts: false,
    };
  }

  return {
    kind: "working" as const,
    verb: running ? "Working" : "Reviewed session context",
    detail: "",
    durationMs,
    hideThoughts: false,
  };
}

export function historySearchQuery(entry: { arguments: Record<string, unknown> }): string {
  const queries = entry.arguments.queries;
  if (Array.isArray(queries)) {
    const first = queries.find((item) => typeof item === "string" && item.trim());
    if (typeof first === "string") return first.trim();
  }
  const query = entry.arguments.query;
  return typeof query === "string" ? query.trim() : "";
}

function numberish(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function topicCountFromTool(item: Extract<ExploreTimelineItem, { kind: "tool" }>): number {
  const explicit = numberish(item.metadata.topicCount);
  if (explicit > 0) return explicit;
  const topics = item.metadata.topics;
  if (Array.isArray(topics) && topics.length > 0) return topics.length;
  const queries = item.arguments.queries;
  if (Array.isArray(queries)) {
    const count = queries.filter((entry) => typeof entry === "string" && entry.trim()).length;
    if (count > 0) return count;
  }
  const query = item.arguments.query;
  return typeof query === "string" && query.trim() ? 1 : 1;
}
