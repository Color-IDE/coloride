/** Resolve a local agent path without letting a sibling folder or traversal count as membership. */
function absolutePath(value: string): string | null {
  const path = value.replace(/\\/g, "/");
  if (!path || path.includes("\0") || (!path.startsWith("/") && !/^[A-Za-z]:\//.test(path))) return null;
  const prefix = path.startsWith("/") ? "/" : path.slice(0, 3);
  const parts: string[] = [];
  for (const part of path.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return prefix + parts.join("/");
}

export function workspaceFilePath(path: string, workspaceRoot: string | null | undefined, agentRoot?: string | null): string | null {
  const root = workspaceRoot ? absolutePath(workspaceRoot) : null;
  if (!root || !path || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return null;
  const base = agentRoot ? absolutePath(agentRoot) : null;
  const file = absolutePath(path) ?? (base ? absolutePath(`${base}/${path}`) : null);
  if (!file || file === root) return null;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return file.startsWith(prefix) ? file : null;
}
