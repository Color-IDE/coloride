import type { AgentEvent } from "@coloride/contracts";

// Keep browser diagnostics useful without copying a user's prompt, file
// contents, command arguments, or streamed model output into DevTools.
// This is intentionally limited to Vite development builds.
const AGENT_CONSOLE_EVENT_TYPES = new Set<AgentEvent["type"]>([
  "activity",
  "tool_call",
  "tool_output",
  "tool_result",
  "guard_paused",
  "guard_resolved",
  "cloud_session_refreshing",
  "error",
  "done",
  "usage",
  "workspace_changed",
]);

export function logAgentConsoleEvent(event: AgentEvent) {
  if (!import.meta.env.DEV || !AGENT_CONSOLE_EVENT_TYPES.has(event.type))
    return;
  const data = event.data ?? {};
  // Successful tool outputs may contain source code or command output. Log
  // only failures; the result event below still records success/failure.
  if (event.type === "tool_output" && data.failed !== true) return;
  const readString = (key: string) =>
    typeof data[key] === "string" ? data[key] : undefined;
  const readNumber = (key: string) =>
    typeof data[key] === "number" ? data[key] : undefined;
  const argumentsValue =
    data.arguments && typeof data.arguments === "object"
      ? (data.arguments as Record<string, unknown>)
      : null;
  const safeFailureMessage =
    event.type === "tool_output" && data.failed === true
      ? (readString("text") ?? "Tool failed")
          .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
          .replace(/([?&](?:token|key|api_key)=)[^&\s]+/gi, "$1[redacted]")
          .replace(/\b(?:sk|AIza)[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
          .slice(0, 500)
      : undefined;
  const budget =
    data.budget && typeof data.budget === "object"
      ? (data.budget as Record<string, unknown>)
      : null;
  const usage =
    data.usage && typeof data.usage === "object"
      ? (data.usage as Record<string, unknown>)
      : null;
  const detail = {
    sessionId: event.sessionId,
    sequence: event.sequence,
    type: event.type,
    activity: readString("kind"),
    state: readString("state"),
    iteration: readNumber("iteration"),
    itemId: readString("itemId"),
    tool: readString("tool"),
    path:
      typeof argumentsValue?.path === "string"
        ? argumentsValue.path
        : undefined,
    startLine:
      typeof argumentsValue?.start_line === "number"
        ? argumentsValue.start_line
        : undefined,
    endLine:
      typeof argumentsValue?.end_line === "number"
        ? argumentsValue.end_line
        : undefined,
    failed: data.failed === true || undefined,
    recoverable: data.recoverable === true || undefined,
    error: safeFailureMessage,
    reason: readString("reason"),
    durationMs: readNumber("durationMs"),
    inputTokens: readNumber("inputTokens"),
    outputTokens: readNumber("outputTokens"),
    runtimeMs:
      typeof usage?.runtimeMs === "number" ? usage.runtimeMs : undefined,
    runtimeLimitMs:
      typeof budget?.maxRuntimeMs === "number"
        ? budget.maxRuntimeMs
        : undefined,
    detail: readString("detail"),
  };
  const logger =
    event.type === "error" ||
    data.failed === true ||
    event.type === "guard_paused"
      ? console.error
      : console.info;
  logger("[coloride][agent:event]", detail);
}
