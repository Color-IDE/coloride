import type { Entry } from "../../../shared/api/types";
import {
  canonicalizeWorkspacePath,
  getParentWorkspacePath,
  isAbsoluteWorkspacePath,
  isWorkspaceRootPath,
  joinWorkspacePath,
  isUnderWorkspace as pathIsUnderWorkspace,
  isPathOrDescendant as workspaceIsPathOrDescendant,
  workspacePathParts,
} from "../../../shared/lib/workspacePath";
import { isBrowserTabKey } from "../../explorer/BrowserPane";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";

export const getItemPath = (item: FileTreeItem) => item.path ?? item.id;

export const getParentPath = getParentWorkspacePath;

export const isUnderWorkspace = pathIsUnderWorkspace;

/** Ancestor directories between workspace root and the file (exclusive of root, inclusive of file's parent). */
export const getAncestorDirsUnderRoot = (
  filePath: string,
  rootPath: string,
): string[] => {
  const root = canonicalizeWorkspacePath(rootPath);
  const file = canonicalizeWorkspacePath(filePath);
  if (!isUnderWorkspace(filePath, rootPath) || file === root) return [];

  const dirs: string[] = [];
  let current = getParentPath(filePath);
  while (canonicalizeWorkspacePath(current) !== root) {
    if (
      isWorkspaceRootPath(current) &&
      canonicalizeWorkspacePath(current) !== root
    )
      break;
    dirs.unshift(current);
    const parent = getParentPath(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
};

/** Depth of a tree item under the workspace root (root children = 0). */
export const itemDepthUnderRoot = (itemPath: string, rootPath: string) => {
  const rootParts = isWorkspaceRootPath(rootPath)
    ? []
    : workspacePathParts(rootPath);
  const itemParts = workspacePathParts(itemPath);
  return Math.max(0, itemParts.length - rootParts.length - 1);
};

export const joinRemotePath = joinWorkspacePath;

export const isPathOrDescendant = workspaceIsPathOrDescendant;

export const replacePathPrefix = (
  candidate: string,
  oldPath: string,
  newPath: string,
) =>
  isPathOrDescendant(candidate, oldPath)
    ? `${newPath}${candidate.slice(oldPath.length)}`
    : candidate;

export const replacePathPrefixInSet = (
  paths: Set<string>,
  oldPath: string,
  newPath: string,
) =>
  new Set([...paths].map((path) => replacePathPrefix(path, oldPath, newPath)));

/** Build a non-colliding name like `file copy.txt`, `file copy 2.txt`. */
export const buildCopyName = (
  name: string,
  existingNames: Set<string>,
  forceSuffix = false,
) => {
  const lastDot = name.lastIndexOf(".");
  const hasExt =
    lastDot > 0 &&
    lastDot < name.length - 1 &&
    !name.slice(lastDot + 1).includes(" ");
  const base = hasExt ? name.slice(0, lastDot) : name;
  const ext = hasExt ? name.slice(lastDot) : "";

  if (!forceSuffix && !existingNames.has(name)) {
    return name;
  }

  let candidate = `${base} copy${ext}`;
  if (!existingNames.has(candidate)) return candidate;

  let index = 2;
  while (existingNames.has(`${base} copy ${index}${ext}`)) {
    index += 1;
  }
  return `${base} copy ${index}${ext}`;
};

/** Normalize remote/local paths for equality checks (drop trailing slashes except root). */
export const normalizeRemotePath = (path: string) =>
  canonicalizeWorkspacePath(path) || "";

/**
 * Paths that must never become editor tabs (workspace root, known folders).
 * Stops phantom tabs like "www" when the root is `/var/www/.../sites/www`.
 */
export const isDirectoryEditorPath = (
  path: string,
  workspaceRoot: string,
  treeItems: ReadonlyArray<FileTreeItem>,
  getPath: (item: FileTreeItem) => string,
): boolean => {
  if (!isAbsoluteWorkspacePath(path) || isBrowserTabKey(path)) return false;
  const normalized = normalizeRemotePath(path);
  const root = normalizeRemotePath(workspaceRoot);
  if (root && normalized === root) return true;
  const known = treeItems.find(
    (item) => normalizeRemotePath(getPath(item)) === normalized,
  );
  return known?.kind === "dir";
};

export const entriesToTreeItems = (
  entries: Entry[],
  depth: number,
): FileTreeItem[] => {
  return [...entries]
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "dir" ? -1 : b.kind === "dir" ? 1 : 0;
      }

      return a.name.localeCompare(b.name);
    })
    .map((entry) => ({
      id: entry.path,
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      depth,
    }));
};

