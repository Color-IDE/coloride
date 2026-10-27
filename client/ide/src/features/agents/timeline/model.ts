import type {
  AgentApproval,
  AgentCheckpoint,
  AgentEvent,
  AgentPlan,
} from "@coloride/contracts";
import {
  numberValue,
  parseUserAttachments,
  parseUserPluginIds,
  recordValue,
  stringArgument,
  stringValue,
} from "./formatting";
import { capStreamedContent } from "./streamedContent";
import {
  type ActivityState,
  type ActivityTimelineEntry,
  type AgentTimelineEntry,
  type AgentUserTimelineEntry,
  type ExploreTimelineItem,
  type ToolTimelineEntry,
} from "./types";

/** Group timeline into user turns so each prompt can stick to the top while its reply scrolls. */
export function groupTimelineTurns(entries: AgentTimelineEntry[]): Array<{
  id: string;
  user: AgentUserTimelineEntry | null;
  items: AgentTimelineEntry[];
}> {
  const turns: Array<{
    id: string;
    user: AgentUserTimelineEntry | null;
    items: AgentTimelineEntry[];
  }> = [];
  let current: {
    id: string;
    user: AgentUserTimelineEntry | null;
    items: AgentTimelineEntry[];
  } | null = null;

  const pushCurrent = () => {
    if (!current) return;
    if (current.user || current.items.length) turns.push(current);
    current = null;
  };

  for (const entry of entries) {
    if (entry.kind === "user") {
      pushCurrent();
      current = { id: entry.id, user: entry, items: [] };
      continue;
    }
    if (!current) current = { id: `lead-${entry.id}`, user: null, items: [] };
    current.items.push(entry);
  }
  pushCurrent();
  return turns;
}

