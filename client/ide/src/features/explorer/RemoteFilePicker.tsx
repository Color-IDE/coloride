import { motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../../shared/api/client";
import type { Entry } from "../../shared/api/types";
import { FileIcon, FolderClosedIcon, FolderOpenIcon } from "./filetree/FileTree";
import type { ServerWorkspaceController } from "../server/useServerWorkspace";

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

const isConnectionNotOpen = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.includes("Connection not open") || raw.includes("No active SSH connection");
};

/** Restricted SSH home. The visible connection is `coloride`, never `/root`. */
const RESTRICTED_HOME = "/home/coloride";
/** Typical VPS project roots. Only shown in Places if the server can list them. */
const PROJECT_CANDIDATES = [
  { path: "/var/www", label: "Web root" },
  { path: "/var/www/html", label: "Default site" },
  { path: "/usr/share/nginx/html", label: "Nginx html" },
  { path: "/usr/share/caddy", label: "Caddy html" },
  { path: "/srv/www", label: "Server sites" },
  { path: "/srv/http", label: "HTTP root" },
  { path: "/srv", label: "Services" },
  { path: "/opt", label: "Optional software" },
] as const;

type SidebarLocation = {
  id: string;
  label: string;
  path: string;
  section: "favorites" | "places" | "system";
};

type RemoteFilePickerProps = {
  folderOnly?: boolean;
  onCancel?: () => void;
  onClose: () => void;
  onOpenExplorer: () => void;
  /**
   * When set, selecting a file/folder calls this instead of opening Explorer.
   * Used by Agent workspace "File" to pick a remote path without leaving Agent.
   */
  onPick?: (entry: Entry) => void | Promise<void>;
  open: boolean;
  requireWorkspace?: boolean;
  workspace: ServerWorkspaceController;
};

function normalizeRemotePath(path: string | null | undefined): string {
  if (!path) return "";
  const trimmed = path.trim().replace(/\/+/g, "/");
  if (!trimmed || trimmed === "/") return trimmed || "/";
  return trimmed.replace(/\/+$/, "");
}

function homePathForUser(username: string | null | undefined): string {
  const user = (username || "").trim();
  // Bootstrap/admin names must not send the picker to /root. Explorer lists
  // files as `coloride`, so the only safe home is that account.
  if (!user || user === "root") return RESTRICTED_HOME;
  return `/home/${user}`;
}

function pickerErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const payload = JSON.parse(raw.slice(jsonStart)) as {
        message?: unknown;
        detail?: { message?: unknown };
      };
      const message =
        typeof payload.message === "string"
          ? payload.message
          : typeof payload.detail?.message === "string"
            ? payload.detail.message
            : "";
      if (message.includes("outside the permitted")) {
        return "This folder is outside the areas Coloride can open. Use Workspace, /home/coloride, or /var/www.";
      }
      if (message) return message;
    } catch {
      // Fall through to the raw text.
    }
  }
  return raw;
}