/** Stable snapshot of a directory listing for change detection. */
export const fingerprintEntries = (entries: Entry[]) =>
  [...entries]
    .map(
      (entry) => `${entry.name}\0${entry.kind}\0${entry.size}\0${entry.mtime}`,
    )
    .sort()
    .join("\n");

export const pathDepth = (path: string) => workspacePathParts(path).length;

/**
 * Replace direct children of `parentPath` (or the whole root listing when parentPath is null)
 * while keeping previously expanded subtrees under directories that still exist.
 * Avoids unmounting the entire tree on quiet remote-watch refreshes (enter animation flash).
 */
export const mergeDirectoryListing = (
  current: FileTreeItem[],
  parentPath: string | null,
  children: FileTreeItem[],
): FileTreeItem[] => {
  const collectSubtrees = (items: FileTreeItem[], parentDepth: number) => {
    const subtrees = new Map<string, FileTreeItem[]>();
    let index = 0;
    while (index < items.length) {
      const item = items[index]!;
      if (item.depth !== parentDepth + 1) {
        index += 1;
        continue;
      }
      const itemPath = getItemPath(item);
      let end = index + 1;
      while (end < items.length && items[end]!.depth > item.depth) end += 1;
      if (item.kind === "dir" && end > index + 1) {
        subtrees.set(itemPath, items.slice(index + 1, end));
      }
      index = end;
    }
    return subtrees;
  };

  const withPreservedSubtrees = (
    directChildren: FileTreeItem[],
    previousSlice: FileTreeItem[],
    parentDepth: number,
  ) => {
    const oldSubtrees = collectSubtrees(previousSlice, parentDepth);
    const next: FileTreeItem[] = [];
    for (const child of directChildren) {
      next.push(child);
      if (child.kind === "dir") {
        const subtree = oldSubtrees.get(getItemPath(child));
        if (subtree?.length) next.push(...subtree);
      }
    }
    return next;
  };

  // Workspace root listing: items at depth 0 are the children.
  if (parentPath == null) {
    return withPreservedSubtrees(children, current, -1);
  }

  const parentIndex = current.findIndex(
    (item) => getItemPath(item) === parentPath,
  );
  if (parentIndex < 0) {
    // Parent row isn't in the flat list (e.g. workspace root path) — treat as root merge.
    return withPreservedSubtrees(children, current, -1);
  }

  const parentDepth = current[parentIndex]!.depth;
  let endIndex = parentIndex + 1;
  while (endIndex < current.length && current[endIndex]!.depth > parentDepth) {
    endIndex += 1;
  }
  const previousDescendants = current.slice(parentIndex + 1, endIndex);
  const mergedDescendants = withPreservedSubtrees(
    children,
    previousDescendants,
    parentDepth,
  );
  return [
    ...current.slice(0, parentIndex + 1),
    ...mergedDescendants,
    ...current.slice(endIndex),
  ];
};

/** True when the visible tree structure (paths + kinds + depths) is unchanged. */
export const treeStructureEqual = (
  left: FileTreeItem[],
  right: FileTreeItem[],
) => {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]!;
    const b = right[i]!;
    if (
      a.id !== b.id ||
      a.kind !== b.kind ||
      a.depth !== b.depth ||
      a.name !== b.name
    ) {
      return false;
    }
  }
  return true;
};