export function buildAgentTimeline(
  events: AgentEvent[],
  options?: { sealIncomplete?: boolean },
): AgentTimelineEntry[] {
  const result: AgentTimelineEntry[] = [];
  // History from disk/cache is almost always sequence-ordered; avoid O(n log n) copy+sort.
  let ordered = true;
  for (let i = 1; i < events.length; i += 1) {
    if (events[i]!.sequence < events[i - 1]!.sequence) {
      ordered = false;
      break;
    }
  }
  const orderedEvents = ordered
    ? events
    : [...events].sort((left, right) => left.sequence - right.sequence);
  for (const event of orderedEvents) {
    if (event.type === "user_message") {
      // Hidden / legacy implement kickoffs must NOT start a new user turn.
      if (event.data.hidden === true) {
        // Soft seal only — keep the same chat thread for plan → implement.
        finishOpenAssistants(result, event.createdAt, false);
      } else {
        finishOpenAssistants(result, event.createdAt, true);
        // A new user message ("continue", etc.) closes the prior turn's error
        // banner so stall/red cards do not stick under the next bubble.
        while (
          result.length > 0 &&
          result[result.length - 1]?.kind === "error"
        ) {
          result.pop();
        }
        result.push({
          id: event.id,
          kind: "user",
          text: stringValue(event.data.text),
          attachments: parseUserAttachments(event.data.attachments),
          pluginIds: parseUserPluginIds(
            event.data.pluginIds ?? event.data.plugin_ids,
          ),
        });
      }
    } else if (event.type === "status") {
      const text = stringValue(event.data.text);
      if (text) result.push({ id: event.id, kind: "status", text });
    } else if (event.type === "activity") {
      // Updates (including heartbeats and completion) belong to the existing
      // model step. Only a new activity may introduce a text boundary.
      const activityId = stringValue(event.data.activityId) || event.id;
      const existing = result.some(
        (entry) => entry.kind === "activity" && entry.activityId === activityId,
      );
      if (!existing && result[result.length - 1]?.kind === "assistant") {
        finishOpenAssistants(result, event.createdAt, false);
      }
      mergeActivity(result, event);
    } else if (event.type === "text" || event.type === "text_delta") {
      appendAssistantText(
        result,
        event.id,
        stringValue(event.data.text),
        event.createdAt,
        stringValue(event.data.activityId),
      );
    } else if (event.type === "text_replace") {
      const activityId = stringValue(event.data.activityId);
      if (!activityId) continue;
      const matching = result.filter(
        (entry) =>
          entry.kind === "assistant" && entry.activityId === activityId,
      );
      const first = matching[0];
      if (first?.kind === "assistant") {
        first.text = stringValue(event.data.text);
        for (const entry of matching.slice(1))
          result.splice(result.indexOf(entry), 1);
      }
    } else if (event.type === "reasoning_delta") {
      appendReasoning(result, event);
    } else if (event.type === "plan_delta") {
      finishOpenAssistants(result, event.createdAt, false);
      appendPlanText(result, event.id, stringValue(event.data.text));
    } else if (event.type === "plan_updated") {
      // Keep the same thread — plan card updates in place as steps progress.
      finishOpenAssistants(result, event.createdAt, false);
      upsertPlan(result, event);
    } else if (event.type === "done") {
      // Soft seal: plan → implement is one continuous thread, not a hard "chat ended".
      finishOpenAssistants(result, event.createdAt, true);
      // User pause (stopped) is not a failure — seal Thinking as completed.
      const userStopped = Boolean(event.data.stopped);
      const doneFailed = Boolean(event.data.failed) && !userStopped;
      // Only close the current turn (after last user bubble). Stale local dones
      // must not complete/fail a brand-new Thinking row after "continue".
      const lastUserIdx = (() => {
        for (let i = result.length - 1; i >= 0; i -= 1) {
          if (result[i]?.kind === "user") return i;
        }
        return -1;
      })();
      for (let i = Math.max(0, lastUserIdx + 1); i < result.length; i += 1) {
        const entry = result[i]!;
        if (entry.kind === "activity" && entry.state === "running") {
          entry.state = doneFailed ? "failed" : "completed";
        }
        if (entry.kind === "tool" && !entry.complete && !entry.failed) {
          entry.complete = true;
          entry.failed = doneFailed;
          entry.waitingApproval = false;
        }
        if (
          entry.kind === "approval" &&
          entry.approval.state === "pending" &&
          userStopped
        ) {
          entry.approval = { ...entry.approval, state: "cancelled" };
        }
      }
    } else if (event.type === "file_write_delta") {
      finishOpenAssistants(result, event.createdAt, false);
      const itemId = stringValue(event.data.itemId) || event.id;
      const toolName = stringValue(event.data.tool) || "write_file";
      const path = stringValue(event.data.path);
      const streamedContent = stringValue(event.data.content);
      const streamedOldText = stringValue(event.data.oldText);
      const streamedNewText = stringValue(event.data.newText);
      const streamedChars = streamedContent
        ? streamedContent.length
        : streamedOldText.length + streamedNewText.length;
      const existing = findTool(result, itemId);
      if (existing) {
        existing.tool = toolName || existing.tool;
        if (path) existing.arguments = { ...existing.arguments, path };
        existing.metadata = {
          ...existing.metadata,
          liveWrite: true,
          createdAt: existing.metadata.createdAt || event.createdAt,
          streamedCharacters:
            streamedChars || existing.metadata.streamedCharacters || 0,
          streamedContent: streamedContent
            ? capStreamedContent(streamedContent)
            : existing.metadata.streamedContent,
          streamedOldText: streamedOldText
            ? capStreamedContent(streamedOldText)
            : existing.metadata.streamedOldText,
          streamedNewText: streamedNewText
            ? capStreamedContent(streamedNewText)
            : existing.metadata.streamedNewText,
        };
      } else {
        result.push({
          id: event.id,
          kind: "tool",
          itemId,
          tool: toolName,
          title: "",
          arguments: path ? { path } : {},
          output: "",
          metadata: {
            liveWrite: true,
            createdAt: event.createdAt,
            streamedCharacters: streamedChars,
            streamedContent: streamedContent
              ? capStreamedContent(streamedContent)
              : "",
            streamedOldText: streamedOldText
              ? capStreamedContent(streamedOldText)
              : "",
            streamedNewText: streamedNewText
              ? capStreamedContent(streamedNewText)
              : "",
          },
          diff: "",
          preview: "",
          complete: false,
          failed: false,
          waitingApproval: false,
        });
      }
    } else if (event.type === "tool_call") {
      const toolName = stringValue(event.data.tool);
      // A proposed completion can still be rejected by the host. Only the
      // authoritative text event publishes its accepted summary.
      if (toolName === "complete_task") continue;
      finishOpenAssistants(result, event.createdAt, false);
      const itemId = stringValue(event.data.itemId);
      const incomingArgs = recordValue(event.data.arguments);
      const incomingPath = stringArgument(incomingArgs.path);
      let existing = findTool(result, itemId);
      if (
        !existing &&
        (toolName === "write_file" || toolName === "replace_in_file") &&
        incomingPath
      ) {
        for (let i = result.length - 1; i >= 0; i -= 1) {
          const candidate = result[i];
          if (candidate?.kind === "user") break;
          if (
            candidate?.kind === "tool" &&
            !candidate.complete &&
            candidate.metadata.liveWrite === true &&
            candidate.tool === toolName &&
            stringArgument(candidate.arguments.path) === incomingPath
          ) {
            existing = candidate;
            if (itemId) existing.itemId = itemId;
            break;
          }
        }
      }
      if (existing) {
        // Merge the finalized call into the provisional live-write row instead
        // of showing the same edit twice.
        existing.tool = toolName || existing.tool;
        existing.title = stringValue(event.data.title) || existing.title;
        existing.arguments = {
          ...existing.arguments,
          ...incomingArgs,
        };
        const callContent = stringArgument(existing.arguments.content);
        const callOldText = stringArgument(existing.arguments.old_text);
        const callNewText = stringArgument(existing.arguments.new_text);
        existing.metadata = {
          ...existing.metadata,
          createdAt: existing.metadata.createdAt || event.createdAt,
          ...(callContent
            ? {
                streamedContent: capStreamedContent(callContent),
                streamedCharacters: callContent.length,
              }
            : {}),
          ...(callOldText
            ? { streamedOldText: capStreamedContent(callOldText) }
            : {}),
          ...(callNewText
            ? {
                streamedNewText: capStreamedContent(callNewText),
                streamedCharacters: callOldText.length + callNewText.length,
              }
            : {}),
        };
        existing.complete = false;
        existing.failed = false;
        existing.waitingApproval = false;
      } else {
        const callContent = stringArgument(incomingArgs.content);
        const callOldText = stringArgument(incomingArgs.old_text);
        const callNewText = stringArgument(incomingArgs.new_text);
        result.push({
          id: event.id,
          kind: "tool",
          itemId,
          tool: toolName,
          title: stringValue(event.data.title),
          arguments: incomingArgs,
          output: "",
          metadata: {
            createdAt: event.createdAt,
            ...(callContent
              ? {
                  streamedContent: capStreamedContent(callContent),
                  streamedCharacters: callContent.length,
                }
              : {}),
            ...(callOldText
              ? { streamedOldText: capStreamedContent(callOldText) }
              : {}),
            ...(callNewText
              ? {
                  streamedNewText: capStreamedContent(callNewText),
                  streamedCharacters: callOldText.length + callNewText.length,
                }
              : {}),
          },
          diff: "",
          preview: "",
          complete: false,
          failed: false,
          waitingApproval: false,
        });
      }
    } else if (event.type === "tool_output") {
      if (stringValue(event.data.tool) === "complete_task") continue;
      const tool = findTool(result, stringValue(event.data.itemId));
      if (tool) {
        tool.output += stringValue(event.data.text);
        tool.metadata = {
          ...tool.metadata,
          ...recordValue(event.data.metadata),
          ...(event.data.recoverable === true
            ? { internalRecoverableFailure: true }
            : {}),
        };
        tool.failed = tool.failed || Boolean(event.data.failed);
      }
    } else if (event.type === "tool_result") {
      if (stringValue(event.data.tool) === "complete_task") continue;
      const tool = findTool(result, stringValue(event.data.itemId));
      if (tool) {
        tool.complete = true;
        tool.failed = Boolean(event.data.failed);
        if (event.data.recoverable === true) {
          tool.metadata = {
            ...tool.metadata,
            internalRecoverableFailure: true,
          };
        }
        tool.waitingApproval = false;
      }
    } else if (event.type === "diff_preview" || event.type === "diff") {
      const patch = stringValue(event.data.patch);
      const tool = findTool(result, stringValue(event.data.itemId));
      if (tool) {
        if (event.type === "diff") tool.diff = patch;
        else tool.preview = patch;
      } else if (event.type === "diff") {
        result.push({ id: event.id, kind: "diff", patch });
      }
    } else if (event.type === "approval_required") {
      const approval = event.data as unknown as AgentApproval;
      const tool = findTool(result, stringValue(approval.details?.itemId));
      // Restored approval records may already be expired/resolved. Do not put
      // their command row back into a waiting state just because the original
      // request event is part of the durable timeline.
      if (tool) tool.waitingApproval = approval.state === "pending";
      result.push({ id: event.id, kind: "approval", approval });
    } else if (event.type === "checkpoint_created") {
      const checkpoint = event.data as unknown as AgentCheckpoint;
      if (checkpoint.id)
        result.push({ id: event.id, kind: "checkpoint", checkpoint });
    } else if (event.type === "checkpoint_restored") {
      // Silent — Undo / Reject already applied the files; no chat noise.
    } else if (event.type === "context_compacted") {
      // Rendered as a Thought-style activity row (kind: context) from paired activity events.
    } else if (event.type === "context_snapshot") {
      // Composer context meter only — no timeline row.
    } else if (event.type === "tool_progress") {
      // Heartbeat while a long tool runs — no timeline row; keeps the stall watchdog awake.
    } else if (event.type === "approval_resolved") {
      const approvalId = stringValue(event.data.approvalId);
      const approval = result.find(
        (entry): entry is Extract<AgentTimelineEntry, { kind: "approval" }> =>
          entry.kind === "approval" && entry.approval.id === approvalId,
      );
      if (approval) {
        const decision = stringValue(event.data.decision);
        const nextState = decision.startsWith("approve")
          ? "approved"
          : decision === "cancel" || decision === "cancelled"
            ? "cancelled"
            : decision === "expired"
              ? "expired"
              : "declined";
        approval.approval = {
          ...approval.approval,
          state: nextState,
        };
        const tool = findTool(
          result,
          stringValue(approval.approval.details.itemId),
        );
        if (tool) tool.waitingApproval = false;
      }
    } else if (event.type === "mode_changed") {
      // Mode changes are shown via the composer badge; skip chat status lines.
    } else if (event.type === "reasoning_changed") {
      // Reasoning effort is shown via the composer menu; skip chat status lines.
    } else if (event.type === "cloud_session_refreshing") {
      // Internal JWT refresh during a long turn — not a chat row.
    } else if (event.type === "workspace_changed") {
      // Shown via the change_workspace tool row; skip a separate status line.
    } else if (event.type === "error") {
      finishOpenAssistants(result, event.createdAt, true);
      const userStopped =
        Boolean(event.data.stopped) ||
        /^stopped\.?$/i.test(stringValue(event.data.message).trim());
      // Only seal the open activity/tool AFTER the latest user bubble — never
      // re-fail an earlier turn if a stale local error is still in the stream.
      const lastUserIdx = (() => {
        for (let i = result.length - 1; i >= 0; i -= 1) {
          if (result[i]?.kind === "user") return i;
        }
        return -1;
      })();
      // Never leave a shimmering "Thinking" row after a provider/turn failure.
      // User stop seals cleanly (Thought) — not "Thought failed" + "Stopped." spam.
      for (let i = Math.max(0, lastUserIdx + 1); i < result.length; i += 1) {
        const entry = result[i]!;
        if (entry.kind === "activity" && entry.state === "running") {
          entry.state = userStopped ? "completed" : "failed";
        }
        if (entry.kind === "tool" && !entry.complete) {
          entry.complete = true;
          entry.failed = !userStopped;
          entry.waitingApproval = false;
        }
        if (
          entry.kind === "approval" &&
          entry.approval.state === "pending" &&
          userStopped
        ) {
          entry.approval = { ...entry.approval, state: "cancelled" };
        }
      }
      if (userStopped) {
        // Quiet pause — no error card.
        continue;
      }
      const message = stringValue(event.data.message);
      // Prefer painting the failed tool red over a separate error card when the
      // message already belongs to the last tool failure (avoids cutting the chat).
      const lastTool = [...result]
        .reverse()
        .find((entry): entry is ToolTimelineEntry => entry.kind === "tool");
      if (lastTool && (lastTool.failed || !lastTool.complete) && message) {
        lastTool.failed = true;
        lastTool.complete = true;
        lastTool.waitingApproval = false;
        if (!lastTool.output.trim()) {
          lastTool.output = message.startsWith("Error:")
            ? message
            : `Error: ${message}`;
        }
      } else if (message) {
        // Deduplicate consecutive identical error lines (double stop / race).
        const prev = result[result.length - 1];
        if (!(prev?.kind === "error" && prev.text === message)) {
          result.push({ id: event.id, kind: "error", text: message });
        }
      }
    }
  }
  // After reload / idle session there may be no trailing "done". Seal open
  // rows so thoughts and tools don't look stuck mid-stream. Never seal while
  // a turn is live — that would freeze streaming text and running tools.
  if (options?.sealIncomplete) sealTimelineAfterRebuild(result);
  // Always normalize which assistant bubble owns like/copy (one per turn).
  applyAssistantFinality(result, Boolean(options?.sealIncomplete));
  return collapseExploreGroups(result);
}