export function RemoteFilePicker({
  folderOnly = false,
  onCancel,
  onClose,
  onOpenExplorer,
  onPick,
  open,
  requireWorkspace = false,
  workspace,
}: RemoteFilePickerProps) {
  const selectFoldersOnly = requireWorkspace || folderOnly;
  const workspaceRoot = normalizeRemotePath(workspace.workspacePath);
  const homePath = homePathForUser(workspace.username);
  // Prefer current workspace → home → never dump users on bare `/`.
  const startPath = workspaceRoot && workspaceRoot !== "/" ? workspaceRoot : homePath;
  const [currentPath, setCurrentPath] = useState(startPath);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [placePaths, setPlacePaths] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [error, setError] = useState("");
  const [backStack, setBackStack] = useState<string[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);
  const locationsScrollRef = useRef<HTMLDivElement>(null);
  const [locationsThumb, setLocationsThumb] = useState({ height: 0, top: 0, visible: false });

  const sidebarLocations = useMemo((): SidebarLocation[] => {
    const items: SidebarLocation[] = [];
    const seen = new Set<string>();
    const push = (item: SidebarLocation) => {
      const key = normalizeRemotePath(item.path) || "/";
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ ...item, path: key });
    };

    if (workspaceRoot && workspaceRoot !== "/") {
      push({ id: "workspace", label: "Workspace", path: workspaceRoot, section: "favorites" });
    }
    // Don't list the user home separately when it is the same folder as Workspace.
    if (normalizeRemotePath(homePath) !== workspaceRoot) {
      push({
        id: "home",
        label: pathTitle(homePath) || "coloride",
        path: homePath,
        section: "favorites",
      });
    }

    for (const path of placePaths) {
      const normalized = normalizeRemotePath(path);
      if (!normalized || normalized === "/" || normalized === homePath || normalized === workspaceRoot) {
        continue;
      }
      push({
        id: `place:${normalized}`,
        label: placeLabel(normalized),
        path: normalized,
        section: "places",
      });
    }

    push({ id: "computer", label: "Computer", path: "/", section: "system" });
    return items;
  }, [homePath, placePaths, workspaceRoot]);

  /** Only the most specific sidebar row is active (workspace under home must not light Home). */
  const activeSidebarId = useMemo(() => {
    const here = normalizeRemotePath(currentPath) || "/";
    let best: SidebarLocation | null = null;
    for (const item of sidebarLocations) {
      const path = item.path || "/";
      const matches =
        here === path
        || (path !== "/" && (here === path || here.startsWith(`${path}/`)))
        || (path === "/" && here === "/");
      if (!matches) continue;
      if (!best) {
        best = item;
        continue;
      }
      // Longer path = more specific (prefer /home/u/app over /home/u over /).
      const bestLen = best.path === "/" ? 0 : best.path.length;
      const itemLen = path === "/" ? 0 : path.length;
      if (itemLen > bestLen) best = item;
    }
    return best?.id ?? null;
  }, [currentPath, sidebarLocations]);

  const updateLocationsThumb = useCallback(() => {
    const element = locationsScrollRef.current;
    if (!element) return;

    const { clientHeight, scrollHeight, scrollTop } = element;
    if (scrollHeight <= clientHeight) {
      setLocationsThumb({ height: 0, top: 0, visible: false });
      return;
    }

    const height = Math.max(30, (clientHeight / scrollHeight) * clientHeight);
    const maxTop = clientHeight - height;
    const top = maxTop * (scrollTop / (scrollHeight - clientHeight));
    setLocationsThumb({ height, top, visible: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    setCurrentPath(startPath);
    setSelectedPath(null);
    setBackStack([]);
    setForwardStack([]);
  }, [open, startPath]);

  useEffect(() => {
    if (!open || workspace.connectionState !== "connected") return;
    void loadPath(currentPath);
  }, [currentPath, open, workspace.connectionState]);

  // Probe a few useful project roots — never dump the whole `/` tree in the rail.
  useEffect(() => {
    if (!open || workspace.connectionState !== "connected") {
      setPlacePaths([]);
      return;
    }
    let cancelled = false;
    const candidates = PROJECT_CANDIDATES.filter((item) => {
      const n = normalizeRemotePath(item.path);
      return n && n !== homePath && n !== workspaceRoot;
    });
    void Promise.all(
      candidates.map(async (item): Promise<string | null> => {
        try {
          await api.listFiles(item.path, 0, 1);
          return item.path;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setPlacePaths(results.filter((path): path is string => typeof path === "string" && path.length > 0));
    });
    return () => {
      cancelled = true;
    };
  }, [homePath, open, workspace.connectionState, workspaceRoot]);

  useLayoutEffect(() => {
    if (!open) return;
    const element = locationsScrollRef.current;
    if (!element) return;

    updateLocationsThumb();
    const observer = new ResizeObserver(updateLocationsThumb);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, sidebarLocations, updateLocationsThumb]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (requireWorkspace) {
          onCancel?.();
        } else {
          onClose();
        }
      }
      if (event.key === "Enter" && selectedPath) {
        const selected = entries.find((entry) => entry.path === selectedPath);
        if (selected && (!selectFoldersOnly || selected.kind === "dir")) {
          void confirmSelection(selected);
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [entries, onCancel, onClose, open, requireWorkspace, selectFoldersOnly, selectedPath]);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "dir" ? -1 : b.kind === "dir" ? 1 : 0;
      }
      return a.name.localeCompare(b.name);
    });
  }, [entries]);

  if (!open) return null;

  const loadPath = async (path: string) => {
    setLoading(true);
    setError("");
    setSelectedPath(null);

    try {
      const response = await api.listFiles(path);
      setEntries(response.entries);
    } catch (err) {
      setEntries([]);
      if (isConnectionNotOpen(err)) {
        const message = "Connection closed. Reconnect to browse VPS files.";
        setError(message);
        workspace.handleConnectionUnavailable(message);
        return;
      }
      setError(pickerErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const navigateToPath = (path: string) => {
    if (path === currentPath) return;
    setBackStack((current) => [...current, currentPath]);
    setForwardStack([]);
    setCurrentPath(path);
  };

  const goBack = () => {
    setBackStack((current) => {
      const previous = current.at(-1);
      if (!previous) return current;
      setForwardStack((forward) => [currentPath, ...forward]);
      setCurrentPath(previous);
      return current.slice(0, -1);
    });
  };

  const goForward = () => {
    setForwardStack((current) => {
      const next = current[0];
      if (!next) return current;
      setBackStack((back) => [...back, currentPath]);
      setCurrentPath(next);
      return current.slice(1);
    });
  };

  const navigateIntoFolder = (entry: Entry) => {
    if (entry.kind === "dir") {
      navigateToPath(entry.path);
    }
  };

  const confirmSelection = async (entry: Entry) => {
    if (selectFoldersOnly && entry.kind !== "dir") return;
    if (requireWorkspace) {
      if (entry.kind !== "dir") return;
      setOpeningWorkspace(true);
      setError("");
      try {
        await workspace.saveDefaultWorkspace(entry.path);
        onOpenExplorer();
        onClose();
      } catch (selectionError) {
        setError(selectionError instanceof Error ? selectionError.message : "Unable to open this workspace.");
      } finally {
        setOpeningWorkspace(false);
      }
      return;
    }
    // Pick mode (Agent File tab): return path without switching to Explorer.
    if (onPick) {
      if (!selectFoldersOnly && entry.kind === "dir") {
        navigateIntoFolder(entry);
        return;
      }
      await onPick(entry);
      onClose();
      return;
    }
    const opened = entry.kind === "dir"
      ? await workspace.openRemoteDirectory(entry.path)
      : await workspace.openRemoteFile(entry.path);

    if (opened) {
      onOpenExplorer();
      onClose();
    }
  };

  const confirmCurrentFolder = async () => {
    if (requireWorkspace) {
      setOpeningWorkspace(true);
      setError("");
      try {
        await workspace.saveDefaultWorkspace(currentPath);
        onOpenExplorer();
        onClose();
      } catch (selectionError) {
        setError(selectionError instanceof Error ? selectionError.message : "Unable to open this workspace.");
      } finally {
        setOpeningWorkspace(false);
      }
      return;
    }
    if (onPick) {
      await onPick({
        name: pathTitle(currentPath),
        path: currentPath,
        kind: "dir",
        size: 0,
        mtime: "",
      } as Entry);
      onClose();
      return;
    }
    const opened = await workspace.openRemoteDirectory(currentPath);
    if (opened) {
      onOpenExplorer();
      onClose();
    }
  };

  const selectedEntry = sortedEntries.find((entry) => entry.path === selectedPath);
  const title = selectedEntry?.name ?? pathTitle(currentPath);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/45 px-5 py-8"
      onClick={requireWorkspace ? undefined : onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 12 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="remote-browser-card flex h-[min(720px,calc(100vh-64px))] w-[min(980px,calc(100vw-40px))] gap-3 overflow-hidden rounded-[24px] border bg-[#171717] p-3 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="remote-browser-locations relative flex w-[204px] flex-shrink-0 flex-col overflow-hidden rounded-2xl bg-[#1f1f1f] py-2 pl-2">
          <div
            className="remote-browser-locations-scroll min-h-0 flex-1 overflow-y-scroll pr-2"
            onScroll={updateLocationsThumb}
            ref={locationsScrollRef}
          >
            {(["favorites", "places", "system"] as const).map((section) => {
              const sectionItems = sidebarLocations.filter((item) => item.section === section);
              if (sectionItems.length === 0) return null;
              const heading =
                section === "favorites" ? "Favorites" : section === "places" ? "Places" : "System";
              return (
                <div className="mb-2" key={section}>
                  <div className="px-2 pb-1 pt-1 text-[12px] font-normal normal-case tracking-normal text-[#8a8a90]">
                    {heading}
                  </div>
                  {sectionItems.map((item) => {
                    const active = activeSidebarId === item.id;
                    const icon =
                      item.id === "computer" ? (
                        <ComputerIcon className="size-[18px] shrink-0 text-[#878888]/70" />
                      ) : item.id === "home" ? (
                        <HomeIcon className="size-[18px] shrink-0 text-[#878888]/70" />
                      ) : item.id === "workspace" && active ? (
                        <FolderOpenIcon className="size-4 shrink-0 text-[#878888]/70" />
                      ) : (
                        <FolderClosedIcon className="size-4 shrink-0 text-[#878888]/70" />
                      );
                    return (
                      <FinderLocation
                        active={active}
                        icon={icon}
                        key={item.id}
                        label={item.label}
                        onClick={() => navigateToPath(item.path)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
          {locationsThumb.visible && (
            <div className="remote-browser-locations-track pointer-events-none absolute bottom-2 right-[3px] top-2 w-1 overflow-hidden rounded-full">
              <span
                className="remote-browser-locations-thumb absolute inset-x-0 top-0 rounded-full bg-[#4a4a4a]"
                style={{ height: locationsThumb.height, transform: `translateY(${locationsThumb.top}px)` }}
              />
            </div>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#171717]">
          <header className="flex h-12 flex-shrink-0 items-center gap-2 px-1">
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-xl text-[#878888] transition-all hover:bg-[#303030] hover:text-white active:scale-90 disabled:opacity-40 disabled:active:scale-100"
              disabled={backStack.length === 0}
              onClick={goBack}
              aria-label="Back"
            >
              <BackIcon />
            </button>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-xl text-[#878888] transition-all hover:bg-[#303030] hover:text-white active:scale-90 disabled:opacity-40 disabled:active:scale-100"
              disabled={forwardStack.length === 0}
              onClick={goForward}
              aria-label="Forward"
            >
              <ForwardIcon />
            </button>
            <button
              type="button"
              className="group flex size-8 items-center justify-center rounded-xl text-[#878888] transition-all hover:bg-[#303030] hover:text-white active:scale-90"
              onClick={() => void loadPath(currentPath)}
              aria-label="Refresh"
            >
              <ReloadIcon loading={loading} />
            </button>

            <div className="flex min-w-0 flex-1 items-center gap-2 pl-2">
              {selectedEntry?.kind === "file" ? (
                <FileIcon name={selectedEntry.name} className="size-4 shrink-0 text-[#878888]/70" />
              ) : (
                <FolderClosedIcon className="size-4 shrink-0 text-[#878888]/70" />
              )}
              <span className="truncate text-[15px] font-medium text-[#f0f4f8]">{title}</span>
            </div>

          </header>

          {workspace.connectionState !== "connected" ? (
            <div className="flex flex-1 items-center justify-center text-sm text-[#878888]">
              Connect to a server first.
            </div>
          ) : (
            <>
              <div className="relative w-full flex-shrink-0">
                <div className="mx-2 grid h-8 grid-cols-[1fr_90px_110px_150px] items-center px-3 text-[12px] font-normal normal-case tracking-normal text-[#8a8a90]">
                  <span>Name</span>
                  <span>Kind</span>
                  <span>Size</span>
                  <span>Modified</span>
                </div>
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#2c2c2c]" />
              </div>

              <div className="remote-browser-scroll min-h-0 flex-1 overflow-auto p-2">
                {loading && <div className="px-4 py-3 text-sm text-[#878888]">Loading...</div>}
                {!loading && error && <div className="px-4 py-3 text-sm text-[#f93a56]">{error}</div>}
                {!loading && !error && sortedEntries.length === 0 && (
                  <div className="px-4 py-3 text-sm text-[#878888]">Empty folder.</div>
                )}
                {!loading && !error && sortedEntries.map((entry, index) => {
                  const selected = selectedPath === entry.path;
                  return (
                    <button
                      key={entry.path}
                      type="button"
                      className={cx(
                        "tree-row-appear grid h-9 w-full grid-cols-[1fr_90px_110px_150px] items-center rounded-xl border-0 px-3 text-left text-[13px] transition-all active:scale-[0.99]",
                        selected
                          ? "bg-white/[0.08] text-[#f0f4f8]"
                          : "bg-transparent text-[#a6a6ad] hover:bg-white/[0.05] hover:text-[#f0f4f8]",
                      )}
                      disabled={selectFoldersOnly && entry.kind !== "dir"}
                      onClick={() => setSelectedPath(entry.path)}
                      onDoubleClick={() => {
                        if (entry.kind === "dir") navigateIntoFolder(entry);
                        else void confirmSelection(entry);
                      }}
                      style={{ animationDelay: `${Math.min((index % 6) * 12, 72)}ms` }}
                    >
                      <span className="group flex min-w-0 items-center gap-2">
                        {entry.kind === "dir" ? (
                          <FolderClosedIcon className="size-4 shrink-0 text-[#878888]/70 transition-colors group-hover:text-[#a6a6ad]" />
                        ) : (
                          <FileIcon name={entry.name} className="size-4 shrink-0 text-[#878888]/70 transition-colors group-hover:text-[#a6a6ad]" />
                        )}
                        <span className="truncate">{entry.name}</span>
                      </span>
                      <span className="truncate text-[#878888]">{entry.kind}</span>
                      <span className="truncate text-[#878888]">{entry.kind === "dir" ? "--" : formatSize(entry.size)}</span>
                      <span className="truncate text-[#878888]">{formatDate(entry.mtime)}</span>
                    </button>
                  );
                })}
              </div>

              <footer className="flex h-14 flex-shrink-0 items-end justify-end gap-2 px-1 pb-1.5 pt-2">
                <button
                  type="button"
                  className="h-8 rounded-xl px-3 text-[12px] text-[#cfcfcf] transition-all hover:bg-[#303030] hover:text-white active:scale-95"
                  onClick={requireWorkspace ? onCancel : onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="remote-browser-open-btn h-8 rounded-xl px-3 text-[12px] font-medium transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
                  disabled={selectFoldersOnly ? loading || openingWorkspace || Boolean(error) : !selectedEntry}
                  onClick={() => {
                    if (selectFoldersOnly) {
                      if (selectedEntry?.kind === "dir") {
                        void confirmSelection(selectedEntry);
                      } else {
                        void confirmCurrentFolder();
                      }
                      return;
                    }
                    if (selectedEntry) void confirmSelection(selectedEntry);
                  }}
                >
                  {openingWorkspace ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Opening…
                    </span>
                  ) : selectFoldersOnly || selectedEntry?.kind === "dir" ? "Open Workspace" : "Open File"}
                </button>
              </footer>
            </>
          )}
        </section>
      </motion.div>
    </motion.div>
  );
}

function ComputerIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      height="24"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path d="M4.08 5.227A3 3 0 0 1 6.979 3H17.02a3 3 0 0 1 2.9 2.227l2.113 7.926A5.23 5.23 0 0 0 18.75 12H5.25a5.23 5.23 0 0 0-3.284 1.153z" />
      <path
        clipRule="evenodd"
        d="M5.25 13.5a3.75 3.75 0 1 0 0 7.5h13.5a3.75 3.75 0 1 0 0-7.5zm10.5 4.5a.75.75 0 1 0 0-1.5a.75.75 0 0 0 0 1.5m3.75-.75a.75.75 0 1 1-1.5 0a.75.75 0 0 1 1.5 0"
        fillRule="evenodd"
      />
    </svg>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      height="24"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path d="M3 13h1v7c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-7h1c.4 0 .77-.24.92-.62c.16-.37.07-.8-.22-1.09l-8.99-9a.996.996 0 0 0-1.41 0l-9.01 9c-.29.29-.37.72-.22 1.09s.52.62.92.62Z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" className="size-[18px]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M15 18C15 18 9.00001 13.5811 9 12C8.99999 10.4188 15 6 15 6" />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg aria-hidden="true" className="size-[18px]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M9.00005 18C9.00005 18 15 13.5811 15 12C15 10.4188 9 6 9 6" />
    </svg>
  );
}

function ReloadIcon({ loading }: { loading: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`size-[18px] transition-transform duration-300 ${loading ? "animate-spin" : "group-active:rotate-180"}`}
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M20.9451 13C20.9814 12.6717 21 12.338 21 12C21 7.02944 16.9706 3 12 3C9.17273 3 6.64996 4.30367 5 6.34267M3.05493 11C3.01863 11.3283 3 11.662 3 12C3 16.9706 7.02944 21 12 21C14.8273 21 17.35 19.6963 19 17.6573" />
      <path d="M8 7H7C5.58579 7 4.87868 7 4.43934 6.56066C4 6.12132 4 5.41421 4 4V3" />
      <path d="M16 17H17C18.4142 17 19.1213 17 19.5607 17.4393C20 17.8787 20 18.5858 20 20V21" />
    </svg>
  );
}

function FinderLocation({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-active={active}
      className={cx(
        "remote-browser-location mb-1 flex h-9 w-full items-center gap-2 rounded-xl px-2 text-left transition-all active:scale-[0.97]",
        active ? "bg-[#303030] text-white" : "text-[#bdbdbd] hover:bg-[#2a2a2a] hover:text-white",
      )}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{label}</span>
      </span>
    </button>
  );
}

function pathTitle(path: string) {
  if (path === "/") return "Root";
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function placeLabel(path: string): string {
  const normalized = normalizeRemotePath(path);
  const known = PROJECT_CANDIDATES.find((item) => item.path === normalized);
  return known?.label || pathTitle(normalized) || normalized;
}

function formatSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}
