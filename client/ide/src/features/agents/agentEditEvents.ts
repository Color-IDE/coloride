export const WRITE_TOOLS = new Set(["write_file", "replace_in_file"]);

export const DELETE_TOOLS = new Set(["delete_path"]);

export type AgentEditKind = "write" | "delete";

export function resolveAgentEditPath(
  raw: string,
  workspacePath: string | null,
): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed.replace(/\/+$/, "") || "/";
  const root = (workspacePath ?? "").replace(/\/+$/, "");
  if (!root) return trimmed;
  const rel = trimmed.replace(/^\.\//, "").replace(/^\/+/, "");
  return `${root}/${rel}`.replace(/\/{2,}/g, "/");
}

export function pathFromToolEventData(data: Record<string, unknown>): string {
  const meta =
    data.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : null;
  if (meta && typeof meta.path === "string" && meta.path.trim())
    return meta.path.trim();
  if (typeof data.path === "string" && data.path.trim())
    return data.path.trim();
  const args = data.arguments;
  if (args && typeof args === "object") {
    const p = (args as Record<string, unknown>).path;
    if (typeof p === "string" && p.trim()) return p.trim();
  }
  return "";
}

export function toolNameFromEventData(data: Record<string, unknown>): string {
  return String(data.tool || data.name || "").trim();
}