export function sealTimelineAfterRebuild(result: AgentTimelineEntry[]) {
  finishOpenAssistants(result, undefined, true);
  for (const entry of result) {
    if (entry.kind === "activity" && entry.state === "running") {
      // Bare "Thought" with no duration is noise — drop empty sealed rows later in UI.
      entry.state = "completed";
      if (entry.durationMs == null) entry.durationMs = 0;
    }
    if (entry.kind === "tool" && !entry.complete && !entry.failed) {
      // Incomplete tool rows from truncated history still show as finished.
      entry.complete = true;
      entry.waitingApproval = false;
    }
  }
}

/**
 * Like/copy footer only on the last assistant bubble of each completed turn.
 * Intermediate text (before tools) must not look like a "cut off" final answer.
 */
export function applyAssistantFinality(
  result: AgentTimelineEntry[],
  currentTurnSealed: boolean,
) {
  for (const entry of result) {
    if (entry.kind === "assistant") {
      entry.final = false;
      if (entry.streaming && currentTurnSealed) {
        entry.streaming = false;
      }
    }
  }
  let lastAssistant: Extract<AgentTimelineEntry, { kind: "assistant" }> | null =
    null;
  const sealTurn = (allow: boolean) => {
    if (allow && lastAssistant && lastAssistant.text.trim()) {
      lastAssistant.final = true;
      lastAssistant.streaming = false;
    }
    lastAssistant = null;
  };
  for (const entry of result) {
    if (entry.kind === "user") {
      // Previous turn is always complete once the next user message exists.
      sealTurn(true);
      continue;
    }
    if (entry.kind === "assistant") {
      lastAssistant = entry;
    }
  }
  // Open turn at the end of the timeline: only final when idle/sealed.
  sealTurn(currentTurnSealed);
}

