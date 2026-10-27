export function isHomeWorkspacePath(path: string | null | undefined): boolean {
  const normalized = normalizeWorkspaceCwd(path);
  if (!normalized) return false;
  return /^(\/Users\/[^/]+|\/home\/[^/]+)$/.test(normalized);
}

export function pathTailLabel(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) || path;
}

export function workspaceMenuPathLabel(
  path: string | null | undefined,
): string {
  const normalized = normalizeWorkspaceCwd(path);
  if (!normalized) return "";
  const home = normalized.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
  if (
    home?.[1] &&
    (normalized === home[1] || normalized.startsWith(`${home[1]}/`))
  ) {
    return `~${normalized.slice(home[1].length)}` || "~";
  }
  return normalized;
}

export function normalizeWorkspaceCwd(path: string | null | undefined): string {
  if (!path) return "";
  return path.trim().replace(/\/+/g, "/").replace(/\/+$/, "");
}

export function isPathInsideWorkspace(
  path: string,
  root: string | null | undefined,
): boolean {
  const normalizedPath = normalizeWorkspaceCwd(path);
  const normalizedRoot = normalizeWorkspaceCwd(root);
  if (!normalizedPath || !normalizedRoot) return false;
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

export function uniqueWorkspaceLabels(keys: string[]): Map<string, string> {
  const labels = new Map<string, string>();
  const byBase = new Map<string, string[]>();
  for (const key of keys) {
    const base = (key ? pathTailLabel(key) : "Other") || "Other";
    labels.set(key, base);
    const bucket = base.toLowerCase();
    const list = byBase.get(bucket);
    if (list) list.push(key);
    else byBase.set(bucket, [key]);
  }
  for (const groupKeys of byBase.values()) {
    if (groupKeys.length < 2) continue;
    for (const key of groupKeys) {
      if (!key) {
        labels.set(key, "Other");
        continue;
      }
      const parts = key.split("/").filter(Boolean);
      let depth = 2;
      let label = parts.slice(-Math.min(depth, parts.length)).join("/");
      while (depth < parts.length) {
        const clash = groupKeys.some((other) => {
          if (other === key || !other) return false;
          const otherParts = other.split("/").filter(Boolean);
          return (
            otherParts
              .slice(-Math.min(depth, otherParts.length))
              .join("/")
              .toLowerCase() === label.toLowerCase()
          );
        });
        if (!clash) break;
        depth += 1;
        label = parts.slice(-Math.min(depth, parts.length)).join("/");
      }
      labels.set(key, label || pathTailLabel(key) || key);
    }
  }
  return labels;
}
