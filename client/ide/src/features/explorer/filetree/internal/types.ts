import type { ContentSearchMatch } from "../../../../shared/api/types";

export type FileTreeItem = {
  id: string;
  name: string;
  kind: "dir" | "file" | "link";
  depth: number;
  path?: string;
  active?: boolean;
};

export type FileTreeProps = {
  items?: FileTreeItem[];
  expandedIds?: Set<string>;
  connected?: boolean;
  loadingPaths?: Set<string>;
  selectedPath?: string | null;
  onToggleDir?: (item: FileTreeItem) => void;
  onSelectFile?: (item: FileTreeItem) => void;
  /** Create a file under parentDirPath with the given basename. Returns true on success. */
  onCreateFile?: (parentDirPath: string, name: string) => Promise<boolean>;
  /** Create a folder under parentDirPath with the given basename. Returns true on success. */
  onCreateFolder?: (parentDirPath: string, name: string) => Promise<boolean>;
  /**
   * External trigger (app menu / shortcuts) to start inline create.
   * FileTree starts a draft row when `token` changes.
   */
  createRequest?: { kind: "file" | "folder"; token: number } | null;
  onDeleteItem?: (item: FileTreeItem) => Promise<boolean>;
  /** Bulk delete (multi-select). Prefer this when deleting more than one item. */
  onDeleteItems?: (items: FileTreeItem[]) => Promise<boolean>;
  /** Undo last tree mutation (e.g. restore deleted files). */
  onUndo?: () => Promise<boolean> | boolean;
  canUndo?: boolean;
  onOpenRemoteFile?: (
    path: string,
    options?: { line?: number; column?: number },
  ) => void | Promise<unknown>;
  onRenameItem?: (item: FileTreeItem, newName: string) => Promise<boolean>;
  onMoveItem?: (item: FileTreeItem, targetDirPath: string) => Promise<boolean>;
  onCutItem?: (item: FileTreeItem) => boolean | void;
  onCopyItem?: (item: FileTreeItem) => boolean | void;
  onDuplicateItem?: (item: FileTreeItem) => Promise<boolean>;
  onPasteItem?: (contextItem?: FileTreeItem) => Promise<boolean>;
  canPaste?: boolean;
  /** Upload local OS files (any type) into a remote directory. */
  onUploadFiles?: (targetDirPath: string, files: File[]) => Promise<boolean>;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** When token changes, scroll/focus this path in the tree (reveal in explorer). */
  revealPath?: string | null;
  revealToken?: number;
  workspacePath?: string | null;
  /** Collapse every open folder in the tree (not the header workspace chrome). */
  workspaceKind?: "local" | "ssh";
  connectionId?: string | null;
  onExpandAllFolders?: () => void | Promise<void>;
  onCollapseAllFolders?: () => void;
  /** Remote paths with LSP errors — file name and ancestor folders turn red. */
  errorPaths?: ReadonlySet<string>;
  /** Unsaved editor buffers — a dirty dot on the right of the file row. */
  dirtyPaths?: ReadonlySet<string>;
};

export type CreateDraft = {
  kind: "file" | "folder";
  parentPath: string;
  depth: number;
  name: string;
};

export type GroupedContentHits = {
  path: string;
  name: string;
  matches: ContentSearchMatch[];
};
