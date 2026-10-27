import { AGENT_PLUGIN_CHOICES, findAgentPlugin, type AgentPluginChoice } from "./slashCommands";

const STORAGE_KEY = "coloride.agent.session-plugins.v1";
const ADDED_KEY = "coloride.agent.session-plugin-added.v1";
const NEW_TASK_KEY = "__new__";

function storageKey(sessionId: string | null | undefined): string {
  const id = typeof sessionId === "string" ? sessionId.trim() : "";
  return id || NEW_TASK_KEY;
}

function pluginStore(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function readAll(): Record<string, string[]> {
  const store = pluginStore();
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const ids = value
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean);
      if (ids.length) next[key] = [...new Set(ids)];
    }
    return next;
  } catch {
    return {};
  }
}

function writeAll(value: Record<string, string[]>) {
  const store = pluginStore();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
  }
}

export function resolveAgentPlugin(id: string): AgentPluginChoice {
  const cleaned = id.trim().toLowerCase();
  return findAgentPlugin(cleaned) ?? {
    id: cleaned,
    name: cleaned,
    description: "Installed MCP plugin",
  };
}

export function readSessionPluginIds(sessionId: string | null | undefined): string[] {
  return readAll()[storageKey(sessionId)] ?? [];
}

export function readSessionPlugins(sessionId: string | null | undefined): AgentPluginChoice[] {
  return readSessionPluginIds(sessionId).map(resolveAgentPlugin);
}

export function writeSessionPluginIds(sessionId: string | null | undefined, ids: readonly string[]) {
  const key = storageKey(sessionId);
  const all = readAll();
  const cleaned = [...new Set(ids.map((item) => item.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length) all[key] = cleaned;
  else delete all[key];
  writeAll(all);
}

export function attachSessionPlugin(
  sessionId: string | null | undefined,
  pluginId: string,
): AgentPluginChoice[] {
  const plugin = resolveAgentPlugin(pluginId);
  const next = [...readSessionPluginIds(sessionId).filter((id) => id !== plugin.id), plugin.id];
  writeSessionPluginIds(sessionId, next);
  return next.map(resolveAgentPlugin);
}

export function detachSessionPlugin(
  sessionId: string | null | undefined,
  pluginId: string,
): AgentPluginChoice[] {
  const plugin = resolveAgentPlugin(pluginId);
  const next = readSessionPluginIds(sessionId).filter((id) => id !== plugin.id);
  writeSessionPluginIds(sessionId, next);
  return next.map(resolveAgentPlugin);
}

export function clearSessionPlugins(sessionId: string | null | undefined) {
  writeSessionPluginIds(sessionId, []);
}

export function copySessionPlugins(
  fromSessionId: string | null | undefined,
  toSessionId: string,
) {
  writeSessionPluginIds(toSessionId, readSessionPluginIds(fromSessionId));
  writeSessionPluginAdded(toSessionId, readSessionPluginAdded(fromSessionId));
}

export function adoptNewTaskPlugins(sessionId: string): string[] {
  const ids = readSessionPluginIds(null);
  writeSessionPluginIds(sessionId, ids);
  writeSessionPluginAdded(sessionId, readSessionPluginAdded(null));
  clearSessionPlugins(null);
  writeSessionPluginAdded(null, null);
  return ids;
}

export function readSessionPluginAdded(
  sessionId: string | null | undefined,
): AgentPluginChoice | null {
  const store = pluginStore();
  if (!store) return null;
  try {
    const raw = store.getItem(ADDED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const id = (parsed as Record<string, unknown>)[storageKey(sessionId)];
    return typeof id === "string" && id.trim() ? resolveAgentPlugin(id) : null;
  } catch {
    return null;
  }
}

export function writeSessionPluginAdded(
  sessionId: string | null | undefined,
  plugin: AgentPluginChoice | string | null,
) {
  const store = pluginStore();
  if (!store) return;
  try {
    const raw = store.getItem(ADDED_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : {};
    const all = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, string>) }
      : {};
    const key = storageKey(sessionId);
    const id = typeof plugin === "string" ? plugin : plugin?.id;
    if (id?.trim()) all[key] = id.trim().toLowerCase();
    else delete all[key];
    store.setItem(ADDED_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota / private mode */
  }
}

export function mergePluginChoices(
  extra: readonly AgentPluginChoice[] = [],
): AgentPluginChoice[] {
  const seen = new Set<string>();
  const merged: AgentPluginChoice[] = [];
  for (const plugin of [...AGENT_PLUGIN_CHOICES, ...extra]) {
    const id = plugin.id.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push({ ...plugin, id });
  }
  return merged;
}
