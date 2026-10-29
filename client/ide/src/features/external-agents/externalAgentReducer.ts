import type {
  ExternalAgentConfigOption,
  ExternalAgentEvent,
  ExternalAgentPermissionRequest,
  ExternalAgentSessionUpdate,
} from "@coloride/contracts";

export type ExternalTranscriptItem =
  | { id: string; kind: "user" | "agent" | "thought"; text: string; live: boolean }
  | { id: string; kind: "plan"; entries: Array<{ content: string; status: string; priority: string }> }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      title: string;
      status: string;
      toolKind: string | null;
      content: unknown;
      rawInput?: Record<string, unknown>;
      rawOutput?: unknown;
      terminalOutput?: string;
    }
  | { id: string; kind: "notice"; text: string };

export type ExternalAgentUiState = {
  items: ExternalTranscriptItem[];
  permissions: ExternalAgentPermissionRequest[];
  config: ExternalAgentConfigOption[];
  pendingConfig: Record<string, string | boolean>;
  commands: Array<{ name: string; description?: string }>;
  usage: { used: number; size: number } | null;
  turnActive: boolean;
  lastSequence: number;
};

export const emptyExternalAgentState = (): ExternalAgentUiState => ({
  items: [],
  permissions: [],
  config: [],
  pendingConfig: {},
  commands: [],
  usage: null,
  turnActive: false,
  lastSequence: 0,
});

function textOf(update: ExternalAgentSessionUpdate): string {
  const content = update.content;
  if (content && typeof content === "object" && "text" in content && typeof content.text === "string") {
    return content.text;
  }
  return typeof update.text === "string" ? update.text : "";
}

function appendText(
  items: ExternalTranscriptItem[],
  kind: "user" | "agent" | "thought",
  text: string,
): ExternalTranscriptItem[] {
  const last = items.at(-1);
  if (last && last.kind === kind && last.live) {
    return [...items.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...items, { id: `${kind}-${items.length}`, kind, text, live: true }];
}

function finishLive(items: ExternalTranscriptItem[]): ExternalTranscriptItem[] {
  return items.map((item) => (item.kind === "user" || item.kind === "agent" || item.kind === "thought" ? { ...item, live: false } : item));
}

export function reduceExternalAgentUpdate(
  state: ExternalAgentUiState,
  update: ExternalAgentSessionUpdate,
): ExternalAgentUiState {
  const kind = update.sessionUpdate;
  if (kind === "user_message_chunk") {
    return { ...state, items: appendText(state.items, "user", textOf(update)), turnActive: true };
  }
  if (kind === "agent_message_chunk") {
    return { ...state, items: appendText(state.items, "agent", textOf(update)), turnActive: true };
  }
  if (kind === "agent_thought_chunk") {
    return { ...state, items: appendText(state.items, "thought", textOf(update)), turnActive: true };
  }
  if (kind === "plan") {
    const entries = Array.isArray(update.entries) ? update.entries : [];
    const plan = {
      id: "plan",
      kind: "plan" as const,
      entries: entries
        .filter((entry): entry is { content: string; status: string; priority: string } => Boolean(entry) && typeof entry === "object")
        .map((entry) => ({
          content: String(entry.content ?? ""),
          status: String(entry.status ?? "pending"),
          priority: String(entry.priority ?? "medium"),
        })),
    };
    const without = state.items.filter((item) => item.kind !== "plan");
    return { ...state, items: [...without, plan] };
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    const toolCallId = String(update.toolCallId ?? "");
    const existing = state.items.find((item) => item.kind === "tool" && item.toolCallId === toolCallId);
    const meta = update._meta && typeof update._meta === "object"
      ? update._meta as Record<string, unknown> : {};
    const chunk = meta.terminal_output_delta ?? meta.terminal_output;
    const data = chunk && typeof chunk === "object" && "data" in chunk && typeof chunk.data === "string" ? chunk.data : "";
    const previousOutput = existing?.kind === "tool" ? existing.terminalOutput ?? "" : "";
    const next = {
      id: existing?.id ?? `tool-${toolCallId}`,
      kind: "tool" as const,
      toolCallId,
      title: String(update.title ?? (existing && existing.kind === "tool" ? existing.title : toolCallId)),
      status: String(update.status ?? (existing && existing.kind === "tool" ? existing.status : "pending")),
      toolKind: typeof update.kind === "string" ? update.kind : existing && existing.kind === "tool" ? existing.toolKind : null,
      content: update.content ?? (existing && existing.kind === "tool" ? existing.content : null),
      rawInput: update.rawInput && typeof update.rawInput === "object" && !Array.isArray(update.rawInput)
        ? update.rawInput as Record<string, unknown>
        : existing?.kind === "tool" ? existing.rawInput : undefined,
      rawOutput: update.rawOutput ?? (existing?.kind === "tool" ? existing.rawOutput : undefined),
      terminalOutput: previousOutput + data,
    };
    const items = existing
      ? state.items.map((item) => (item.kind === "tool" && item.toolCallId === toolCallId ? next : item))
      : [...state.items, next];
    return { ...state, items };
  }
  if (kind === "config_option_update") {
    const options = Array.isArray(update.configOptions) ? update.configOptions as ExternalAgentConfigOption[] : state.config;
    return { ...state, config: options, pendingConfig: {} };
  }
  if (kind === "available_commands_update") {
    const commands = Array.isArray(update.availableCommands) ? update.availableCommands : [];
    return {
      ...state,
      commands: commands
        .filter((item): item is { name: string; description?: string } => Boolean(item) && typeof item === "object" && "name" in item)
        .map((item) => ({ name: String(item.name), description: typeof item.description === "string" ? item.description : undefined })),
    };
  }
  if (kind === "usage_update") {
    return { ...state, usage: { used: Number(update.used ?? 0), size: Number(update.size ?? 0) } };
  }
  if (kind === "permission_request") {
    const request = update as unknown as ExternalAgentPermissionRequest;
    return { ...state, permissions: [...state.permissions, request] };
  }
  if (kind === "permission_resolved") {
    return { ...state, permissions: state.permissions.filter((item) => item.requestId !== update.requestId) };
  }
  if (kind === "turn_complete" || kind === "execution_closed") {
    return { ...state, items: finishLive(state.items), permissions: [], turnActive: false };
  }
  if (kind === "error") {
    return {
      ...state,
      items: [...finishLive(state.items), { id: `notice-${state.items.length}`, kind: "notice", text: String(update.message ?? "The agent stopped.") }],
      turnActive: false,
    };
  }
  return state;
}

export function reduceExternalAgentEvent(state: ExternalAgentUiState, event: ExternalAgentEvent): ExternalAgentUiState {
  if (event.sequence <= state.lastSequence) return state;
  return { ...reduceExternalAgentUpdate(state, event.update), lastSequence: event.sequence };
}

export function hydrateExternalAgentEvents(events: ExternalAgentEvent[]): ExternalAgentUiState {
  const state = events.reduce(reduceExternalAgentEvent, emptyExternalAgentState());
  const closed = events.some((event) => event.update.sessionUpdate === "turn_complete");
  return closed ? state : { ...state, items: state.items.map((item) => ("live" in item ? { ...item, live: false } : item)), turnActive: false };
}
