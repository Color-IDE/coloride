/**
 * Right-pane Source Control for the Coloride workspace:
 * file list and commit. Selecting a file opens a unified diff tab.
 */
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api/client";
import type { GitChangedFile, GitSafeStatus } from "../../shared/api/types";
import { GitIcon } from "../explorer/filetree/FileTree";

export type AgentGitSourceControlProps = {
  workspacePath: string | null;
  connected: boolean;
  onOpenWorkspacePath?: (path: string) => void;
  /** Open a workspace tab with unified CodeMirror diff (green/red highlights). */
  onOpenFileDiff?: (args: {
    path: string;
    workspaceRoot: string;
    diff: string;
    status?: string;
  }) => void;
};

const fileName = (path: string) => path.split("/").filter(Boolean).at(-1) || path;
const fileDir = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
};

type ChangeIconKind = "add" | "mod" | "del";

const statusIconKind = (s: string): ChangeIconKind => {
  if (s === "D") return "del";
  if (s === "A" || s === "U" || s === "?") return "add";
  return "mod";
};

export function AgentGitSourceControl({
  workspacePath,
  connected,
  onOpenWorkspacePath,
  onOpenFileDiff,
}: AgentGitSourceControlProps) {
  const [status, setStatus] = useState<GitSafeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("coloride: workspace changes");
  const [view, setView] = useState<"changes" | "history">("changes");
  const [history, setHistory] = useState<
    Array<{ short: string; hash: string; subject: string; relative: string; author: string }>
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!connected || !workspacePath?.startsWith("/")) {
      setStatus(null);
      return;
    }
    try {
      const next = await api.gitSafeStatus(workspacePath);
      setStatus(next);
      setError("");
    } catch (err) {
      setStatus(null);
      const msg = err instanceof Error ? err.message : String(err);
      if (!/404|Not Found|not prepared/i.test(msg)) {
        setError(msg.replace(/^Coloride API \d+:\s*/, ""));
      }
    }
  }, [connected, workspacePath]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 8_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const loadHistory = useCallback(async () => {
    if (!connected || !workspacePath?.startsWith("/")) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const res = await api.gitSafeHistory(workspacePath, 50);
      setHistory(res.commits ?? []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [connected, workspacePath]);

  useEffect(() => {
    if (view !== "history") return;
    void loadHistory();
  }, [view, loadHistory]);

  const files = useMemo(() => status?.files ?? [], [status?.files]);
  const changeCount = files.length > 0 ? files.length : status?.filesChanged ?? 0;

  /** Fetch unified diff and open single-pane editor tab above. */
  const openFileInDiffTab = useCallback(
    async (file: GitChangedFile) => {
      if (!workspacePath || !onOpenFileDiff) return;
      setSelectedPath(file.path);
      setOpeningPath(file.path);
      setError("");
      try {
        const res = await api.gitSafeDiff(workspacePath, file.path);
        onOpenFileDiff({
          path: file.path,
          workspaceRoot: status?.workspacePath || workspacePath,
          diff: res.diff || "",
          status: file.status,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message.replace(/^Coloride API \d+:\s*/, "") : String(err));
      } finally {
        setOpeningPath(null);
      }
    },
    [onOpenFileDiff, workspacePath, status?.workspacePath],
  );

  const run = async (key: string, fn: () => Promise<GitSafeStatus>) => {
    setBusy(key);
    setError("");
    try {
      const next = await fn();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Coloride API \d+:\s*/, "") : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[#878888]">
        Connect to a server to use Git.
      </div>
    );
  }

  if (!workspacePath?.startsWith("/")) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[#878888]">
        Choose a workspace first.
      </div>
    );
  }

  const ready = Boolean(status?.ready);
  const dirty = Boolean(status?.dirty);
  const totalPlus = status?.insertions ?? 0;
  const totalMinus = status?.deletions ?? 0;

  return (
    <div className="agent-git-sc flex h-full min-h-0 flex-col bg-[#1e1e1e] text-[#d4d4d8]">
      {/* Segmented toggle: Changes | History */}
      <header className="agent-git-sc-header flex h-9 shrink-0 items-center border-b border-[#2e2e2e] px-2">
        <div
          className="agent-git-sc-tabs"
          role="tablist"
          aria-label="Git panel mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "changes"}
            className={`agent-git-sc-tab${view === "changes" ? " is-active" : ""}`}
            onClick={() => {
              setView("changes");
              void refresh();
            }}
          >
            {view === "changes" ? (
              <motion.span
                className="agent-git-sc-tab-pill"
                layoutId="agent-git-sc-pill"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative z-[1]">
              Changes ({changeCount})
              {ready && (totalPlus > 0 || totalMinus > 0) ? (
                <span className="agent-git-sc-tab-stats">
                  {" "}
                  <span className="text-emerald-400/90">+{totalPlus}</span>
                  {" "}
                  <span className="text-rose-400/90">−{totalMinus}</span>
                </span>
              ) : null}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "history"}
            className={`agent-git-sc-tab${view === "history" ? " is-active" : ""}`}
            onClick={() => setView("history")}
          >
            {view === "history" ? (
              <motion.span
                className="agent-git-sc-tab-pill"
                layoutId="agent-git-sc-pill"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative z-[1]">History</span>
          </button>
        </div>
      </header>

      {!ready ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="max-w-xs text-[13px] leading-relaxed text-[#9a9aa2]">
            Git is not ready in this Coloride folder yet.
          </p>
          <button
            type="button"
            className="agent-git-sc-primary"
            disabled={busy !== null}
            onClick={() => {
              void (async () => {
                setBusy("ensure");
                setError("");
                try {
                  const next = await api.gitSafeEnsure(workspacePath);
                  setStatus(next);
                  if (next.workspacePath) onOpenWorkspacePath?.(next.workspacePath);
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message.replace(/^Coloride API \d+:\s*/, "")
                      : String(err),
                  );
                } finally {
                  setBusy(null);
                }
              })();
            }}
          >
            {busy === "ensure" ? "Preparing…" : "Prepare Git"}
          </button>
          {error ? <p className="max-w-sm text-[12px] text-[#f0a8a0]">{error}</p> : null}
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {view === "history" ? (
              <motion.div
                key="history"
                className="absolute inset-0 flex min-h-0 flex-col"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                {error ? (
                  <div className="shrink-0 border-b border-[#3a2220] bg-[#2a1816] px-3 py-2 text-[12px] text-[#f0a8a0]">
                    {error}
                  </div>
                ) : null}
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {historyLoading ? (
                    <div className="px-3 py-4 text-[12px] text-[#6f6f6f]">Loading history…</div>
                  ) : history.length === 0 ? (
                    <div className="px-3 py-4 text-[12px] text-[#6f6f6f]">No commits yet</div>
                  ) : (
                    history.map((commit) => {
                      const isHead = status?.workspaceCommit === commit.short
                        || status?.workspaceCommit === commit.hash.slice(0, 7);
                      return (
                        <div
                          key={commit.hash}
                          className="flex items-start gap-2 border-b border-[#2a2a2a] px-2.5 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] text-[#e8e8ea]">{commit.subject}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#7a7a82]">
                              <span className="font-mono text-[#a6a6ad]">{commit.short}</span>
                              <span>{commit.relative}</span>
                              <span>{commit.author}</span>
                              {isHead ? (
                                <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[#c8c8ce]">
                                  HEAD
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="changes"
                className="absolute inset-0 flex min-h-0 flex-col"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                {/* Actions */}
                <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#2e2e2e] px-2 py-1.5">
                  <button
                    type="button"
                    className="agent-git-sc-chip"
                    disabled={busy !== null}
                    onClick={() => status?.workspacePath && onOpenWorkspacePath?.(status.workspacePath)}
                  >
                    Open workspace
                  </button>
                  <button
                    type="button"
                    className="agent-git-sc-chip"
                    disabled={busy !== null || !dirty}
                    onClick={() =>
                      void run("commit", () => api.gitSafeCommit(workspacePath, commitMessage))
                    }
                  >
                    {busy === "commit" ? "Committing…" : "Commit all"}
                  </button>
                </div>

                {error ? (
                  <div className="shrink-0 border-b border-[#3a2220] bg-[#2a1816] px-3 py-2 text-[12px] text-[#f0a8a0]">
                    {error}
                  </div>
                ) : null}

                {/* File list — click opens unified diff tab in the workspace bar */}
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {files.length === 0 ? (
                      <div className="px-3 py-4 text-[12px] text-[#6f6f6f]">No local changes</div>
                    ) : (
                      files.map((file) => (
                        <ChangeRow
                          key={file.path}
                          file={file}
                          active={selectedPath === file.path}
                          opening={openingPath === file.path}
                          onClick={() => void openFileInDiffTab(file)}
                        />
                      ))
                    )}
                  </div>
                  <div className="flex h-7 shrink-0 items-center gap-2 border-t border-[#2e2e2e] px-2.5 text-[11px] text-[#8b8b93]">
                    <BranchIcon />
                    <span className="truncate font-mono">{status?.branch || "—"}</span>
                    <span className="ml-auto truncate text-[10px] text-[#5c5c5c]">
                      Click a file to open diff
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="agent-git-sc-compose shrink-0 border-t border-[#2e2e2e] px-2.5 py-2">
        {ready ? (
          <div className="mb-1.5 text-[11px] text-[#8b8b93]">
            {status?.workspaceCommit || "—"}
            {status?.branch ? ` · ${status.branch}` : ""}
            {dirty ? " · uncommitted changes" : ""}
          </div>
        ) : null}
        <input
          className="h-7 w-full rounded-md border-0 bg-[#2a2a2a] px-2 text-[12px] text-[#e8e8ea] outline-none placeholder:text-[#6f6f6f] disabled:opacity-50"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Commit message"
          disabled={!ready}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !ready || !dirty || busy) return;
            e.preventDefault();
            void run("commit", () => api.gitSafeCommit(workspacePath, commitMessage));
          }}
        />
      </div>
    </div>
  );
}

function ChangeRow({
  file,
  active,
  opening,
  onClick,
}: {
  file: GitChangedFile;
  active: boolean;
  opening?: boolean;
  onClick: () => void;
}) {
  const dir = fileDir(file.path);
  const name = fileName(file.path);
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] transition-colors ${
        active ? "bg-[#2a2d2e]" : "hover:bg-white/[0.04]"
      }${opening ? " opacity-70" : ""}`}
      onClick={onClick}
      title={`${file.path} — open diff`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center ${
          statusIconKind(file.status) === "del"
            ? "text-[#f87171]"
            : statusIconKind(file.status) === "add"
              ? "text-[#4ade80]"
              : "text-[#fbbf24]"
        }`}
        title={
          statusIconKind(file.status) === "del"
            ? "Deleted"
            : statusIconKind(file.status) === "add"
              ? "Added"
              : "Modified"
        }
        aria-hidden="true"
      >
        <ChangeStatusIcon kind={statusIconKind(file.status)} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-[#e8e8ea]">{name}</span>
        {dir ? <span className="text-[#6f6f6f]"> {dir}</span> : null}
      </span>
      <span className="shrink-0 tabular-nums text-[11px]">
        {file.insertions > 0 ? (
          <span className="text-emerald-400/90">+{file.insertions}</span>
        ) : null}
        {file.insertions > 0 && file.deletions > 0 ? " " : null}
        {file.deletions > 0 ? (
          <span className="text-rose-400/90">−{file.deletions}</span>
        ) : null}
      </span>
    </button>
  );
}

function BranchIcon() {
  return <GitIcon className="h-3.5 w-3.5 shrink-0" />;
}

/**
 * Status glyphs (no letters):
 * - add / untracked (A, U, ?): green rounded square +
 * - modified (M, …): yellow rounded square ·
 * - deleted (D): rose rounded square −
 */
function ChangeStatusIcon({ kind }: { kind: ChangeIconKind }) {
  if (kind === "add") {
    return (
      <svg
        aria-hidden="true"
        className="h-3.5 w-3.5"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.5 12.0001C2.5 7.52171 2.5 5.28254 3.89124 3.8913C5.28249 2.50005 7.52166 2.50005 12 2.50005C16.4783 2.50005 18.7175 2.50005 20.1088 3.8913C21.5 5.28254 21.5 7.52171 21.5 12.0001C21.5 16.4784 21.5 18.7176 20.1088 20.1088C18.7175 21.5001 16.4783 21.5001 12 21.5001C7.52166 21.5001 5.28249 21.5001 3.89124 20.1088C2.5 18.7176 2.5 16.4784 2.5 12.0001Z" />
        <path d="M12 8.00005V16.0001M16 12.0001L8 12.0001" />
      </svg>
    );
  }
  if (kind === "del") {
    return (
      <svg
        aria-hidden="true"
        className="h-3.5 w-3.5"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.5 12.0001C2.5 7.52171 2.5 5.28254 3.89124 3.8913C5.28249 2.50005 7.52166 2.50005 12 2.50005C16.4783 2.50005 18.7175 2.50005 20.1088 3.8913C21.5 5.28254 21.5 7.52171 21.5 12.0001C21.5 16.4784 21.5 18.7176 20.1088 20.1088C18.7175 21.5001 16.4783 21.5001 12 21.5001C7.52166 21.5001 5.28249 21.5001 3.89124 20.1088C2.5 18.7176 2.5 16.4784 2.5 12.0001Z" />
        <path d="M16 12.0001L8 12.0001" />
      </svg>
    );
  }
  // modified — yellow square with center dot (filled so it stays visible at 14px)
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path
        d="M12 21C15.7497 21 17.6246 21 18.9389 20.0451C19.3634 19.7367 19.7367 19.3634 20.0451 18.9389C21 17.6246 21 15.7497 21 12C21 8.25027 21 6.3754 20.0451 5.06107C19.7367 4.6366 19.3634 4.26331 18.9389 3.95492C17.6246 3 15.7497 3 12 3C8.25027 3 6.3754 3 5.06107 3.95491C4.6366 4.26331 4.26331 4.6366 3.95492 5.06107C3 6.3754 3 8.25027 3 12C3 15.7497 3 17.6246 3.95491 18.9389C4.26331 19.3634 4.6366 19.7367 5.06107 20.0451C6.3754 21 8.25027 21 12 21Z"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
