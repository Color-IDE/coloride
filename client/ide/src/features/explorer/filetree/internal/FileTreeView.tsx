import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { api } from "../../../../shared/api/client";
import { OverflowFadeText } from "../../../../shared/components/OverflowFadeText";
import {
  getParentWorkspacePath,
  workspaceBasename,
  isPathOrDescendant as workspaceIsPathOrDescendant,
} from "../../../../shared/lib/workspacePath";
import { Menu } from "../../../../shared/ui/Menu";
import { useContextMenuPosition } from "../../../../shared/ui/useContextMenuPosition";
import { VerticalScrollHairline } from "../../../../shared/ui/VerticalScrollHairline";
import {
  getAllAgentEditReviews,
  normalizeAgentPath,
  subscribeAgentEditReviews,
} from "../../../editor/agentEditBridge";
import { ChevronIcon, FolderClosedIcon, FolderOpenIcon } from "./FileIcons";
import {
  CREATE_DRAFT_ID,
  TREE_OVERSCAN,
  TREE_ROW_HEIGHT,
  TREE_SCROLL_PADDING,
  TREE_VIRTUALIZE_THRESHOLD,
  externalDropDestination,
  getParentPath,
  getTreeItemPath,
  getVisibleTreeItems,
  initialExpanded,
  makeWorkspaceRootItem,
  modKey,
  pickNextSelectionAfterDelete,
  treeItems,
  treePathHasError,
} from "./model";
import { SearchPanel } from "./SearchPanel";
import { TreeMenuDivider, TreeMenuItem } from "./TreeMenu";
import { FileTreeSkeleton, TreeRow } from "./TreeRow";
import {
  type CreateDraft,
  type FileTreeItem,
  type FileTreeProps,
} from "./types";
import { useTreeDragAndDrop } from "./useTreeDragAndDrop";
import { useTreeKeyboard } from "./useTreeKeyboard";
import { useTreeSelection } from "./useTreeSelection";