export function mergeActivity(result: AgentTimelineEntry[], event: AgentEvent) {
  const activityId = stringValue(event.data.activityId) || event.id;
  const existing = [...result]
    .reverse()
    .find(
      (entry): entry is Extract<AgentTimelineEntry, { kind: "activity" }> =>
        entry.kind === "activity" && entry.activityId === activityId,
    );
  const stateValue = stringValue(event.data.state);
  const state: ActivityState =
    stateValue === "completed" || stateValue === "failed"
      ? stateValue
      : "running";
  const rawKind = stringValue(event.data.kind).toLowerCase();
  const activityKind: ActivityTimelineEntry["activityKind"] =
    rawKind === "context" ? "context" : "thinking";
  if (existing) {
    existing.label = stringValue(event.data.label) || existing.label;
    // Completed events may send empty detail — never wipe streamed reasoning.
    const nextDetail = stringValue(event.data.detail);
    if (nextDetail) existing.detail = nextDetail;
    if (!(event.data.heartbeat === true && existing.state !== "running"))
      existing.state = state;
    existing.activityKind = activityKind || existing.activityKind;
    if (!existing.startedAt && event.createdAt)
      existing.startedAt = event.createdAt;
    const durationMs = numberValue(event.data.durationMs);
    if (durationMs !== null) existing.durationMs = durationMs;
    return;
  }
  result.push({
    id: event.id,
    kind: "activity",
    activityId,
    activityKind,
    label:
      stringValue(event.data.label) ||
      (activityKind === "context" ? "Compacting context" : "Thinking"),
    detail: stringValue(event.data.detail),
    state,
    durationMs: numberValue(event.data.durationMs),
    startedAt: event.createdAt || null,
  });
}

