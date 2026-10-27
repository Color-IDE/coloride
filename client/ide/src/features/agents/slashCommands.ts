export type SlashCommandId =
  | "run-everything"
  | "plan"
  | "ask"
  | "debug"
  | "fork"
  | "summarize"
  | "shell"
  | "canvas"
  | "add-plugin"
  | "remove-plugin"
  | "log";

export type SlashCommandDef = {
  id: SlashCommandId;
  name: string;
  description: string;
  /** Shown after the command when completing from the menu. */
  hint?: string;
  /** Remainder is sent as a chat message after the command runs. */
  takesPrompt?: boolean;
};

export type ParsedSlashInput = {
  raw: string;
  name: string;
  args: string;
};

export type SlashCommandInvocation = {
  id: SlashCommandId;
  args: string;
  raw: string;
};

export type SlashCommandResult = {
  /** Clear the composer after a successful command. Default true. */
  clearInput?: boolean;
  /** Leave `/` in the composer so the menu stays open (used by /help). */
  keepSlashMenu?: boolean;
  /** Force picking a complement before the user can send. */
  pickPlugin?: "add" | "remove";
  attachPlugin?: string;
  detachPlugin?: string;
  submitRemainder?: string;
  notice?: string;
};

export type AgentPluginChoice = {
  id: string;
  name: string;
  description: string;
};

export const AGENT_PLUGIN_CHOICES: readonly AgentPluginChoice[] = [
  { id: "linear", name: "Linear", description: "Issues and project workflows" },
  { id: "github", name: "GitHub", description: "PRs, issues, and reviews" },
];

export function findAgentPlugin(
  query: string,
  choices: readonly AgentPluginChoice[] = AGENT_PLUGIN_CHOICES,
): AgentPluginChoice | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  const exact = choices.find(
    (plugin) => plugin.id === needle || plugin.name.toLowerCase() === needle,
  );
  if (exact) return exact;
  const prefixed = choices.filter(
    (plugin) => plugin.id.startsWith(needle) || plugin.name.toLowerCase().startsWith(needle),
  );
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

export function filterAgentPlugins(
  query: string,
  choices: readonly AgentPluginChoice[] = AGENT_PLUGIN_CHOICES,
): AgentPluginChoice[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...choices];
  return choices.filter(
    (plugin) =>
      plugin.id.startsWith(needle)
      || plugin.name.toLowerCase().includes(needle)
      || plugin.description.toLowerCase().includes(needle),
  );
}

export function pluginCommandMode(name: string): "add" | "remove" | null {
  if (name === "add-plugin") return "add";
  if (name === "remove-plugin") return "remove";
  return null;
}

export function findExactAgentPlugin(
  query: string,
  choices: readonly AgentPluginChoice[] = AGENT_PLUGIN_CHOICES,
): AgentPluginChoice | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  return choices.find(
    (plugin) => plugin.id === needle || plugin.name.toLowerCase() === needle,
  );
}

/** `/add-plugin Linear look at ENG-1` → plugin Linear + remainder "look at ENG-1". */
export function splitPluginCommand(
  text: string,
  choices: readonly AgentPluginChoice[] = AGENT_PLUGIN_CHOICES,
): { mode: "add" | "remove"; plugin?: AgentPluginChoice; remainder: string } | null {
  const parsed = parseSlashInput(text);
  if (!parsed) return null;
  const mode = pluginCommandMode(parsed.name);
  if (!mode) return null;
  const token = parsed.args.split(/\s+/, 1)[0] ?? "";
  const plugin = findExactAgentPlugin(token, choices);
  if (!plugin) return { mode, remainder: parsed.args };
  const remainder = parsed.args.slice(token.length).trimStart();
  return { mode, plugin, remainder };
}

