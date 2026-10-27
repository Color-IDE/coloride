import {
  getParentWorkspacePath,
  workspaceBasename,
  isPathOrDescendant as workspaceIsPathOrDescendant,
} from "../../../../shared/lib/workspacePath";
import { type FileTreeItem } from "./types";

export const TREE_DND_MIME = "application/x-coloride-tree-item";

/** Fixed row height. Enables O(1) windowing for huge trees. */
export const TREE_ROW_HEIGHT = 22;

/** Matches `p-1` on the scroll container. */
export const TREE_SCROLL_PADDING = 4;

/** Extra rows rendered above/below the viewport. */
export const TREE_OVERSCAN = 12;

/** Always window once the visible list is non-trivial. */
export const TREE_VIRTUALIZE_THRESHOLD = 80;

export const CREATE_DRAFT_ID = "__coloride_create_draft__";

export function normalizeTreePath(path: string) {
  return path.replace(/\/+$/, "") || "/";
}

export function treePathHasError(
  path: string,
  kind: FileTreeItem["kind"],
  errorPaths?: ReadonlySet<string>,
) {
  if (!errorPaths || errorPaths.size === 0) return false;
  const normalized = normalizeTreePath(path);
  if (errorPaths.has(normalized)) return true;
  if (kind !== "dir") return false;
  const prefix = `${normalized}/`;
  for (const errorPath of errorPaths) {
    if (errorPath === normalized || errorPath.startsWith(prefix)) return true;
  }
  return false;
}

/** True when the OS is dragging real files (Finder/Explorer), not an in-app tree move. */
export function isExternalFileDrag(
  dataTransfer: DataTransfer | null | undefined,
  internalDragActive = false,
): boolean {
  if (!dataTransfer || internalDragActive) return false;
  const types = [...dataTransfer.types];
  // Internal tree moves set our custom MIME (and often text/plain).
  if (types.includes(TREE_DND_MIME)) return false;
  // Electron/macOS is inconsistent during dragover: sometimes only uri-list / file-url.
  return (
    types.includes("Files") ||
    types.includes("files") ||
    types.includes("text/uri-list") ||
    types.includes("public.file-url") ||
    types.includes("public.url") ||
    types.some((type) => /file/i.test(type) && !/plain|html|rtf/i.test(type))
  );
}

export function externalDropDestination(
  item: FileTreeItem | null | undefined,
  workspacePath: string | null | undefined,
): string | null {
  if (item) {
    const path = getTreeItemPath(item);
    if (item.kind === "dir") return path;
    const parent = getParentPath(path);
    return parent || workspacePath || null;
  }
  return workspacePath || null;
}

