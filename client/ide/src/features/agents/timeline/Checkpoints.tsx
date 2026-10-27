import type { AgentCheckpoint } from "@coloride/contracts";
import { type ReactNode } from "react";
import { FileIcon, FolderClosedIcon } from "../../explorer/filetree/FileTree";
import { flattenTimelineItems } from "../presentAgentTimeline";
import { CollapsibleSection } from "./Primitives";
import { parseUnifiedDiff, stringArgument } from "./formatting";
import { CreateDirectoryIcon, ExpandChevronIcon, WriteFileIcon } from "./icons";
import {
  type AgentOpenFileRequest,
  type AgentTimelineEntry,
  type CheckpointFileStat,
} from "./types";

export const CHECKPOINT_FILE_PREVIEW = 4;

/** +/- from write/edit diffs in these timeline entries, keyed by tool path. */
export function collectTurnFileStats(
  entries: AgentTimelineEntry[],
): Map<string, CheckpointFileStat> {
  const stats = new Map<string, CheckpointFileStat>();
  for (const entry of flattenTimelineItems(entries)) {
    if (!entry || entry.kind !== "tool") continue;
    if (
      entry.tool !== "write_file" &&
      entry.tool !== "replace_in_file" &&
      entry.tool !== "delete_path"
    ) {
      continue;
    }
    const path = stringArgument(entry.arguments.path).trim();
    if (!path) continue;
    const patch = entry.diff || entry.preview;
    if (!patch) continue;
    const parsed = parseUnifiedDiff(patch, path);
    const prev = stats.get(path);
    stats.set(path, {
      additions: (prev?.additions ?? 0) + parsed.additions,
      deletions: (prev?.deletions ?? 0) + parsed.deletions,
      patch: patch || prev?.patch,
    });
  }
  return stats;
}

export function checkpointsFromEntries(
  entries: AgentTimelineEntry[],
): AgentCheckpoint[] {
  const collected: AgentCheckpoint[] = [];
  for (const entry of entries) {
    if (entry.kind === "checkpoint" && entry.checkpoint.id)
      collected.push(entry.checkpoint);
  }
  return collected;
}

export function fileNameFromPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed) || path || "file";
}

export function statForChangePath(
  stats: Map<string, CheckpointFileStat> | undefined,
  path: string,
): CheckpointFileStat | undefined {
  if (!stats || !path) return undefined;
  const direct = stats.get(path);
  if (direct) return direct;
  const normalized = path.replace(/\/+$/, "");
  const alt = stats.get(normalized);
  if (alt) return alt;
  for (const [key, value] of stats) {
    if (key === normalized) return value;
    if (key.endsWith(`/${normalized}`) || normalized.endsWith(`/${key}`))
      return value;
    if (
      fileNameFromPath(key) === fileNameFromPath(normalized) &&
      (key.endsWith(normalized) || normalized.endsWith(key))
    ) {
      return value;
    }
  }
  return undefined;
}