export const SLASH_COMMANDS: readonly SlashCommandDef[] = [
  { id: "run-everything", name: "run-everything", description: "Full access — no approvals, no sandbox" },
  { id: "plan", name: "plan", description: "Plan mode — inspect, then propose steps", hint: "task", takesPrompt: true },
  { id: "ask", name: "ask", description: "Ask mode — read-only, no tools", hint: "question", takesPrompt: true },
  { id: "debug", name: "debug", description: "Debug mode — shell and processes, no file writes", hint: "issue", takesPrompt: true },
  { id: "fork", name: "fork", description: "Duplicate this chat and continue from a copy" },
  { id: "summarize", name: "summarize", description: "Summarize this conversation", hint: "focus", takesPrompt: true },
  { id: "shell", name: "shell", description: "Open a terminal in the workspace" },
  { id: "canvas", name: "canvas", description: "Open the canvas" },
  { id: "add-plugin", name: "add-plugin", description: "Add a plugin to this chat", hint: "name" },
  { id: "remove-plugin", name: "remove-plugin", description: "Remove a plugin from this chat", hint: "name" },
  { id: "log", name: "log", description: "Open a full agent dump in the editor" },
];

const COMMAND_BY_NAME = new Map(SLASH_COMMANDS.map((command) => [command.name, command]));
const COMMAND_BY_ID = new Map(SLASH_COMMANDS.map((command) => [command.id, command]));

const RECENT_KEY = "coloride.agent.slash-recent.v1";
const RECENT_LIMIT = 5;

function slashStorage(): Storage | null {
  try {
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

export function readRecentSlashCommands(): SlashCommandDef[] {
  const storage = slashStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const commands: SlashCommandDef[] = [];
    for (const value of parsed) {
      const id = String(value);
      if (seen.has(id)) continue;
      const command = COMMAND_BY_ID.get(id as SlashCommandId);
      if (!command) continue;
      seen.add(id);
      commands.push(command);
      if (commands.length >= RECENT_LIMIT) break;
    }
    return commands;
  } catch {
    return [];
  }
}

export function splitSlashCommands(
  commands: readonly SlashCommandDef[],
  query = "",
): {
  recent: SlashCommandDef[];
  rest: SlashCommandDef[];
  rows: SlashCommandDef[];
} {
  const needle = query.trim().toLowerCase();
  const visible = new Set(commands.map((command) => command.id));
  const recent = readRecentSlashCommands()
    .filter((command) => (needle ? visible.has(command.id) : true))
    .slice(0, RECENT_LIMIT);
  const recentIds = new Set(recent.map((command) => command.id));
  const rest = commands.filter((command) => !recentIds.has(command.id));
  return { recent, rest, rows: [...recent, ...rest] };
}

export function rememberSlashCommand(id: SlashCommandId) {
  if (!COMMAND_BY_ID.has(id)) return;
  const storage = slashStorage();
  if (!storage) return;
  const next = [id, ...readRecentSlashCommands().map((command) => command.id).filter((item) => item !== id)].slice(
    0,
    RECENT_LIMIT,
  );
  try {
    storage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

/** `/plan foo` is a command. `/var/www` and `/Users/...` are paths, not commands. */
const SLASH_LINE = /^\/([a-z][a-z0-9-]*)?(?:\s+([\s\S]*))?$/i;

export function parseSlashInput(text: string): ParsedSlashInput | null {
  const raw = text.replace(/^\uFEFF/, "");
  if (!raw.startsWith("/")) return null;
  const firstLine = raw.split("\n", 1)[0] ?? raw;
  if (firstLine.includes("/", 1)) return null;
  const match = SLASH_LINE.exec(firstLine);
  if (!match) return null;
  return {
    raw,
    name: (match[1] ?? "").toLowerCase(),
    args: (match[2] ?? "").trim(),
  };
}

export function findSlashCommand(name: string): SlashCommandDef | undefined {
  return COMMAND_BY_NAME.get(name.trim().toLowerCase());
}

const HIDDEN_UNTIL_TYPED = new Set<SlashCommandId>(["ask", "plan", "debug"]);

export function filterSlashCommands(query: string): SlashCommandDef[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return SLASH_COMMANDS.filter((command) => !HIDDEN_UNTIL_TYPED.has(command.id));
  }
  return SLASH_COMMANDS.filter(
    (command) =>
      command.name.startsWith(needle)
      || command.name.includes(needle)
      || command.description.toLowerCase().includes(needle),
  );
}

export const SUMMARIZE_PROMPT =
  "Summarize this conversation so far: the goal, decisions, files changed, and remaining work. Be concise.";