export function appendAssistantText(
  result: AgentTimelineEntry[],
  id: string,
  text: string,
  createdAt: string,
  activityId?: string,
) {
  if (!text) return;
  const previous = result[result.length - 1];
  if (
    previous?.kind === "assistant" &&
    previous.streaming &&
    previous.activityId === activityId
  ) {
    previous.text += text;
    previous.finishedAt = createdAt || previous.finishedAt;
    previous.streaming = true;
    return;
  }
  // New bubble after tools/status — previous open assistants are already sealed.
  result.push({
    id,
    kind: "assistant",
    activityId,
    text,
    finishedAt: createdAt || null,
    streaming: true,
    final: false,
  });
}

export function finishOpenAssistants(
  result: AgentTimelineEntry[],
  createdAt: string | undefined,
  final: boolean,
) {
  const stamp = createdAt || new Date().toISOString();
  let lastAssistant: Extract<AgentTimelineEntry, { kind: "assistant" }> | null =
    null;
  for (const entry of result) {
    if (entry.kind !== "assistant") continue;
    lastAssistant = entry;
    if (!entry.streaming) continue;
    entry.streaming = false;
    entry.finishedAt = createdAt || entry.finishedAt || stamp;
    // Intermediate seals (tools/thinking) are not the end of the full response.
    if (!final) entry.final = false;
  }
  // Footer only on the last assistant bubble of a completed turn.
  if (final && lastAssistant) {
    lastAssistant.streaming = false;
    lastAssistant.finishedAt = createdAt || lastAssistant.finishedAt || stamp;
    lastAssistant.final = true;
  }
}