export function AgentCheckpointDock({
  checkpoints,
  onKeepAll,
  onReview,
  onUndoAll,
  onOpenFile,
  fileStats,
  restoring,
  reviewOpen,
  turnActive,
  /** sidebar = Explorer dock (Cursor chip). full = Agents tab (own bar). */
  variant = "full",
}: {
  checkpoints: AgentCheckpoint[];
  onKeepAll: () => void;
  onReview: () => void;
  onUndoAll: () => void;
  onOpenFile?: (request: AgentOpenFileRequest) => void;
  fileStats?: Map<string, CheckpointFileStat>;
  restoring: boolean;
  reviewOpen: boolean;
  turnActive: boolean;
  variant?: "sidebar" | "full";
}) {
  const pathCount = (() => {
    const paths = new Set<string>();
    for (const checkpoint of checkpoints) {
      for (const item of checkpoint.paths) paths.add(item.path);
    }
    return paths.size;
  })();

  const paths = (() => {
    const seen = new Set<string>();
    const rows: { path: string; kind: string; tool: string }[] = [];
    for (const checkpoint of [...checkpoints].reverse()) {
      for (const item of checkpoint.paths) {
        if (seen.has(item.path)) continue;
        seen.add(item.path);
        rows.push({ path: item.path, kind: item.kind, tool: checkpoint.tool });
      }
    }
    return rows;
  })();

  if (!checkpoints.length) return null;

  const fileCount = pathCount || checkpoints.length;
  const isSidebar = variant === "sidebar";
  const filesLabel = isSidebar
    ? fileCount === 1
      ? "1 File"
      : `${fileCount} Files`
    : fileCount === 1
      ? "1 file changed"
      : `${fileCount} files changed`;
  const changeFiles = paths.map((row) => {
    const stat = statForChangePath(fileStats, row.path);
    return {
      path: row.path,
      name: fileNameFromPath(row.path),
      kind: row.kind,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      patch: stat?.patch,
    };
  });
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);
  // Both actions wait for committed writes; accepting an in-flight checkpoint
  // would hide it before its final editor review has arrived.
  const undoBusy = restoring || turnActive;
  const keepBusy = restoring || turnActive;
  const keyIcon = (
    paths: ReactNode,
    className = "agent-review-pill-key-icon",
  ) => (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      width="12"
      xmlns="http://www.w3.org/2000/svg"
    >
      {paths}
    </svg>
  );
  const enterKeyIcon = keyIcon(
    <>
      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
      <path d="m9 10-5 5 5 5" />
    </>,
  );
  const commandKeyIcon = keyIcon(
    <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />,
  );
  const shiftKeyIcon = keyIcon(
    <path d="M9 19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-6a1 1 0 0 1 1-1h3.293a.707.707 0 0 0 .5-1.207l-7.086-7.086a1 1 0 0 0-1.414 0l-7.086 7.086a.707.707 0 0 0 .5 1.207H8a1 1 0 0 1 1 1z" />,
  );
  const deleteKeyIcon = keyIcon(
    <>
      <path d="M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />
      <path d="m12 9 6 6" />
      <path d="m18 9-6 6" />
    </>,
  );

  const openChangeFile = (file: (typeof changeFiles)[number]) => {
    if (!file.path || !onOpenFile) {
      onReview();
      return;
    }
    onOpenFile({ path: file.path, patch: file.patch });
  };

  if (!isSidebar) {
    const previewFiles = reviewOpen
      ? changeFiles
      : changeFiles.slice(0, CHECKPOINT_FILE_PREVIEW);
    const hiddenCount = Math.max(
      0,
      changeFiles.length - CHECKPOINT_FILE_PREVIEW,
    );
    const showMoreLabel =
      hiddenCount > 0
        ? reviewOpen
          ? "Show less"
          : `Show ${hiddenCount} more`
        : null;

    return (
      <div
        className={`agent-approval agent-approval-dock agent-checkpoint-dock agent-checkpoint-dock-full agent-checkpoint-card is-multi${
          reviewOpen ? " is-open" : ""
        }`}
      >
        <div className="agent-checkpoint-card-head">
          <span className="agent-checkpoint-card-count">
            {fileCount} {fileCount === 1 ? "File Changed" : "Files Changed"}
          </span>
          <div className="agent-checkpoint-card-actions">
            <div className="agent-checkpoint-card-split">
              <button
                className="agent-checkpoint-card-btn is-review"
                disabled={keepBusy}
                onClick={() => {
                  const first = changeFiles[0];
                  if (first) openChangeFile(first);
                  else onReview();
                }}
                title={
                  fileCount === 1 ? "Review this file" : "Review file changes"
                }
                type="button"
              >
                Review
              </button>
              <button
                className="agent-checkpoint-card-btn"
                disabled={undoBusy}
                onClick={onUndoAll}
                title={
                  turnActive && !restoring
                    ? "Stop the agent before undoing file changes"
                    : fileCount === 1
                      ? "Undo this file change"
                      : "Undo all agent file changes"
                }
                type="button"
              >
                {restoring ? "Undoing…" : "Undo"}
              </button>
              <button
                className="agent-checkpoint-card-btn is-keep"
                disabled={keepBusy}
                onClick={onKeepAll}
                title={
                  turnActive
                    ? "Wait for the agent to finish before keeping changes"
                    : "Keep all these changes"
                }
                type="button"
              >
                Keep all
              </button>
            </div>
          </div>
        </div>
        <div className="agent-checkpoint-card-list">
          {previewFiles.map((file) => (
            <button
              className="agent-checkpoint-card-file"
              key={file.path}
              onClick={() => openChangeFile(file)}
              title={file.path}
              type="button"
            >
              <span
                className="agent-checkpoint-card-file-icon"
                aria-hidden="true"
              >
                {file.kind === "dir" ? (
                  <FolderClosedIcon className="agent-checkpoint-tree-icon" />
                ) : (
                  <FileIcon
                    className="agent-checkpoint-tree-icon"
                    name={file.name}
                  />
                )}
              </span>
              <span className="agent-checkpoint-card-file-name">
                {file.name}
              </span>
              <span className="agent-checkpoint-card-file-meta">
                {file.additions > 0 || file.deletions > 0 ? (
                  <span
                    className="agent-checkpoint-card-stats"
                    aria-hidden="true"
                  >
                    {file.additions > 0 ? (
                      <span className="agent-diff-additions">
                        +{file.additions}
                      </span>
                    ) : null}
                    {file.deletions > 0 ? (
                      <span className="agent-diff-deletions">
                        -{file.deletions}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span
                  className="agent-checkpoint-card-file-open"
                  aria-hidden="true"
                >
                  <svg
                    fill="none"
                    height="16"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    viewBox="0 0 24 24"
                    width="16"
                  >
                    <path d="M9 6.65032C9 6.65032 15.9383 6.10759 16.9154 7.08463C17.8924 8.06167 17.3496 15 17.3496 15M16.5 7.5L6.5 17.5" />
                  </svg>
                </span>
              </span>
            </button>
          ))}
          {!changeFiles.length ? (
            <div className="agent-checkpoint-card-empty">
              Workspace state snapshot
            </div>
          ) : null}
          {showMoreLabel ? (
            <button
              className="agent-checkpoint-card-more"
              onClick={onReview}
              type="button"
            >
              {showMoreLabel}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`agent-approval agent-approval-dock agent-checkpoint-dock agent-checkpoint-dock-sidebar${
        reviewOpen ? " is-open" : ""
      }`}
    >
      <div className="agent-checkpoint-dock-main">
        <button
          aria-expanded={reviewOpen}
          className="agent-checkpoint-dock-left"
          disabled={restoring}
          onClick={onReview}
          type="button"
        >
          <span
            className={`agent-checkpoint-chevron${reviewOpen ? " is-open" : ""}`}
            aria-hidden="true"
          >
            <ExpandChevronIcon />
          </span>
          <span className="agent-approval-label">
            <span className="agent-tool-verb">{filesLabel}</span>
          </span>
        </button>
        <div className="agent-checkpoint-dock-right">
          <button
            className="agent-checkpoint-card-btn"
            disabled={undoBusy}
            onClick={onUndoAll}
            title={
              turnActive && !restoring
                ? "Stop the agent before undoing file changes"
                : "Undo all agent file changes"
            }
            type="button"
          >
            {restoring ? "Undoing…" : "Undo All"}
            {!restoring ? (
              <span className="agent-review-pill-kbd-keys" aria-hidden="true">
                {isMac ? (
                  <>
                    {shiftKeyIcon}
                    {commandKeyIcon}
                    {deleteKeyIcon}
                  </>
                ) : (
                  <>
                    <span className="agent-review-pill-mod">Ctrl</span>
                    {shiftKeyIcon}
                    {deleteKeyIcon}
                  </>
                )}
              </span>
            ) : null}
          </button>
          <button
            className="agent-checkpoint-card-btn is-review"
            disabled={keepBusy}
            onClick={onKeepAll}
            title={
              turnActive
                ? "Wait for the agent to finish before keeping changes"
                : "Keep all these changes"
            }
            type="button"
          >
            Keep All
            <span className="agent-review-pill-kbd-keys" aria-hidden="true">
              {isMac ? (
                commandKeyIcon
              ) : (
                <span className="agent-review-pill-mod">Ctrl</span>
              )}
              {enterKeyIcon}
            </span>
          </button>
        </div>
      </div>
      <CollapsibleSection
        className="agent-checkpoint-review-wrap"
        open={reviewOpen}
      >
        <div className="agent-checkpoint-review">
          {paths.map((row) => (
            <div className="agent-checkpoint-review-row" key={row.path}>
              <span className="agent-checkpoint-review-icon" aria-hidden="true">
                {row.kind === "missing" ? (
                  <CreateDirectoryIcon />
                ) : (
                  <WriteFileIcon />
                )}
              </span>
              <span className="agent-checkpoint-review-path" title={row.path}>
                {row.path}
              </span>
            </div>
          ))}
          {!paths.length ? (
            <div className="agent-checkpoint-review-row agent-muted">
              Workspace state snapshot
            </div>
          ) : null}
        </div>
      </CollapsibleSection>
    </div>
  );
}