/** Collect File objects from a drop (Files list + items API; Electron path-aware). */
export function filesFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
): File[] {
  if (!dataTransfer) return [];
  const collected: File[] = [];
  const seen = new Set<string>();

  const push = (file: File | null | undefined) => {
    if (!file) return;
    // Electron attaches `.path` for Finder drops — use it to dedupe.
    const electronPath = (file as File & { path?: string }).path || "";
    const key =
      electronPath || `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(file);
  };

  if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (const file of Array.from(dataTransfer.files)) push(file);
  }

  if (
    collected.length === 0 &&
    dataTransfer.items &&
    dataTransfer.items.length > 0
  ) {
    for (let index = 0; index < dataTransfer.items.length; index += 1) {
      const item = dataTransfer.items[index];
      if (!item || item.kind !== "file") continue;
      push(item.getAsFile());
    }
  }

  return collected;
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export function modKey(event: { metaKey: boolean; ctrlKey: boolean }) {
  return event.metaKey || event.ctrlKey;
}

export function getTreeItemPath(item: FileTreeItem) {
  return item.path ?? item.id;
}

export function getParentPath(path: string) {
  return getParentWorkspacePath(path);
}

/** Synthetic tree item representing the workspace root (the explorer card itself). */
export function makeWorkspaceRootItem(workspacePath: string): FileTreeItem {
  const name = workspaceBasename(workspacePath) || workspacePath;
  return {
    id: workspacePath,
    path: workspacePath,
    name,
    kind: "dir",
    depth: -1,
  };
}

export function isPathOrDescendant(candidate: string, path: string) {
  return workspaceIsPathOrDescendant(candidate, path);
}

/**
 * Range to pre-select when renaming: basename only, leave extension unselected
 * so the user can change the name without wiping `.png` / `.tsx` by accident.
 * Folders, dotfiles (`.gitignore`), and names without a real extension → all.
 */
export function renameSelectionRange(
  name: string,
  kind: FileTreeItem["kind"],
): { start: number; end: number } {
  if (kind === "dir" || !name || name.startsWith(".")) {
    return { start: 0, end: name.length };
  }
  const lastDot = name.lastIndexOf(".");
  // No extension, or trailing dot only.
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return { start: 0, end: name.length };
  }
  return { start: 0, end: lastDot };
}

/**
 * After delete, keep selection inside the same folder:
 * next sibling → previous sibling → parent folder → workspace root.
 */
export function pickNextSelectionAfterDelete(
  orderedItems: FileTreeItem[],
  deletedItems: FileTreeItem[],
  workspacePath?: string | null,
): string | null {
  if (deletedItems.length === 0) return null;

  const deletedRoots = deletedItems.map(getTreeItemPath);
  const isGone = (path: string) =>
    deletedRoots.some((root) => isPathOrDescendant(path, root));

  // Anchor on the first deleted row in tree order.
  let primaryPath = deletedRoots[0]!;
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const path of deletedRoots) {
    const index = orderedItems.findIndex(
      (item) => getTreeItemPath(item) === path,
    );
    if (index >= 0 && index < bestIndex) {
      bestIndex = index;
      primaryPath = path;
    }
  }

  const parent = getParentPath(primaryPath);
  const siblings = orderedItems.filter(
    (item) => getParentPath(getTreeItemPath(item)) === parent,
  );
  const anchorIndex = siblings.findIndex(
    (item) => getTreeItemPath(item) === primaryPath,
  );

  if (anchorIndex >= 0) {
    for (let index = anchorIndex + 1; index < siblings.length; index += 1) {
      const path = getTreeItemPath(siblings[index]!);
      if (!isGone(path)) return path;
    }
    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
      const path = getTreeItemPath(siblings[index]!);
      if (!isGone(path)) return path;
    }
  } else {
    // Anchor already missing from list — still prefer remaining same-folder rows.
    for (const sibling of siblings) {
      const path = getTreeItemPath(sibling);
      if (!isGone(path)) return path;
    }
  }

  // Folder empty: select the parent directory row when it exists.
  if (parent && !isGone(parent)) {
    const parentInTree = orderedItems.some(
      (item) => getTreeItemPath(item) === parent,
    );
    if (parentInTree) return parent;
    if (workspacePath && parent === workspacePath) return workspacePath;
  }

  if (workspacePath && !isGone(workspacePath)) return workspacePath;
  return null;
}

/** Resolve the directory that should receive a drop for a hovered row. */
export function resolveDropTarget(
  target: FileTreeItem,
  sourcePath: string,
  workspacePath?: string | null,
): string | null {
  const targetPath = getTreeItemPath(target);
  if (targetPath === sourcePath) return null;

  // Dropping on a directory → move into it.
  // Dropping on a file → move into that file's parent.
  let destination =
    target.kind === "dir" ? targetPath : getParentPath(targetPath);

  // Root workspace: allow dropping onto the empty area via workspacePath.
  if (!destination && workspacePath) {
    destination = workspacePath;
  }

  if (!destination) return null;

  // No-op: already in that folder.
  if (getParentPath(sourcePath) === destination) return null;

  // Cannot move a folder into itself or a descendant.
  if (isPathOrDescendant(destination, sourcePath)) return null;

  return destination;
}

export const treeItems: FileTreeItem[] = [
  { id: "backend", name: "backend", kind: "dir", depth: 0 },
  { id: "core/ide-host", name: "desktop", kind: "dir", depth: 1 },
  { id: "core/ide-host/src", name: "src", kind: "dir", depth: 2 },
  {
    id: "core/ide-host/src/coloride_desktop",
    name: "coloride_desktop",
    kind: "dir",
    depth: 3,
  },
  { id: "frontend", name: "frontend", kind: "dir", depth: 0 },
  { id: "client/ide", name: "app", kind: "dir", depth: 1 },
  { id: "client/ide/src", name: "src", kind: "dir", depth: 2 },
  { id: "client/ide/src/filetree", name: "filetree", kind: "dir", depth: 3 },
  {
    id: "client/ide/src/filetree/FileTree.tsx",
    name: "FileTree.tsx",
    kind: "file",
    depth: 4,
    active: true,
  },
  { id: "client/ide/src/App.tsx", name: "App.tsx", kind: "file", depth: 3 },
  { id: "client/ide/src/styles.css", name: "styles.css", kind: "file", depth: 3 },
  { id: "shared", name: "shared", kind: "dir", depth: 0 },
  { id: "logo.svg", name: "logo.svg", kind: "file", depth: 0 },
  { id: "package.json", name: "package.json", kind: "file", depth: 0 },
  { id: "README.md", name: "README.md", kind: "file", depth: 0 },
];

export const initialExpanded = new Set([
  "backend",
  "core/ide-host",
  "core/ide-host/src",
  "frontend",
  "client/ide",
  "client/ide/src",
  "client/ide/src/filetree",
]);

export function getVisibleTreeItems(
  items: FileTreeItem[],
  expandedIds: Set<string>,
) {
  const collapsedDepths = new Set<number>();

  return items.filter((item) => {
    for (const depth of collapsedDepths) {
      if (item.depth > depth) {
        return false;
      }

      collapsedDepths.delete(depth);
    }

    if (item.kind === "dir" && !expandedIds.has(item.path ?? item.id)) {
      collapsedDepths.add(item.depth);
    }

    return true;
  });
}