export function FileTree({
  items,
  expandedIds,
  connected = false,
  loadingPaths,
  selectedPath,
  onToggleDir,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  createRequest = null,
  onDeleteItem,
  onDeleteItems,
  onUndo,
  canUndo = false,
  onOpenRemoteFile,
  onRenameItem,
  onMoveItem,
  onCutItem,
  onCopyItem,
  onDuplicateItem,
  onPasteItem,
  canPaste = false,
  onUploadFiles,
  onRefresh,
  refreshing = false,
  revealPath = null,
  revealToken = 0,
  workspacePath,
  workspaceKind = "ssh",
  connectionId,
  onExpandAllFolders,
  onCollapseAllFolders,
  errorPaths,
  dirtyPaths,
}: FileTreeProps = {}) {
  const [pendingAgentReviewPaths, setPendingAgentReviewPaths] = useState(
    () =>
      new Set(
        getAllAgentEditReviews().map((review) =>
          normalizeAgentPath(review.path),
        ),
      ),
  );
  useEffect(() => {
    const sync = () =>
      setPendingAgentReviewPaths(
        new Set(
          getAllAgentEditReviews().map((review) =>
            normalizeAgentPath(review.path),
          ),
        ),
      );
    const unsubscribe = subscribeAgentEditReviews(sync);
    sync();
    return unsubscribe;
  }, []);
  const hasPendingAgentReview = (path: string, kind: FileTreeItem["kind"]) => {
    const normalized = normalizeAgentPath(path);
    if (kind !== "dir") return pendingAgentReviewPaths.has(normalized);
    return [...pendingAgentReviewPaths].some((reviewPath) =>
      workspaceIsPathOrDescendant(reviewPath, normalized),
    );
  };
  /** Collapse the whole workspace tree under the header. */
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);
  const [internalExpandedIds, setInternalExpandedIds] = useState<Set<string>>(
    () => new Set(initialExpanded),
  );
  const [searchRoot, setSearchRoot] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    setSearchRoot(null);
    setActionError("");
  }, [workspacePath, workspaceKind, connectionId]);
  const [contextMenu, setContextMenu] = useState<{
    item: FileTreeItem;
    x: number;
    y: number;
  } | null>(null);
  const contextMenuPlacement = useContextMenuPosition(contextMenu);
  const [actionPath, setActionPath] = useState<string | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  /** Multi-select paths (Cmd/Ctrl toggle, Shift range). */
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const selectionAnchorRef = useRef<string | null>(null);
  const lastRevealTokenRef = useRef(0);
  const lastCreateTokenRef = useRef(0);
  const [renamingItem, setRenamingItem] = useState<FileTreeItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const createCommittingRef = useRef(false);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  /** OS file drag hovering the tree (Finder → upload). */
  const [externalDragOver, setExternalDragOver] = useState(false);
  const dragSourceRef = useRef<FileTreeItem | null>(null);
  const externalDragDepthRef = useRef(0);
  const suppressClickAfterDragRef = useRef(false);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const treeRootRef = useRef<HTMLElement>(null);
  /** True after the user interacts with the tree until they click/focus outside it. */
  const treeInteractionActiveRef = useRef(false);
  const focusedPathRef = useRef<string | null>(null);
  const selectedPathsRef = useRef<Set<string>>(new Set());
  const [treeFadeEdges, setTreeFadeEdges] = useState({
    bottom: false,
    top: false,
  });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRafRef = useRef(0);
  const canDrag = Boolean(onMoveItem);
  const canUpload = Boolean(onUploadFiles && connected);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetDirRef = useRef<string | null>(null);
  const hasClipboardActions = Boolean(
    onCutItem || onCopyItem || onDuplicateItem || onPasteItem,
  );
  const canDelete = Boolean(onDeleteItem || onDeleteItems);
  const rootSelected = Boolean(workspacePath && focusedPath === workspacePath);

  const openUploadPicker = useCallback(
    (targetDirPath: string) => {
      if (!canUpload || !targetDirPath) return;
      uploadTargetDirRef.current = targetDirPath;
      uploadInputRef.current?.click();
    },
    [canUpload],
  );

  const handleUploadInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      const target = uploadTargetDirRef.current;
      event.target.value = "";
      if (!files?.length || !target || !onUploadFiles) return;
      setActionPath(target);
      void onUploadFiles(target, Array.from(files)).finally(() => {
        setActionPath(null);
        uploadTargetDirRef.current = null;
      });
    },
    [onUploadFiles],
  );

  useEffect(() => {
    focusedPathRef.current = focusedPath;
  }, [focusedPath]);

  useEffect(() => {
    selectedPathsRef.current = selectedPaths;
  }, [selectedPaths]);

  const isWorkspaceRootPath = useCallback(
    (path: string | null | undefined) =>
      Boolean(workspacePath && path && path === workspacePath),
    [workspacePath],
  );

  const isWorkspaceRootItem = useCallback(
    (item: FileTreeItem | null | undefined) =>
      Boolean(item && isWorkspaceRootPath(getTreeItemPath(item))),
    [isWorkspaceRootPath],
  );

  const isBackgroundTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    // Rows, buttons, inputs, menus — not the empty card surface.
    if (target.closest("[data-tree-path]")) return false;
    if (target.closest("button, input, textarea, select, [role='menuitem']"))
      return false;
    return true;
  }, []);

  // Track tree interaction + clear root-card selection when clicking anywhere else.
  useEffect(() => {
    const clearRootSelection = () => {
      if (!workspacePath) return;
      if (focusedPathRef.current !== workspacePath) return;
      setFocusedPath(null);
      if (selectionAnchorRef.current === workspacePath) {
        selectionAnchorRef.current = null;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const root = treeRootRef.current;
      const target = event.target;

      // Context menu is portaled outside the aside but still a tree action.
      if (target instanceof Element && target.closest('[role="menu"]')) {
        return;
      }

      if (root && target instanceof Node && root.contains(target)) {
        treeInteractionActiveRef.current = true;
        // Clicking a real row / toolbar / etc. is "somewhere else" than the
        // empty card surface → drop the blue root selection.
        // Only keep root selected when clicking the empty card area itself.
        if (target instanceof Element && !isBackgroundTarget(target)) {
          clearRootSelection();
        }
        return;
      }

      treeInteractionActiveRef.current = false;
      // Anywhere outside the explorer card deselects the root highlight.
      clearRootSelection();
      // Also drop multi-select when leaving the tree entirely.
      if (selectedPathsRef.current.size > 0) {
        setSelectedPaths(new Set());
        selectionAnchorRef.current = null;
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [workspacePath, isBackgroundTarget]);

  const updateTreeFadeEdges = useCallback(() => {
    const element = treeScrollRef.current;
    if (!element) return;

    const maxScrollTop = Math.max(
      0,
      element.scrollHeight - element.clientHeight,
    );
    const next = {
      bottom: maxScrollTop > 1 && element.scrollTop < maxScrollTop - 1,
      top: maxScrollTop > 1 && element.scrollTop > 1,
    };
    setTreeFadeEdges((current) =>
      current.bottom === next.bottom && current.top === next.top
        ? current
        : next,
    );
  }, []);

  const sourceItems = items ?? treeItems;
  const effectiveExpandedIds = expandedIds ?? internalExpandedIds;
  const visibleItems = useMemo(
    () => getVisibleTreeItems(sourceItems, effectiveExpandedIds),
    [sourceItems, effectiveExpandedIds],
  );
  /** Visible rows, plus an inline draft when creating a file or folder. */
  const displayItems = useMemo(() => {
    if (!createDraft) return visibleItems;
    const draftItem: FileTreeItem = {
      id: CREATE_DRAFT_ID,
      path: CREATE_DRAFT_ID,
      name: createDraft.name,
      kind: createDraft.kind === "folder" ? "dir" : "file",
      depth: createDraft.depth,
    };
    const parentIndex = visibleItems.findIndex(
      (item) => getTreeItemPath(item) === createDraft.parentPath,
    );
    // Workspace root is not a tree row — draft goes at the top of the list.
    if (parentIndex < 0) {
      return [draftItem, ...visibleItems];
    }
    // Insert as first child under the parent folder.
    return [
      ...visibleItems.slice(0, parentIndex + 1),
      draftItem,
      ...visibleItems.slice(parentIndex + 1),
    ];
  }, [visibleItems, createDraft]);
  const showTreeSkeleton =
    connected && sourceItems.length === 0 && (loadingPaths?.size ?? 0) > 0;
  const virtualize =
    !showTreeSkeleton && displayItems.length >= TREE_VIRTUALIZE_THRESHOLD;

  const scrollRowIntoView = useCallback(
    (path: string, behavior: ScrollBehavior = "auto") => {
      const scroller = treeScrollRef.current;
      if (!scroller) return;
      const index = displayItems.findIndex(
        (item) => getTreeItemPath(item) === path,
      );
      if (index < 0) return;
      const rowTop = TREE_SCROLL_PADDING + index * TREE_ROW_HEIGHT;
      const rowBottom = rowTop + TREE_ROW_HEIGHT;
      const viewTop = scroller.scrollTop;
      const viewBottom = viewTop + scroller.clientHeight;
      if (rowTop < viewTop) {
        scroller.scrollTo({
          top: Math.max(0, rowTop - TREE_SCROLL_PADDING),
          behavior,
        });
      } else if (rowBottom > viewBottom) {
        scroller.scrollTo({
          top: Math.max(
            0,
            rowBottom - scroller.clientHeight + TREE_SCROLL_PADDING,
          ),
          behavior,
        });
      }
    },
    [displayItems],
  );

  const virtualRange = useMemo(() => {
    const count = displayItems.length;
    if (!virtualize || count === 0) {
      return {
        start: 0,
        end: count,
        offsetY: 0,
        totalHeight: count * TREE_ROW_HEIGHT,
      };
    }
    const totalHeight = count * TREE_ROW_HEIGHT;
    const viewH = Math.max(viewportHeight, TREE_ROW_HEIGHT);
    const start = Math.max(
      0,
      Math.floor(scrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN,
    );
    const end = Math.min(
      count,
      start + Math.ceil(viewH / TREE_ROW_HEIGHT) + TREE_OVERSCAN * 2,
    );
    return {
      start,
      end,
      offsetY: start * TREE_ROW_HEIGHT,
      totalHeight,
    };
  }, [virtualize, displayItems.length, scrollTop, viewportHeight]);

  const renderedItems = useMemo(() => {
    if (!virtualize) return displayItems;
    return displayItems.slice(virtualRange.start, virtualRange.end);
  }, [virtualize, displayItems, virtualRange.start, virtualRange.end]);

  const handleTreeScroll = useCallback(() => {
    const element = treeScrollRef.current;
    if (!element) return;
    updateTreeFadeEdges();
    if (!virtualize) return;
    if (scrollRafRef.current) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const node = treeScrollRef.current;
      if (!node) return;
      setScrollTop(node.scrollTop);
    });
  }, [updateTreeFadeEdges, virtualize]);

  // Track viewport size for the window calculator.
  useLayoutEffect(() => {
    const element = treeScrollRef.current;
    if (!element || !workspaceExpanded) return;

    const measure = () => {
      setViewportHeight(element.clientHeight);
      setScrollTop(element.scrollTop);
      updateTreeFadeEdges();
    };
    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
    };
  }, [workspaceExpanded, showTreeSkeleton, updateTreeFadeEdges]);

  const findItemByPath = useCallback(
    (path: string | null | undefined) => {
      if (!path) return null;
      if (workspacePath && path === workspacePath) {
        return makeWorkspaceRootItem(workspacePath);
      }
      return (
        sourceItems.find((candidate) => getTreeItemPath(candidate) === path) ??
        null
      );
    },
    [sourceItems, workspacePath],
  );

  /** Parent directory for a new file/folder (context row → focused → open file → workspace). */
  const resolveCreateParent = useCallback(
    (contextItem?: FileTreeItem | null): string | null => {
      if (!workspacePath) return null;

      const fromItem = (item: FileTreeItem) => {
        const path = getTreeItemPath(item);
        if (item.kind === "dir") return path;
        return getParentPath(path) || workspacePath;
      };

      if (contextItem) return fromItem(contextItem);

      const focused = findItemByPath(focusedPathRef.current);
      if (focused) return fromItem(focused);

      if (selectedPathsRef.current.size === 1) {
        const only = findItemByPath([...selectedPathsRef.current][0]);
        if (only) return fromItem(only);
      }

      if (selectedPath) {
        const known = findItemByPath(selectedPath);
        if (known) return fromItem(known);
        return getParentPath(selectedPath) || workspacePath;
      }

      return workspacePath;
    },
    [findItemByPath, selectedPath, workspacePath],
  );

  const parentDepth = useCallback(
    (parentPath: string) => {
      if (workspacePath && parentPath === workspacePath) return -1;
      const parent = findItemByPath(parentPath);
      if (parent) return parent.depth;
      // Fallback: count segments under workspace.
      if (!workspacePath) return 0;
      const root = workspacePath.replace(/\/+$/, "") || "/";
      const rootParts = root === "/" ? [] : root.split("/").filter(Boolean);
      const itemParts = parentPath
        .replace(/\/+$/, "")
        .split("/")
        .filter(Boolean);
      return Math.max(0, itemParts.length - rootParts.length - 1);
    },
    [findItemByPath, workspacePath],
  );

  const cancelCreate = useCallback(() => {
    if (createCommittingRef.current) return;
    setCreateDraft(null);
  }, []);

  const beginCreate = useCallback(
    (kind: "file" | "folder", contextItem?: FileTreeItem | null) => {
      if (!connected || !workspacePath) return;
      if (kind === "file" && !onCreateFile) return;
      if (kind === "folder" && !onCreateFolder) return;

      const parentPath = resolveCreateParent(contextItem);
      if (!parentPath) return;

      // Cancel rename while creating.
      setRenamingItem(null);
      setRenameValue("");
      setContextMenu(null);
      setWorkspaceExpanded(true);
      createCommittingRef.current = false;

      // Expand parent so the draft row is visible under it.
      if (parentPath !== workspacePath) {
        const parentItem = findItemByPath(parentPath);
        if (
          parentItem?.kind === "dir" &&
          !effectiveExpandedIds.has(parentPath)
        ) {
          onToggleDir?.(parentItem);
        } else if (!expandedIds) {
          setInternalExpandedIds((current) => {
            if (current.has(parentPath)) return current;
            const next = new Set(current);
            next.add(parentPath);
            return next;
          });
        }
      } else if (!expandedIds) {
        // Controlled expand is owned by workspace — still try toggle if we have a root item.
      }

      // Ensure workspace root stays expanded when controlled via expandedIds:
      // parent dirs must be in expandedIds for children to show. Workspace already expands on load.
      if (
        expandedIds &&
        parentPath !== workspacePath &&
        !expandedIds.has(parentPath)
      ) {
        const parentItem = findItemByPath(parentPath);
        if (parentItem) onToggleDir?.(parentItem);
      }

      const depth = parentDepth(parentPath) + 1;
      setCreateDraft({
        kind,
        parentPath,
        depth: Math.max(0, depth),
        name: "",
      });
      setFocusedPath(parentPath);
      treeInteractionActiveRef.current = true;

      // Scroll parent into view; draft inserts just after it.
      requestAnimationFrame(() => {
        scrollRowIntoView(parentPath, "auto");
        // Also try scrolling to the draft id once painted.
        requestAnimationFrame(() => {
          const scroller = treeScrollRef.current;
          const row = scroller?.querySelector<HTMLElement>(
            `[data-tree-path="${CSS.escape(CREATE_DRAFT_ID)}"]`,
          );
          row?.scrollIntoView({ block: "nearest" });
          const input = row?.querySelector("input");
          input?.focus({ preventScroll: true });
        });
      });
    },
    [
      connected,
      workspacePath,
      onCreateFile,
      onCreateFolder,
      resolveCreateParent,
      findItemByPath,
      effectiveExpandedIds,
      expandedIds,
      onToggleDir,
      parentDepth,
      scrollRowIntoView,
    ],
  );

  const commitCreate = useCallback(async () => {
    const draft = createDraft;
    if (!draft || createCommittingRef.current) return;

    const name = draft.name.trim();
    if (!name) {
      cancelCreate();
      return;
    }

    createCommittingRef.current = true;
    setActionPath(draft.parentPath);
    try {
      const ok =
        draft.kind === "file"
          ? await onCreateFile?.(draft.parentPath, name)
          : await onCreateFolder?.(draft.parentPath, name);
      if (ok) {
        setCreateDraft(null);
      }
    } finally {
      createCommittingRef.current = false;
      setActionPath(null);
    }
  }, [createDraft, cancelCreate, onCreateFile, onCreateFolder]);

  // App menu / keyboard shortcuts → start inline create.
  useEffect(() => {
    if (
      !createRequest?.token ||
      createRequest.token === lastCreateTokenRef.current
    )
      return;
    lastCreateTokenRef.current = createRequest.token;
    beginCreate(createRequest.kind);
  }, [createRequest, beginCreate]);

  /** Click empty area of the explorer card → select workspace root. */
  const selectWorkspaceRoot = useCallback(() => {
    if (!workspacePath) return;
    setSelectedPaths(new Set());
    selectionAnchorRef.current = workspacePath;
    setFocusedPath(workspacePath);
    treeInteractionActiveRef.current = true;
    treeScrollRef.current?.focus({ preventScroll: true });
  }, [workspacePath]);

  // Drop selection entries that no longer exist in the tree (after delete/move/refresh).
  useEffect(() => {
    setSelectedPaths((current) => {
      if (current.size === 0) return current;
      const known = new Set(sourceItems.map(getTreeItemPath));
      let changed = false;
      const next = new Set<string>();
      for (const path of current) {
        if (known.has(path)) next.add(path);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [sourceItems]);

  const {
    clearMultiSelection,
    selectOnlyPath,
    resolveSelectedItems,
    selectVisibleRange,
    togglePathInSelection,
  } = useTreeSelection({
    setSelectedPaths,
    selectionAnchorRef,
    setFocusedPath,
    focusedPath,
    visibleItems,
    selectedPaths,
    sourceItems,
  });
  const runCopy = useCallback(
    (item: FileTreeItem) => {
      setContextMenu(null);
      setFocusedPath(getTreeItemPath(item));
      onCopyItem?.(item);
    },
    [onCopyItem],
  );

  const runCut = useCallback(
    (item: FileTreeItem) => {
      setContextMenu(null);
      setFocusedPath(getTreeItemPath(item));
      onCutItem?.(item);
    },
    [onCutItem],
  );
  const runAction = async (callback: () => unknown | Promise<unknown>) => {
    setContextMenu(null);
    setActionError("");
    try {
      await callback();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };
  const openTerminalAt = async (item: FileTreeItem) => {
    const cwd =
      item.kind === "dir"
        ? getTreeItemPath(item)
        : getParentWorkspacePath(getTreeItemPath(item));
    if (!cwd || !workspacePath) return;
    const result = await api.createTerminal({
      cwd,
      workspaceKind,
      connectionId: workspaceKind === "local" ? null : connectionId,
      sessionId: `tree-${crypto.randomUUID()}`,
      cols: 80,
      rows: 24,
    });
    window.dispatchEvent(
      new CustomEvent("coloride:agent-terminal", {
        detail: {
          ...result,
          title: workspaceBasename(cwd),
          cwd,
          workspaceKind,
          connectionId: workspaceKind === "local" ? null : connectionId,
          agentSessionId: null,
          workspacePath,
        },
      }),
    );
  };

  const runDuplicate = useCallback(
    async (item: FileTreeItem) => {
      setContextMenu(null);
      setFocusedPath(getTreeItemPath(item));
      setActionPath(getTreeItemPath(item));
      try {
        await onDuplicateItem?.(item);
      } finally {
        setActionPath(null);
      }
    },
    [onDuplicateItem],
  );

  const runPaste = useCallback(
    async (contextItem?: FileTreeItem) => {
      // Always attempt paste when a handler exists — OS clipboard images (Figma etc.)
      // don't set the internal tree clipboard, so `canPaste` alone is not enough.
      if (!onPasteItem) return;
      setContextMenu(null);
      // Loading spinner belongs on the destination *folder*, never the selected file.
      // File selected → parent folder; folder selected → that folder; root → no row spinner.
      let marker: string | null = null;
      if (contextItem) {
        const path = getTreeItemPath(contextItem);
        if (isWorkspaceRootPath(path)) {
          marker = null;
        } else if (contextItem.kind === "dir") {
          marker = path;
        } else {
          marker = getParentPath(path);
          if (workspacePath && marker === workspacePath) marker = null;
        }
      }
      setActionPath(marker);
      try {
        // Root card item has kind "dir" + workspace path → paste into workspace root.
        await onPasteItem(contextItem);
      } finally {
        setActionPath(null);
      }
    },
    [onPasteItem, isWorkspaceRootPath, workspacePath],
  );

  const deleteItems = useCallback(
    async (items: FileTreeItem[]) => {
      if (!canDelete || items.length === 0) return;
      setContextMenu(null);
      const marker = getTreeItemPath(items[0]!);
      // Snapshot neighbor before the tree mutates so selection stays in-folder.
      const nextPath = pickNextSelectionAfterDelete(
        visibleItems,
        items,
        workspacePath,
      );
      setActionPath(marker);
      try {
        let ok = false;
        if (items.length > 1 && onDeleteItems) {
          ok = Boolean(await onDeleteItems(items));
        } else if (items.length > 1 && onDeleteItem) {
          // Fallback: sequential single deletes (each may confirm).
          ok = true;
          for (const item of items) {
            const deleted = await onDeleteItem(item);
            if (!deleted) {
              ok = false;
              break;
            }
          }
        } else if (onDeleteItem) {
          ok = Boolean(await onDeleteItem(items[0]!));
        } else if (onDeleteItems) {
          ok = Boolean(await onDeleteItems(items));
        }
        if (ok) {
          clearMultiSelection();
          if (nextPath) {
            selectOnlyPath(nextPath);
            treeInteractionActiveRef.current = true;
            scrollRowIntoView(nextPath, "auto");
            requestAnimationFrame(() => {
              const row = treeScrollRef.current?.querySelector<HTMLElement>(
                `[data-tree-path="${CSS.escape(nextPath)}"]`,
              );
              row?.focus({ preventScroll: true });
            });
          } else {
            setFocusedPath(null);
            selectionAnchorRef.current = null;
          }
        }
      } finally {
        setActionPath(null);
      }
    },
    [
      canDelete,
      onDeleteItem,
      onDeleteItems,
      clearMultiSelection,
      visibleItems,
      workspacePath,
      selectOnlyPath,
      scrollRowIntoView,
    ],
  );

  const beginRename = useCallback(
    (item: FileTreeItem) => {
      setContextMenu(null);
      setCreateDraft(null);
      createCommittingRef.current = false;
      const path = item.path ?? item.id;
      setFocusedPath(path);
      // Ensure the row is in the virtual window before mounting the rename input.
      scrollRowIntoView(path, "auto");
      setRenamingItem(item);
      setRenameValue(item.name);
    },
    [scrollRowIntoView],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const frame = requestAnimationFrame(() =>
      contextMenuPlacement.ref.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true }),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  // Reveal-in-tree: select the revealed row (e.g. just-pasted file), scroll, focus.
  useLayoutEffect(() => {
    if (
      !revealPath ||
      !revealToken ||
      revealToken === lastRevealTokenRef.current
    )
      return;
    setWorkspaceExpanded(true);

    const index = visibleItems.findIndex(
      (item) => getTreeItemPath(item) === revealPath,
    );
    if (index < 0) return;

    lastRevealTokenRef.current = revealToken;
    // Drop previous multi/single selection — highlight only what was revealed (paste target).
    selectOnlyPath(revealPath);
    treeInteractionActiveRef.current = true;
    scrollRowIntoView(revealPath, "smooth");

    const scroller = treeScrollRef.current;
    if (!scroller) return;

    // Focus after the virtual window paints the target row.
    let attempts = 0;
    let raf = 0;
    const tryFocus = () => {
      attempts += 1;
      const row = scroller.querySelector<HTMLElement>(
        `[data-tree-path="${CSS.escape(revealPath)}"]`,
      );
      if (row) {
        row.focus({ preventScroll: true });
        return;
      }
      if (attempts < 16) raf = window.requestAnimationFrame(tryFocus);
    };
    raf = window.requestAnimationFrame(tryFocus);
    return () => window.cancelAnimationFrame(raf);
  }, [
    revealPath,
    revealToken,
    visibleItems,
    scrollRowIntoView,
    selectOnlyPath,
  ]);

  const openContextMenu = (
    event: React.MouseEvent<HTMLElement>,
    item: FileTreeItem,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const path = item.path ?? item.id;
    setFocusedPath(path);
    // Right-click on an unselected row → select only that row.
    // Right-click inside multi-select keeps the selection for bulk actions.
    if (!selectedPaths.has(path)) {
      selectOnlyPath(path);
    }
    setContextMenu({
      item,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const collapseAllFolders = () => {
    if (!workspacePath) return;
    if (onCollapseAllFolders) {
      onCollapseAllFolders();
    } else if (!expandedIds) {
      setInternalExpandedIds(new Set());
    }
    treeInteractionActiveRef.current = true;
  };

  const openRootContextMenu = (
    event: React.MouseEvent<HTMLElement>,
    options?: { fromHeader?: boolean },
  ) => {
    if (!workspacePath) return;
    if (!options?.fromHeader && !isBackgroundTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    selectWorkspaceRoot();
    setContextMenu({
      item: makeWorkspaceRootItem(workspacePath),
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleBackgroundPointerDown = (
    event: React.MouseEvent<HTMLElement>,
  ) => {
    if (!workspacePath) return;
    if (!isBackgroundTarget(event.target)) return;
    // Only plain left-click selects the card/root (right-click opens menu).
    if (event.button !== 0) return;
    selectWorkspaceRoot();
  };

  const cancelRename = () => {
    if (actionPath) return;
    setRenamingItem(null);
    setRenameValue("");
  };

  const commitRename = async () => {
    const item = renamingItem;
    if (!item || actionPath) return;
    const name = renameValue.trim();
    if (name === item.name) {
      cancelRename();
      return;
    }
    setActionPath(item.path ?? item.id);
    try {
      const renamed = await onRenameItem?.(item, name);
      if (renamed) {
        setRenamingItem(null);
        setRenameValue("");
      }
    } finally {
      setActionPath(null);
    }
  };

  const handleRowActivate = (event: React.MouseEvent, item: FileTreeItem) => {
    if (suppressClickAfterDragRef.current) return;
    const path = getTreeItemPath(item);

    if (event.shiftKey) {
      event.preventDefault();
      selectVisibleRange(path);
      return;
    }

    if (modKey(event)) {
      event.preventDefault();
      togglePathInSelection(path);
      return;
    }

    // Plain click: single-select + open/toggle.
    selectOnlyPath(path);
    if (item.kind === "dir") {
      toggleExpanded(item);
    } else {
      selectFile(item);
    }
  };

  const copyPath = async (item: FileTreeItem, relative: boolean) => {
    setContextMenu(null);
    const path = item.path ?? item.id;
    const root = workspacePath?.replace(/\/+$/, "") ?? "";
    const value =
      relative && root && path.startsWith(`${root}/`)
        ? path.slice(root.length + 1)
        : relative && path === root
          ? "."
          : path;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
  };

  const toggleExpanded = (item: FileTreeItem) => {
    if (onToggleDir) {
      onToggleDir(item);
      return;
    }

    setInternalExpandedIds((current) => {
      const next = new Set(current);
      const id = item.path ?? item.id;

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const selectFile = (item: FileTreeItem) => {
    if (item.kind !== "dir") {
      onSelectFile?.(item);
    }
  };

  const {
    handleRootDragEnter,
    handleRootDragLeave,
    handleRootDragOver,
    handleRootDrop,
    handleDragEnd,
    handleRowDragOver,
    handleDragStart,
    handleRowDrop,
  } = useTreeDragAndDrop({
    dragSourceRef,
    setDraggingPath,
    setDropTargetPath,
    setExternalDragOver,
    externalDragDepthRef,
    draggingPath,
    connected,
    onUploadFiles,
    setActionPath,
    workspacePath,
    dropTargetPath,
    canDrag,
    renamingItem,
    actionPath,
    suppressClickAfterDragRef,
    setContextMenu,
    onMoveItem,
    sourceItems,
    canUpload,
  });
  useTreeKeyboard({
    workspaceExpanded,
    renamingItem,
    createDraft,
    treeRootRef,
    treeInteractionActiveRef,
    focusedPathRef,
    selectedPathsRef,
    findItemByPath,
    selectedPath,
    workspacePath,
    copyPath,
    setWorkspaceExpanded,
    runAction,
    onExpandAllFolders,
    collapseAllFolders,
    canDelete,
    isWorkspaceRootItem,
    resolveSelectedItems,
    deleteItems,
    onRenameItem,
    beginRename,
    clearMultiSelection,
    setFocusedPath,
    selectionAnchorRef,
    onUndo,
    canUndo,
    hasClipboardActions,
    visibleItems,
    setSelectedPaths,
    onCopyItem,
    runCopy,
    onCutItem,
    runCut,
    onDuplicateItem,
    runDuplicate,
    onPasteItem,
    runPaste,
    canPaste,
  });
  const rootDropActive =
    Boolean(workspacePath && dropTargetPath === workspacePath) &&
    (Boolean(draggingPath) || externalDragOver);
  const workspaceHasError = Boolean(
    workspacePath && treePathHasError(workspacePath, "dir", errorPaths),
  );
  const folderDropActive =
    externalDragOver &&
    Boolean(dropTargetPath) &&
    Boolean(workspacePath) &&
    dropTargetPath !== workspacePath;

  return (
    <>
      <input
        accept="*/*"
        className="hidden"
        multiple
        onChange={handleUploadInputChange}
        ref={uploadInputRef}
        type="file"
      />
      <aside
        className="app-side-surface filetree-surface flex h-full min-h-0 flex-col overflow-hidden bg-[#212121]"
        ref={treeRootRef}
      >
        {actionError ? (
          <p role="alert" className="px-2 py-1 text-xs text-red-400">
            {actionError}
          </p>
        ) : null}
        {searchRoot ? (
          <SearchPanel
            connected={connected}
            onClose={() => setSearchRoot(null)}
            onOpenFile={onOpenRemoteFile}
            rootPath={searchRoot}
          />
        ) : (
          <>
            <div
              className={`filetree-body relative flex min-h-0 flex-1 flex-col ${rootDropActive ? "filetree-root-drop-active" : ""
                } ${rootSelected && !rootDropActive && !folderDropActive ? "filetree-root-selected" : ""}`}
            >
              <div className="filetree-workspace-row relative mx-1 mt-1 flex h-[22px] shrink-0 items-center">
                <button
                  type="button"
                  className={`filetree-workspace-toggle flex h-[22px] min-w-0 flex-1 items-center overflow-hidden rounded-[2px] border-0 bg-transparent py-0 pr-2 text-left font-normal outline-none ${workspacePath
                      ? workspaceHasError
                        ? "cursor-pointer text-[#f87171]"
                        : "cursor-pointer text-[#f0f4f8]"
                      : "cursor-default text-[#6b6b72]"
                    }`}
                  style={{ paddingLeft: 8 }}
                  aria-expanded={workspaceExpanded}
                  aria-label={
                    workspacePath
                      ? workspaceExpanded
                        ? "Collapse workspace tree"
                        : "Expand workspace tree"
                      : "No workspace"
                  }
                  disabled={!workspacePath}
                  onClick={() => {
                    if (!workspacePath) return;
                    setWorkspaceExpanded((open) => !open);
                    setFocusedPath(workspacePath);
                    treeInteractionActiveRef.current = true;
                  }}
                  onContextMenu={(event) => {
                    if (!workspacePath) return;
                    setFocusedPath(workspacePath);
                    openRootContextMenu(event, { fromHeader: true });
                  }}
                  title={workspacePath || "No workspace open"}
                >
                  <ChevronIcon
                    className={`mr-1 size-3.5 shrink-0 transform-gpu text-[#878888]/50 transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] ${workspaceExpanded ? "" : "-rotate-90"
                      }`}
                  />
                  {workspaceExpanded && workspacePath ? (
                    <FolderOpenIcon
                      className={`size-3.5 shrink-0 ${workspaceHasError ? "text-[#f87171]" : "filetree-folder-color"}`}
                    />
                  ) : (
                    <FolderClosedIcon
                      className={`size-3.5 shrink-0 ${workspaceHasError ? "text-[#f87171]" : "filetree-folder-color"}`}
                    />
                  )}
                  <OverflowFadeText
                    className={`ml-2 ${workspaceHasError ? "text-[#f87171]" : ""}`}
                  >
                    {workspacePath
                      ? workspacePath
                        .replace(/\/+$/, "")
                        .split("/")
                        .filter(Boolean)
                        .at(-1) || workspacePath
                      : "No workspace"}
                  </OverflowFadeText>
                  {workspacePath &&
                    hasPendingAgentReview(workspacePath, "dir") ? (
                    <span
                      aria-label="Agent changes pending review"
                      className="filetree-agent-review-dot ml-auto mr-2 shrink-0"
                      title="Contains agent changes pending review — Keep or Undo"
                    />
                  ) : null}
                </button>
              </div>
              {workspaceExpanded ? (
                <div
                  className="filetree-tree-pane relative min-h-0 flex-1"
                  onDragEnter={handleRootDragEnter}
                  onDragLeave={handleRootDragLeave}
                  onDragOver={handleRootDragOver}
                  onDrop={handleRootDrop}
                >
                  <div
                    className="filetree-scroll h-full min-h-0 overflow-y-auto px-1 pb-1 pt-0 text-[13px] outline-none"
                    onClick={handleBackgroundPointerDown}
                    onContextMenu={openRootContextMenu}
                    onDragEnter={handleRootDragEnter}
                    onDragLeave={handleRootDragLeave}
                    onDragOver={handleRootDragOver}
                    onDrop={handleRootDrop}
                    onScroll={handleTreeScroll}
                    ref={treeScrollRef}
                    tabIndex={0}
                    aria-label={
                      workspacePath ? "Workspace file tree" : "File tree"
                    }
                  >
                    {showTreeSkeleton ? (
                      <FileTreeSkeleton />
                    ) : (
                      <div
                        className="relative w-full min-h-full"
                        role="tree"
                        style={
                          virtualize
                            ? {
                              height: Math.max(
                                virtualRange.totalHeight,
                                viewportHeight || 0,
                              ),
                            }
                            : undefined
                        }
                      >
                        <div
                          className="w-full"
                          style={
                            virtualize
                              ? {
                                transform: `translateY(${virtualRange.offsetY}px)`,
                              }
                              : undefined
                          }
                        >
                          {renderedItems.map((item, localIndex) => {
                            const itemPath = item.path ?? item.id;
                            const rowIndex = virtualize
                              ? virtualRange.start + localIndex
                              : localIndex;
                            // Only the destination folder row gets the blue bg (not the whole card).
                            const isDropTarget = Boolean(
                              dropTargetPath &&
                              item.kind === "dir" &&
                              itemPath === dropTargetPath &&
                              dropTargetPath !== workspacePath,
                            );
                            const isMultiSelected = selectedPaths.has(itemPath);
                            // Tree focus/selection wins over the open editor tab. Otherwise clicking a
                            // folder after a file keeps both rows highlighted (selectedPath + focusedPath).
                            const treeOwnsSelection =
                              rootSelected ||
                              Boolean(focusedPath) ||
                              selectedPaths.size > 0;
                            const isCreateDraft = item.id === CREATE_DRAFT_ID;
                            const isActiveRow =
                              isCreateDraft ||
                              isMultiSelected ||
                              focusedPath === itemPath ||
                              (!treeOwnsSelection &&
                                selectedPath === itemPath) ||
                              Boolean(item.active);
                            return (
                              <TreeRow
                                active={isActiveRow}
                                pendingAgentReview={
                                  !isCreateDraft &&
                                  hasPendingAgentReview(itemPath, item.kind)
                                }
                                dirty={
                                  !isCreateDraft &&
                                  item.kind !== "dir" &&
                                  Boolean(dirtyPaths?.has(itemPath))
                                }
                                hasError={
                                  !isCreateDraft &&
                                  treePathHasError(
                                    itemPath,
                                    item.kind,
                                    errorPaths,
                                  )
                                }
                                multiSelected={
                                  isMultiSelected && !isCreateDraft
                                }
                                dragging={
                                  !isCreateDraft && draggingPath === itemPath
                                }
                                dropTarget={!isCreateDraft && isDropTarget}
                                editing={
                                  isCreateDraft || renamingItem?.id === item.id
                                }
                                expanded={
                                  !isCreateDraft &&
                                  effectiveExpandedIds.has(itemPath)
                                }
                                // Skip enter animation while windowing — remounts on scroll would flash.
                                animateEnter={!virtualize && !isCreateDraft}
                                item={item}
                                key={item.id}
                                loading={
                                  !isCreateDraft &&
                                  ((loadingPaths?.has(itemPath) ?? false) ||
                                    actionPath === itemPath)
                                }
                                onCancelRename={
                                  isCreateDraft ? cancelCreate : cancelRename
                                }
                                onCommitRename={() => {
                                  if (isCreateDraft) void commitCreate();
                                  else void commitRename();
                                }}
                                onDragEnd={
                                  isCreateDraft ? undefined : handleDragEnd
                                }
                                onDragOver={
                                  isCreateDraft
                                    ? undefined
                                    : (event) => handleRowDragOver(event, item)
                                }
                                onDragStart={
                                  isCreateDraft || !canDrag
                                    ? undefined
                                    : (event) => handleDragStart(event, item)
                                }
                                onDrop={
                                  isCreateDraft
                                    ? undefined
                                    : (event) => handleRowDrop(event, item)
                                }
                                onFocus={() => {
                                  if (!isCreateDraft) setFocusedPath(itemPath);
                                }}
                                onOpenMenu={
                                  isCreateDraft
                                    ? undefined
                                    : (event) => openContextMenu(event, item)
                                }
                                onRenameChange={(value) => {
                                  if (isCreateDraft) {
                                    setCreateDraft((current) =>
                                      current
                                        ? { ...current, name: value }
                                        : current,
                                    );
                                  } else {
                                    setRenameValue(value);
                                  }
                                }}
                                onStartRename={
                                  isCreateDraft || !onRenameItem
                                    ? undefined
                                    : () => beginRename(item)
                                }
                                onActivate={
                                  isCreateDraft
                                    ? undefined
                                    : (event) => handleRowActivate(event, item)
                                }
                                renameValue={
                                  isCreateDraft
                                    ? (createDraft?.name ?? "")
                                    : renameValue
                                }
                                rowIndex={rowIndex}
                                createPlaceholder={
                                  isCreateDraft
                                    ? createDraft?.kind === "folder"
                                      ? "New folder"
                                      : "New file"
                                    : undefined
                                }
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <VerticalScrollHairline
                    targetRef={treeScrollRef}
                    label="File tree scroll"
                  />
                  <span
                    aria-hidden="true"
                    data-edge="top"
                    className={`scroll-edge-fade filetree-edge-fade pointer-events-none absolute left-0 right-2.5 top-0 z-20 h-5 transition-opacity duration-150 ${treeFadeEdges.top ? "opacity-100" : "opacity-0"}`}
                  />
                  <span
                    aria-hidden="true"
                    data-edge="bottom"
                    className={`scroll-edge-fade filetree-edge-fade pointer-events-none absolute bottom-0 left-0 right-2.5 z-20 h-5 transition-opacity duration-150 ${treeFadeEdges.bottom ? "opacity-100" : "opacity-0"}`}
                  />
                </div>
              ) : (
                <div
                  className="filetree-tree-pane relative min-h-0 flex-1"
                  onContextMenu={openRootContextMenu}
                  onDragEnter={handleRootDragEnter}
                  onDragLeave={handleRootDragLeave}
                  onDragOver={handleRootDragOver}
                  onDrop={handleRootDrop}
                />
              )}
            </div>
          </>
        )}
      </aside>
      {contextMenu &&
        (() => {
          const menuItem = contextMenu.item;
          const menuIsRoot = isWorkspaceRootItem(menuItem);
          return createPortal(
            <Menu
              aria-label="File actions"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setContextMenu(null);
                  return;
                }
                if (
                  !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ),
                );
                const index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
                buttons[next]?.focus();
              }}
              ref={contextMenuPlacement.ref}
              onPointerDown={(event) => event.stopPropagation()}
              style={contextMenuPlacement.style}
              variant="context"
            >
              {onCreateFile && (
                <TreeMenuItem
                  label="New File"
                  onClick={() => {
                    setContextMenu(null);
                    beginCreate("file", menuItem);
                  }}
                />
              )}
              {onCreateFolder && (
                <TreeMenuItem
                  label="New Folder"
                  onClick={() => {
                    setContextMenu(null);
                    beginCreate("folder", menuItem);
                  }}
                />
              )}
              <TreeMenuDivider />
              {workspaceKind === "local" ? (
                <>
                  <TreeMenuItem
                    label={
                      /Mac/.test(navigator.platform)
                        ? "Reveal in Finder"
                        : "Reveal in File Manager"
                    }
                    disabled={!window.colorideDesktop?.localPathAction}
                    onClick={() =>
                      void runAction(() =>
                        window.colorideDesktop!.localPathAction!({
                          action: "reveal",
                          path: getTreeItemPath(menuItem),
                        }),
                      )
                    }
                  />
                  <TreeMenuItem
                    label="Open in Default App"
                    disabled={!window.colorideDesktop?.localPathAction}
                    onClick={() =>
                      void runAction(() =>
                        window.colorideDesktop!.localPathAction!({
                          action: "open",
                          path: getTreeItemPath(menuItem),
                        }),
                      )
                    }
                  />
                </>
              ) : null}
              {!menuIsRoot && menuItem.kind !== "dir" ? (
                <TreeMenuItem
                  label="Open"
                  disabled={!onSelectFile}
                  onClick={() => {
                    setContextMenu(null);
                    onSelectFile?.(menuItem);
                  }}
                />
              ) : null}
              <TreeMenuItem
                label="Open in Terminal"
                disabled={!connected}
                onClick={() => void runAction(() => openTerminalAt(menuItem))}
              />
              <TreeMenuDivider />
              <TreeMenuItem
                label="Find in Folder…"
                disabled={!connected}
                onClick={() => {
                  setContextMenu(null);
                  setSearchRoot(
                    menuItem.kind === "dir"
                      ? getTreeItemPath(menuItem)
                      : getParentWorkspacePath(getTreeItemPath(menuItem)),
                  );
                }}
              />
              {canUpload && (
                <TreeMenuItem
                  label="Upload Files…"
                  onClick={() => {
                    setContextMenu(null);
                    const dest = externalDropDestination(
                      menuItem,
                      workspacePath,
                    );
                    if (dest) openUploadPicker(dest);
                  }}
                />
              )}
              {(onCreateFile || onCreateFolder || onRefresh || canUpload) && (
                <TreeMenuDivider />
              )}
              {onCutItem && !menuIsRoot ? (
                <TreeMenuItem
                  label="Cut"
                  shortcut="⌘X"
                  disabled={selectedPaths.size > 1}
                  onClick={() => runCut(menuItem)}
                />
              ) : null}
              {onCopyItem && !menuIsRoot && (
                <TreeMenuItem
                  label="Copy"
                  onClick={() => runCopy(menuItem)}
                  shortcut="⌘C"
                />
              )}
              {onPasteItem && (
                <TreeMenuItem
                  // Keep enabled: paste may use OS clipboard (Figma/screenshot) even
                  // when nothing was copied inside the tree.
                  disabled={false}
                  label="Paste"
                  onClick={() => void runPaste(menuItem)}
                  shortcut="⌘V"
                />
              )}
              {onDuplicateItem && !menuIsRoot && (
                <TreeMenuItem
                  label="Duplicate"
                  onClick={() => void runDuplicate(menuItem)}
                  shortcut="⌘D"
                />
              )}
              {onUndo ? (
                <TreeMenuItem
                  label="Undo"
                  shortcut="⌘Z"
                  disabled={!canUndo}
                  onClick={() => void runAction(onUndo)}
                />
              ) : null}
              {(onCopyItem || onPasteItem || onDuplicateItem) && (
                <TreeMenuDivider />
              )}
              <TreeMenuItem
                label="Copy Path"
                shortcut="⌥⌘C"
                onClick={() => void copyPath(menuItem, false)}
              />
              <TreeMenuItem
                label="Copy Relative Path"
                shortcut="⌥⇧⌘C"
                onClick={() => void copyPath(menuItem, true)}
              />
              {!menuIsRoot && <TreeMenuDivider />}
              {onRenameItem && !menuIsRoot && selectedPaths.size <= 1 && (
                <TreeMenuItem
                  label="Rename"
                  onClick={() => beginRename(menuItem)}
                  shortcut="F2"
                />
              )}
              {canDelete &&
                !menuIsRoot &&
                (() => {
                  const bulk = resolveSelectedItems(menuItem).filter(
                    (item) => !isWorkspaceRootItem(item),
                  );
                  const count = bulk.length;
                  const label = count > 1 ? `Delete ${count} Items` : "Delete";
                  return (
                    <TreeMenuItem
                      danger
                      label={label}
                      onClick={() =>
                        void deleteItems(count > 0 ? bulk : [menuItem])
                      }
                      shortcut="⌫"
                    />
                  );
                })()}
              <TreeMenuDivider />
              {onRefresh ? (
                <TreeMenuItem
                  label="Refresh"
                  disabled={refreshing || !connected}
                  onClick={() => {
                    setContextMenu(null);
                    onRefresh();
                  }}
                />
              ) : null}
              <TreeMenuItem
                label="Expand All"
                shortcut="⌘→"
                disabled={!connected || !onExpandAllFolders}
                onClick={() => {
                  setWorkspaceExpanded(true);
                  void runAction(() => onExpandAllFolders?.());
                }}
              />
              <TreeMenuItem
                label="Collapse All"
                shortcut="⌘←"
                disabled={!workspacePath || !workspaceExpanded}
                onClick={() => {
                  setContextMenu(null);
                  collapseAllFolders();
                }}
              />
            </Menu>,
            document.body,
          );
        })()}
    </>
  );
}