export function appendPlanText(
  result: AgentTimelineEntry[],
  id: string,
  text: string,
) {
  const previous = result[result.length - 1];
  if (previous?.kind === "plan" && !previous.plan)
    previous.text = `${previous.text || ""}${text}`;
  else if (text) result.push({ id, kind: "plan", text });
}

export function upsertPlan(result: AgentTimelineEntry[], event: AgentEvent) {
  const raw = event.data.plan;
  if (!raw || typeof raw !== "object") return;
  const plan = raw as AgentPlan;
  if (!plan.id || !Array.isArray(plan.steps)) return;
  // One live plan card per plan id — update data in place, keep original position.
  const existing = [...result]
    .reverse()
    .find(
      (entry): entry is Extract<AgentTimelineEntry, { kind: "plan" }> =>
        entry.kind === "plan" && entry.plan?.id === plan.id,
    );
  if (existing) {
    existing.plan = plan;
    return;
  }
  result.push({ id: event.id, kind: "plan", plan });
}

export function compactThoughtText(text: string) {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function appendReasoning(
  result: AgentTimelineEntry[],
  event: AgentEvent,
) {
  const activityId = stringValue(event.data.activityId);
  let activity = [...result]
    .reverse()
    .find(
      (entry): entry is Extract<AgentTimelineEntry, { kind: "activity" }> =>
        entry.kind === "activity" && entry.activityId === activityId,
    );
  const text = stringValue(event.data.text);
  if (!text) return;
  // If reasoning arrives before/without a running activity row, create one live.
  if (!activity) {
    activity = {
      id: event.id,
      kind: "activity",
      activityId: activityId || event.id,
      activityKind: "thinking",
      label: "Thinking",
      detail: text,
      state: "running",
      durationMs: null,
      startedAt: event.createdAt || null,
    };
    result.push(activity);
    return;
  }
  activity.detail += text;
  // Never reopen a completed activity if a delayed reasoning delta arrives.
  // Event transport and React state updates can interleave during long turns.
}

export function findTool(result: AgentTimelineEntry[], itemId: string) {
  return [...result]
    .reverse()
    .find(
      (entry): entry is ToolTimelineEntry =>
        entry.kind === "tool" && entry.itemId === itemId,
    );
}

export const EXPLORE_TOOLS = new Set([
  "read_file",
  "search_files",
  "list_files",
  "read_tool_output",
]);

export const SESSION_RECOVERY_TOOLS = new Set(["search_chat_history"]);

export function isSessionRecoveryTool(
  entry: AgentTimelineEntry,
): entry is ToolTimelineEntry {
  return entry.kind === "tool" && SESSION_RECOVERY_TOOLS.has(entry.tool);
}

export function isExploreEntry(
  entry: AgentTimelineEntry,
): entry is ExploreTimelineItem {
  // Context compaction stays a top-level Thought-style row, not inside explore groups.
  if (entry.kind === "activity") return entry.activityKind !== "context";
  if (entry.kind === "tool" && SESSION_RECOVERY_TOOLS.has(entry.tool))
    return false;
  return entry.kind === "tool" && EXPLORE_TOOLS.has(entry.tool);
}

export function isExploreItemRunning(entry: ExploreTimelineItem) {
  if (entry.kind === "activity") return entry.state === "running";
  return !entry.complete && !entry.failed;
}

export function countExploreTools(items: ExploreTimelineItem[]) {
  return items.filter(
    (item) => item.kind === "tool" && EXPLORE_TOOLS.has(item.tool),
  ).length;
}

export function collapseExploreGroups(
  entries: AgentTimelineEntry[],
): AgentTimelineEntry[] {
  const collapsed = collapseSessionRecoveryGroups(entries);
  const result: AgentTimelineEntry[] = [];
  let buffer: ExploreTimelineItem[] = [];

  const flush = () => {
    if (!buffer.length) return;
    if (countExploreTools(buffer) >= 2) {
      result.push({
        id: `explore-${buffer[0]!.id}`,
        kind: "explore_group",
        items: buffer,
      });
    } else {
      result.push(...buffer);
    }
    buffer = [];
  };

  for (const entry of collapsed) {
    if (isExploreEntry(entry)) {
      buffer.push(entry);
      continue;
    }
    flush();
    result.push(entry);
  }
  flush();
  return result;
}

export function collapseSessionRecoveryGroups(
  entries: AgentTimelineEntry[],
): AgentTimelineEntry[] {
  const result: AgentTimelineEntry[] = [];
  let buffer: ExploreTimelineItem[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const searches = buffer.filter(
      (item) => item.kind === "tool" && item.tool === "search_chat_history",
    );
    if (
      searches.length >= 2 ||
      (searches.length >= 1 && buffer.length > searches.length)
    ) {
      result.push({
        id: `session-recovery-${buffer[0]!.id}`,
        kind: "explore_group",
        items: buffer,
      });
    } else {
      result.push(...buffer);
    }
    buffer = [];
  };

  for (const entry of entries) {
    if (entry.kind === "activity" && entry.activityKind !== "context") {
      buffer.push(entry);
      continue;
    }
    if (isSessionRecoveryTool(entry)) {
      buffer.push(entry);
      continue;
    }
    flush();
    result.push(entry);
  }
  flush();
  return result;
}
