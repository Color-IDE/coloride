import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { api, hydrateRuntimeFromDesktop } from "../../../shared/api/client";
import type { Profile } from "../../../shared/api/types";
import {
  isAbsoluteWorkspacePath,
  trimTrailingSeparators,
  workspacePathParts,
} from "../../../shared/lib/workspacePath";
import { reconcileAgentEditReviewDirectory } from "../../editor/agentEditBridge";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import {
  readLastSession,
  readTreeSession,
  writeLastSession,
} from "../../settings/lastSession";
import { isConnectionNotOpen, messageFromError } from "./connectionValidation";
import {
  entriesToTreeItems,
  fingerprintEntries,
  getItemPath,
  isUnderWorkspace,
  itemDepthUnderRoot,
  mergeDirectoryListing,
  normalizeRemotePath,
  treeStructureEqual,
} from "./treeModel";
import { type ConnectionState } from "./types";

interface Dependencies {
  connectionState: ConnectionState;
  setExplorerError: Dispatch<SetStateAction<string>>;
  clearRemoteWorkspace: () => void;
  setLoadingDirs: Dispatch<SetStateAction<Set<string>>>;
  dirFingerprintsRef: RefObject<Map<string, string>>;
  setTreeItems: Dispatch<SetStateAction<FileTreeItem[]>>;
  workspacePathRef: RefObject<string>;
  treeItemsRef: RefObject<FileTreeItem[]>;
  setLoadedDirs: Dispatch<SetStateAction<Set<string>>>;
  loadedDirsRef: RefObject<Set<string>>;
  handleConnectionUnavailable: (message?: string) => void;
  loadDirectoryRef: RefObject<
    (
      path: string,
      depth: number,
      replaceRoot?: boolean,
      allowDuringConnect?: boolean,
      options?: { quiet?: boolean; force?: boolean },
    ) => Promise<boolean>
  >;
  lastPersistedWorkspaceRef: RefObject<string>;
  setSavedProfiles: Dispatch<SetStateAction<Profile[]>>;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  expandedIdsRef: RefObject<Set<string>>;
  setUsername: Dispatch<SetStateAction<string>>;
  connectionStateRef: RefObject<ConnectionState>;
  sessionRestoreGenRef: RefObject<number>;
  connectionUnavailableRef: RefObject<boolean>;
  setWorkspacePath: Dispatch<SetStateAction<string>>;
  setConnectionState: Dispatch<SetStateAction<ConnectionState>>;
  activeProfileIdRef: RefObject<string | null>;
  setTreeSessionReadyKey: Dispatch<SetStateAction<string>>;
  activateWorkspaceRef: RefObject<
    (
      path: string,
      options?: {
        persist?: boolean;
        forceReload?: boolean;
        skipAccessSetup?: boolean;
      },
    ) => Promise<boolean>
  >;
}
export function useWorkspaceTreeLoading({
  connectionState,
  setExplorerError,
  clearRemoteWorkspace,
  setLoadingDirs,
  dirFingerprintsRef,
  setTreeItems,
  workspacePathRef,
  treeItemsRef,
  setLoadedDirs,
  loadedDirsRef,
  handleConnectionUnavailable,
  loadDirectoryRef,
  lastPersistedWorkspaceRef,
  setSavedProfiles,
  setExpandedIds,
  expandedIdsRef,
  setUsername,
  connectionStateRef,
  sessionRestoreGenRef,
  connectionUnavailableRef,
  setWorkspacePath,
  setConnectionState,
  activeProfileIdRef,
  setTreeSessionReadyKey,
  activateWorkspaceRef,
}: Dependencies) {
  const requestOrder = useRef(new Map<string, number>());
  const requestSequence = useRef(0);
  const loadDirectory = async (
    path: string,
    depth: number,
    replaceRoot = false,
    allowDuringConnect = false,
    options?: { quiet?: boolean; force?: boolean },
  ) => {
    if (!allowDuringConnect && connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      clearRemoteWorkspace();
      return false;
    }

    if (!options?.quiet) {
      setLoadingDirs((current) => new Set(current).add(path));
    }

    const requestedRoot = workspacePathRef.current;
    const requestedProfile = activeProfileIdRef.current;
    const requestedGeneration = sessionRestoreGenRef.current;
    const requestKey = JSON.stringify([requestedProfile, requestedRoot, path]);
    const requestId = ++requestSequence.current;
    requestOrder.current.set(requestKey, requestId);
    const stillCurrent = () => sessionRestoreGenRef.current === requestedGeneration
      && workspacePathRef.current === requestedRoot
      && activeProfileIdRef.current === requestedProfile && requestOrder.current.get(requestKey) === requestId;
    try {
      const response = await api.listFiles(path);
      if (!stillCurrent()) return false;
      const children = entriesToTreeItems(response.entries, depth);
      reconcileAgentEditReviewDirectory(path, children.map(getItemPath));
      dirFingerprintsRef.current.set(
        path,
        fingerprintEntries(response.entries),
      );

      setTreeItems((current) => {
        if (!stillCurrent()) return current;
        // Quiet/auto refreshes preserve expanded subtrees so rows keep their React
        // identity (no re-play of the tree-row enter animation after a save).
        // Force/manual refresh still does a hard replace so deleted nodes disappear.
        const preserveSubtrees = Boolean(options?.quiet) && !options?.force;
        let next: FileTreeItem[];
        if (replaceRoot) {
          next = preserveSubtrees
            ? mergeDirectoryListing(current, null, children)
            : children;
        } else {
          const parentIndex = current.findIndex(
            (item) => getItemPath(item) === path,
          );
          if (parentIndex < 0) {
            // Workspace root path isn't a row — merge as root children when quiet.
            if (preserveSubtrees && workspacePathRef.current === path) {
              next = mergeDirectoryListing(current, null, children);
            } else {
              return current;
            }
          } else if (preserveSubtrees) {
            next = mergeDirectoryListing(current, path, children);
          } else {
            const parentDepth = current[parentIndex]!.depth;
            let endIndex = parentIndex + 1;
            while (
              endIndex < current.length &&
              current[endIndex]!.depth > parentDepth
            ) {
              endIndex += 1;
            }
            next = [
              ...current.slice(0, parentIndex + 1),
              ...children,
              ...current.slice(endIndex),
            ];
          }
        }
        if (treeStructureEqual(current, next)) {
          treeItemsRef.current = current;
          return current;
        }
        // Keep ref in sync immediately for sequential refresh reloads.
        treeItemsRef.current = next;
        return next;
      });

      setLoadedDirs((current) => {
        if (!stillCurrent()) return current;
        // A hard replacement drops nested rows. Their cache flags must go too,
        // otherwise reopening a folder would incorrectly treat it as loaded.
        const hardReplace = !options?.quiet || Boolean(options?.force);
        const next = hardReplace
          ? new Set([...current].filter(dir => dir === path || !isUnderWorkspace(dir, path)))
          : new Set(current);
        next.add(path);
        loadedDirsRef.current = next;
        return next;
      });
      if (!options?.quiet) setExplorerError("");
      return true;
    } catch (error) {
      if (!stillCurrent()) return false;
      if (isConnectionNotOpen(error)) {
        handleConnectionUnavailable();
        return false;
      }

      if (!options?.quiet) {
        setExplorerError(messageFromError(error));
      }
      if (replaceRoot && !options?.quiet) {
        setTreeItems([]);
      }
      return false;
    } finally {
      if (sessionRestoreGenRef.current === requestedGeneration && workspacePathRef.current === requestedRoot && activeProfileIdRef.current === requestedProfile && !options?.quiet) {
        setLoadingDirs((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    }
  };
  loadDirectoryRef.current = loadDirectory;

  /** Remember workspace on the profile + local last-session so restarts reopen it. */
  const persistWorkspaceSession = (
    rootPath: string,
    profileId: string | null,
  ) => {
    if (!isAbsoluteWorkspacePath(rootPath)) return;
    const key = `${profileId ?? ""}:${rootPath}`;
    if (lastPersistedWorkspaceRef.current === key) return;
    lastPersistedWorkspaceRef.current = key;

    // Only remember workspace identity here — never stamp expandedPaths:[] while the
    // tree is still empty post-clear (that wiped folder restore across restarts).
    writeLastSession({
      profileId,
      workspacePath: rootPath,
    });

    // "local" is a sentinel for native folders, not a saved SSH profile.
    if (!profileId || profileId === "local") return;
    void (async () => {
      try {
        await hydrateRuntimeFromDesktop();
        const updated = await api.updateProfile(profileId, {
          defaultWorkspace: rootPath,
        });
        setSavedProfiles((current) =>
          current.map((profile) =>
            profile.id === updated.id ? updated : profile,
          ),
        );
      } catch {
        // Offline / API blip — local last-session still holds the path.
      }
    })();
  };

  /** Re-expand folders from the previous visit and load their children (depth-batched). */
  const restoreExpandedTree = async (
    rootPath: string,
    profileId: string | null,
  ) => {
    const fromTree = profileId
      ? readTreeSession(profileId, rootPath).expandedPaths
      : [];
    const fromLast = readLastSession();
    const candidates =
      fromTree.length > 0
        ? fromTree
        : fromLast.workspacePath === rootPath ||
            fromLast.workspacePath === normalizeRemotePath(rootPath)
          ? fromLast.expandedPaths
          : [];
    if (candidates.length === 0) return;

    // Only keep folders under this workspace root (and not the root itself).
    const rootNorm = normalizeRemotePath(rootPath);
    const dirs = candidates
      .filter((path) => {
        const p = normalizeRemotePath(path);
        if (p === rootNorm) return false;
        return isUnderWorkspace(path, rootPath);
      })
      .map((path) => normalizeRemotePath(path))
      .sort(
        (a, b) => workspacePathParts(a).length - workspacePathParts(b).length,
      )
      .slice(0, 80);

    if (dirs.length === 0) return;

    // Expand all folders in one React update so the tree doesn't tick open one-by-one.
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const dir of dirs) next.add(dir);
      expandedIdsRef.current = next;
      return next;
    });

    // Load children depth-first batches in parallel (parents before children).
    const byDepth = new Map<number, string[]>();
    for (const dir of dirs) {
      const depth =
        rootNorm === "/"
          ? dir.split("/").filter(Boolean).length
          : itemDepthUnderRoot(dir, rootNorm) + 1;
      const list = byDepth.get(depth) ?? [];
      list.push(dir);
      byDepth.set(depth, list);
    }
    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    for (const depth of depths) {
      const batch = (byDepth.get(depth) ?? []).filter(
        (dir) => !loadedDirsRef.current.has(dir),
      );
      if (batch.length === 0) continue;
      await Promise.all(
        batch.map((dir) =>
          loadDirectory(dir, Math.max(0, depth), false, true, { quiet: true }),
        ),
      );
    }
  };

  const activateWorkspace = async (
    rootPath: string,
    options?: {
      persist?: boolean;
      forceReload?: boolean;
      skipAccessSetup?: boolean;
    },
  ) => {
    const normalized = trimTrailingSeparators(rootPath) || "/";
    if (!options?.skipAccessSetup) {
      try {
        const opened = await api.openWorkspace(normalized);
        if (opened.sessionUser) setUsername(opened.sessionUser);
        if (opened.path && opened.path !== normalized) {
          return activateWorkspace(opened.path, {
            persist: options?.persist,
            forceReload: true,
            skipAccessSetup: true,
          });
        }
      } catch (error) {
        setExplorerError(messageFromError(error));
        return false;
      }
    }
    // Already on this root — still refresh listing so explorer stays honest.
    if (
      (trimTrailingSeparators(workspacePathRef.current) || "/") ===
        normalized &&
      connectionStateRef.current === "connected" &&
      options?.forceReload !== true
    ) {
      await loadDirectory(normalized, 0, true, true, {
        quiet: true,
        force: true,
      });
      return true;
    }

    // clearRemoteWorkspace bumps sessionRestoreGenRef — capture gen *after* teardown.
    clearRemoteWorkspace();
    const restoreGen = sessionRestoreGenRef.current;
    connectionUnavailableRef.current = false;
    // Establish identity before listing: React may apply the queued tree updater
    // after this async function resumes. Its stale-response guard must see the
    // same root both when receiving the response and when committing the rows.
    workspacePathRef.current = normalized;
    setWorkspacePath(normalized);
    const loaded = await loadDirectory(normalized, 0, true, true);
    if (sessionRestoreGenRef.current !== restoreGen) return false;
    if (!loaded) {
      // Report a failed listing without committing a superseded activation.
      if (!connectionUnavailableRef.current) {
        setConnectionState("connected");
      }
      setExplorerError(`Could not open workspace: ${normalized}`);
      return false;
    }
    setWorkspacePath(normalized);
    workspacePathRef.current = normalized;
    setConnectionState("connected");
    setExplorerError("");

    const profileId = activeProfileIdRef.current;
    if (options?.persist !== false) {
      persistWorkspaceSession(normalized, profileId);
    }

    // Restore expanded folders from last session (after root listing is in place).
    // Mark tree session ready only after restore so empty expandedIds never wipe storage.
    void (async () => {
      try {
        await restoreExpandedTree(normalized, profileId);
      } finally {
        if (sessionRestoreGenRef.current === restoreGen) {
          setTreeSessionReadyKey(`${profileId ?? ""}:${normalized}`);
        }
      }
    })();
    return true;
  };
  activateWorkspaceRef.current = activateWorkspace;

  return { loadDirectory, activateWorkspace };
}
