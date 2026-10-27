/**
 * Workspace paths are Unix on SSH hosts and native on the local machine.
 * Windows local folders arrive as `C:\…` / `C:/…` / UNC `\\server\share`.
 */

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC = /^\\\\[^\\]+\\[^\\]+/;

export function isWindowsAbsPath(path: string): boolean {
  return WINDOWS_DRIVE.test(path) || WINDOWS_UNC.test(path);
}

export function isAbsoluteWorkspacePath(path: string): boolean {
  const value = path.trim();
  return Boolean(value) && (value.startsWith("/") || isWindowsAbsPath(value));
}

export function isWorkspaceRootPath(path: string): boolean {
  const canon = canonicalizeWorkspacePath(path);
  return canon === "/" || /^[A-Za-z]:\/$/.test(canon);
}

/** Forward-slash form for comparisons. Drive roots become `C:/`. */
export function canonicalizeWorkspacePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  let value = trimmed.replace(/\\/g, "/");
  if (/^[A-Za-z]:$/.test(value)) return `${value}/`;
  if (/^[A-Za-z]:\/$/.test(value) || value === "/") return value;
  return value.replace(/\/+$/, "") || "/";
}

export function trimTrailingSeparators(path: string): string {
  if (!path) return "";
  if (isWindowsAbsPath(path)) {
    const trimmed = path.replace(/[\\/]+$/, "");
    if (/^[A-Za-z]:$/.test(trimmed)) {
      return path.includes("\\") ? `${trimmed}\\` : `${trimmed}/`;
    }
    return trimmed;
  }
  if (path === "/") return "/";
  return path.replace(/\/+$/, "") || "/";
}

function compareKey(path: string): string {
  const canon = canonicalizeWorkspacePath(path);
  return isWindowsAbsPath(path) ? canon.toLowerCase() : canon;
}

export function isUnderWorkspace(filePath: string, rootPath: string): boolean {
  const file = compareKey(filePath);
  const root = compareKey(rootPath);
  if (!file || !root) return false;
  if (root === "/") return file.startsWith("/");
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return file === root || file.startsWith(prefix);
}

export function getParentWorkspacePath(path: string): string {
  if (isWorkspaceRootPath(path)) {
    return trimTrailingSeparators(path) || "/";
  }
  const canon = canonicalizeWorkspacePath(path);
  const index = canon.lastIndexOf("/");
  if (index <= 0) return "/";
  const parent = canon.slice(0, index);
  if (/^[A-Za-z]:$/.test(parent)) {
    return path.includes("\\") ? `${parent}\\` : `${parent}/`;
  }
  if (isWindowsAbsPath(path) && path.includes("\\")) {
    return parent.replace(/\//g, "\\");
  }
  return parent;
}

export function workspacePathParts(path: string): string[] {
  return canonicalizeWorkspacePath(path).split("/").filter(Boolean);
}

export function workspaceBasename(path: string): string {
  const parts = workspacePathParts(path);
  return parts.at(-1) || trimTrailingSeparators(path) || path;
}

export function joinWorkspacePath(base: string, name: string): string {
  const leaf = name.replace(/^[\\/]+/, "");
  if (isWorkspaceRootPath(base)) {
    if (base === "/" || canonicalizeWorkspacePath(base) === "/") return `/${leaf}`;
    return `${trimTrailingSeparators(base)}${base.includes("\\") ? "\\" : "/"}${leaf}`;
  }
  const sep = isWindowsAbsPath(base) && base.includes("\\") ? "\\" : "/";
  return `${trimTrailingSeparators(base)}${sep}${leaf}`;
}

export function isPathOrDescendant(candidate: string, path: string): boolean {
  return candidate === path || isUnderWorkspace(candidate, path);
}
